import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toUiMessage } from "../utils/errorMessages";

/**
 * Raw error text reaches a salesperson as jargon: readApiError falls back to
 * response.statusText ("Internal Server Error", "Bad Request") and a dropped
 * connection throws "Failed to fetch" or, on iOS, "Load failed". toUiMessage
 * turns those into product copy while preserving server-assigned messages.
 */
describe("user-facing error copy", () => {
  /**
   * Walk the tree rather than list it. The first version of this guard carried
   * a hardcoded list of the seven files the fix had touched, which meant it
   * could only ever confirm work already done — two components this same
   * branch modified were showing raw error text and the guard could not see
   * them because they were not on the list.
   */
  const componentFiles = (): string[] => {
    const dir = resolve(process.cwd(), "components");
    return [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/${f}`),
      ...readdirSync(resolve(dir, "ui"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/ui/${f}`),
    ];
  };

  // components/SystemHealthPanel.tsx is deliberately exempt: it is the
  // super-admin health diagnostic, where an operator debugging an incident
  // needs the exact transport error ("Network disconnected"), not curated copy.
  // __tests__/SystemHealthPanel.test.tsx pins that behavior.
  const EXEMPT = new Set(["components/SystemHealthPanel.tsx"]);

  it("never puts a raw Error message straight into a toast or error banner", () => {
    // The identifier is captured and back-referenced rather than spelled `err`.
    // Baking in one variable name meant three sites that name the same thing
    // `cause` sailed past a guard written to catch exactly them.
    const rawErrorToUser =
      /(?:toast\.error|setError)\(\s*(\w+)\s+instanceof Error\s*\?\s*\1\.message/;
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      if (EXEMPT.has(file)) continue;
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const match = source.match(rawErrorToUser);
      if (!match) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${file}:${line}`);
    }
    expect(
      offenders,
      `raw Error message shown to the user; route it through toUiMessage:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("translates transport noise into something a salesperson can act on", () => {
    for (const raw of ["Failed to fetch", "Load failed", "Internal Server Error"]) {
      const shown = toUiMessage(new Error(raw), "Could not save.");
      expect(shown).not.toContain(raw);
      expect(shown.length).toBeGreaterThan(0);
    }
  });

  it("keeps a server-assigned message, which is already product copy", () => {
    const apiError = Object.assign(new Error("That access code is already in use."), {
      name: "ApiError",
      code: "DUPLICATE_CODE",
    });
    expect(toUiMessage(apiError, "Could not save.")).toBe(
      "That access code is already in use.",
    );
  });
});
