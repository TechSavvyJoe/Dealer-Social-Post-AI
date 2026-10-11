import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const admin = { role: "super_admin" };
const manager = { role: "dealer_admin", dealer: { id: "dealer-a" } };
const syntheticKey = "synthetic-only-key".padEnd(32, "1");
const apiSecret = "synthetic-provider-credential";
class Row {
  id = "";
  values: Record<string, any>;
  collection: string;
  constructor(collection: string, values: Record<string, any> = {}) {
    this.collection = collection;
    this.values = { ...values };
  }
  get(key: string) {
    return this.values[key];
  }
  getString(key: string) {
    return String(this.values[key] ?? "");
  }
  getBool(key: string) {
    return !!this.values[key];
  }
  set(key: string, value: any) {
    this.values[key] = value;
  }
}
function load(file: string, globals: Record<string, any> = {}) {
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  new Function("module", "exports", ...Object.keys(globals), source(file))(
    module,
    module.exports,
    ...Object.values(globals),
  );
  return module.exports;
}
function harness() {
  const env: Record<string, string> = {
    CONNECTIONS_ENCRYPTION_KEY: syntheticKey,
    GEMINI_API_KEY: apiSecret,
    ANTHROPIC_API_KEY: apiSecret,
    OPENAI_API_KEY: apiSecret,
    ENABLE_CLAUDE_FALLBACK: "true",
    ENABLE_OPENAI_FALLBACK: "true",
    CONNECTIONS_ALLOWED_ORIGINS: "https://approved.example",
  };
  const rows: Row[] = [];
  let nextId = 0;
  let storageFailure = false;
  const policies = load("pb_hooks/requestPolicies.js");
  const originalPolicy = policies.geminiModelPolicySnapshot;
  let modelVersion = 0;
  policies.geminiModelPolicySnapshot = () => ({
    ...originalPolicy(),
    testVersion: modelVersion,
  });
  const dao: any = {
    findCollectionByNameOrId: (name: string) => name,
    findRecordsByFilter: (
      collection: string,
      filter: string,
      sort: string,
      _limit: number,
      _offset: number,
      params: any,
    ) => {
      if (storageFailure) throw new Error("synthetic secret in storage error");
      if (!filter || filter === 'id != ""')
        return rows.filter((row) => row.collection === collection).slice(0, 5001);
      if (filter === "scope = 'dealer' && service = 'website' && enabled = true") {
        expect(_limit).toBe(10);
        return rows
          .filter(
            (row) =>
              row.collection === collection &&
              row.getString("scope") === "dealer" &&
              row.getString("service") === "website" &&
              row.getBool("enabled"),
          )
          .slice(_offset, _offset + _limit);
      }
      const found = rows.filter(
        (row) =>
          row.collection === collection &&
          ["scope", "dealer", "service"].every(
            (key) => row.getString(key) === params[key],
          ) &&
          (!filter.includes("key_hash") ||
            row.getString("key_hash") === params.keyHash),
      );
      return sort ? found.reverse().slice(0, 1) : found.slice(0, 1);
    },
    findRecordById: (collection: string, id: string) => {
      const row = rows.find((row) => row.collection === collection && row.id === id);
      if (!row) throw new Error("missing");
      return row;
    },
    saveRecord: (row: Row) => {
      if (!row.id) {
        row.id = "row" + ++nextId;
        rows.push(row);
      }
    },
    db: () => ({ newQuery: () => ({ execute: vi.fn() }) }),
    runInTransaction: (callback: (dao: any) => void) => {
      const prior = rows.map((row) => ({ row, values: { ...row.values } }));
      try {
        callback(dao);
      } catch (error) {
        rows.splice(
          0,
          rows.length,
          ...prior.map((item) => {
            item.row.values = item.values;
            return item.row;
          }),
        );
        throw error;
      }
    },
  };
  const encrypt = (value: string, key: string) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), nonce);
    const body = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
  };
  const decrypt = vi.fn((text: string, key: string) => {
    const bytes = Buffer.from(text, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(12, -16)),
      decipher.final(),
    ]).toString();
  });
  const api = load("pb_hooks/connectionConfig.js", {
    $app: { dao: () => dao },
    $os: { getenv: (name: string) => env[name] || "" },
    $security: {
      encrypt,
      decrypt,
      sha256: sha,
      randomString: () => "synthetic-attempt-token-0000000001",
    },
    Record: Row,
    __hooks: "/hooks",
    require: () => policies,
    toString: (value: any) => String(value),
  });
  const save = (service = "gemini", revision = 0, changes: any = {}) =>
    api.saveConfig(
      service,
      service === "website" ? "dealer-a" : undefined,
      { confirmApply: true, expectedRevision: revision, enabled: true, ...changes },
      revision,
      admin,
    );
  const reserve = (
    service = "gemini",
    revision = 0,
    idempotencyKey = "synthetic-op-1",
    extra = {},
  ) =>
    api.reserveVerification(
      service,
      service === "website" ? "dealer-a" : undefined,
      revision,
      admin,
      { idempotencyKey, ...extra },
    );
  return {
    api,
    rows,
    env,
    save,
    reserve,
    encrypt,
    decrypt,
    setStorageFailure: () => {
      storageFailure = true;
    },
    changePolicy: () => {
      modelVersion++;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("encrypted managed connection config", () => {
  function canaryHarness() {
    const h = harness();
    Object.assign(h.env, {
      CUSTOMER_HUB_URL: "https://approved.example",
      CUSTOMER_HUB_DESTINATION_ID: "joe_customer_hub",
      CUSTOMER_HUB_DEALER_ID: "dealer-a",
      CUSTOMER_HUB_SECRET: "r".repeat(48),
      CUSTOMER_HUB_CANARY_DEALER_ID: "dealer-canary",
      CUSTOMER_HUB_CANARY_SECRET: "c".repeat(48),
    });
    return h;
  }
  it("isolates the exact server canary dealer and binds credential rotation to its identity", () => {
    const h = canaryHarness();
    const real = h.api.runtimeSnapshot("website", "dealer-a");
    const canary = h.api.runtimeSnapshot("website", "dealer-canary");
    expect(canary).toMatchObject({
      enabled: true,
      configured: true,
      values: {
        CUSTOMER_HUB_DEALER_ID: "dealer-canary",
        CUSTOMER_HUB_SECRET: "c".repeat(48),
        CUSTOMER_HUB_URL: "https://approved.example",
        CUSTOMER_HUB_DESTINATION_ID: "joe_customer_hub",
      },
    });
    expect(canary.identity).not.toBe(real.identity);
    expect(h.api.runtimeSnapshot("website", "dealer-other").configured).toBe(false);
    const publicConfig = h.api.getPublicConfig("website", "dealer-canary");
    expect(JSON.stringify(publicConfig)).not.toContain("c".repeat(48));
    expect(JSON.stringify(publicConfig)).not.toContain(canary.identity);
    h.env.CUSTOMER_HUB_CANARY_SECRET = "d".repeat(48);
    expect(h.api.runtimeSnapshot("website", "dealer-canary").identity).not.toBe(
      canary.identity,
    );
    expect(h.api.runtimeSnapshot("website", "dealer-a").identity).toBe(real.identity);
  });
  it.each(["", "short", "r".repeat(48), " c".repeat(24)])(
    "holds an invalid canary secret without changing the real connection",
    (secret) => {
      const h = canaryHarness();
      const real = h.api.runtimeSnapshot("website", "dealer-a");
      h.env.CUSTOMER_HUB_CANARY_SECRET = secret;
      expect(h.api.runtimeSnapshot("website", "dealer-canary")).toMatchObject({
        enabled: false,
        configured: false,
      });
      expect(h.api.runtimeSnapshot("website", "dealer-a")).toEqual(real);
    },
  );
  it("holds an incomplete or whitespace-padded canary identity without affecting real delivery", () => {
    const h = canaryHarness();
    const real = h.api.runtimeSnapshot("website", "dealer-a");
    h.env.CUSTOMER_HUB_CANARY_DEALER_ID = " dealer-canary ";
    expect(h.api.runtimeSnapshot("website", "dealer-canary")).toMatchObject({
      enabled: false,
      configured: false,
    });
    expect(h.api.runtimeSnapshot("website", "dealer-a")).toEqual(real);
    delete h.env.CUSTOMER_HUB_CANARY_DEALER_ID;
    expect(h.api.runtimeSnapshot("website", "dealer-canary").configured).toBe(false);
  });
  it("keeps managed canary off authoritative and invalidates a pinned managed identity after server key rotation", () => {
    const h = canaryHarness();
    h.api.saveConfig(
      "website",
      "dealer-canary",
      { enabled: true, confirmApply: true, expectedRevision: 0 },
      0,
      admin,
    );
    const current = h.api.runtimeSnapshot("website", "dealer-canary");
    expect(current).toMatchObject({
      enabled: true,
      configured: true,
      source: "managed",
      revision: 1,
    });
    h.env.CUSTOMER_HUB_CANARY_SECRET = "d".repeat(48);
    const changed = h.api.runtimeSnapshot("website", "dealer-canary");
    expect(changed).toMatchObject({ enabled: false, configured: false });
    expect(changed.identity).not.toBe(current.identity);
    h.env.CUSTOMER_HUB_CANARY_SECRET = "c".repeat(48);
    h.api.saveConfig(
      "website",
      "dealer-canary",
      { enabled: false, confirmApply: true, expectedRevision: 1 },
      1,
      admin,
    );
    expect(h.api.runtimeSnapshot("website", "dealer-canary")).toMatchObject({
      enabled: false,
      source: "managed",
      revision: 2,
    });
    expect(h.api.runtimeSnapshot("website", "dealer-a").enabled).toBe(true);
  });
  it("never replaces the real mapping when the canary dealer overlaps", () => {
    const h = canaryHarness();
    const real = h.api.runtimeSnapshot("website", "dealer-a");
    h.env.CUSTOMER_HUB_CANARY_DEALER_ID = "dealer-a";
    expect(h.api.runtimeSnapshot("website", "dealer-a")).toEqual(real);
    expect(h.api.runtimeSnapshot("website", "dealer-canary").configured).toBe(false);
  });
  it("uses the real managed target but rejects client-selected canary targets and credentials", () => {
    const h = canaryHarness();
    h.save("website", 0, {
      settings: { origin: "https://approved.example", destinationId: "managed-hub" },
      credentials: { sharedSecret: "m".repeat(48) },
    });
    expect(
      h.api.runtimeSnapshot("website", "dealer-canary").values
        .CUSTOMER_HUB_DESTINATION_ID,
    ).toBe("managed-hub");
    h.api.saveConfig(
      "website",
      "dealer-canary",
      {
        enabled: true,
        confirmApply: true,
        expectedRevision: 0,
        settings: {
          origin: "https://approved.example",
          destinationId: "client-picked",
        },
        credentials: { sharedSecret: "x".repeat(48) },
      },
      0,
      admin,
    );
    expect(h.api.runtimeSnapshot("website", "dealer-canary")).toMatchObject({
      enabled: false,
      configured: false,
      source: "managed",
    });
    expect(h.api.runtimeSnapshot("website", "dealer-a")).toMatchObject({
      enabled: true,
      configured: true,
    });
  });
  it("holds canary mapping on real credential overlap or managed storage failure", () => {
    const h = canaryHarness();
    h.save("website", 0, {
      settings: { origin: "https://approved.example", destinationId: "managed-hub" },
      credentials: { sharedSecret: h.env.CUSTOMER_HUB_CANARY_SECRET },
    });
    expect(h.api.runtimeSnapshot("website", "dealer-canary").enabled).toBe(false);
    expect(h.api.runtimeSnapshot("website", "dealer-a").enabled).toBe(true);
    h.setStorageFailure();
    expect(h.api.runtimeSnapshot("website", "dealer-canary").enabled).toBe(false);
  });
  it("writes authenticated ciphertext and returns only credential presence", () => {
    const h = harness();
    const result = h.save("gemini", 0, {
      credentials: { apiKey: "synthetic-new-credential" },
    });
    expect(result.revision).toBe(1);
    expect(result.credentialConfigured.apiKey).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-new-credential|ciphertext|identity/,
    );
    expect(JSON.stringify(h.rows[0].values)).not.toContain("synthetic-new-credential");
    expect(h.api.runtimeValue("GEMINI_API_KEY")).toBe("synthetic-new-credential");
  });
  it("finds a healthy destination after incomplete, corrupt or deleted store candidates", () => {
    const h = harness();
    for (const id of ["dealer-a", "dealer-b"]) {
      const dealer = new Row("dealers");
      dealer.id = id;
      h.rows.push(dealer);
    }
    h.save("website", 0);
    h.api.saveConfig(
      "website",
      "dealer-b",
      {
        confirmApply: true,
        expectedRevision: 0,
        enabled: true,
        settings: {
          origin: "https://approved.example",
          destinationId: "dealer-b-destination",
        },
        credentials: {
          sharedSecret: "synthetic-website-secret-at-least-32-characters",
        },
      },
      0,
      admin,
    );
    expect(h.api.hasConfiguredWebsite()).toBe(true);
    const broken = h.rows.find(
      (row) =>
        row.collection === "managed_connections" &&
        row.getString("dealer") === "dealer-a",
    )!;
    broken.set("ciphertext", "corrupt");
    expect(h.api.hasConfiguredWebsite()).toBe(true);
    h.rows.splice(
      h.rows.findIndex((row) => row.collection === "dealers" && row.id === "dealer-a"),
      1,
    );
    expect(h.api.hasConfiguredWebsite()).toBe(true);
    h.api.saveConfig(
      "website",
      "dealer-b",
      { confirmApply: true, expectedRevision: 1, enabled: false },
      1,
      admin,
    );
    expect(h.api.hasConfiguredWebsite()).toBe(false);
  });
  it("requires dedicated encryption key, explicit apply and current revision", () => {
    const h = harness();
    delete h.env.CONNECTIONS_ENCRYPTION_KEY;
    expect(() => h.save()).toThrow("CONNECTION_SECURE_STORAGE_REQUIRED");
    h.env.CONNECTIONS_ENCRYPTION_KEY = syntheticKey;
    expect(() => h.save("gemini", 0, { confirmApply: false })).toThrow(
      "CONNECTION_APPLY_CONFIRMATION_REQUIRED",
    );
    h.save();
    expect(() => h.save()).toThrow("CONNECTION_REVISION_CONFLICT");
    expect(h.rows[0].get("revision")).toBe(1);
  });
  it("rejects unrecognized settings, credentials and caller scope claims", () => {
    const h = harness();
    expect(() => h.save("gemini", 0, { credentials: { token: "synthetic" } })).toThrow(
      "CONNECTION_FIELDS_INVALID",
    );
    expect(() => h.api.saveConfig("gemini", "dealer-a", {}, 0, admin)).toThrow(
      "CONNECTION_SCOPE_INVALID",
    );
    expect(() => h.save("gemini", 0, { scope: "dealer" })).toThrow(
      "CONNECTION_FIELDS_INVALID",
    );
  });
  it("rejects malformed optional objects and operation binding fields", () => {
    const h = harness();
    for (const value of [false, null, "", []])
      expect(() => h.save("gemini", 0, { credentials: value })).toThrow(
        "CONNECTION_FIELDS_INVALID",
      );
    expect(() => h.reserve("gemini", 0, "synthetic-op-1", { proofId: 0 })).toThrow(
      "CONNECTION_PROOF_INVALID",
    );
    expect(() =>
      h.reserve("gemini", 0, "synthetic-op-1", { targetDealerId: false }),
    ).toThrow("CONNECTION_PROOF_INVALID");
  });
  it("resolves managed enable flags consistently with runtime credentials", () => {
    const h = harness();
    h.save("anthropic", 0, { enabled: false });
    expect(h.api.runtimeValue("ENABLE_CLAUDE_FALLBACK")).toBe("false");
    expect(h.api.runtimeValue("ANTHROPIC_API_KEY")).toBe("");
    h.save("anthropic", 1);
    expect(h.api.runtimeValue("ENABLE_CLAUDE_FALLBACK")).toBe("true");
    expect(h.api.runtimeValue("ANTHROPIC_API_KEY")).toBe(apiSecret);
  });
  it("rejects malformed ciphertext before invoking PocketBase decrypt", () => {
    const h = harness();
    h.save();
    h.decrypt.mockClear();
    h.rows[0].set("ciphertext", "AAAA");
    expect(h.api.getPublicConfig("gemini").state).toBe("attention");
    expect(h.decrypt).not.toHaveBeenCalled();
    for (const value of ["", "A".repeat(36), "A".repeat(40000), "!".repeat(40)])
      expect(h.api.validCiphertext(value)).toBe(false);
  });
  it("enforces dealer authorization and excludes global inventory from managers", () => {
    const h = harness();
    expect(() => h.api.authorize("gemini", undefined, manager)).toThrow(
      "CONNECTION_FORBIDDEN",
    );
    expect(() => h.api.authorize("website", "dealer-b", manager)).toThrow(
      "CONNECTION_FORBIDDEN",
    );
    expect(
      h.api.inventory("dealer-a", manager).map((item: any) => item.service),
    ).toEqual(["website"]);
    expect(() => h.api.inventory("dealer-b", manager)).toThrow("CONNECTION_FORBIDDEN");
    expect(() =>
      h.api.authorize("website", "dealer-a", { ...manager, role: "salesperson" }),
    ).toThrow("CONNECTION_FORBIDDEN");
  });
  it("managed off never falls back to environment and preserves write-only credentials", () => {
    const h = harness();
    h.save("gemini", 0, { enabled: false });
    expect(h.api.runtimeValue("GEMINI_API_KEY")).toBe("");
    expect(h.api.getPublicConfig("gemini").state).toBe("off");
    h.save("gemini", 1);
    expect(h.api.runtimeValue("GEMINI_API_KEY")).toBe(apiSecret);
  });
  it.each(["scope", "dealer", "service", "revision", "enabled"])(
    "binds ciphertext to the %s column",
    (field) => {
      const h = harness();
      h.save();
      const row = h.rows[0];
      const envelope = JSON.parse(h.decrypt(row.getString("ciphertext"), syntheticKey));
      envelope[field] =
        field === "revision" ? 2 : field === "enabled" ? false : "mismatch";
      row.set("ciphertext", h.encrypt(JSON.stringify(envelope), syntheticKey));
      expect(h.api.runtimeValue("GEMINI_API_KEY")).toBe("");
      expect(h.api.getPublicConfig("gemini").code).toBe("CONNECTION_CONFIG_CORRUPT");
    },
  );
  it("fails closed on tamper, wrong key, short ciphertext and storage failure", () => {
    for (const mode of ["tamper", "wrong-key", "short", "storage"]) {
      const h = harness();
      h.save();
      if (mode === "tamper") {
        const bytes = Buffer.from(h.rows[0].getString("ciphertext"), "base64");
        bytes[20] ^= 1;
        h.rows[0].set("ciphertext", bytes.toString("base64"));
      }
      if (mode === "wrong-key")
        h.env.CONNECTIONS_ENCRYPTION_KEY = "synthetic-only-key".padEnd(32, "2");
      if (mode === "short") h.rows[0].set("ciphertext", "AAAA");
      if (mode === "storage") h.setStorageFailure();
      expect(h.api.runtimeValue("GEMINI_API_KEY")).toBe("");
      expect(h.api.getPublicConfig("gemini").source).toBe("managed");
      expect(JSON.stringify(h.api.getPublicConfig("gemini"))).not.toContain(
        "synthetic secret",
      );
    }
  });
  it("audits encrypted restore recoverability without endpoint approval or secret output", () => {
    const h = harness();
    h.save();
    h.save("website", 0, {
      settings: { origin: "https://approved.example", destinationId: "site" },
      credentials: { sharedSecret: "synthetic-shared-secret".repeat(3) },
    });
    h.env.CONNECTIONS_ALLOWED_ORIGINS = "";
    expect(h.api.verifyStoredEncryption()).toEqual({ ok: true, count: 2 });
    h.env.CONNECTIONS_ENCRYPTION_KEY = "synthetic-only-key".padEnd(32, "2");
    expect(h.api.verifyStoredEncryption()).toEqual({ ok: false, count: 2 });
    h.env.CONNECTIONS_ENCRYPTION_KEY = syntheticKey;
    h.rows[0].set("ciphertext", "AAAA");
    expect(h.api.verifyStoredEncryption()).toEqual({ ok: false, count: 2 });
    expect(JSON.stringify(h.api.verifyStoredEncryption())).not.toMatch(
      /ciphertext|synthetic|scope|dealer/,
    );
  });
  it("bounds encrypted restore audit and rejects wrong record scope", () => {
    const h = harness();
    h.save();
    h.rows[0].set("scope", "dealer");
    expect(h.api.verifyStoredEncryption()).toEqual({ ok: false, count: 1 });
    const many = harness();
    for (let index = 0; index < 5001; index++)
      many.rows.push(new Row("managed_connections"));
    expect(many.api.verifyStoredEncryption()).toEqual({ ok: false, count: 5001 });
  });
  it("allows exact canonical existing server destinations and never learns managed domains", () => {
    const h = harness();
    h.env.CONNECTIONS_ALLOWED_ORIGINS = "";
    h.env.CUSTOMER_HUB_URL = "https://legacy.example";
    expect(h.api.approvedOrigin("https://legacy.example")).toBe(true);
    expect(h.api.approvedOrigin("https://legacy.example.evil.example")).toBe(false);
    expect(h.api.approvedOrigin("https://legacy.example/path")).toBe(false);
    h.env.WALKAROUND_UPLOAD_BROKER_URL = "https://upload.example/path";
    expect(h.api.approvedOrigin("https://upload.example")).toBe(false);
    h.save("website", 0, {
      settings: { origin: "https://legacy.example", destinationId: "site" },
      credentials: { sharedSecret: "synthetic-shared-secret".repeat(3) },
    });
    delete h.env.CUSTOMER_HUB_URL;
    expect(h.api.approvedOrigin("https://legacy.example")).toBe(false);
  });
  it("requires approved canonical origin and revokes existing managed destinations", () => {
    const h = harness();
    const credentials = { sharedSecret: "synthetic-shared-secret".repeat(3) };
    expect(() =>
      h.save("website", 0, {
        settings: { origin: "https://evil.example", destinationId: "site" },
        credentials,
      }),
    ).toThrow("CONNECTION_ORIGIN_NOT_APPROVED");
    h.save("website", 0, {
      settings: { origin: "https://approved.example", destinationId: "site" },
      credentials,
    });
    expect(h.api.runtimeValue("CUSTOMER_HUB_URL", "dealer-a")).toBe(
      "https://approved.example",
    );
    expect(h.api.runtimeValue("CUSTOMER_HUB_URL", "dealer-b")).toBe("");
    h.env.CONNECTIONS_ALLOWED_ORIGINS = "";
    expect(h.api.runtimeValue("CUSTOMER_HUB_URL", "dealer-a")).toBe("");
  });
});

describe("durable connection proof ledger", () => {
  it("reserves before effects and replays completed results without a new attempt", () => {
    const h = harness();
    const ticket = h.reserve();
    expect(h.rows[0].getString("state")).toBe("testing");
    expect(h.rows[0].getString("attempt_hash")).toBe(sha(ticket.token));
    const result = h.api.finalizeVerification(ticket, {
      ok: true,
      capabilities: ["text"],
    });
    expect(result.state).toBe("ready");
    expect(result.capabilities.images).toBe(false);
    expect(h.reserve().replay).toBe(true);
    expect(h.rows.length).toBe(1);
    expect(JSON.stringify(h.reserve().result)).not.toMatch(
      /identity|attempt_hash|synthetic-attempt/,
    );
  });
  it("rejects reused operation keys with changed revision, target or proof", () => {
    for (const extra of [{ proofId: "other-proof" }, { targetDealerId: "dealer-b" }]) {
      const h = harness();
      h.reserve();
      expect(() => h.reserve("gemini", 0, "synthetic-op-1", extra)).toThrow(
        "CONNECTION_OPERATION_CONFLICT",
      );
    }
    const h = harness();
    h.reserve();
    h.save();
    expect(() => h.reserve("gemini", 1)).toThrow("CONNECTION_OPERATION_CONFLICT");
  });
  it("blocks another active test and treats lost response as unknown after 45 seconds", () => {
    vi.useFakeTimers();
    const h = harness();
    h.reserve();
    expect(() => h.reserve("gemini", 0, "synthetic-op-2")).toThrow(
      "CONNECTION_TEST_BUSY",
    );
    vi.advanceTimersByTime(45001);
    expect(h.api.getPublicConfig("gemini").verification.state).toBe("unknown");
    expect(h.reserve().state).toBe("unknown");
    expect(h.rows.length).toBe(1);
  });
  it("rejects stale completions after config changes or test lease expiry", () => {
    const h = harness();
    const ticket = h.reserve();
    h.save();
    expect(() =>
      h.api.finalizeVerification(ticket, { ok: true, capabilities: ["text"] }),
    ).toThrow("CONNECTION_PROOF_STALE");
    expect(h.api.getPublicConfig("gemini").state).toBe("needs_test");
    vi.useFakeTimers();
    const second = harness();
    const expired = second.reserve();
    vi.advanceTimersByTime(45001);
    expect(() =>
      second.api.finalizeVerification(expired, { ok: true, capabilities: ["text"] }),
    ).toThrow("CONNECTION_PROOF_STALE");
  });
  it("rejects invalid lease dates and record revision corruption on completion", () => {
    const h = harness();
    const ticket = h.reserve();
    h.rows[0].set("config_revision", 8);
    expect(() =>
      h.api.finalizeVerification(ticket, { ok: true, capabilities: ["text"] }),
    ).toThrow("CONNECTION_PROOF_STALE");
    h.rows[0].set("config_revision", 0);
    h.rows[0].set("started_at", "not-a-date");
    expect(h.api.getPublicConfig("gemini").verification.state).toBe("unknown");
    expect(() =>
      h.api.finalizeVerification(ticket, { ok: true, capabilities: ["text"] }),
    ).toThrow("CONNECTION_PROOF_STALE");
  });
  it("binds proof to scope, service and unguessable attempt token", () => {
    for (const change of [
      { token: "forged" },
      { service: "anthropic" },
      { dealerId: "dealer-a" },
    ]) {
      const h = harness();
      const ticket = h.reserve();
      expect(() =>
        h.api.finalizeVerification(
          { ...ticket, ...change },
          { ok: true, capabilities: ["text"] },
        ),
      ).toThrow();
      expect(h.api.getPublicConfig("gemini").capabilities.text).toBe(false);
    }
  });
  it("invalidates provider proof on model policy change and keeps operation identity", () => {
    const h = harness();
    const ticket = h.reserve();
    h.api.finalizeVerification(ticket, { ok: true, capabilities: ["text"] });
    h.changePolicy();
    expect(h.api.getPublicConfig("gemini").state).toBe("needs_test");
    expect(() => h.reserve()).toThrow("CONNECTION_OPERATION_CONFLICT");
    expect(h.rows[0].getString("key_hash")).toBe(sha("synthetic-op-1"));
  });
  it("expires verified capability after seven days and rejects invalid proof dates", () => {
    vi.useFakeTimers();
    const h = harness();
    const ticket = h.reserve();
    h.api.finalizeVerification(ticket, { ok: true, capabilities: ["text"] });
    vi.advanceTimersByTime(7 * 86400000 + 1);
    expect(h.api.getPublicConfig("gemini").state).toBe("needs_test");
    expect(h.api.getPublicConfig("gemini").verification.code).toBe(
      "CONNECTION_PROOF_EXPIRED",
    );
    h.rows[0].set("checked_at", "not-a-date");
    expect(h.api.getPublicConfig("gemini").capabilities.text).toBe(false);
  });
  it("keeps an undelivered private draft unverified without presenting a service fault", () => {
    const h = harness();
    h.save("website", 0, {
      settings: { origin: "https://approved.example", destinationId: "destination-a" },
      credentials: { sharedSecret: "synthetic-website-secret-at-least-32-characters" },
    });
    const result = h.api.finalizeVerification(
      h.reserve("website", 1, "pending-draft", {
        proofId: "post-a",
        targetDealerId: "dealer-a",
      }),
      { ok: false, capabilities: [], code: "CONNECTION_DRAFT_PENDING" },
    );
    expect(result.state).toBe("needs_test");
    expect(result.capabilities.website).toBe(false);
    expect(result.verification.code).toBe("CONNECTION_DRAFT_PENDING");
  });
  it("keeps OpenAI image fallback needs_test after a text-only proof", () => {
    const h = harness();
    const result = h.api.finalizeVerification(h.reserve("openai"), {
      ok: true,
      capabilities: ["text"],
    });
    expect(result.state).toBe("needs_test");
    expect(result.verification.state).toBe("verified");
    expect(result.capabilities).toMatchObject({ text: true, images: false });
  });
  it("rejects unearned capabilities and raw provider errors", () => {
    const h = harness();
    const ticket = h.reserve();
    expect(() =>
      h.api.finalizeVerification(ticket, { ok: true, capabilities: ["images"] }),
    ).toThrow("CONNECTION_PROOF_INVALID");
    expect(() =>
      h.api.finalizeVerification(ticket, {
        ok: false,
        capabilities: [],
        code: "synthetic raw secret error",
      }),
    ).toThrow("CONNECTION_PROOF_INVALID");
    h.api.finalizeVerification(ticket, {
      ok: false,
      capabilities: [],
      code: "CONNECTION_AUTH_FAILED",
    });
    expect(h.api.getPublicConfig("gemini").verification.code).toBe(
      "CONNECTION_AUTH_FAILED",
    );
    h.rows[0].set("code", "synthetic raw secret error");
    expect(JSON.stringify(h.api.getPublicConfig("gemini"))).not.toContain(
      "synthetic raw",
    );
    h.rows[0].set("state", "verified");
    h.rows[0].set("capabilities_json", '["images"]');
    expect(h.api.getPublicConfig("gemini").state).toBe("attention");
  });
});
