import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Collection = {
  schema: {
    getFieldByName(name: string): CodeField | null;
  };
};

type CodeField = {
  name: string;
  options: {
    min: number | null;
    max: number | null;
    pattern: string;
  };
};

type MigrationHandler = (dao: {
  findCollectionByNameOrId(name: string): Collection;
  saveCollection(collection: Collection): unknown;
}) => unknown;

describe("dealer code schema migration", () => {
  it("uses the PocketBase 0.22 Schema API for apply and rollback", () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750100000_update_dealer_code_schema.js"),
      "utf8",
    );

    let up: MigrationHandler | undefined;
    let down: MigrationHandler | undefined;
    runInNewContext(source, {
      migrate: (apply: MigrationHandler, rollback: MigrationHandler) => {
        up = apply;
        down = rollback;
      },
      // PocketBase injects Dao into the migration runtime. Returning the
      // supplied test double from a constructor mirrors `new Dao(db)`.
      Dao: function Dao(db: Parameters<MigrationHandler>[0]) {
        return db;
      },
    });

    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");

    const codeField: CodeField = {
      name: "code",
      options: { min: 4, max: 4, pattern: "^[0-9]{4}$" },
    };
    const getFieldByName = vi.fn((name: string) =>
      name === "code" ? codeField : null,
    );
    const dealers: Collection = { schema: { getFieldByName } };
    const saveCollection = vi.fn();
    const dao = {
      findCollectionByNameOrId: vi.fn(() => dealers),
      saveCollection,
    };

    up!(dao);
    expect(codeField.options).toEqual({
      min: 6,
      max: 6,
      pattern: "^[0-9]{6}$",
    });

    down!(dao);
    expect(codeField.options).toEqual({ min: null, max: 6, pattern: "" });
    expect(getFieldByName).toHaveBeenCalledTimes(2);
    expect(saveCollection).toHaveBeenNthCalledWith(1, dealers);
    expect(saveCollection).toHaveBeenNthCalledWith(2, dealers);
  });
});

describe("brand-consistent creative foundations migration", () => {
  type BrandField = {
    name: string;
    type: string;
    required?: boolean;
    options?: Record<string, unknown>;
  };

  class FakeSchema {
    fields: BrandField[];
    constructor(fields: BrandField[]) {
      this.fields = [...fields];
    }
    getFieldByName(name: string) {
      return this.fields.find((field) => field.name === name) ?? null;
    }
    addField(field: BrandField) {
      this.fields.push(field);
    }
    [Symbol.iterator]() {
      return this.fields[Symbol.iterator]();
    }
  }

  const loadMigration = () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1751500000_brand_consistent_creative_foundations.js",
      ),
      "utf8",
    );
    let up: ((dao: unknown) => unknown) | undefined;
    let down: ((dao: unknown) => unknown) | undefined;
    runInNewContext(source, {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      SchemaField: function SchemaField(definition: BrandField) {
        return { ...definition };
      },
    });
    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    return { up: up!, down: down! };
  };

  const dealerFieldNames = [
    "signature_look",
    "alternate_look",
    "default_tone",
    "playful_style",
    "motion_signature",
    "logo_placement",
    "brand_voice_do",
    "brand_voice_dont",
    "required_hashtags_locked",
    "category_destinations",
    "approval_policy",
    "feature_permissions",
    "image_quality_tier",
  ];
  const personFieldNames = [
    "manager_scope",
    "signature_line",
    "default_category",
    "playful_default",
  ];

  const buildDao = () => {
    const dealers = {
      schema: new FakeSchema([{ name: "name", type: "text" }]) as
        FakeSchema | BrandField[],
    };
    const people = {
      schema: new FakeSchema([{ name: "pin_hash", type: "text" }]) as
        FakeSchema | BrandField[],
    };
    const saveCollection = vi.fn();
    return {
      dealers,
      people,
      saveCollection,
      dao: {
        findCollectionByNameOrId: (name: string) => {
          if (name === "dealers") return dealers;
          if (name === "salespeople") return people;
          throw new Error("missing collection " + name);
        },
        saveCollection,
      },
    };
  };

  const fieldsOf = (schema: FakeSchema | BrandField[]) => Array.from(schema);

  it("adds every spec §6 field as optional, typed, and size-capped", () => {
    const { up } = loadMigration();
    const { dealers, people, dao, saveCollection } = buildDao();

    up(dao);

    const dealerFields = fieldsOf(dealers.schema);
    expect(dealerFields.map((field) => field.name)).toEqual([
      "name",
      ...dealerFieldNames,
    ]);
    expect(
      dealerFields.every((field) => field.name === "name" || field.required === false),
    ).toBe(true);
    const byName = Object.fromEntries(dealerFields.map((field) => [field.name, field]));
    for (const look of ["signature_look", "alternate_look"]) {
      expect(byName[look]).toMatchObject({
        type: "select",
        options: { maxSelect: 1, values: ["showroom", "hometown", "turbo"] },
      });
    }
    expect(byName.image_quality_tier).toMatchObject({
      type: "select",
      options: { maxSelect: 1, values: ["standard", "studio"] },
    });
    expect(byName.default_tone).toMatchObject({ type: "text", options: { max: 40 } });
    expect(byName.playful_style).toMatchObject({ type: "text", options: { max: 80 } });
    expect(byName.required_hashtags_locked).toMatchObject({ type: "bool" });
    // PB 0.22 rejects json fields without a positive maxSize.
    for (const jsonField of [
      "motion_signature",
      "logo_placement",
      "brand_voice_do",
      "brand_voice_dont",
      "category_destinations",
      "approval_policy",
      "feature_permissions",
    ]) {
      expect(byName[jsonField].type).toBe("json");
      expect(byName[jsonField].options?.maxSize).toBeGreaterThan(0);
    }

    const personFields = fieldsOf(people.schema);
    expect(personFields.map((field) => field.name)).toEqual([
      "pin_hash",
      ...personFieldNames,
    ]);
    const personByName = Object.fromEntries(
      personFields.map((field) => [field.name, field]),
    );
    expect(personByName.manager_scope).toMatchObject({ type: "bool", required: false });
    expect(personByName.playful_default).toMatchObject({
      type: "bool",
      required: false,
    });
    expect(personByName.signature_line).toMatchObject({
      type: "text",
      options: { max: 140 },
    });
    expect(personByName.default_category).toMatchObject({
      type: "text",
      options: { max: 40 },
    });
    expect(saveCollection).toHaveBeenCalledTimes(2);

    // Re-running the apply step is a no-op (deploy retries must not duplicate).
    up(dao);
    expect(fieldsOf(dealers.schema)).toHaveLength(1 + dealerFieldNames.length);
    expect(fieldsOf(people.schema)).toHaveLength(1 + personFieldNames.length);
  });

  it("keeps the json byte caps in lockstep with the hook validators", () => {
    const { up } = loadMigration();
    const { dealers, dao } = buildDao();
    up(dao);
    const helpersSource = readFileSync(
      resolve(process.cwd(), "pb_hooks/helpers.js"),
      "utf8",
    );
    const module = {
      exports: {} as { DEALER_JSON_FIELD_LIMITS: Record<string, number> },
    };
    new Function("module", "exports", helpersSource)(module, module.exports);

    const migrated = Object.fromEntries(
      fieldsOf(dealers.schema)
        .filter((field) => field.type === "json")
        .map((field) => [field.name, field.options?.maxSize]),
    );
    expect(migrated).toEqual(module.exports.DEALER_JSON_FIELD_LIMITS);
  });

  it("rolls back by removing exactly the fields it added", () => {
    const { up, down } = loadMigration();
    const { dealers, people, dao, saveCollection } = buildDao();
    up(dao);
    down(dao);

    expect(fieldsOf(dealers.schema).map((field) => field.name)).toEqual(["name"]);
    expect(fieldsOf(people.schema).map((field) => field.name)).toEqual(["pin_hash"]);
    expect(saveCollection).toHaveBeenCalledTimes(4);

    // A rollback against a database that never had the collections is inert.
    expect(() =>
      down({
        findCollectionByNameOrId: () => {
          throw new Error("missing");
        },
        saveCollection: vi.fn(),
      }),
    ).not.toThrow();
  });
});

describe("generation usage accounting migration", () => {
  type UsageField = {
    name: string;
    type: string;
    required?: boolean;
    options?: Record<string, unknown>;
  };

  class FakeSchema {
    fields: UsageField[];
    constructor(fields: UsageField[]) {
      this.fields = [...fields];
    }
    getFieldByName(name: string) {
      return this.fields.find((field) => field.name === name) ?? null;
    }
    addField(field: UsageField) {
      this.fields.push(field);
    }
    [Symbol.iterator]() {
      return this.fields[Symbol.iterator]();
    }
  }

  const usageFieldNames = [
    "prompt_tokens",
    "candidate_tokens",
    "thoughts_tokens",
    "cached_tokens",
    "finish_reason",
    "latency_ms",
    "purpose",
    "image_size",
    "video_seconds",
  ];

  const loadMigration = () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751600000_generation_usage.js"),
      "utf8",
    );
    let up: ((dao: unknown) => unknown) | undefined;
    let down: ((dao: unknown) => unknown) | undefined;
    runInNewContext(source, {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      SchemaField: function SchemaField(definition: UsageField) {
        return { ...definition };
      },
    });
    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    return { up: up!, down: down! };
  };

  const buildDao = () => {
    const events = {
      schema: new FakeSchema([
        { name: "dealer", type: "text" },
        { name: "task", type: "select" },
      ]) as FakeSchema | UsageField[],
    };
    const saveCollection = vi.fn();
    return {
      events,
      saveCollection,
      dao: {
        findCollectionByNameOrId: (name: string) => {
          if (name === "generation_events") return events;
          throw new Error("missing collection " + name);
        },
        saveCollection,
      },
    };
  };

  const fieldsOf = (schema: FakeSchema | UsageField[]) => Array.from(schema);

  it("adds optional counters and short tokens to generation_events, idempotently", () => {
    const { up } = loadMigration();
    const { events, dao, saveCollection } = buildDao();

    up(dao);

    const fields = fieldsOf(events.schema);
    expect(fields.map((field) => field.name)).toEqual([
      "dealer",
      "task",
      ...usageFieldNames,
    ]);
    const added = fields.filter((field) => usageFieldNames.includes(field.name));
    expect(added.every((field) => field.required === false)).toBe(true);
    const byName = Object.fromEntries(added.map((field) => [field.name, field]));
    for (const counter of [
      "prompt_tokens",
      "candidate_tokens",
      "thoughts_tokens",
      "cached_tokens",
      "latency_ms",
      "video_seconds",
    ]) {
      expect(byName[counter]).toMatchObject({
        type: "number",
        options: { min: 0, noDecimal: true },
      });
    }
    expect(byName.finish_reason).toMatchObject({ type: "text", options: { max: 40 } });
    expect(byName.purpose).toMatchObject({ type: "text", options: { max: 40 } });
    expect(byName.image_size).toMatchObject({ type: "text", options: { max: 8 } });
    expect(saveCollection).toHaveBeenCalledTimes(1);

    // Re-running the apply step is a no-op (deploy retries must not duplicate).
    up(dao);
    expect(fieldsOf(events.schema)).toHaveLength(2 + usageFieldNames.length);
  });

  it("rolls back by removing exactly the usage fields and is inert without the collection", () => {
    const { up, down } = loadMigration();
    const { events, dao, saveCollection } = buildDao();
    up(dao);
    down(dao);

    expect(fieldsOf(events.schema).map((field) => field.name)).toEqual([
      "dealer",
      "task",
    ]);
    expect(saveCollection).toHaveBeenCalledTimes(2);
    expect(() =>
      down({
        findCollectionByNameOrId: () => {
          throw new Error("missing");
        },
        saveCollection: vi.fn(),
      }),
    ).not.toThrow();
  });

  it("is covered by the backend prettier globs", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );
    expect(pkg.scripts["format:check:backend"]).toContain('"pb_migrations/175160*.js"');
    expect(pkg.scripts["format:backend"]).toContain('"pb_migrations/175160*.js"');
  });
});
