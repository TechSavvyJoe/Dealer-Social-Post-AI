import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

type StringMap = Record<string, unknown>;

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const between = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing contract marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing contract marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

class MockSchema {
  private readonly fields = new Map<string, StringMap>();

  constructor(fields: StringMap[] = []) {
    for (const field of fields) this.fields.set(String(field.name), field);
  }

  getFieldByName(name: string) {
    return this.fields.get(name) ?? null;
  }

  addField(field: StringMap) {
    this.fields.set(String(field.name), field);
  }
}

function runManagerLoginMigration(existingManagerAccounts?: StringMap) {
  let apply: ((db: StringMap) => void) | undefined;
  let managerAccounts: StringMap | undefined = existingManagerAccounts;
  const people = { id: "people-id", schema: new MockSchema(), indexes: [] as string[] };
  const sessions = {
    id: "sessions-id",
    schema: new MockSchema(),
    indexes: [] as string[],
  };
  const savedCollections: StringMap[] = [];
  const dao = {
    findCollectionByNameOrId(name: string) {
      if (name === "salespeople") return people;
      if (name === "sessions") return sessions;
      if (name === "manager_accounts" && managerAccounts) return managerAccounts;
      throw new Error(`Collection is absent: ${name}`);
    },
    saveCollection(collection: StringMap) {
      savedCollections.push(collection);
    },
  };

  class Collection {
    id = "manager-accounts-id";

    constructor(values: StringMap) {
      Object.assign(this, values);
      managerAccounts = this as unknown as StringMap;
    }
  }

  class SchemaField {
    constructor(values: StringMap) {
      Object.assign(this, values);
    }
  }

  runInNewContext(read("pb_migrations/1750900000_manager_password_login.js"), {
    migrate: (up: (db: StringMap) => void) => {
      apply = up;
    },
    Dao: function Dao(db: StringMap) {
      return db;
    },
    Collection,
    SchemaField,
  });

  expect(apply).toBeTypeOf("function");
  apply!(dao as unknown as StringMap);
  return { managerAccounts, people, sessions, savedCollections };
}

function loadHelpers() {
  const source = read("pb_hooks/helpers.js");
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
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

const runtime = globalThis as unknown as Record<string, any>;
const savedRuntime = {
  $os: runtime.$os,
  $security: runtime.$security,
  Record: runtime.Record,
};

afterEach(() => {
  runtime.$os = savedRuntime.$os;
  runtime.$security = savedRuntime.$security;
  runtime.Record = savedRuntime.Record;
});

describe("manager password authentication backend contract", () => {
  it("creates a locked PocketBase auth collection with password login disabled", () => {
    const { managerAccounts, people, sessions, savedCollections } =
      runManagerLoginMigration();

    expect(managerAccounts).toMatchObject({
      name: "manager_accounts",
      type: "auth",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      options: {
        manageRule: null,
        allowOAuth2Auth: false,
        allowUsernameAuth: false,
        allowEmailAuth: false,
        requireEmail: false,
        minPasswordLength: 15,
      },
    });
    expect(managerAccounts?.indexes).toEqual([
      "CREATE UNIQUE INDEX `idx_manager_accounts_person` ON `manager_accounts` (`person`)",
    ]);
    expect(people.schema.getFieldByName("manager_username")).toMatchObject({
      type: "text",
      required: false,
      options: { min: 3, max: 32, pattern: "^[a-z][a-z0-9._-]{2,31}$" },
    });
    expect(people.indexes.join("\n")).toContain("idx_salespeople_manager_username");
    expect(sessions.schema.getFieldByName("manager_account")).toMatchObject({
      type: "relation",
      required: false,
    });
    expect(sessions.schema.getFieldByName("manager_auth_fingerprint")).toMatchObject({
      type: "text",
      options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
    });
    expect(savedCollections).toContain(managerAccounts);
  });

  it("reconciles a dirty auth collection and rejects an unsafe collection type", () => {
    const dirtyPersonField = {
      name: "person",
      type: "relation",
      required: false,
      options: {
        collectionId: "wrong-collection",
        cascadeDelete: false,
        maxSelect: 9,
        minSelect: 0,
      },
    };
    const dirty = {
      id: "manager-accounts-id",
      name: "manager_accounts",
      type: "auth",
      system: true,
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      options: {
        manageRule: "",
        allowOAuth2Auth: true,
        allowUsernameAuth: true,
        allowEmailAuth: true,
        requireEmail: true,
        minPasswordLength: 6,
      },
      setOptions(options: StringMap) {
        (this as StringMap).options = { ...options };
      },
      schema: new MockSchema([dirtyPersonField]),
      indexes: [
        "CREATE INDEX `idx_manager_accounts_person` ON `manager_accounts` (`person`)",
      ],
    };
    const { managerAccounts } = runManagerLoginMigration(dirty);

    expect(managerAccounts).toMatchObject({
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      options: {
        manageRule: null,
        allowOAuth2Auth: false,
        allowUsernameAuth: false,
        allowEmailAuth: false,
        requireEmail: false,
        minPasswordLength: 15,
      },
    });
    expect(dirtyPersonField).toMatchObject({
      required: true,
      options: {
        collectionId: "people-id",
        cascadeDelete: true,
        maxSelect: 1,
        minSelect: 1,
      },
    });
    expect(managerAccounts?.indexes).toEqual([
      "CREATE UNIQUE INDEX `idx_manager_accounts_person` ON `manager_accounts` (`person`)",
    ]);

    expect(() =>
      runManagerLoginMigration({
        id: "unsafe-id",
        name: "manager_accounts",
        type: "base",
        schema: new MockSchema(),
        indexes: [],
      }),
    ).toThrow("manager_accounts exists but is not an auth collection");
  });

  it("enforces the 8-to-128 character password boundary", () => {
    const helpers = loadHelpers();

    expect(helpers.isManagerLoginPasswordShape("x".repeat(7))).toBe(false);
    expect(helpers.isStrongManagerPassword("x".repeat(7))).toBe(false);
    expect(helpers.isManagerLoginPasswordShape("x".repeat(8))).toBe(true);
    expect(helpers.isStrongManagerPassword("x".repeat(8))).toBe(true);
    expect(helpers.isManagerLoginPasswordShape("x".repeat(128))).toBe(true);
    expect(helpers.isStrongManagerPassword("x".repeat(129))).toBe(false);
  });

  it("delegates password storage and comparison to PocketBase", () => {
    const backend = read("pb_hooks/main.pb.js");
    const loginRoute = between(
      backend,
      'routerAdd("POST", "/api/app/session"',
      'routerAdd("GET", "/api/app/session"',
    );
    const configureRoute = between(
      backend,
      'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
      'routerAdd("DELETE", "/api/app/salespeople/:id/manager-login"',
    );

    expect(configureRoute).toContain("account.setPassword(password)");
    expect(loginRoute).toMatch(
      /passwordVerificationAccount\.validatePassword\(\s*managerPassword/,
    );
    expect(loginRoute).toContain("findManagerPasswordVerificationAccount()");
    expect(loginRoute).toContain(
      'managerLookup.status === "found" && passwordAccepted',
    );
    expect(configureRoute).not.toMatch(
      /(?:sha256|md5|hash)\s*\([^)]*password|set\(["'](?:password|password_hash|passwordHash)["']/i,
    );
    expect(loginRoute).not.toMatch(
      /managerPassword\s*===|(?:sha256|md5|hash)\s*\([^)]*managerPassword/i,
    );
  });

  it("restricts manager-login configuration and disablement to super admin", () => {
    const backend = read("pb_hooks/main.pb.js");
    const configureRoute = between(
      backend,
      'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
      'routerAdd("DELETE", "/api/app/salespeople/:id/manager-login"',
    );
    const disableRoute = between(
      backend,
      'routerAdd("DELETE", "/api/app/salespeople/:id/manager-login"',
      'routerAdd("POST", "/api/app/salespeople/:id/rotate-pin"',
    );

    for (const route of [configureRoute, disableRoute]) {
      const roleCheck = route.indexOf('context.role !== "super_admin"');
      const personLookup = route.indexOf('findRecordById("salespeople"');
      expect(roleCheck).toBeGreaterThanOrEqual(0);
      expect(personLookup).toBeGreaterThan(roleCheck);
      expect(route).toContain('set("Cache-Control", "private, no-store")');
      expect(route).toContain("MANAGER_LOGIN_FORBIDDEN");
    }
  });

  it("binds manager sessions to the current PocketBase credential token key", () => {
    const helpers = loadHelpers();
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    runtime.$os = { getenv: () => "" };
    runtime.$security = {
      sha256: digest,
      randomStringWithAlphabet: (length: number) => "a".repeat(length),
    };

    let tokenKey = "manager-token-key-v1";
    const dealer = makeRecord("dealer-1", { is_system: false });
    const person = makeRecord("person-1", {
      dealer: dealer.id,
      role: "manager",
      active: true,
      pin: "2468",
      manager_username: "jordan.manager",
    });
    const account = {
      ...makeRecord("account-1", {
        person: person.id,
        username: "jordan.manager",
      }),
      tokenKey: () => tokenKey,
    };
    const saved: Array<{ values: StringMap }> = [];

    runtime.Record = class {
      id = "session-1";
      values: StringMap;

      constructor(_collection: unknown, values: StringMap) {
        this.values = { ...values };
      }
    };

    const dao = {
      findCollectionByNameOrId(name: string) {
        if (name === "sessions") return { id: "sessions" };
        throw new Error(`Unexpected collection: ${name}`);
      },
      findRecordById(collection: string, id: string) {
        if (collection === "dealers" && id === dealer.id) return dealer;
        if (collection === "salespeople" && id === person.id) return person;
        if (collection === "manager_accounts" && id === account.id) return account;
        throw new Error(`Missing ${collection}/${id}`);
      },
      saveRecord(record: { values: StringMap }) {
        saved.push(record);
      },
    };
    const pinFingerprint = helpers.personPinFingerprint(person);
    const managerFingerprint = helpers.managerAuthFingerprint(account);

    helpers.createSessionWithDao(
      dao,
      dealer.id,
      "dealer_admin",
      "203.0.113.8",
      "vitest",
      {
        personId: person.id,
        expectedPersonPinFingerprint: pinFingerprint,
        managerAccountId: account.id,
        expectedManagerAuthFingerprint: managerFingerprint,
      },
    );

    expect(saved).toHaveLength(1);
    expect(saved[0].values).toMatchObject({
      person: person.id,
      manager_account: account.id,
      manager_auth_fingerprint: managerFingerprint,
    });
    expect(JSON.stringify(saved[0].values)).not.toContain(tokenKey);

    tokenKey = "manager-token-key-v2";
    expect(() =>
      helpers.createSessionWithDao(
        dao,
        dealer.id,
        "dealer_admin",
        "203.0.113.8",
        "vitest",
        {
          personId: person.id,
          expectedPersonPinFingerprint: pinFingerprint,
          managerAccountId: account.id,
          expectedManagerAuthFingerprint: managerFingerprint,
        },
      ),
    ).toThrow("Manager credential changed during sign-in");

    const helperSource = read("pb_hooks/helpers.js");
    const sessionValidator = between(
      helperSource,
      "function sessionContext(c)",
      "function dealerFromSession(c)",
    );
    expect(sessionValidator).toContain(
      'findRecordById("manager_accounts", managerAccountId)',
    );
    expect(sessionValidator).toContain(
      "managerAuthFingerprint(account) !== storedManagerFingerprint",
    );
  });

  it("revokes sessions on configure, disable, and manager role removal", () => {
    const backend = read("pb_hooks/main.pb.js");
    const patchRoute = between(
      backend,
      'routerAdd("PATCH", "/api/app/salespeople/:id"',
      'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
    );
    const configureRoute = between(
      backend,
      'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
      'routerAdd("DELETE", "/api/app/salespeople/:id/manager-login"',
    );
    const disableRoute = between(
      backend,
      'routerAdd("DELETE", "/api/app/salespeople/:id/manager-login"',
      'routerAdd("POST", "/api/app/salespeople/:id/rotate-pin"',
    );

    expect(configureRoute).toContain(
      'const txPerson = txDao.findRecordById("salespeople", personId)',
    );
    expect(configureRoute).toContain("revokePersonSessionsWithDao(txDao, txPerson.id)");
    expect(disableRoute).toContain(
      'const txPerson = txDao.findRecordById("salespeople", personId)',
    );
    expect(disableRoute).toContain("revokePersonSessionsWithDao(txDao, txPerson.id)");
    expect(patchRoute).toContain("revokePersonSessionsWithDao(txDao, txPerson.id)");
    expect(disableRoute).toContain("txDao.deleteRecord(account)");
    expect(disableRoute).toContain('txPerson.set("manager_username", "")');
    expect(patchRoute).toContain('roleChanged && nextRole !== "manager"');
    expect(patchRoute).toContain("txDao.deleteRecord(managerAccount)");
    expect(patchRoute).toContain('txPerson.set("manager_username", "")');
  });

  it("mutates existing people only from transaction-current authorized records", () => {
    const backend = read("pb_hooks/main.pb.js");
    const routes = [
      {
        label: "profile update",
        source: between(
          backend,
          'routerAdd("PATCH", "/api/app/salespeople/:id"',
          'routerAdd("PUT", "/api/app/salespeople/:id/manager-login"',
        ),
        forbidden: "PERSON_EDIT_FORBIDDEN",
      },
      {
        label: "PIN rotation",
        source: between(
          backend,
          'routerAdd("POST", "/api/app/salespeople/:id/rotate-pin"',
          'routerAdd("POST", "/api/app/salespeople/:id/reveal-pin"',
        ),
        forbidden: "PIN_ROTATE_FORBIDDEN",
      },
      {
        label: "PIN distribution acknowledgement",
        source: between(
          backend,
          'routerAdd("POST", "/api/app/salespeople/:id/acknowledge-pin"',
          'routerAdd("DELETE", "/api/app/salespeople/:id"',
        ),
        forbidden: "PIN_ACKNOWLEDGE_FORBIDDEN",
      },
      {
        label: "deactivation",
        source: between(
          backend,
          'routerAdd("DELETE", "/api/app/salespeople/:id"',
          "// ---- Dealers CRUD",
        ),
        forbidden: "PERSON_DEACTIVATE_FORBIDDEN",
      },
    ] as const;

    for (const route of routes) {
      const transaction = route.source.indexOf("helpers.runAuditedTransaction");
      const txRead = route.source.indexOf(
        'const txPerson = txDao.findRecordById("salespeople", personId)',
      );
      const authorization = route.source.indexOf(route.forbidden);
      const txSave = route.source.indexOf("txDao.saveRecord(txPerson)");

      expect(
        transaction,
        `${route.label} must be audited transactionally`,
      ).toBeGreaterThan(-1);
      expect(
        route.source.slice(0, transaction),
        `${route.label} must not load a mutable person before its transaction`,
      ).not.toContain('findRecordById("salespeople"');
      expect(txRead, `${route.label} must re-read the current person`).toBeGreaterThan(
        transaction,
      );
      expect(
        authorization,
        `${route.label} must authorize the transaction-current person`,
      ).toBeGreaterThan(txRead);
      expect(
        txSave,
        `${route.label} must save the transaction-current person`,
      ).toBeGreaterThan(authorization);
      expect(route.source).not.toContain("txDao.saveRecord(record)");
      expect(route.source).not.toContain("$app.dao().saveRecord(record)");
    }
  });

  it("keeps password and auth-token material out of person DTOs", () => {
    const helpers = loadHelpers();
    const secretPassword = "DoNotLeakThisPassword!";
    const secretTokenKey = "DoNotLeakThisTokenKey";
    const person = makeRecord("manager-1", {
      dealer: "dealer-1",
      name: "Jordan Manager",
      role: "manager",
      active: true,
      pin: "2468",
      pin_needs_distribution: false,
      manager_username: "jordan.manager",
      password: secretPassword,
      passwordHash: secretPassword,
      tokenKey: secretTokenKey,
      manager_account: "account-1",
      manager_auth_fingerprint: "f".repeat(64),
    });

    const roster = helpers.serializePerson(person);
    const summary = helpers.serializePersonSummary(person);
    const serialized = JSON.stringify({ roster, summary });

    expect(roster).toMatchObject({
      hasManagerLogin: true,
      managerUsername: "jordan.manager",
    });
    expect(serialized).not.toContain(secretPassword);
    expect(serialized).not.toContain(secretTokenKey);
    for (const field of [
      "password",
      "passwordHash",
      "tokenKey",
      "manager_account",
      "manager_auth_fingerprint",
    ]) {
      expect(Object.hasOwn(roster, field)).toBe(false);
      expect(Object.hasOwn(summary, field)).toBe(false);
    }
  });

  it("keeps the v4 API contract synchronized across backend and clients", () => {
    const sources = [
      ["pb_hooks/helpers.js", /const API_CONTRACT_VERSION = "([^"]+)"/],
      ["services/salespeople.ts", /API_CONTRACT_VERSION = "([^"]+)"/],
      ["utils/telemetry.ts", /const API_CONTRACT_VERSION = "([^"]+)"/],
      ["e2e/real-pocketbase.spec.ts", /const apiContractVersion = "([^"]+)"/],
    ] as const;
    const versions = sources.map(([path, pattern]) => read(path).match(pattern)?.[1]);

    expect(versions).toEqual(Array(versions.length).fill("2026-07-31.v4"));
    expect(read("pb_hooks/main.pb.js")).toContain(
      "apiContractVersion: helpers.API_CONTRACT_VERSION",
    );
  });

  it("records only credential mode and non-secret identifiers in logs and audits", () => {
    const backend = read("pb_hooks/main.pb.js");
    const store = read("stores/appStore.ts");
    const auditDetails = Array.from(
      backend.matchAll(/auditOptions\.detail\s*=\s*([\s\S]*?);/g),
      (match) => match[1],
    );
    const loginTelemetry = store.slice(
      store.indexOf('logError("app.login.failed"'),
      store.indexOf("const userMessage", store.indexOf('logError("app.login.failed"')),
    );

    expect(auditDetails.length).toBeGreaterThan(0);
    for (const detail of auditDetails) {
      expect(detail).not.toMatch(
        /managerPassword|\bpassword\b|managerUsername|\busername\b/,
      );
    }
    expect(loginTelemetry).toContain("errorCode: code");
    expect(loginTelemetry).toContain("authType: credentials.authType");
    expect(loginTelemetry).not.toMatch(/credentials\.(?:username|password)/);
    expect(backend).not.toMatch(
      /console\.(?:log|error|warn)\([^)]*(?:managerPassword|managerUsername)/s,
    );
  });
});
