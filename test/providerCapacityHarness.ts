import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/** Execute the actual migration and SQL, rather than mocking the lease result. */
export function createCapacityHarness() {
  const database = new DatabaseSync(":memory:");
  const db = {
    newQuery(sql: string) {
      let values = {};
      return {
        bind(parameters: object) {
          values = parameters;
          return this;
        },
        execute() {
          const result = database
            .prepare(sql.replace(/\{:(\w+)\}/g, ":$1"))
            .run(values);
          return { rowsAffected: () => Number(result.changes) };
        },
      };
    },
  };
  const migration = readFileSync(
    "pb_migrations/1752700000_provider_capacity.js",
    "utf8",
  );
  new Function("migrate", migration)((up: (db: unknown) => void) => up(db));
  const module = {
    exports: {} as {
      acquire: (key: string, limit: number) => { ok: boolean; release?: () => void };
    },
  };
  new Function(
    "module",
    "$app",
    "$security",
    readFileSync("pb_hooks/providerCapacity.js", "utf8"),
  )(
    module,
    { dao: () => ({ db: () => db }) },
    { randomString: () => randomBytes(20).toString("hex") },
  );
  return { ...module.exports, database, close: () => database.close() };
}
