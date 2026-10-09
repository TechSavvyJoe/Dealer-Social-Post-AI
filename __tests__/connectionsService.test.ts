import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConnectionProofs,
  getConnections,
  saveConnection,
  testConnection,
} from "../services/connections";
import { setActiveAuthEpoch } from "../utils/authBoundary";

const response = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("managed connection service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveAuthEpoch(0);
  });

  it("uses session cookies and no-store for all connection endpoints", async () => {
    setActiveAuthEpoch(4);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ items: [] })));
    await getConnections();
    await getConnectionProofs("website", "dealer 1");
    await saveConnection("gemini", {
      expectedRevision: 7,
      enabled: true,
      settings: {},
      credentials: { apiKey: "temporary" },
    });
    await testConnection("website", {
      dealerId: "dealer-1",
      expectedRevision: 8,
      idempotencyKey: "idempotency-1",
      proofId: "proof-1",
    });

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
    }
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      "/api/app/connections/proofs?service=website&dealerId=dealer+1",
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body))).toMatchObject(
      {
        confirmApply: true,
        credentials: { apiKey: "temporary" },
      },
    );
  });

  it("rejects a response after the signed-in workspace changes", async () => {
    setActiveAuthEpoch(10);
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    const request = getConnections();
    setActiveAuthEpoch(11);
    resolveFetch(response({ scope: "guided_setup", services: [], dealers: [] }));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
