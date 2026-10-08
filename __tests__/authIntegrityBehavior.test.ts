import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

type StringMap = Record<string, unknown>;

type PocketBaseRecord = ReturnType<typeof makeRecord>;

type AuthHelpers = {
  adminAuthFingerprint: (account: PocketBaseRecord) => string;
  personPinFingerprint: (person: PocketBaseRecord) => string;
  createSession: (
    dealerId: string,
    role: string,
    ip: string,
    userAgent: string,
    options?: {
      personId?: string;
      isImpersonation?: boolean;
      impersonatorSessionId?: string;
      expectedPersonPinFingerprint?: string;
    },
  ) => { token: string; expiresAt: Date; sessionId: string };
  replaceImpersonationSession: (
    childSessionId: string,
    sourceSessionId: string,
    ip: string,
    userAgent: string,
  ) => { token: string; expiresAt: Date; sessionId: string };
  sessionContext: (context: unknown) => {
    role: string;
    isImpersonating: boolean;
  } | null;
  revokePersonSessions: (personId: string) => number;
  revokeDealerSessions: (dealerId: string, preserveToken?: string) => number;
  revokeSession: (context: unknown) => number;
  findActivePersonByPin: (pin: string) => {
    status: "found" | "not_found" | "unavailable";
    person: PocketBaseRecord | null;
  };
  loginFailureState: (
    ip: string,
    threshold: number,
    windowSeconds: number,
  ) => {
    count: number;
    locked: boolean;
    retryAfterSeconds: number;
    unavailable: boolean;
  };
  reserveLoginAttempt: (options: {
    ip: string;
    userAgent?: string;
    credentialPresent?: boolean;
    threshold?: number;
    windowSeconds?: number;
    challengeAfter?: number;
    challengeValidated?: boolean;
  }) => {
    status: "reserved" | "challenge_required" | "locked" | "unavailable";
    attemptId?: string;
    count?: number;
    retryAfterSeconds?: number;
  };
  finalizeLoginAttempt: (
    attemptId: string,
    kind: "login_fail" | "login_success",
    options?: StringMap,
  ) => boolean;
  cancelLoginAttempt: (attemptId: string) => boolean;
  serializePerson: (record: PocketBaseRecord) => Record<string, unknown>;
  serializePersonSummary: (record: PocketBaseRecord) => Record<string, unknown>;
  verifyTurnstileToken: (
    token: string,
    remoteIp: string,
  ) => { ok: boolean; unavailable: boolean };
  configuredTurnstileHostnames: () => string[];
  isTurnstileTestSiteKey: (value: string) => boolean;
  isTurnstileTestSecret: (value: string) => boolean;
  clientIP: (context: unknown) => string;
  legacyClientCompatibilityEnabled: (context: unknown) => boolean;
};

// PocketBase's generated ambient types describe the full production globals.
// Tests intentionally install small behavioral doubles, so keep this bridge
// untyped instead of pretending those doubles implement the entire JSVM API.
const runtime = globalThis as unknown as Record<string, any>;
const savedRuntime = {
  $app: runtime.$app,
  $http: runtime.$http,
  $os: runtime.$os,
  $security: runtime.$security,
  Record: runtime.Record,
  ApiError: runtime.ApiError,
};

afterEach(() => {
  runtime.$app = savedRuntime.$app;
  runtime.$http = savedRuntime.$http;
  runtime.$os = savedRuntime.$os;
  runtime.$security = savedRuntime.$security;
  runtime.Record = savedRuntime.Record;
  runtime.ApiError = savedRuntime.ApiError;
  vi.restoreAllMocks();
});

function loadCommonJs<T>(relativePath: string): T {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

function makeRecord(id: string, initial: StringMap) {
  const values = { ...initial };
  return {
    id,
    values,
    getString(field: string) {
      const value = values[field];
      return value === undefined || value === null ? "" : String(value);
    },
    getBool(field: string) {
      return values[field] === true;
    },
    get(field: string) {
      return values[field];
    },
    set(field: string, value: unknown) {
      values[field] = value;
    },
  };
}

class MockSchema {
  private readonly fields = new Map<string, StringMap>();

  constructor(fields: StringMap[]) {
    for (const field of fields) this.fields.set(String(field.name), field);
  }

  getFieldByName(name: string) {
    return this.fields.get(name) ?? null;
  }

  addField(field: StringMap) {
    this.fields.set(String(field.name), field);
  }
}

function runPeopleIntegrityMigration(
  records: PocketBaseRecord[],
  dealerRecords: PocketBaseRecord[] = [],
) {
  const events: string[] = [];
  const people = {
    name: "salespeople",
    schema: new MockSchema([
      {
        name: "pin",
        required: false,
        options: { min: null, max: null, pattern: "" },
      },
    ]),
    indexes: [
      "CREATE UNIQUE INDEX `idx_salespeople_pin_legacy` ON `salespeople` (`pin`)",
    ],
  };
  const dealers = {
    name: "dealers",
    schema: new MockSchema([]),
    indexes: ["CREATE UNIQUE INDEX `idx_code` ON `dealers` (`code`)"] as string[],
  };
  const sessions = {
    name: "sessions",
    schema: new MockSchema([]),
    indexes: [] as string[],
  };
  const authEvents = {
    name: "auth_events",
    schema: new MockSchema([
      { name: "kind", options: { maxSelect: 1, values: ["login_success"] } },
    ]),
    indexes: [] as string[],
  };
  const collections = {
    salespeople: people,
    dealers,
    sessions,
    auth_events: authEvents,
  };

  const dao = {
    findCollectionByNameOrId(name: keyof typeof collections) {
      return collections[name];
    },
    findRecordsByFilter(collection: string, filter: string) {
      if (collection === "salespeople") return records;
      if (collection === "dealers" && filter.includes("admin_code")) {
        return dealerRecords.filter(
          (record) =>
            record.getString("admin_code") &&
            record.getString("name") !== "SYSTEM ADMIN",
        );
      }
      if (collection === "dealers" && filter.includes("name")) {
        return dealerRecords.filter(
          (record) => record.getString("name") === "SYSTEM ADMIN",
        );
      }
      throw new Error(`Unexpected collection query: ${collection}`);
    },
    findFirstRecordByFilter(collection: string, _filter: string, params: StringMap) {
      if (collection !== "salespeople") {
        throw new Error(`Unexpected first-record query: ${collection}`);
      }
      const manager = records.find(
        (record) =>
          record.getString("dealer") === String(params.dealer || "") &&
          record.getString("role") === "manager",
      );
      if (!manager) throw new Error("record not found");
      return manager;
    },
    saveCollection(collection: {
      name: string;
      indexes: string[];
      schema: MockSchema;
    }) {
      const pin = collection.schema.getFieldByName("pin");
      events.push(
        [
          `collection:${collection.name}`,
          `unique=${collection.indexes.some((index) => index.includes("idx_salespeople_pin"))}`,
          `pattern=${String(pin?.options && (pin.options as StringMap).pattern)}`,
        ].join("|"),
      );
    },
    saveRecord(record: PocketBaseRecord) {
      if (!records.some((candidate) => candidate.id === record.id)) {
        records.push(record);
      }
      events.push(`record:${record.id}:${record.getString("pin")}`);
    },
  };
  const queries: string[] = [];
  const db = {
    dao,
    newQuery(sql: string) {
      queries.push(sql);
      const query = {
        bind() {
          return query;
        },
        execute() {
          return undefined;
        },
      };
      return query;
    },
  };

  let apply: ((dbValue: typeof db) => void) | undefined;
  const source = readFileSync(
    resolve(process.cwd(), "pb_migrations/1750500000_auth_people_integrity.js"),
    "utf8",
  );
  runInNewContext(source, {
    migrate: (up: typeof apply) => {
      apply = up;
    },
    Dao: function Dao(dbValue: typeof db) {
      return dbValue.dao;
    },
    SchemaField: class SchemaField {
      [key: string]: unknown;

      constructor(options: StringMap) {
        Object.assign(this, options);
      }
    },
    Record: function Record() {
      return makeRecord(`migrated-manager-${records.length + 1}`, {});
    },
    $security: {
      // Starting at an already-used value proves the migration searches the
      // namespace deterministically instead of trusting one random attempt.
      randomStringWithAlphabet: () => "0042",
    },
  });
  if (!apply) throw new Error("Migration did not register an apply handler");

  return { apply: () => apply!(db), events, people, queries };
}

function makeRequestContext(token: string) {
  const responseHeaders: Array<[string, string]> = [];
  return {
    responseHeaders,
    context: {
      request: () => ({
        header: {
          get: (name: string) => (name === "Cookie" ? `dealer_session=${token}` : ""),
        },
      }),
      response: () => ({
        header: () => ({
          add: (name: string, value: string) => {
            responseHeaders.push([name, value]);
          },
        }),
      }),
    },
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("people integrity migration behavior", () => {
  it("preserves valid unique PINs, repairs dirty rows, then installs constraints", () => {
    const records = [
      makeRecord("a", { pin: "0042", pin_needs_distribution: false }),
      makeRecord("b", { pin: "0042", pin_needs_distribution: false }),
      makeRecord("c", { pin: "not-a-pin", pin_needs_distribution: false }),
      makeRecord("d", { pin: "9999", pin_needs_distribution: false }),
      makeRecord("e", { pin: "", pin_needs_distribution: false }),
    ];
    const harness = runPeopleIntegrityMigration(records);

    harness.apply();

    expect(records.map((record) => record.getString("pin"))).toEqual([
      "0042",
      "0043",
      "0044",
      "9999",
      "0045",
    ]);
    expect(new Set(records.map((record) => record.getString("pin"))).size).toBe(
      records.length,
    );
    expect(records[0].getBool("pin_needs_distribution")).toBe(false);
    expect(records[3].getBool("pin_needs_distribution")).toBe(false);
    for (const repaired of [records[1], records[2], records[4]]) {
      expect(repaired.getBool("pin_needs_distribution")).toBe(true);
    }

    const firstRepair = harness.events.findIndex((event) =>
      event.startsWith("record:"),
    );
    const constrainedSave = harness.events.findIndex(
      (event) =>
        event.startsWith("collection:salespeople") &&
        event.includes("unique=true") &&
        event.includes("pattern=^[0-9]{4}$"),
    );
    expect(firstRepair).toBeGreaterThan(-1);
    expect(constrainedSave).toBeGreaterThan(firstRepair);
    expect(harness.people.indexes).toEqual([
      "CREATE UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != ''",
    ]);
  });

  it("fails before constraints when the four-digit identity space is exceeded", () => {
    const records = Array.from({ length: 10_001 }, (_, index) =>
      makeRecord(`person-${index}`, { pin: String(index % 10_000).padStart(4, "0") }),
    );
    const harness = runPeopleIntegrityMigration(records);

    expect(() => harness.apply()).toThrow(/more than 10,000 people/i);
    expect(harness.events.some((event) => event.startsWith("record:"))).toBe(false);
    expect(
      harness.events.some(
        (event) =>
          event.startsWith("collection:salespeople") &&
          event.includes("pattern=^[0-9]{4}$"),
      ),
    ).toBe(false);
  });

  it("backfills dirty legacy dealer managers before shared credentials are scrubbed", () => {
    const records: PocketBaseRecord[] = [];
    const dealers = [
      makeRecord("dealer-a", { name: "Dealer A", admin_code: "2468" }),
      makeRecord("dealer-b", { name: "Dealer B", admin_code: "2468" }),
      makeRecord("dealer-c", { name: "Dealer C", admin_code: "12AB56" }),
      makeRecord("system", { name: "SYSTEM ADMIN", admin_code: "SystemSecret" }),
    ];
    const harness = runPeopleIntegrityMigration(records, dealers);

    harness.apply();

    const managers = records.filter((record) => record.getString("role") === "manager");
    expect(managers).toHaveLength(3);
    expect(managers.map((record) => record.getString("dealer"))).toEqual([
      "dealer-a",
      "dealer-b",
      "dealer-c",
    ]);
    expect(managers.every((record) => /^[0-9]{4}$/.test(record.getString("pin")))).toBe(
      true,
    );
    expect(new Set(managers.map((record) => record.getString("pin"))).size).toBe(3);
    expect(managers[0].getString("pin")).toBe("2468");
    expect(managers[0].getBool("pin_needs_distribution")).toBe(false);
    expect(managers[1].getBool("pin_needs_distribution")).toBe(true);
    expect(managers[2].getBool("pin_needs_distribution")).toBe(true);
    expect(
      harness.queries.some((query) =>
        query.includes("UPDATE dealers SET is_system = 0, code = '', admin_code = ''"),
      ),
    ).toBe(true);
  });
});

describe("authoritative session revalidation", () => {
  const helpers = loadCommonJs<AuthHelpers>("pb_hooks/helpers.js");
  const token = "a".repeat(64);
  const adminAuthFp = () =>
    sha256("dealer-social-post-ai:admin-auth:v1:admin-account-1:token-key-1");

  function installRuntime(options?: {
    session?: PocketBaseRecord;
    person?: PocketBaseRecord;
    dealer?: PocketBaseRecord;
    systemDealer?: PocketBaseRecord;
    sourceSession?: PocketBaseRecord;
    impersonationChildren?: PocketBaseRecord[];
    impersonationLookupError?: Error;
  }) {
    const adminAccount = makeRecord("admin-account-1", {
      username: "admin",
      tokenKey: "token-key-1",
    });
    const deleted: string[] = [];
    const session =
      options?.session ??
      makeRecord("admin-session", {
        role: "super_admin",
        dealer: "system-dealer",
        person: "",
        is_impersonation: false,
        impersonator_session: "",
        expires_at: "2999-01-01T00:00:00.000Z",
        admin_secret_fingerprint: adminAuthFp(),
      });
    const dealer = options?.dealer ?? makeRecord("dealer-1", { is_system: false });
    const systemDealer =
      options?.systemDealer ?? makeRecord("system-dealer", { is_system: true });
    const person =
      options?.person ??
      makeRecord("person-1", {
        dealer: dealer.id,
        role: "salesperson",
        active: true,
        pin: "1234",
      });
    const sourceSession = options?.sourceSession;
    const impersonationChildren = options?.impersonationChildren ?? [];

    const dao = {
      findFirstRecordByFilter: (collection: string) => {
        if (collection === "sessions") return session;
        if (collection === "dealers") return systemDealer;
        throw new Error(`Unexpected lookup: ${collection}`);
      },
      findRecordById: (collection: string, id: string) => {
        if (collection === "dealers" && id === dealer.id) return dealer;
        if (collection === "dealers" && id === systemDealer.id) return systemDealer;
        if (collection === "salespeople" && id === person.id) return person;
        if (collection === "sessions" && sourceSession?.id === id) return sourceSession;
        throw new Error(`Missing ${collection}/${id}`);
      },
      deleteRecord: (record: PocketBaseRecord) => {
        deleted.push(record.id);
      },
      findRecordsByFilter: (
        collection: string,
        _filter: string,
        _sort: string,
        limit: number,
        _offset: number,
        params: StringMap,
      ) => {
        if (collection === "admin_accounts") {
          return [adminAccount];
        }
        if (collection !== "sessions") {
          throw new Error(`Unexpected records lookup: ${collection}`);
        }
        if (options?.impersonationLookupError) {
          throw options.impersonationLookupError;
        }
        return impersonationChildren
          .filter(
            (child) =>
              child.getBool("is_impersonation") &&
              child.getString("impersonator_session") === String(params.source || "") &&
              new Date(child.getString("expires_at")).getTime() > Date.now(),
          )
          .slice(0, limit);
      },
    };
    runtime.$os = { getenv: () => "" };
    runtime.$security = { sha256 };
    runtime.$app = { dao: () => dao };

    return {
      deleted,
      session,
      person,
      rotateAdminCredential() {
        adminAccount.set("tokenKey", "token-key-2");
      },
    };
  }

  it("accepts admin authority and revokes it after credential rotation", () => {
    const state = installRuntime();
    const firstRequest = makeRequestContext(token);

    expect(helpers.sessionContext(firstRequest.context)).toMatchObject({
      role: "super_admin",
      isImpersonating: false,
    });

    // Password rotation changes the account token key; sessions bound to the
    // previous credential must revoke immediately.
    state.rotateAdminCredential();
    const rotatedRequest = makeRequestContext(token);
    expect(helpers.sessionContext(rotatedRequest.context)).toBeNull();
    expect(state.deleted).toContain("admin-session");
    expect(rotatedRequest.responseHeaders).toContainEqual([
      "Set-Cookie",
      expect.stringContaining("Max-Age=0"),
    ]);
  });

  it("parks a source bearer while its live impersonation child remains valid", () => {
    const source = makeRecord("source-admin-session", {
      role: "super_admin",
      dealer: "system-dealer",
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const child = makeRecord("impersonated-session", {
      role: "salesperson",
      dealer: "dealer-1",
      person: "person-1",
      is_impersonation: true,
      impersonator_session: source.id,
      expires_at: "2999-01-01T00:00:00.000Z",
    });
    const state = installRuntime({
      session: source,
      impersonationChildren: [child],
    });
    const request = makeRequestContext(token);

    expect(helpers.sessionContext(request.context)).toBeNull();
    expect(state.deleted).toEqual([]);
    expect(request.responseHeaders).toContainEqual([
      "Set-Cookie",
      expect.stringContaining("Max-Age=0"),
    ]);
  });

  it("unparks the source bearer after its child is gone or expired", () => {
    const source = makeRecord("source-admin-session", {
      role: "super_admin",
      dealer: "system-dealer",
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const child = makeRecord("expired-impersonated-session", {
      role: "salesperson",
      dealer: "dealer-1",
      person: "person-1",
      is_impersonation: true,
      impersonator_session: source.id,
      expires_at: "2000-01-01T00:00:00.000Z",
    });
    const state = installRuntime({
      session: source,
      impersonationChildren: [child],
    });
    const request = makeRequestContext(token);

    expect(helpers.sessionContext(request.context)).toMatchObject({
      role: "super_admin",
      isImpersonating: false,
    });
    expect(state.deleted).toEqual([]);
    expect(request.responseHeaders).toEqual([]);
  });

  it("preserves the parked source when its child lookup is unavailable", () => {
    const source = makeRecord("source-admin-session", {
      role: "super_admin",
      dealer: "system-dealer",
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const state = installRuntime({
      session: source,
      impersonationLookupError: new Error("database unavailable"),
    });
    const request = makeRequestContext(token);
    runtime.ApiError = class extends Error {
      status: number;
      data: StringMap;

      constructor(status: number, message: string, data: StringMap) {
        super(message);
        this.status = status;
        this.data = data;
      }
    };

    let failure: unknown;
    try {
      helpers.sessionContext(request.context);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      status: 503,
      data: { code: "UNAVAILABLE" },
    });
    expect(state.deleted).toEqual([]);
    expect(request.responseHeaders).toEqual([]);
  });

  it("invalidates a person session immediately when the current role changes", () => {
    const session = makeRecord("person-session", {
      role: "dealer_admin",
      dealer: "dealer-1",
      person: "person-1",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      person_pin_fingerprint: sha256(
        "dealer-social-post-ai:person-pin:v1:person-1:1234",
      ),
    });
    const person = makeRecord("person-1", {
      dealer: "dealer-1",
      role: "manager",
      active: true,
      pin: "1234",
    });
    const state = installRuntime({ session, person });

    expect(helpers.sessionContext(makeRequestContext(token).context)).toMatchObject({
      role: "dealer_admin",
    });
    person.set("role", "salesperson");
    const changedRequest = makeRequestContext(token);
    expect(helpers.sessionContext(changedRequest.context)).toBeNull();
    expect(state.deleted).toContain("person-session");
  });

  it("ends impersonation when its source super-admin session expires", () => {
    const source = makeRecord("source-admin-session", {
      role: "super_admin",
      dealer: "system-dealer",
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const child = makeRecord("impersonated-session", {
      role: "salesperson",
      dealer: "dealer-1",
      person: "person-1",
      is_impersonation: true,
      impersonator_session: source.id,
      expires_at: "2999-01-01T00:00:00.000Z",
      person_pin_fingerprint: sha256(
        "dealer-social-post-ai:person-pin:v1:person-1:1234",
      ),
    });
    const state = installRuntime({ session: child, sourceSession: source });

    expect(helpers.sessionContext(makeRequestContext(token).context)).toMatchObject({
      role: "salesperson",
      isImpersonating: true,
    });
    source.set("expires_at", "2000-01-01T00:00:00.000Z");
    const expiredRequest = makeRequestContext(token);
    expect(helpers.sessionContext(expiredRequest.context)).toBeNull();
    expect(state.deleted).toEqual(
      expect.arrayContaining(["source-admin-session", "impersonated-session"]),
    );
    expect(expiredRequest.responseHeaders).toContainEqual([
      "Set-Cookie",
      expect.stringContaining("Max-Age=0"),
    ]);
  });

  it("revokes every session attached to a rotated or deactivated person", () => {
    let sql = "";
    let params: StringMap = {};
    const query = {
      bind: (value: StringMap) => {
        params = value;
        return query;
      },
      execute: () => ({ rowsAffected: () => 2 }),
    };
    runtime.$app = {
      dao: () => ({
        db: () => ({
          newQuery: (value: string) => {
            sql = value;
            return query;
          },
        }),
      }),
    };

    expect(helpers.revokePersonSessions("person-1")).toBe(2);
    expect(sql).toBe("DELETE FROM sessions WHERE person = {:person}");
    expect(sql).not.toContain("LIMIT");
    expect(params).toEqual({ person: "person-1" });
  });

  it("atomically revokes all dealer sessions and can preserve one token", () => {
    let sql = "";
    let params: StringMap = {};
    const query = {
      bind: (value: StringMap) => {
        params = value;
        return query;
      },
      execute: () => ({ rowsAffected: () => 37 }),
    };
    runtime.$security = { sha256 };
    runtime.$app = {
      dao: () => ({
        db: () => ({
          newQuery: (value: string) => {
            sql = value;
            return query;
          },
        }),
      }),
    };

    const preserveToken = "b".repeat(64);
    expect(helpers.revokeDealerSessions("dealer-1", preserveToken)).toBe(37);
    expect(sql).toBe(
      "DELETE FROM sessions WHERE dealer = {:dealer} AND token_hash != {:preserve}",
    );
    expect(sql).not.toContain("LIMIT");
    expect(params).toEqual({
      dealer: "dealer-1",
      preserve: sha256(preserveToken),
    });
  });

  it("binds a login to the exact PIN record that matched the submitted code", () => {
    const dealer = makeRecord("dealer-1", { is_system: false });
    const person = makeRecord("person-1", {
      dealer: dealer.id,
      role: "salesperson",
      active: true,
      // Simulate a rotation after the login lookup matched the former 1234 PIN.
      pin: "5678",
    });
    const saveRecord = vi.fn();
    runtime.$os = { getenv: () => "" };
    runtime.$security = {
      sha256,
      randomStringWithAlphabet: () => "a".repeat(64),
    };
    runtime.Record = class {
      id = "new-session";
    };
    runtime.$app = {
      dao: () => ({
        runInTransaction(this: unknown, callback: (dao: unknown) => void) {
          callback(this);
        },
        findCollectionByNameOrId: () => ({ id: "sessions" }),
        findRecordById: (collection: string, id: string) => {
          if (collection === "dealers" && id === dealer.id) return dealer;
          if (collection === "salespeople" && id === person.id) return person;
          throw new Error(`Missing ${collection}/${id}`);
        },
        saveRecord,
      }),
    };

    expect(() =>
      helpers.createSession(dealer.id, "salesperson", "203.0.113.20", "vitest", {
        personId: person.id,
        expectedPersonPinFingerprint: sha256(
          "dealer-social-post-ai:person-pin:v1:person-1:1234",
        ),
      }),
    ).toThrow("Session person credential changed during sign-in");
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("prevents a second live impersonation child from the same source", () => {
    const systemDealer = makeRecord("system-dealer", { is_system: true });
    const dealer = makeRecord("dealer-1", { is_system: false });
    const person = makeRecord("person-1", {
      dealer: dealer.id,
      role: "salesperson",
      active: true,
      pin: "1234",
    });
    const source = makeRecord("source-session", {
      role: "super_admin",
      dealer: systemDealer.id,
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const existingChild = makeRecord("existing-child", {
      is_impersonation: true,
      impersonator_session: source.id,
      expires_at: "2999-01-01T00:00:00.000Z",
    });
    const adminAccount = makeRecord("admin-account-1", {
      username: "admin",
      tokenKey: "token-key-1",
    });
    const saveRecord = vi.fn();
    const findRecordsByFilter = vi.fn((collection: string) =>
      collection === "admin_accounts" ? [adminAccount] : [existingChild],
    );
    runtime.$os = { getenv: () => "" };
    runtime.$security = {
      sha256,
      randomStringWithAlphabet: () => "a".repeat(64),
    };
    runtime.Record = class {};
    runtime.$app = {
      dao: () => ({
        runInTransaction(this: unknown, callback: (dao: unknown) => void) {
          callback(this);
        },
        findCollectionByNameOrId: () => ({ id: "sessions" }),
        findRecordById: (collection: string, id: string) => {
          if (collection === "dealers" && id === dealer.id) return dealer;
          if (collection === "dealers" && id === systemDealer.id) return systemDealer;
          if (collection === "salespeople" && id === person.id) return person;
          if (collection === "sessions" && id === source.id) return source;
          throw new Error(`Missing ${collection}/${id}`);
        },
        findRecordsByFilter,
        saveRecord,
      }),
    };

    expect(() =>
      helpers.createSession(dealer.id, "salesperson", "203.0.113.20", "vitest", {
        personId: person.id,
        isImpersonation: true,
        impersonatorSessionId: source.id,
      }),
    ).toThrow("Impersonation source already has an active child");
    expect(findRecordsByFilter).toHaveBeenCalledWith(
      "sessions",
      expect.stringContaining("impersonator_session = {:source}"),
      "id",
      1,
      0,
      expect.objectContaining({ source: source.id }),
    );
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("rolls back an impersonation exit when either old bearer cannot be deleted", () => {
    const systemDealer = makeRecord("system-dealer", { is_system: true });
    const source = makeRecord("source-session", {
      role: "super_admin",
      dealer: systemDealer.id,
      person: "",
      is_impersonation: false,
      impersonator_session: "",
      expires_at: "2999-01-01T00:00:00.000Z",
      admin_secret_fingerprint: adminAuthFp(),
    });
    const child = makeRecord("child-session", {
      role: "salesperson",
      dealer: "dealer-1",
      person: "person-1",
      is_impersonation: true,
      impersonator_session: source.id,
      expires_at: "2999-01-01T00:00:00.000Z",
    });
    const sessions = new Map<string, PocketBaseRecord>([
      [source.id, source],
      [child.id, child],
    ]);
    const adminAccount = makeRecord("admin-account-1", {
      username: "admin",
      tokenKey: "token-key-1",
    });
    let replacementNumber = 0;
    runtime.$os = { getenv: () => "" };
    runtime.$security = {
      sha256,
      randomStringWithAlphabet: () => "a".repeat(64),
    };
    runtime.Record = class {
      constructor(_collection: unknown, data: StringMap) {
        replacementNumber += 1;
        return makeRecord(`replacement-${replacementNumber}`, data);
      }
    };

    const dao: any = {
      findCollectionByNameOrId: () => ({ id: "sessions" }),
      findRecordsByFilter: (collection: string) =>
        collection === "admin_accounts" ? [adminAccount] : [],
      findRecordById: (collection: string, id: string) => {
        if (collection === "dealers" && id === systemDealer.id) {
          return systemDealer;
        }
        if (collection === "admin_accounts" && id === adminAccount.id) {
          return adminAccount;
        }
        if (collection === "sessions" && sessions.has(id)) {
          return sessions.get(id);
        }
        throw new Error(`Missing ${collection}/${id}`);
      },
      saveRecord: (record: PocketBaseRecord) => {
        sessions.set(record.id, record);
      },
      deleteRecord: (record: PocketBaseRecord) => {
        if (record.id === source.id) throw new Error("source delete failed");
        sessions.delete(record.id);
      },
      runInTransaction: (callback: (transactionDao: typeof dao) => void) => {
        const snapshot = new Map(sessions);
        try {
          callback(dao);
        } catch (error) {
          sessions.clear();
          for (const [id, record] of snapshot) sessions.set(id, record);
          throw error;
        }
      },
    };
    runtime.$app = { dao: () => dao };

    expect(() =>
      helpers.replaceImpersonationSession(
        child.id,
        source.id,
        "203.0.113.20",
        "vitest",
      ),
    ).toThrow("source delete failed");
    expect([...sessions.keys()].sort()).toEqual(["child-session", "source-session"]);
  });

  it("revokes a presented bearer and its parked impersonation source atomically", () => {
    let sql = "";
    runtime.$security = { sha256 };
    runtime.$app = {
      dao: () => ({
        db: () => ({
          newQuery: (value: string) => {
            sql = value;
            return {
              bind() {
                return this;
              },
              execute: () => ({ rowsAffected: () => 2 }),
            };
          },
        }),
      }),
    };

    expect(helpers.revokeSession(makeRequestContext(token).context)).toBe(2);
    expect(sql).toContain("WITH doomed(id)");
    expect(sql).toContain("impersonator_session");
    expect(sql).not.toContain("LIMIT");
  });

  it("does not report logout revocation success when SQLite fails", () => {
    runtime.$security = { sha256 };
    runtime.$app = {
      dao: () => ({
        db: () => ({
          newQuery: () => ({
            bind() {
              return this;
            },
            execute: () => {
              throw new Error("database unavailable");
            },
          }),
        }),
      }),
    };

    expect(() => helpers.revokeSession(makeRequestContext(token).context)).toThrow(
      "database unavailable",
    );
  });

  it("surfaces session revocation database failures", () => {
    runtime.$app = {
      dao: () => ({
        db: () => ({
          newQuery: () => ({
            bind() {
              return this;
            },
            execute: () => {
              throw new Error("database unavailable");
            },
          }),
        }),
      }),
    };

    expect(() => helpers.revokePersonSessions("person-1")).toThrow(
      "database unavailable",
    );
  });
});

describe("authentication failure-state availability", () => {
  const helpers = loadCommonJs<AuthHelpers>("pb_hooks/helpers.js");

  it("keeps missing PINs distinct from a failed PIN lookup", () => {
    const person = makeRecord("person-1", { active: true });
    let result: PocketBaseRecord[] = [];
    runtime.$app = {
      dao: () => ({ findRecordsByFilter: () => result }),
    };

    expect(helpers.findActivePersonByPin("1234")).toEqual({
      status: "not_found",
      person: null,
    });
    result = [person];
    expect(helpers.findActivePersonByPin("1234")).toEqual({
      status: "found",
      person,
    });

    runtime.$app = {
      dao: () => ({
        findRecordsByFilter: () => {
          throw new Error("database unavailable");
        },
      }),
    };
    expect(helpers.findActivePersonByPin("1234")).toEqual({
      status: "unavailable",
      person: null,
    });
  });

  it("fails closed when the login failure-state query is unavailable", () => {
    runtime.$app = {
      dao: () => ({
        findRecordsByFilter: () => {
          throw new Error("database unavailable");
        },
      }),
    };

    expect(helpers.loginFailureState("203.0.113.20", 10, 900)).toEqual({
      count: 10,
      locked: true,
      retryAfterSeconds: 900,
      unavailable: true,
    });
  });
});

describe("transactional login-attempt reservations", () => {
  const helpers = loadCommonJs<AuthHelpers>("pb_hooks/helpers.js");

  function installAuthEventStore() {
    const events: PocketBaseRecord[] = [];
    let nextId = 0;
    runtime.Record = class {
      constructor(_collection: unknown, data: StringMap) {
        nextId += 1;
        return makeRecord(`attempt-${nextId}`, {
          ...data,
          created: new Date().toISOString(),
        });
      }
    };

    const dao: any = {
      findCollectionByNameOrId: (name: string) =>
        name === "auth_events" ? { id: name } : null,
      saveRecord: (record: PocketBaseRecord) => {
        if (!events.includes(record)) events.push(record);
      },
      deleteRecord: (record: PocketBaseRecord) => {
        const index = events.indexOf(record);
        if (index >= 0) events.splice(index, 1);
      },
      findRecordById: (collection: string, id: string) => {
        if (collection !== "auth_events") throw new Error("Wrong collection");
        const record = events.find((candidate) => candidate.id === id);
        if (!record) throw new Error("Missing auth event");
        return record;
      },
      findRecordsByFilter: (
        collection: string,
        filter: string,
        _sort: string,
        _limit: number,
        _offset: number,
        params: Record<string, string>,
      ) => {
        if (collection !== "auth_events") throw new Error("Wrong collection");
        if (filter.includes("id =")) {
          return events.filter((record) => record.id === params.id);
        }
        return events.filter(
          (record) =>
            record.getString("kind") === params.k &&
            record.getString("ip") === params.i,
        );
      },
      runInTransaction: (callback: (transactionDao: typeof dao) => void) => {
        callback(dao);
      },
    };
    runtime.$app = { dao: () => dao };
    return events;
  }

  it("requires the fourth comparison to solve Turnstile and hard-locks at ten", () => {
    const events = installAuthEventStore();
    const reserve = (challengeValidated: boolean) =>
      helpers.reserveLoginAttempt({
        ip: "203.0.113.20",
        userAgent: "vitest",
        credentialPresent: true,
        threshold: 10,
        windowSeconds: 900,
        challengeAfter: 3,
        challengeValidated,
      });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = reserve(false);
      expect(result.status).toBe("reserved");
      expect(
        helpers.finalizeLoginAttempt(result.attemptId || "", "login_fail", {
          credentialPresent: true,
          detail: "invalid",
        }),
      ).toBe(true);
    }

    expect(reserve(false)).toMatchObject({
      status: "challenge_required",
      count: 3,
    });
    expect(
      events.filter((record) => record.getString("kind") === "login_fail"),
    ).toHaveLength(3);

    for (let attempt = 3; attempt < 10; attempt += 1) {
      const result = reserve(true);
      expect(result.status).toBe("reserved");
      expect(
        helpers.finalizeLoginAttempt(result.attemptId || "", "login_fail", {
          credentialPresent: true,
          detail: "invalid after challenge",
        }),
      ).toBe(true);
    }

    expect(reserve(true)).toMatchObject({ status: "locked", count: 10 });
    expect(
      events.filter((record) => record.getString("kind") === "login_fail"),
    ).toHaveLength(10);
  });

  it("removes a successful reserved comparison from the failure bucket", () => {
    installAuthEventStore();
    const reservation = helpers.reserveLoginAttempt({
      ip: "203.0.113.21",
      threshold: 10,
      windowSeconds: 900,
      challengeAfter: 3,
      challengeValidated: false,
    });

    expect(reservation.status).toBe("reserved");
    expect(
      helpers.finalizeLoginAttempt(reservation.attemptId || "", "login_success", {
        dealerId: "dealer-1",
        credentialPresent: true,
      }),
    ).toBe(true);
    expect(helpers.loginFailureState("203.0.113.21", 10, 900)).toMatchObject({
      count: 0,
      locked: false,
      unavailable: false,
    });
  });
});

describe("trusted request metadata", () => {
  const helpers = loadCommonJs<AuthHelpers>("pb_hooks/helpers.js");
  const proxySecret = "v".repeat(32);

  function requestContext(options: {
    headers?: Record<string, string>;
    remoteAddr?: string;
  }) {
    const headers = new Map(
      Object.entries(options.headers || {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    return {
      request: () => ({
        header: {
          get: (name: string) => headers.get(name.toLowerCase()) || "",
        },
        remoteAddr: options.remoteAddr || "",
      }),
    };
  }

  it("uses Vercel's original client only when the shared proxy secret matches", () => {
    runtime.$os = {
      getenv: (name: string) =>
        name === "VERCEL_TO_FLY_PROXY_SECRET" ? proxySecret : "",
    };
    runtime.$security = { sha256 };

    expect(
      helpers.clientIP(
        requestContext({
          headers: {
            "X-Dealer-Proxy-Secret": proxySecret,
            "X-Vercel-Forwarded-For": "198.51.100.27, 10.0.0.4",
            "Fly-Client-IP": "203.0.113.9",
          },
          remoteAddr: "192.0.2.44:4312",
        }),
      ),
    ).toBe("198.51.100.27");
  });

  it("ignores spoofed forwarded headers when the proxy secret is wrong", () => {
    runtime.$os = {
      getenv: (name: string) =>
        name === "VERCEL_TO_FLY_PROXY_SECRET" ? proxySecret : "",
    };
    runtime.$security = { sha256 };

    expect(
      helpers.clientIP(
        requestContext({
          headers: {
            "X-Dealer-Proxy-Secret": "attacker-controlled-secret-value",
            "X-Vercel-Forwarded-For": "198.51.100.99",
            "X-Forwarded-For": "198.51.100.98",
            "Fly-Client-IP": "203.0.113.41",
          },
          remoteAddr: "192.0.2.44:4312",
        }),
      ),
    ).toBe("203.0.113.41");
  });

  it("falls back to the socket address when no trusted edge identity exists", () => {
    runtime.$os = { getenv: () => "" };
    runtime.$security = { sha256 };

    expect(
      helpers.clientIP(
        requestContext({
          headers: {
            "X-Vercel-Forwarded-For": "198.51.100.99",
            "X-Forwarded-For": "198.51.100.98",
          },
          remoteAddr: "192.0.2.44:4312",
        }),
      ),
    ).toBe("192.0.2.44");
  });

  it("enables the legacy bridge only for explicitly old clients", () => {
    runtime.$os = {
      getenv: (name: string) =>
        name === "LEGACY_CLIENT_COMPATIBILITY_ENABLED" ? "true" : "",
    };

    expect(helpers.legacyClientCompatibilityEnabled(requestContext({}))).toBe(true);
    expect(
      helpers.legacyClientCompatibilityEnabled(
        requestContext({
          headers: { "X-Dealer-Client-Contract": "2026-07-31.v4" },
        }),
      ),
    ).toBe(false);

    runtime.$os = { getenv: () => "false" };
    expect(helpers.legacyClientCompatibilityEnabled(requestContext({}))).toBe(false);
  });
});

describe("Turnstile and route authority contracts", () => {
  const helpers = loadCommonJs<AuthHelpers>("pb_hooks/helpers.js");

  it("uses local hostname defaults only outside Fly and fails closed without Fly config", () => {
    runtime.$os = { getenv: () => "" };
    expect(helpers.configuredTurnstileHostnames()).toEqual(["localhost", "127.0.0.1"]);

    runtime.$os = {
      getenv: (name: string) => {
        if (name === "FLY_APP_NAME") return "dealer-social-post-ai-production";
        if (name === "TURNSTILE_SECRET") return "production-secret";
        return "";
      },
    };
    expect(helpers.configuredTurnstileHostnames()).toEqual([]);
    const sendWithoutFlyHostnames = vi.fn(() => ({
      statusCode: 200,
      json: {
        success: true,
        hostname: "localhost",
        action: "turnstile-spin-v2",
      },
    }));
    runtime.$http = {
      send: sendWithoutFlyHostnames,
    };
    expect(helpers.verifyTurnstileToken("local-token", "127.0.0.1")).toEqual({
      ok: false,
      unavailable: true,
    });
    expect(sendWithoutFlyHostnames).not.toHaveBeenCalled();

    runtime.$os = {
      getenv: (name: string) => {
        if (name === "FLY_APP_NAME") return "dealer-social-post-ai-production";
        if (name === "TURNSTILE_SECRET") return "production-secret";
        if (name === "TURNSTILE_ALLOWED_HOSTNAMES") {
          return [
            "localhost",
            "127.0.0.1",
            "::1",
            "[::1]",
            "dealer-social-post-ai.vercel.app",
            "dealer-social-post-ai-production.fly.dev",
          ].join(",");
        }
        return "";
      },
    };
    const successfulFlyVerification = vi.fn(() => ({
      statusCode: 200,
      json: {
        success: true,
        hostname: "dealer-social-post-ai.vercel.app",
        action: "turnstile-spin-v2",
      },
    }));
    runtime.$http = {
      send: successfulFlyVerification,
    };
    expect(helpers.configuredTurnstileHostnames()).toEqual([
      "dealer-social-post-ai.vercel.app",
      "dealer-social-post-ai-production.fly.dev",
    ]);
    expect(helpers.verifyTurnstileToken("production-token", "203.0.113.20")).toEqual({
      ok: true,
      unavailable: false,
    });
    expect(successfulFlyVerification).toHaveBeenCalledTimes(1);

    runtime.$http = {
      send: vi.fn(() => ({
        statusCode: 200,
        json: {
          success: true,
          hostname: "localhost",
          action: "turnstile-spin-v2",
        },
      })),
    };
    expect(helpers.verifyTurnstileToken("local-token", "127.0.0.1")).toEqual({
      ok: false,
      unavailable: false,
    });
  });

  it("requires Cloudflare success, an allowed hostname, and the canonical action", () => {
    let verification = {
      success: true,
      hostname: "dealer-social-post-ai.vercel.app",
      action: "turnstile-spin-v2",
    };
    runtime.$os = {
      getenv: (name: string) => {
        if (name === "TURNSTILE_SECRET") return "production-secret";
        if (name === "TURNSTILE_ALLOWED_HOSTNAMES") {
          return "dealer-social-post-ai.vercel.app";
        }
        return "";
      },
    };
    runtime.$http = {
      send: vi.fn(() => ({ statusCode: 200, json: verification })),
    };

    expect(helpers.verifyTurnstileToken("valid-token", "203.0.113.20")).toEqual({
      ok: true,
      unavailable: false,
    });

    verification = { ...verification, action: "different-action" };
    expect(helpers.verifyTurnstileToken("wrong-action", "203.0.113.20")).toEqual({
      ok: false,
      unavailable: false,
    });

    verification = {
      ...verification,
      action: "turnstile-spin-v2",
      hostname: "attacker.example",
    };
    expect(helpers.verifyTurnstileToken("wrong-host", "203.0.113.20")).toEqual({
      ok: false,
      unavailable: false,
    });
  });

  it("distinguishes verification outages from rejected challenges", () => {
    runtime.$os = { getenv: () => "" };
    runtime.$http = { send: vi.fn() };
    expect(helpers.verifyTurnstileToken("token", "127.0.0.1")).toEqual({
      ok: false,
      unavailable: true,
    });
    expect(
      (runtime.$http as { send: ReturnType<typeof vi.fn> }).send,
    ).not.toHaveBeenCalled();

    runtime.$os = { getenv: () => "production-secret" };
    runtime.$http = {
      send: vi.fn(() => {
        throw new Error("network unavailable");
      }),
    };
    expect(helpers.verifyTurnstileToken("token", "127.0.0.1")).toEqual({
      ok: false,
      unavailable: true,
    });
  });

  it("rejects every official Cloudflare test credential in Fly production", () => {
    const siteKeys = [
      "1x00000000000000000000AA",
      "2x00000000000000000000AB",
      "1x00000000000000000000BB",
      "2x00000000000000000000BB",
      "3x00000000000000000000FF",
    ];
    const secrets = [
      "1x0000000000000000000000000000000AA",
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ];
    for (const key of siteKeys) expect(helpers.isTurnstileTestSiteKey(key)).toBe(true);
    expect(helpers.isTurnstileTestSiteKey("production-site-key-example")).toBe(false);

    for (const secret of secrets) {
      expect(helpers.isTurnstileTestSecret(secret)).toBe(true);
      runtime.$os = {
        getenv: (name: string) => {
          if (name === "TURNSTILE_SECRET") return secret;
          return name === "FLY_APP_NAME" ? "dealer-social-post-ai-production" : "";
        },
      };
      runtime.$http = { send: vi.fn() };
      expect(helpers.verifyTurnstileToken("test-token", "203.0.113.20")).toEqual({
        ok: false,
        unavailable: true,
      });
      expect(
        (runtime.$http as { send: ReturnType<typeof vi.fn> }).send,
      ).not.toHaveBeenCalled();
    }
    expect(helpers.isTurnstileTestSecret("production-secret-example")).toBe(false);
  });

  it("keeps login failures typed and verifies challenge before comparing credentials", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const start = hook.indexOf('routerAdd("POST", "/api/app/session"');
    const end = hook.indexOf('routerAdd("GET", "/api/app/session"', start);
    const route = hook.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    for (const code of [
      "INVALID_CODE",
      "INVALID_CREDENTIALS",
      "CHALLENGE_REQUIRED",
      "LOCKED",
      "UNAVAILABLE",
    ]) {
      expect(route).toContain(`"${code}"`);
    }
    expect(route.indexOf("helpers.verifyTurnstileToken")).toBeLessThan(
      route.indexOf("helpers.findActiveAdminLogin"),
    );
    expect(route.indexOf("helpers.reserveLoginAttempt")).toBeLessThan(
      route.indexOf("helpers.findActiveAdminLogin"),
    );
    expect(route.indexOf("helpers.reserveLoginAttempt")).toBeLessThan(
      route.indexOf("helpers.findActivePersonByPin"),
    );
    expect(route.indexOf("helpers.reserveLoginAttempt")).toBeLessThan(
      route.indexOf("malformed code"),
    );
    expect(route).toContain("sessionOpts.expectedPersonPinFingerprint");
    expect(route).toContain("sessionOpts.expectedAdminAuthFingerprint");
    expect(route.indexOf("helpers.finalizeLoginAttempt")).toBeLessThan(
      route.indexOf("helpers.buildSessionCookie(token)"),
    );
    // The legacy env-secret comparison is gone for good.
    expect(route).not.toContain("ADMIN_DEALER_CODE");
    expect(route).not.toContain("dealerCode === adminEnv");
    expect(route).not.toMatch(/dealerCode\.(?:toLowerCase|toUpperCase)/);
  });

  it("wires logout and impersonation exit to authoritative revocation helpers", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const exitStart = hook.indexOf(
      'routerAdd("POST", "/api/app/session/exit-impersonate"',
    );
    const logoutStart = hook.indexOf(
      'routerAdd("DELETE", "/api/app/session"',
      exitStart,
    );
    const nextRoute = hook.indexOf("routerAdd(", logoutStart + 20);
    const exitRoute = hook.slice(exitStart, logoutStart);
    const logoutRoute = hook.slice(logoutStart, nextRoute);

    expect(exitRoute).toContain("helpers.replaceImpersonationSession(");
    expect(exitRoute).not.toContain("$app.dao().deleteRecord(context.session)");
    expect(exitRoute).not.toContain("$app.dao().deleteRecord(adminSession)");
    expect(logoutRoute).toContain("helpers.revokeSession(c)");
    expect(logoutRoute).toContain('code: "UNAVAILABLE"');
    expect(logoutRoute.indexOf("helpers.revokeSession(c)")).toBeLessThan(
      logoutRoute.indexOf("helpers.buildClearCookie()"),
    );
  });

  it("allows paid provider requests only through an authoritative session", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const start = hook.indexOf("const proxyHandler = (c) =>");
    const end = hook.indexOf(
      'routerAdd("POST", "/api/proxy/openai/v1/images/generations"',
      start,
    );
    const genericProxy = hook.slice(start, end);

    expect(genericProxy).toContain("helpers.dealerFromSession(c)");
    expect(genericProxy).toContain("no authoritative session");
    expect(genericProxy).not.toContain("PROXY_ACCESS_TOKEN");
    expect(genericProxy).not.toContain("incomingToken");
    expect(hook).not.toContain("PROXY_ACCESS_TOKEN");
  });

  it("redacts ordinary PIN DTOs and confines credential output to audited actions", () => {
    const person = makeRecord("person-1", {
      dealer: "dealer-1",
      name: "Alex Morgan",
      role: "salesperson",
      active: true,
      pin: "4821",
      pin_needs_distribution: true,
    });
    const serialized = helpers.serializePerson(person);
    expect(serialized).toMatchObject({ hasPin: true, pinNeedsDistribution: true });
    expect(serialized).not.toHaveProperty("pin");
    expect(JSON.stringify(serialized)).not.toContain("4821");

    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const listStart = hook.indexOf('routerAdd("GET", "/api/app/salespeople"');
    const createStart = hook.indexOf('routerAdd("POST", "/api/app/salespeople"');
    const listRoute = hook.slice(listStart, createStart);
    expect(listRoute).toContain("helpers.serializePerson(record)");
    expect(listRoute).not.toContain('getString("pin")');

    const patchStart = hook.indexOf(
      'routerAdd("PATCH", "/api/app/salespeople/:id"',
      createStart,
    );
    const createRoute = hook.slice(createStart, patchStart);
    expect(createRoute).toContain(
      'runAuditedTransaction("person_pin_issued", createAudit',
    );
    expect(createRoute).toContain("txDao.saveRecord(record)");
    expect(createRoute.indexOf("txDao.saveRecord(record)")).toBeLessThan(
      createRoute.lastIndexOf("pin: pin"),
    );
    const managerLoginStart = hook.indexOf(
      'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
      patchStart,
    );
    const legacyPatchRoute = hook.slice(patchStart, managerLoginStart);
    expect(legacyPatchRoute).toContain(
      "const outcome = helpers.runAuditedTransaction(",
    );
    expect(legacyPatchRoute).toContain("return result ? result.eventKind");
    expect(legacyPatchRoute).toContain('txDao.findRecordById("salespeople", personId)');
    expect(legacyPatchRoute).toContain("txDao.saveRecord(txPerson)");
    expect(legacyPatchRoute).toContain("helpers.revokePersonSessionsWithDao");
    expect(legacyPatchRoute.indexOf("helpers.runAuditedTransaction(")).toBeLessThan(
      legacyPatchRoute.indexOf("pin: outcome.pin"),
    );

    for (const path of ["rotate-pin", "reveal-pin"]) {
      const routeStart = hook.indexOf(
        `routerAdd("POST", "/api/app/salespeople/:id/${path}"`,
      );
      const routeEnd = hook.indexOf("routerAdd(", routeStart + 20);
      const route = hook.slice(routeStart, routeEnd);
      expect(routeStart).toBeGreaterThan(-1);
      expect(route).toContain('set("Cache-Control", "private, no-store")');
      if (path === "rotate-pin") {
        expect(route).toContain('helpers.runAuditedTransaction("person_pin_rotated"');
        expect(route.indexOf("helpers.runAuditedTransaction")).toBeLessThan(
          route.indexOf("pin: pin"),
        );
        expect(route).toContain("pin: pin");
        // Rotation stores only the peppered hash; plaintext leaves in the
        // one-time response and never lands in a record field.
        expect(route).toContain('txPerson.set("pin", "")');
        expect(route).toContain('txPerson.set("pin_hash", helpers.personPinHash(pin))');
      } else {
        // Reveal is retired: hashed storage cannot produce a current code.
        expect(route).toContain("c.json(410");
        expect(route).toContain('"PIN_REVEAL_RETIRED"');
        expect(route).not.toContain("pin: pin");
        expect(route).not.toContain('getString("pin")');
      }
    }
  });

  it("retires PIN reveal with an explanatory 410 and never touches the record", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const routeStart = hook.indexOf(
      'routerAdd("POST", "/api/app/salespeople/:id/reveal-pin"',
    );
    const routeEnd = hook.indexOf("routerAdd(", routeStart + 20);
    const routeSource = hook.slice(routeStart, routeEnd);
    const findRecordById = vi.fn();
    let handler: ((context: any) => unknown) | undefined;
    const responseHeader = vi.fn();
    const json = vi.fn((status: number, payload: StringMap) => ({
      status,
      payload,
    }));

    runInNewContext(routeSource, {
      __hooks: "/hooks",
      routerAdd: (_method: string, _path: string, callback: typeof handler) => {
        handler = callback;
      },
      require: () => ({
        sessionContext: () => ({ role: "super_admin" }),
      }),
      $app: {
        dao: () => ({ findRecordById }),
      },
      console,
    });

    expect(handler).toBeTypeOf("function");
    const result = handler?.({
      pathParam: () => "person-1",
      response: () => ({ header: () => ({ set: responseHeader }) }),
      json,
    }) as { status: number; payload: StringMap };

    expect(responseHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(findRecordById).not.toHaveBeenCalled();
    expect(result.status).toBe(410);
    expect(result.payload.code).toBe("PIN_REVEAL_RETIRED");
    expect(JSON.stringify(result)).not.toMatch(/\b\d{4}\b/);
  });

  it("stores salesperson access codes only as peppered hashes", () => {
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

    // Hashing derives from the deployment pepper and fails closed without it.
    expect(helpers).toContain("function personPinHash(pin)");
    expect(helpers).toContain('$os.getenv("SALESPERSON_PIN_PEPPER")');
    expect(helpers).toContain("SALESPERSON_PIN_PEPPER is not configured");
    expect(helpers).toContain(
      '"dealer-social-post-ai:person-pin-hash:v1:" + normalized',
    );

    // Login resolves the hash first; while the hash index is globally unique
    // a scoped pre-query would be a redundant second lookup, so the dealerId
    // hint is accepted but unused until the dealer-scoped release. The
    // plaintext filter survives only as the bridge fallback.
    expect(helpers).toContain('"pin_hash = {:hash} && active = true"');
    expect(helpers).not.toContain(
      '"pin_hash = {:hash} && dealer = {:dealer} && active = true"',
    );

    // Session fingerprints bind to the stored hash (v2), and the bootstrap
    // sweep converts plaintext rows while rewriting live session fingerprints.
    expect(helpers).toContain('"dealer-social-post-ai:person-pin:v2:"');
    expect(helpers).toContain("function backfillSalespersonPinHashes()");
    expect(hook).toContain("helpers.backfillSalespersonPinHashes()");

    // Availability checks cover both storage forms during the bridge.
    expect(helpers).toContain('"(pin = {:pin} || pin_hash = {:hash})"');

    // Creation writes the hash, never the plaintext.
    expect(hook).toContain("pin_hash: helpers.personPinHash(pin)");

    // Readiness fails without the pepper so a deploy cannot silently disable
    // PIN logins.
    expect(hook).toContain("checks.pin_pepper_configured");

    // The migration swaps the global plaintext index for the dealer-scoped
    // hash index.
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751300000_person_pin_hash.js"),
      "utf8",
    );
    // Global (not dealer-scoped) uniqueness must hold at the database level
    // while PIN-only login remains possible — the application-level
    // check-then-insert alone is raceable across dealerships.
    expect(migration).toContain("idx_salespeople_pin_hash");
    expect(migration).toContain(
      "UNIQUE INDEX `idx_salespeople_pin_hash` ON `salespeople` (`pin_hash`)",
    );
    // The plaintext partial index survives the bridge as the DB backstop for
    // the still-serving old binary's raceable check-then-insert.
    expect(migration).toContain(
      "UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != ''",
    );
    // Rolling back would destroy the only credential material.
    expect(migration).toContain("forward-only");
  });

  it("ignores legacy attribution fields and derives identity from the validated session", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const start = hook.indexOf('routerAdd("POST", "/api/app/posts"');
    const end = hook.indexOf(
      'routerAdd("POST", "/api/app/posts/:id/video-complete"',
      start,
    );
    const route = hook.slice(start, end);

    expect(route).toContain("helpers.sessionContext(c)");
    expect(route).toContain("context.person ? context.person.id");
    expect(route).toContain('context.person.getString("name")');
    expect(route).not.toContain("body.salesperson_id");
    expect(route).not.toContain("body.salesperson_name");
    expect(route.indexOf("helpers.sessionContext(c)")).toBeLessThan(
      route.indexOf("form.loadData"),
    );
  });
});
