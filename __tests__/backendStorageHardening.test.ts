import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Policies = {
  isAllowedImageProxyUrl(url: string, configuredHosts?: string): boolean;
};

type Helpers = {
  findSessionByToken(token: string): unknown;
  findSystemDealer(): unknown;
  createSession(
    dealerId: string,
    role: string,
    ip: string,
    userAgent: string,
    opts?: {
      personId?: string;
      isImpersonation?: boolean;
      impersonatorSessionId?: string;
      expectedPersonPinFingerprint?: string;
      expectedInvitationFingerprint?: string;
    },
  ): { token: string; expiresAt: Date };
  sessionContext(c: unknown): unknown;
  refreshSession(session: { set(field: string, value: string): void }): Date;
};

function loadPocketBaseCommonJs<T>(relativePath: string): T {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  const hooksRoot = resolve(process.cwd(), "pb_hooks");
  const requireHook = (requestPath: string) => {
    const fileName = requestPath.replace(/\\/g, "/").split("/").pop() || "";
    return loadPocketBaseCommonJs(`pb_hooks/${fileName}`);
  };
  new Function("module", "exports", "require", "__hooks", source)(
    module,
    module.exports,
    requireHook,
    hooksRoot,
  );
  return module.exports;
}

const policies = loadPocketBaseCommonJs<Policies>("pb_hooks/requestPolicies.js");
const helpers = loadPocketBaseCommonJs<Helpers>("pb_hooks/helpers.js");
const runtime = globalThis as Record<string, any>;
const originalSecurity = runtime.$security;
const originalApp = runtime.$app;
const originalRecord = runtime.Record;
const originalOs = runtime.$os;

afterEach(() => {
  runtime.$security = originalSecurity;
  runtime.$app = originalApp;
  runtime.Record = originalRecord;
  runtime.$os = originalOs;
});

describe("PocketBase sensitive-storage hardening", () => {
  it("looks sessions up by a SHA-256 verifier instead of plaintext", () => {
    const sha256 = vi.fn(() => "a".repeat(64));
    const findFirstRecordByFilter = vi.fn(() => ({
      getString: (field: string) =>
        field === "expires_at" ? "2099-01-01 00:00:00.000Z" : "",
    }));
    runtime.$security = { sha256 };
    runtime.$app = {
      dao: () => ({ findFirstRecordByFilter }),
    };

    const token = "b".repeat(64);
    expect(helpers.findSessionByToken(token)).toBeTruthy();
    expect(sha256).toHaveBeenCalledWith(token);
    expect(findFirstRecordByFilter).toHaveBeenCalledWith(
      "sessions",
      "token_hash = {:h}",
      { h: "a".repeat(64) },
    );
  });

  it("persists only a token verifier when creating a session", () => {
    let savedData: Record<string, unknown> | undefined;
    runtime.$security = {
      randomStringWithAlphabet: (length: number, alphabet: string) =>
        alphabet[0].repeat(length),
      sha256: () => "c".repeat(64),
    };
    runtime.Record = class {
      id = "session-id";
      constructor(_collection: unknown, data: Record<string, unknown>) {
        savedData = data;
      }
    };
    const invitationHash = "d".repeat(64);
    const dao = {
      findCollectionByNameOrId: () => ({ id: "sessions" }),
      findRecordById: (collection: string) =>
        collection === "dealers"
          ? {
              id: "dealer-id",
              getBool: () => false,
              getString: (field: string) =>
                field === "invitation_hash" ? invitationHash : "",
            }
          : {
              id: "person-id",
              getBool: (field: string) => field === "active",
              getString: (field: string) =>
                field === "dealer"
                  ? "dealer-id"
                  : field === "role"
                    ? "salesperson"
                    : field === "pin"
                      ? "1234"
                      : "",
            },
      saveRecord: () => undefined,
      runInTransaction: (callback: (tx: unknown) => void) => callback(dao),
    };
    runtime.$app = { dao: () => dao };

    const created = helpers.createSession(
      "dealer-id",
      "salesperson",
      "203.0.113.10",
      "test-agent",
      {
        personId: "person-id",
        expectedPersonPinFingerprint: "c".repeat(64),
        expectedInvitationFingerprint: invitationHash,
      },
    );

    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(savedData).toMatchObject({ token_hash: "c".repeat(64) });
    expect(savedData).not.toHaveProperty("token");
  });

  it("rejects a super-admin context after the admin credential rotates", () => {
    const session = {
      id: "admin-session",
      getString: (field: string) => {
        if (field === "expires_at") return "2099-01-01 00:00:00.000Z";
        if (field === "role") return "super_admin";
        if (field === "dealer") return "system-dealer";
        if (field === "admin_secret_fingerprint") return "b".repeat(64);
        return "";
      },
      getBool: () => false,
    };
    const deleteRecord = vi.fn();
    // The live account now fingerprints to "c" — the session still carries the
    // pre-rotation "b" verifier, so it must be revoked.
    runtime.$security = {
      sha256: (value: string) =>
        value.startsWith("dealer-social-post-ai:admin-auth:v1:")
          ? "c".repeat(64)
          : "a".repeat(64),
    };
    runtime.$os = { getenv: () => "" };
    runtime.$app = {
      dao: () => ({
        findFirstRecordByFilter: () => session,
        findRecordsByFilter: (collection: string) =>
          collection === "admin_accounts"
            ? [
                {
                  id: "admin-account-1",
                  getString: (field: string) =>
                    field === "tokenKey" ? "rotated-token-key" : "",
                },
              ]
            : [],
        findRecordById: () => ({
          id: "system-dealer",
          getBool: (field: string) => field === "is_system",
        }),
        deleteRecord,
      }),
    };
    const clearCookie = vi.fn();
    const context = {
      request: () => ({
        header: {
          get: () => `dealer_session=${"d".repeat(64)}`,
        },
      }),
      response: () => ({
        header: () => ({ add: clearCookie }),
      }),
    };

    expect(helpers.sessionContext(context)).toBeNull();
    expect(deleteRecord).toHaveBeenCalledWith(session);
    expect(clearCookie).toHaveBeenCalled();
  });

  it("preserves the bearer when session lookup infrastructure is unavailable", () => {
    const lookupError = Object.assign(new Error("database unavailable"), {
      code: 500,
    });
    const deleteRecord = vi.fn();
    runtime.$security = { sha256: () => "a".repeat(64) };
    runtime.$app = {
      dao: () => ({
        findFirstRecordByFilter: () => {
          throw lookupError;
        },
        deleteRecord,
      }),
    };
    const clearCookie = vi.fn();
    const context = {
      request: () => ({
        header: {
          get: () => `dealer_session=${"d".repeat(64)}`,
        },
      }),
      response: () => ({
        header: () => ({ add: clearCookie }),
      }),
    };

    expect(() => helpers.sessionContext(context)).toThrow("database unavailable");
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("treats PocketBase 0.22's exact no-row sentinel as an ordinary auth miss", () => {
    const noRows = Object.assign(new Error("sql: no rows in result set"), {
      name: "GoError",
    });
    runtime.$security = { sha256: () => "a".repeat(64) };
    runtime.$app = {
      dao: () => ({
        findFirstRecordByFilter: () => {
          throw noRows;
        },
      }),
    };

    expect(helpers.findSessionByToken("d".repeat(64))).toBeNull();
    expect(helpers.findSystemDealer()).toBeNull();
  });

  it("slides the authoritative database expiry together with the cookie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const values: Record<string, string> = {};
    const session = {
      set: vi.fn((field: string, value: string) => {
        values[field] = value;
      }),
    };
    const saveRecord = vi.fn();
    runtime.$app = { dao: () => ({ saveRecord }) };

    try {
      const expires = helpers.refreshSession(session);
      expect(values.last_used_at).toBe("2026-07-15T12:00:00.000Z");
      expect(values.expires_at).toBe("2026-07-22T12:00:00.000Z");
      expect(expires.toISOString()).toBe(values.expires_at);
      expect(saveRecord).toHaveBeenCalledWith(session);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the sensitive-field migrations forward-only", () => {
    const sessionMigration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750300000_hash_session_tokens.js"),
      "utf8",
    );
    const signatureMigration = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1750300100_protect_photo_release_signatures.js",
      ),
      "utf8",
    );
    const approvalMigration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750300200_add_approval_creative.js"),
      "utf8",
    );

    expect(sessionMigration).toContain(
      "sessions.schema.removeField(finalLegacyField.id)",
    );
    expect(sessionMigration).toContain("$security.sha256(token)");
    expect(signatureMigration).toContain("signatureField.options.protected = true");
    expect(signatureMigration).not.toContain("protected = false");
    expect(approvalMigration).toContain("protected: true");
    expect(approvalMigration).toContain('name: "owner_session_hash"');
  });
});

describe("PocketBase image proxy policy", () => {
  it("allows only operator-trusted HTTPS image origins", () => {
    expect(policies.isAllowedImageProxyUrl("https://i.imgur.com/example.png")).toBe(
      true,
    );
    expect(
      policies.isAllowedImageProxyUrl(
        "https://cdn.example-dealer.com/logo.jpg",
        "cdn.example-dealer.com,*.trusted-cdn.example",
      ),
    ).toBe(true);
    expect(
      policies.isAllowedImageProxyUrl(
        "https://tenant.trusted-cdn.example/logo.jpg",
        "*.trusted-cdn.example",
      ),
    ).toBe(true);
    expect(policies.isAllowedImageProxyUrl("https://i.imgur.com:443/example.png")).toBe(
      true,
    );
  });

  it.each([
    "http://i.imgur.com/example.png",
    "https://127.0.0.1/private",
    "https://169.254.169.254/latest/meta-data",
    "https://2130706433/private",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://storage.googleapis.com/user-controlled/object.png",
    "https://googleapis.com.attacker.example/image.png",
    "https://user:password@i.imgur.com/example.png",
    "https://i.imgur.com:8443/example.png",
    "https://i.imgur.com\\@attacker.example/image.png",
    "https://i.imgur.com%2f.attacker.example/image.png",
    "https://i..imgur.com/image.png",
    "https://attacker.example/image.png",
  ])("rejects untrusted image URL %s", (url) => {
    expect(policies.isAllowedImageProxyUrl(url)).toBe(false);
  });

  it("does not depend on a URL constructor unavailable in PocketBase 0.22", () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
      "utf8",
    );
    expect(source).not.toContain("new URL(rawUrl)");
  });
});

describe("Generated video transport", () => {
  it("keeps Google file downloads behind the authenticated binary proxy", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "services/geminiService.ts"),
      "utf8",
    );
    const hookSource = readFileSync(
      resolve(process.cwd(), "pb_hooks/main.pb.js"),
      "utf8",
    );

    expect(clientSource).toContain(
      'parsed.origin !== "https://generativelanguage.googleapis.com"',
    );
    expect(clientSource).toContain(
      String.raw`/^\/v1beta\/files\/([a-z0-9._~-]+)(?::download)?$/i`,
    );
    expect(clientSource).toContain("fetch(`/api/proxy/${proxyPath}`");
    expect(clientSource).not.toContain("await fetch(videoUri)");
    expect(hookSource).toContain("return c.blob(");
    expect(hookSource).toContain("Generated video exceeds 100 MB");
  });
});

describe("PocketBase container startup", () => {
  it("fails closed on incompatible data and fronts PocketBase with Caddy", () => {
    const entrypoint = readFileSync(resolve(process.cwd(), "entrypoint.sh"), "utf8");
    const caddyfile = readFileSync(resolve(process.cwd(), "Caddyfile"), "utf8");
    const openAdmin = readFileSync(
      resolve(process.cwd(), "Caddyfile.open-admin"),
      "utf8",
    );
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(entrypoint).not.toContain("data.db.v23bak");
    expect(entrypoint).not.toMatch(/mv\s+\/pb\/pb_data/);
    expect(entrypoint).toContain("exit 1");
    // Public listener is Caddy; PocketBase stays on loopback.
    expect(entrypoint).toContain("/pb/pocketbase serve");
    expect(entrypoint).toContain("--http=127.0.0.1:8091");
    expect(entrypoint).not.toMatch(/pocketbase serve[^\n]*0\.0\.0\.0:8090/);
    expect(entrypoint).toContain("caddy run");
    expect(entrypoint).toContain("POCKETBASE_ADMIN_UI_ENABLED");
    expect(entrypoint).toMatch(/trap shutdown TERM INT/);
    expect(caddyfile).toMatch(/path \/_\/ \/_\/\*/);
    expect(caddyfile).toContain('respond "Not Found" 404');
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:8091");
    expect(openAdmin).toContain("reverse_proxy 127.0.0.1:8091");
    expect(openAdmin).not.toMatch(/path \/_\/ \/_\/\*/);
    expect(dockerfile).toContain("CADDY_VERSION");
    expect(dockerfile).toContain("COPY Caddyfile /pb/Caddyfile");
  });
});
