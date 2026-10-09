/**
 * Setup notes (spec 2026-10-05 §8): the system administrator's free text about
 * setting a dealership up. Written only by a system administrator, returned
 * only by the administrator's dealer list, never part of a session payload.
 *
 * Runs the real route source from pb_hooks/main.pb.js and the real helpers
 * against fakes of the PocketBase runtime, and the real migration against the
 * schema fake that models PocketBase 0.22's removeField(id).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { fakeCollection, fieldsOf } from "../test/fakePocketBaseSchema";

type AnyRecord = Record<string, unknown>;
type RouteResult = { status: number; payload: AnyRecord };
type Helpers = {
  dealerMutationData: (
    body: AnyRecord,
    allowCode: boolean,
    allowAdmin: boolean,
  ) => AnyRecord;
  serializeDealer: (record: unknown) => AnyRecord;
  safeDealerMutationError: (err: unknown) => string;
  DEALER_ADMIN_TEXT_FIELD_LIMITS: Record<string, number>;
};

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const loadCommonJs = <T>(relativePath: string): T => {
  const module = { exports: {} as T };
  new Function("module", "exports", read(relativePath))(module, module.exports);
  return module.exports;
};

const helpers = loadCommonJs<Helpers>("pb_hooks/helpers.js");
const hookSource = read("pb_hooks/main.pb.js");
const MIGRATION = "pb_migrations/1752400000_dealer_setup_notes.js";

/** Strip comments so a file may still DESCRIBE what its code must not do. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The source of one route registration, up to the next one. */
const routeBounds = (marker: string) => {
  const from = hookSource.indexOf(marker);
  expect(from, marker).toBeGreaterThan(-1);
  const next = hookSource.indexOf("routerAdd(", from + marker.length);
  return { from, to: next === -1 ? hookSource.length : next };
};
const PATCH_ROUTE = 'routerAdd("PATCH", "/api/app/dealers/:id",';
const LIST_ROUTE = 'routerAdd("GET", "/api/app/dealers",';
const routeSource = (marker: string) => {
  const { from, to } = routeBounds(marker);
  return hookSource.slice(from, to);
};

/** A PocketBase record fake whose stored values are plain strings and bools. */
const dealerRecord = (id: string, text: AnyRecord, flags: AnyRecord = {}) => ({
  id,
  getString: (field: string) => String(text[field] ?? ""),
  getBool: (field: string) => flags[field] === true,
  get: (field: string) => text[field] ?? flags[field],
});

/** Runs the real PATCH route; `loaded` is what reached the record form. */
const patchDealer = (role: string, body: AnyRecord, sessionDealerId = "dealer-1") => {
  const loaded: AnyRecord[] = [];
  const submitted = vi.fn();
  let handler: ((c: unknown) => RouteResult) | undefined;
  runInNewContext(routeSource(PATCH_ROUTE), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: () => ({
      dealerFromSession: () => ({ id: sessionDealerId }),
      sessionRoleFromCookie: () => role,
      restrictDealerLogoSchema: vi.fn(),
      dealerMutationData: helpers.dealerMutationData,
      dealerLogoFile: () => null,
      // The route's bounded-media guard is outside the setup-notes policy
      // tested here; report no capacity rejection for these text-only cases.
      // The actual admission policy is exercised in mediaStorage tests.
      respondIfLimited: () => false,
      clientIP: () => "203.0.113.5",
      userAgent: () => "vitest",
      runAuditedTransaction: (
        _event: string,
        _options: unknown,
        fn: (dao: unknown) => void,
      ) => fn({}),
      safeDealerMutationError: helpers.safeDealerMutationError,
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
        submit: submitted,
      };
    },
    console: { error: vi.fn(), log: vi.fn() },
  });
  const result = handler!({
    pathParam: () => "dealer-1",
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
  return { result, loaded, submitted };
};

/** Runs the real dealer-list route against the given saved records. */
const listDealers = (role: string, records: ReturnType<typeof dealerRecord>[]) => {
  let handler: ((c: unknown) => RouteResult) | undefined;
  runInNewContext(routeSource(LIST_ROUTE), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: () => ({
      dealerFromSession: () => ({ id: "system" }),
      sessionRoleFromCookie: () => role,
      serializeDealer: helpers.serializeDealer,
    }),
    $app: { dao: () => ({ findRecordsByFilter: () => records }) },
    console: { error: vi.fn(), log: vi.fn() },
  });
  return handler!({
    queryParam: () => "",
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
};

const NOTES = [
  "Call the GM about the logo file.",
  "",
  "  - Facebook Page: waiting on admin access",
  "  - Instagram: done  ",
].join("\n");

describe("setup notes are written by a system administrator only", () => {
  it("are the administrator's alone: a field list of their own, 4,000 characters", () => {
    expect(helpers.DEALER_ADMIN_TEXT_FIELD_LIMITS).toEqual({ setup_notes: 4000 });
  });

  it("reach the form intact, newlines and spacing included, from a system administrator", () => {
    const { result, loaded, submitted } = patchDealer("super_admin", {
      name: "Northline Motors",
      setup_notes: NOTES,
    });
    expect(result.status).toBe(200);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].setup_notes).toBe(NOTES);
    expect(loaded[0].name).toBe("Northline Motors");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("can be cleared by a system administrator", () => {
    const { result, loaded } = patchDealer("super_admin", { setup_notes: "" });
    expect(result.status).toBe(200);
    expect(loaded[0]).toHaveProperty("setup_notes", "");
  });

  it("are ignored, not rejected, in a manager's save, which still saves everything else", () => {
    const { result, loaded, submitted } = patchDealer("dealer_admin", {
      name: "Northline Motors",
      requires_approval: "true",
      brand_voice: "Friendly and local.",
      setup_notes: NOTES,
    });
    expect(result.status).toBe(200);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      name: "Northline Motors",
      requires_approval: true,
      brand_voice: "Friendly and local.",
    });
    expect(loaded[0]).not.toHaveProperty("setup_notes");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("drops every administrator-only field from a manager's save", () => {
    // A field added to DEALER_ADMIN_TEXT_FIELD_LIMITS later must also be
    // removed by the PATCH route, or a manager could write it.
    for (const field of Object.keys(helpers.DEALER_ADMIN_TEXT_FIELD_LIMITS)) {
      const { result, loaded } = patchDealer("dealer_admin", {
        name: "Northline Motors",
        [field]: "set by a manager",
      });
      expect(result.status, field).toBe(200);
      expect(loaded[0], field).not.toHaveProperty(field);
    }
  });

  it("leave the stored notes alone when a save does not carry them", () => {
    const { loaded } = patchDealer("super_admin", { name: "Northline Motors" });
    expect(loaded[0]).not.toHaveProperty("setup_notes");
  });

  it("accept 4,000 characters and reject 4,001 with the route's normal 400", () => {
    const atLimit = patchDealer("super_admin", { setup_notes: "x".repeat(4000) });
    expect(atLimit.result.status).toBe(200);
    expect((atLimit.loaded[0].setup_notes as string).length).toBe(4000);

    const overLimit = patchDealer("super_admin", { setup_notes: "x".repeat(4001) });
    expect(overLimit.result).toEqual({
      status: 400,
      payload: { error: "A dealer field exceeds its maximum length" },
    });
    expect(overLimit.loaded).toHaveLength(0);
    expect(overLimit.submitted).not.toHaveBeenCalled();
  });

  it("count a line break once, though a browser's form data sends it as CRLF", () => {
    // A textarea with maxLength 4000 counts each line break as one character;
    // multipart form data carries it as CR LF. Both must agree on the limit.
    const typed = "x".repeat(3998) + "\n" + "y";
    const sent = typed.replace(/\n/g, "\r\n");
    expect(sent.length).toBe(4001);
    const { result, loaded } = patchDealer("super_admin", { setup_notes: sent });
    expect(result.status).toBe(200);
    expect(loaded[0].setup_notes).toBe(typed);
  });

  it("go through the same validation on create, which only a system administrator can call", () => {
    const create = routeSource('routerAdd("POST", "/api/app/dealers",');
    expect(create).toContain('helpers.sessionRoleFromCookie(c) !== "super_admin"');
    expect(create).toContain("helpers.dealerMutationData(body, false, false)");
    expect(
      helpers.dealerMutationData(
        { name: "Northline", setup_notes: NOTES },
        false,
        false,
      ),
    ).toMatchObject({ name: "Northline", setup_notes: NOTES });
  });
});

describe("setup notes never reach a session", () => {
  const record = dealerRecord("dealer-1", {
    name: "Northline Motors",
    setup_notes: "Private: GM prefers calls after 4 pm.",
  });

  it("are not in the session dealer payload, even when the record has them", () => {
    const serialized = helpers.serializeDealer(record);
    expect(serialized.name).toBe("Northline Motors");
    for (const field of Object.keys(helpers.DEALER_ADMIN_TEXT_FIELD_LIMITS)) {
      expect(serialized, field).not.toHaveProperty(field);
    }
    expect(JSON.stringify(serialized)).not.toContain("GM prefers calls");
  });

  it("are not named in serializeDealer's code, only in its warning comment", () => {
    const helpersSource = read("pb_hooks/helpers.js");
    const from = helpersSource.indexOf("function serializeDealer(");
    expect(from).toBeGreaterThan(-1);
    const to = helpersSource.indexOf("\n}\n", from);
    expect(to).toBeGreaterThan(from);
    const body = helpersSource.slice(from, to + 2);
    // The comment names the field on purpose; the code must not.
    expect(body).toContain("setup_notes");
    expect(withoutComments(body)).not.toContain("setup_notes");
  });

  it("appear in route code only where the list reads them and the PATCH drops them", () => {
    const list = routeBounds(LIST_ROUTE);
    const patch = routeBounds(PATCH_ROUTE);
    const offenders: number[] = [];
    let at = hookSource.indexOf("setup_notes");
    while (at !== -1) {
      const lineStart = hookSource.lastIndexOf("\n", at) + 1;
      const isComment = /^\s*(\/\/|\*)/.test(hookSource.slice(lineStart, at));
      const inList = at > list.from && at < list.to;
      const inPatch = at > patch.from && at < patch.to;
      if (!isComment && !inList && !inPatch) {
        offenders.push(hookSource.slice(0, at).split("\n").length);
      }
      at = hookSource.indexOf("setup_notes", at + 1);
    }
    expect(offenders, `pb_hooks/main.pb.js lines: ${offenders.join(", ")}`).toEqual([]);
    expect(withoutComments(routeSource(PATCH_ROUTE))).toMatch(
      /if \(!isSuperAdmin\) delete data\.setup_notes;/,
    );
  });

  it("are returned by the administrator's dealer list, for each store", () => {
    const result = listDealers("super_admin", [
      record,
      dealerRecord("dealer-2", { name: "Harbor Ford" }),
    ]);
    expect(result.status).toBe(200);
    const items = result.payload.items as AnyRecord[];
    expect(items.map((item) => [item.id, item.setup_notes])).toEqual([
      ["dealer-1", "Private: GM prefers calls after 4 pm."],
      ["dealer-2", ""],
    ]);
  });

  it("are refused, with the rest of the list, to a manager and a salesperson", () => {
    for (const role of ["dealer_admin", "salesperson"]) {
      const result = listDealers(role, [record]);
      expect(result.status, role).toBe(403);
      expect(JSON.stringify(result.payload)).not.toContain("GM prefers calls");
    }
  });
});

describe("migration 1752400000 adds dealers.setup_notes and can take it out again", () => {
  type Field = { id?: string; name: string; type?: string } & AnyRecord;

  const loadMigration = () => {
    let up: ((dao: unknown) => unknown) | undefined;
    let down: ((dao: unknown) => unknown) | undefined;
    runInNewContext(read(MIGRATION), {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      SchemaField: function SchemaField(definition: Field) {
        return { ...definition };
      },
    });
    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    return { up: up!, down: down! };
  };

  const buildDao = () => {
    const dealers = fakeCollection<Field>([
      { name: "name", type: "text" },
      { name: "creative_system_v2", type: "bool" },
    ]);
    const saveCollection = vi.fn();
    return {
      dealers,
      saveCollection,
      dao: {
        findCollectionByNameOrId: (name: string) => {
          if (name === "dealers") return dealers;
          throw new Error("missing collection " + name);
        },
        saveCollection,
      },
    };
  };

  it("adds an optional text field capped at the same 4,000 characters the hook enforces", () => {
    const { up } = loadMigration();
    const { dealers, dao, saveCollection } = buildDao();
    up(dao);
    const notes = dealers.schema.getFieldByName("setup_notes");
    expect(notes).toMatchObject({
      name: "setup_notes",
      type: "text",
      required: false,
      options: { max: helpers.DEALER_ADMIN_TEXT_FIELD_LIMITS.setup_notes },
    });
    expect(saveCollection).toHaveBeenCalledTimes(1);

    // A deploy retry must not add it twice.
    up(dao);
    expect(fieldsOf(dealers.schema).map((field) => field.name)).toEqual([
      "name",
      "creative_system_v2",
      "setup_notes",
    ]);
  });

  it("removes exactly that field on the way down, by id", () => {
    const { up, down } = loadMigration();
    const { dealers, dao, saveCollection } = buildDao();
    up(dao);
    saveCollection.mockClear();
    down(dao);
    expect(fieldsOf(dealers.schema).map((field) => field.name)).toEqual([
      "name",
      "creative_system_v2",
    ]);
    // Removing the field from the schema object changes nothing on disk until
    // the collection is saved.
    expect(saveCollection).toHaveBeenCalledTimes(1);
    expect(saveCollection).toHaveBeenCalledWith(dealers);
    // Running down again, with the field already gone, changes nothing.
    down(dao);
    expect(fieldsOf(dealers.schema)).toHaveLength(2);
  });

  it("uses the removal API that works on PocketBase 0.22, never a schema assignment", () => {
    const code = withoutComments(read(MIGRATION));
    expect(code).toMatch(/removeField\(\s*field\.id\s*\)/);
    expect(code).not.toMatch(/\.schema\s*=/);
    // The repository-wide guard in backendCompliancePolicy.test.ts reads every
    // .js file in pb_migrations; this file must be one of them.
    expect(readdirSync(resolve(process.cwd(), "pb_migrations"))).toContain(
      "1752400000_dealer_setup_notes.js",
    );
  });
});

describe("setup notes keep their text whatever PocketBase made of the form value", () => {
  // PocketBase 0.22 turns a multipart value that reads as a number or a
  // boolean into one before the hook sees it.
  it.each([
    [0, "0"],
    [false, "false"],
    [true, "true"],
    [2026, "2026"],
    [null, ""],
    ["Line one\r\nLine two", "Line one\nLine two"],
  ])("stores %j as %j", (raw, stored) => {
    expect(helpers.dealerMutationData({ setup_notes: raw }, false, false)).toEqual({
      setup_notes: stored,
    });
  });
});
