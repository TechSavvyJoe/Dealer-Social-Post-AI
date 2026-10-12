import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

/** Evaluate a hooks module with the same explicit runtime as a route fixture. */
export const loadPocketBaseModule = <T = Record<string, unknown>>(
  name: string,
  globals: Record<string, unknown>,
): T => {
  const module = { exports: {} };
  runInNewContext(readFileSync(resolve(process.cwd(), "pb_hooks", name), "utf8"), {
    ...globals,
    module,
    exports: module.exports,
  });
  return module.exports as T;
};
