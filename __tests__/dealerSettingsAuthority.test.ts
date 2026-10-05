/**
 * Which dealer settings a manager may change. Runs the real PATCH route and
 * the real field allowlist against fakes of the PocketBase runtime.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type AnyRecord = Record<string, unknown>;
type RouteResult = { status: number; payload: AnyRecord };

const loadCommonJs = <T>(relativePath: string): T => {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

const realHelpers = loadCommonJs<{
  dealerMutationData: (
    body: AnyRecord,
    allowCode: boolean,
    allowAdmin: boolean,
  ) => AnyRecord;
}>("pb_hooks/helpers.js");
const hookSource = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

const patchDealer = (role: string, body: AnyRecord, sessionDealerId = "dealer-1") => {
  const from = hookSource.indexOf('routerAdd("PATCH", "/api/app/dealers/:id"');
  const to = hookSource.indexOf("routerAdd(", from + 20);
  expect(from).toBeGreaterThan(-1);
  const loaded: AnyRecord[] = [];
  let handler: ((c: unknown) => RouteResult) | undefined;
  runInNewContext(hookSource.slice(from, to), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: () => ({
      dealerFromSession: () => ({ id: sessionDealerId }),
      sessionRoleFromCookie: () => role,
      restrictDealerLogoSchema: vi.fn(),
      dealerMutationData: realHelpers.dealerMutationData,
      dealerLogoFile: () => null,
      clientIP: () => "203.0.113.5",
      userAgent: () => "vitest",
      runAuditedTransaction: (
        _event: string,
        _options: unknown,
        fn: (dao: unknown) => void,
      ) => fn({}),
      safeDealerMutationError: (err: unknown) => String(err),
    }),
    $apis: { requestInfo: () => ({ data: body }) },
    $app: {
      dao: () => ({
        findRecordById: () => ({
          id: "dealer-1",
          getBool: () => false,
          collection: () => ({}),
        }),
      }),
    },
    RecordUpsertForm: function RecordUpsertForm() {
      return {
        setFullManageAccess: vi.fn(),
        setDao: vi.fn(),
        addFiles: vi.fn(),
        loadData: (data: AnyRecord) => loaded.push({ ...data }),
        submit: vi.fn(),
      };
    },
    console: { error: vi.fn(), log: vi.fn() },
  });
  const result = handler!({
    pathParam: () => "dealer-1",
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
  return { result, loaded };
};

describe("PATCH /api/app/dealers/:id — who may change what", () => {
  const body = {
    name: "Northline Motors",
    requires_approval: "true",
    creative_system_v2: "true",
  };

  it("ignores the creative-system rollout flag from a manager and saves the rest", () => {
    const { result, loaded } = patchDealer("dealer_admin", body);
    expect(result.status).toBe(200);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      name: "Northline Motors",
      requires_approval: true,
    });
    expect(loaded[0]).not.toHaveProperty("creative_system_v2");
  });

  it("lets the system administrator switch the creative system for a store", () => {
    const { result, loaded } = patchDealer("super_admin", body);
    expect(result.status).toBe(200);
    expect(loaded[0]).toMatchObject({
      creative_system_v2: true,
      requires_approval: true,
    });
  });

  it("still refuses a salesperson and a manager of another store", () => {
    expect(patchDealer("salesperson", body).result.status).toBe(403);
    expect(patchDealer("dealer_admin", body, "dealer-2").result.status).toBe(403);
  });
});
