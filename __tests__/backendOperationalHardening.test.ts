import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type HelperModule = {
  checkProxyRateLimit: (
    key: string,
    maxPerWindow: number,
    windowMs: number,
  ) => { ok: boolean };
  proxyRateLimitStateSize: () => number;
  acquireProxyConcurrency: (
    key: string,
    maxConcurrent: number,
  ) => { ok: boolean; release?: () => void };
  upstreamContentLength: (response: unknown) => number | null;
  logCoalescedAuthEvent: (
    kind: string,
    options: Record<string, unknown>,
    windowSeconds: number,
    globalMaxPerWindow: number,
  ) => boolean;
};

const runtime = globalThis as unknown as Record<string, any>;
const savedRuntime = {
  $app: runtime.$app,
  Record: runtime.Record,
};

afterEach(() => {
  runtime.$app = savedRuntime.$app;
  runtime.Record = savedRuntime.Record;
});

function loadHelpers(): HelperModule {
  const source = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
  const module = { exports: {} as HelperModule };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

describe("backend operational hardening", () => {
  it("bounds expiring rate state and releases provider concurrency slots", () => {
    const helpers = loadHelpers();
    for (let index = 0; index < 3000; index += 1) {
      helpers.checkProxyRateLimit(`telemetry:203.0.113.${index}`, 30, 60_000);
    }
    expect(helpers.proxyRateLimitStateSize()).toBeLessThanOrEqual(2048);

    const first = helpers.acquireProxyConcurrency("provider:dealer-a", 2);
    const second = helpers.acquireProxyConcurrency("provider:dealer-a", 2);
    const blocked = helpers.acquireProxyConcurrency("provider:dealer-a", 2);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(blocked.ok).toBe(false);

    first.release?.();
    first.release?.();
    expect(helpers.acquireProxyConcurrency("provider:dealer-a", 2).ok).toBe(true);
  });

  it("parses Content-Length conservatively", () => {
    const helpers = loadHelpers();
    expect(
      helpers.upstreamContentLength({
        headers: { "Content-Length": "10485761" },
      }),
    ).toBe(10_485_761);
    expect(
      helpers.upstreamContentLength({
        headers: { "content-length": ["25"] },
      }),
    ).toBe(25);
    expect(
      helpers.upstreamContentLength({
        headers: { "content-length": "not-a-number" },
      }),
    ).toBeNull();
  });

  it("coalesces repeated unauthenticated audit events and caps distributed samples", () => {
    const helpers = loadHelpers();
    const events: Array<Record<string, unknown>> = [];
    runtime.Record = class {
      values: Record<string, unknown>;

      constructor(_collection: unknown, values: Record<string, unknown>) {
        this.values = { ...values };
      }
    };
    const dao = {
      findCollectionByNameOrId: () => ({ id: "auth_events" }),
      saveRecord: (record: { values: Record<string, unknown> }) => {
        events.push(record.values);
      },
      findRecordsByFilter: (
        _collection: string,
        _filter: string,
        _sort: string,
        _limit: number,
        _offset: number,
        params: Record<string, string>,
      ) =>
        events.filter((event) => event.kind === params.kind && event.ip === params.ip),
    };
    runtime.$app = { dao: () => dao };

    for (let repeat = 0; repeat < 20; repeat += 1) {
      expect(
        helpers.logCoalescedAuthEvent(
          "proxy_unauthorized",
          { ip: "203.0.113.9", detail: "no session" },
          900,
          3,
        ),
      ).toBe(true);
    }
    for (let index = 0; index < 20; index += 1) {
      helpers.logCoalescedAuthEvent(
        "proxy_unauthorized",
        { ip: `198.51.100.${index}`, detail: "no session" },
        900,
        3,
      );
    }
    expect(events).toHaveLength(3);
  });

  it("wires retention, transactional audits, atomic provenance, aggregates, and dealer pagination", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1750700000_backend_operational_hardening.js",
      ),
      "utf8",
    );

    expect(hook).toContain("DELETE FROM auth_events WHERE created < {:cutoff}");
    expect(migration).toContain("idx_auth_events_kind_ip_created");
    for (const kind of ["dealer_created", "dealer_updated", "dealer_deleted"]) {
      expect(migration).toContain(`"${kind}"`);
      expect(hook).toContain(`"${kind}"`);
    }

    const impersonation = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/session/impersonate"'),
      hook.indexOf('routerAdd("DELETE", "/api/app/session"'),
    );
    expect(impersonation).toContain(
      'runAuditedTransaction(\n      "impersonate_start"',
    );
    expect(impersonation).toContain('kind: "impersonate_exit"');
    expect(impersonation).not.toContain('logAuthEvent("impersonate_start"');

    const posts = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/posts"'),
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/video-generated"'),
    );
    expect(posts.indexOf("helpers.claimGenerationEvents(")).toBeLessThan(
      posts.indexOf("form.submit()"),
    );
    expect(posts.indexOf("helpers.finalizeGenerationEventClaims(")).toBeGreaterThan(
      posts.indexOf("form.submit()"),
    );
    expect(posts).not.toContain('event.set("consumed_post"');
    expect(helpers).toContain("AND (consumed_post = '' OR consumed_post IS NULL)");
    expect(helpers).toContain("$app.dao().runInTransaction(function (txDao)");

    const health = hook.slice(
      hook.indexOf('routerAdd("GET", "/api/app/health"'),
      hook.indexOf('routerAdd("POST", "/api/telemetry"'),
    );
    expect(health.indexOf('set("Cache-Control", "private, no-store")')).toBeLessThan(
      health.indexOf("helpers.sessionContext(c)"),
    );
    expect(health.indexOf('set("Vary", "Cookie")')).toBeLessThan(
      health.indexOf("helpers.sessionContext(c)"),
    );
    expect(health).toContain("SELECT COUNT(*) AS total");
    expect(health).toContain("GROUP BY COALESCE");
    expect(health).toContain("new DynamicModel({ total: 0 })");
    expect(health).toContain('arrayOf(new DynamicModel({ name: "", count: 0 }))');
    expect(health).not.toContain("findRecordsByFilter(");

    const dealerList = hook.slice(hook.indexOf('routerAdd("GET", "/api/app/dealers"'));
    expect(dealerList).toContain('c.queryParam("limit")');
    expect(dealerList).toContain("payload.nextCursor");
    expect(dealerList).toContain("total: records.length");
  });
});
