import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signWalkaroundRequest } from "./backend.js";

const SECRET = "unit-test-signing-secret-0123456789abcdef";

describe("walkaround v2 request signing", () => {
  it("signs the documented v2 message layout exactly", () => {
    const rawBody = JSON.stringify({ purpose: "master", expiresInSeconds: 900 });
    const { signature } = signWalkaroundRequest({
      method: "post",
      path: "api/internal/walkarounds/abc123def456ghi/assets/xyz/signed-read",
      rawBody,
      idempotencyKey: "worker-1:read:42",
      signingSecret: SECRET,
      timestamp: "1700000000",
      nonce: "00112233445566778899aabbccddeeff",
    });

    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    const expected = createHmac("sha256", SECRET)
      .update(
        [
          "v2",
          "1700000000",
          "00112233445566778899aabbccddeeff",
          "POST",
          "/api/internal/walkarounds/abc123def456ghi/assets/xyz/signed-read",
          "worker-1:read:42",
          bodyHash,
        ].join("."),
      )
      .digest("hex");
    expect(signature).toBe(expected);
  });

  it("canonicalizes the path to a single leading slash", () => {
    const base = {
      method: "get",
      rawBody: "",
      signingSecret: SECRET,
      timestamp: "1700000000",
      nonce: "00112233445566778899aabbccddeeff",
    };
    const withSlash = signWalkaroundRequest({ ...base, path: "/api/internal/x" });
    const withoutSlash = signWalkaroundRequest({ ...base, path: "api/internal/x" });
    expect(withSlash.signature).toBe(withoutSlash.signature);
  });

  it.each([
    ["method", { method: "get" }, { method: "post" }],
    [
      "path",
      { path: "api/internal/walkarounds/a/production-context" },
      { path: "api/internal/walkarounds/b/production-context" },
    ],
    [
      "idempotency key",
      { idempotencyKey: "dispatcher:claim:1" },
      { idempotencyKey: "dispatcher:claim:2" },
    ],
  ] as const)(
    "binds the %s into the signature so substitution invalidates it",
    (_label, a, b) => {
      const base = {
        method: "post",
        path: "api/internal/walkaround-tasks/claim",
        rawBody: "{}",
        idempotencyKey: "dispatcher:claim:1",
        signingSecret: SECRET,
        timestamp: "1700000000",
        nonce: "00112233445566778899aabbccddeeff",
      };
      const first = signWalkaroundRequest({ ...base, ...a });
      const second = signWalkaroundRequest({ ...base, ...b });
      expect(first.signature).not.toBe(second.signature);
    },
  );

  it("generates a fresh 32-hex nonce per request by default", () => {
    const base = {
      method: "get" as const,
      path: "api/internal/x",
      rawBody: "",
      signingSecret: SECRET,
    };
    const first = signWalkaroundRequest(base);
    const second = signWalkaroundRequest(base);
    expect(first.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(second.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(first.nonce).not.toBe(second.nonce);
  });
});
