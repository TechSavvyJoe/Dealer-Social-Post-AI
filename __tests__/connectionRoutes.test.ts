import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function harness(role: string | null, request: Record<string, unknown> = {}) {
  const module = { exports: {} as Record<string, (c: unknown) => any> };
  const context = role ? { role, dealer: { id: "dealer-a" } } : null;
  const sensitive = "synthetic-secret-must-never-be-returned";
  const snapshot = {
    service: "gemini",
    scope: "global",
    enabled: true,
    configured: true,
    state: "needs_test",
    revision: 0,
    settings: {},
    credentialConfigured: { apiKey: true },
    storageReady: true,
    capabilities: {},
    verification: {},
    ciphertext: sensitive,
    values: { GEMINI_API_KEY: sensitive },
  };
  const cfg = {
    getPublicConfig: vi.fn((service: string, dealerId: string) => ({
      ...snapshot,
      service,
      scope: service === "website" ? "dealer" : "global",
      dealerId,
    })),
    saveConfig: vi.fn(() => snapshot),
    reserveVerification: vi.fn(() => ({ replay: true, result: snapshot })),
  };
  const send = vi.fn();
  const dao = {
    findRecordsByFilter: vi.fn(() => []),
    findRecordById: vi.fn((_name: string, id: string) => ({
      id,
      getBool: () => false,
    })),
  };
  runInNewContext(readFileSync(resolve("pb_hooks/connectionRoutes.js"), "utf8"), {
    module,
    __hooks: "/hooks",
    $os: { getenv: () => "" },
    $app: { dao: () => dao },
    $apis: { requestInfo: () => ({ data: request }) },
    require: (name: string) =>
      name.endsWith("helpers.js")
        ? {
            sessionContext: () => context,
            checkProxyRateLimit: () => ({ ok: true }),
            API_CONTRACT_VERSION: "contract",
            PROXY_CAPABILITIES: {},
          }
        : name.endsWith("connectionConfig.js")
          ? cfg
          : name.endsWith("requestPolicies.js")
            ? { geminiModelPolicySnapshot: () => ({ version: 5 }) }
            : { send },
  });
  const c = {
    json: (status: number, payload: unknown) => ({ status, payload }),
    response: () => ({ header: () => ({ set: vi.fn() }) }),
    request: () => ({ header: { get: () => "" } }),
    pathParam: () => request.service || "website",
    queryParam: (key: string) => request[key] || "",
  };
  return { api: module.exports, c, cfg, dao, send, sensitive };
}
describe("guided connection route boundaries", () => {
  it("keeps central setup inaccessible to unauthenticated users and dealership managers", () => {
    for (const role of [null, "salesperson", "dealer_admin"]) {
      const h = harness(role);
      expect(h.api.inventory(h.c).status).toBe(role ? 403 : 401);
      expect(h.cfg.getPublicConfig).not.toHaveBeenCalled();
    }
  });
  it("returns explicit untested state without runtime credentials or ciphertext", () => {
    const h = harness("super_admin");
    const result = h.api.inventory(h.c);
    expect(result.status).toBe(200);
    expect(result.payload.scope).toBe("guided_setup");
    expect(result.payload.services[0]).toMatchObject({
      configured: true,
      state: "needs_test",
    });
    expect(JSON.stringify(result.payload)).not.toContain(h.sensitive);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects cross-dealer and global provider tests before reserving an operation", () => {
    for (const request of [
      { service: "website", dealerId: "dealer-b" },
      { service: "gemini" },
    ]) {
      const h = harness("dealer_admin", request);
      expect(h.api.test(h.c).status).toBe(403);
      expect(h.cfg.reserveVerification).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    }
  });
  it("redacts central infrastructure settings in the dealership status view", () => {
    const h = harness("dealer_admin");
    const result = h.api.dealerStatus(h.c);
    expect(result.status).toBe(200);
    expect(result.payload.services[1]).toMatchObject({
      settings: {},
      credentialConfigured: {},
    });
    expect(JSON.stringify(result.payload)).not.toContain(h.sensitive);
  });
  it("resumes an existing operation without another private draft or video effect", () => {
    const h = harness("super_admin", {
      service: "website",
      dealerId: "dealer-a",
      proofId: "post-a",
      expectedRevision: 0,
      idempotencyKey: "repeat-operation",
    });
    expect(h.api.test(h.c).status).toBe(200);
    expect(h.cfg.reserveVerification).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});
