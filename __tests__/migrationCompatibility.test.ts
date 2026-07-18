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
