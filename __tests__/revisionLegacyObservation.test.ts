import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeObservation } from "../scripts/revision-legacy-observation.mjs";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const DAY = 86400000;
const now = Date.parse("2026-10-08T12:00:00Z");
const date = (ms: number) => new Date(ms).toISOString();
const health = {
  ok: true,
  releaseSha: "a".repeat(40),
  revisionCompatibility: {
    coverage: "durable-deployment-window",
    observedSince: date(now - 8 * DAY),
    clearSince: date(now - 7 * DAY),
    eligibleAfter: date(now),
    ready: true,
  },
};
afterEach(() => vi.useRealTimers());

describe("durable revision observation", () => {
  it("requires seven full days of continuous evidence", () => {
    expect(summarizeObservation(health, date(now)).status).toBe(
      "ready-for-stage-c-review",
    );
    expect(() => summarizeObservation(health, date(now - 1))).toThrow();
    expect(
      summarizeObservation(
        {
          ...health,
          revisionCompatibility: { ...health.revisionCompatibility, ready: false },
        },
        date(now),
      ).status,
    ).toBe("observing");
  });
  it("rejects missing, malformed, inconsistent or unhealthy evidence", () => {
    for (const revisionCompatibility of [
      undefined,
      {},
      { ...health.revisionCompatibility, coverage: "recent-buffer-snapshot" },
      { ...health.revisionCompatibility, clearSince: date(now + 1) },
      { ...health.revisionCompatibility, eligibleAfter: date(now - DAY) },
    ]) {
      expect(() =>
        summarizeObservation({ ...health, revisionCompatibility }, date(now)),
      ).toThrow();
    }
    expect(() => summarizeObservation({ ...health, ok: false }, date(now))).toThrow();
    expect(() =>
      summarizeObservation({ ...health, releaseSha: "unknown" }, date(now)),
    ).toThrow();
  });
  it("persists both legacy paths, preserves routine restarts and resets on deployment, and supports migration rollback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sqlite = new DatabaseSync(":memory:");
    const db = {
      newQuery(sql: string) {
        let params: Record<string, number | string> = {};
        const statement = () => sqlite.prepare(sql.replace(/\{:(\w+)\}/g, ":$1"));
        return {
          bind(values: Record<string, number | string>) {
            params = values;
            return this;
          },
          execute() {
            statement().run(params);
          },
          one(row: Record<string, unknown>) {
            const result = statement().get(params);
            if (!result) throw new Error("missing row");
            Object.assign(row, result);
          },
        };
      },
    };
    let up!: (db: unknown) => void;
    let down!: (db: unknown) => void;
    new Function(
      "migrate",
      readFileSync("pb_migrations/1752500000_revision_observation.js", "utf8"),
    )((forward: typeof up, backward: typeof down) => {
      up = forward;
      down = backward;
    });
    up(db);
    let epoch = "deployment-one";
    const module = {
      exports: {} as {
        beginWindow(): void;
        recordLegacy(route: string): void;
        snapshot(): typeof health.revisionCompatibility;
      },
    };
    new Function(
      "$app",
      "$os",
      "DynamicModel",
      "module",
      "exports",
      readFileSync("pb_hooks/revisionCompatibility.js", "utf8"),
    )(
      { dao: () => ({ db: () => db }) },
      { getenv: (name: string) => (name === "RELEASE_SHA" ? "a".repeat(40) : epoch) },
      function (this: object, values: object) {
        Object.assign(this, values);
      },
      module,
      module.exports,
    );
    const observer = module.exports;
    expect(() => observer.snapshot()).toThrow();
    observer.beginWindow();
    expect(observer.snapshot().ready).toBe(false);
    vi.setSystemTime(now + 7 * DAY);
    expect(observer.snapshot().ready).toBe(true);
    observer.recordLegacy("draft");
    observer.recordLegacy("share");
    observer.recordLegacy("share");
    expect(observer.snapshot()).toMatchObject({
      ready: false,
      clearSince: date(now + 7 * DAY),
      eligibleAfter: date(now + 14 * DAY),
    });
    expect(
      sqlite
        .prepare("SELECT draft_requests, share_requests FROM _revision_compatibility")
        .get(),
    ).toEqual({ draft_requests: 1, share_requests: 2 });
    vi.setSystemTime(now + 14 * DAY);
    expect(observer.snapshot().ready).toBe(true);
    observer.beginWindow();
    expect(observer.snapshot().ready).toBe(true);
    epoch = "deployment-two";
    expect(() => observer.snapshot()).toThrow();
    observer.beginWindow();
    expect(observer.snapshot()).toMatchObject({
      ready: false,
      observedSince: date(now + 14 * DAY),
    });
    expect(() => observer.recordLegacy("other")).toThrow();
    down(db);
    expect(() => observer.recordLegacy("draft")).toThrow();
    expect(() => observer.snapshot()).toThrow();
    up(db);
    observer.beginWindow();
    expect(observer.snapshot().ready).toBe(false);
    sqlite.close();
  });
});
