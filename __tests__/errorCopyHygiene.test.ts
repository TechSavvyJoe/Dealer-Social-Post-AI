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
   * Walk the tree rather than list it. The first version of this guard
   * carried a hardcoded list of seven files, which meant it could only ever
   * confirm work already done. Widening it to walk components/ closed that,
   * but the pattern itself was still bound to two call names
   * (`toast.error`/`setError`), so `setMediaPreparationError`,
   * `setSubmitError`, `setReviewError` and a bare `const detail = ...`
   * assignment in ShareDialog all sailed past it while rendering raw
   * `err.message` to the user. The pattern below matches the ternary itself —
   * `<id> instanceof Error ? <id>.message : ...`, optionally guarded by
   * `<id> instanceof Error && <id>.message` — wherever it appears, so it does
   * not matter what function or object literal wraps it. hooks/ and App.tsx
   * are walked too: a hook that composes a user-facing string is just as
   * capable of leaking transport jargon as a component.
   */
  const scannedFiles = (): string[] => {
    const componentsDir = resolve(process.cwd(), "components");
    const hooksDir = resolve(process.cwd(), "hooks");
    return [
      ...readdirSync(componentsDir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/${f}`),
      ...readdirSync(resolve(componentsDir, "ui"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/ui/${f}`),
      ...readdirSync(hooksDir)
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .map((f) => `hooks/${f}`),
      "App.tsx",
    ];
  };

  // components/SystemHealthPanel.tsx is deliberately exempt: it is the
  // super-admin health diagnostic, where an operator debugging an incident
  // needs the exact transport error ("Network disconnected"), not curated copy.
  // __tests__/SystemHealthPanel.test.tsx pins that behavior.
  const EXEMPT = new Set(["components/SystemHealthPanel.tsx"]);

  /**
   * Is this ternary's result headed only to telemetry (logError/logEvent/
   * console.*), never to the user? Two shapes cover every real site in this
   * tree:
   *   - inline inside the call: `logError("kind", { message: x ? x.msg : y })`
   *   - assigned to a local first: `const message = x ? x.msg : y;` followed,
   *     with nothing else in between, by `logError(...message...)`.
   * Walking backward from the match to find its enclosing call (by paren
   * depth) generalises the first shape to any log-shaped call name, not a
   * hardcoded list. The second shape is checked by scanning forward from the
   * end of that statement for the variable's very next use.
   */
  /**
   * Comments blanked to spaces (newlines and length preserved, so every
   * index and line number computed below stays valid against the original
   * file). Without this, a comment that happens to mention the same
   * identifier as the code it is explaining — exactly the case in
   * CameraCapture.tsx, which explains the fix in a comment reading "...the
   * raw decoder message..." right above the real usage — is matched as if it
   * were code, and the real usage past it is never reached.
   */
  const blankComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/./g, " "));

  /**
   * Name of the call whose argument list directly encloses `index`, found by
   * scanning backward and balancing `()`/`{}`/`[]` as one stack (an object or
   * array literal opening at depth 0 is part of the same argument list, so it
   * is passed over rather than treated as a boundary; a `${...}` template
   * expression's braces balance the same way and so fall out correctly too).
   * Returns "" if nothing encloses the position before a `;` at depth 0.
   */
  const enclosingCallName = (source: string, index: number): string => {
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
      const ch = source[i];
      if (ch === ")" || ch === "}" || ch === "]") {
        depth++;
      } else if (ch === "(") {
        if (depth === 0) {
          const before = source.slice(Math.max(0, i - 40), i);
          return before.match(/([\w.]+)\s*$/)?.[1] || "";
        }
        depth--;
      } else if (ch === "{" || ch === "[") {
        if (depth > 0) depth--;
      } else if (ch === ";" && depth === 0) {
        return "";
      }
    }
    return "";
  };

  // A sink is "not a leak" if it never puts the raw string in front of the
  // user: telemetry (console.*/log<Something>) records it, and a RegExp
  // .test() call only extracts a boolean.
  const isSafeSink = (name: string): boolean =>
    /^(?:console\.\w+|log[A-Z]\w*|\w+\.test)$/.test(name);

  /**
   * Is this ternary's result headed only to a safe sink? Two shapes cover
   * every real site in this tree:
   *   - inline inside the call: `logError("kind", { message: x ? x.msg : y })`
   *   - assigned to a local first: `const message = x ? x.msg : y;` whose very
   *     next use, anywhere later in the file, is itself inside a safe sink
   *     (`logError(...message...)`, or `/re/.test(message)`).
   * A local later handed to `setError`/a template rendered in JSX/`toast.*`
   * is correctly NOT exempted, because that next use encloses in a call that
   * is not in the safe list.
   */
  /** Is this one occurrence of `name`, at `index`, a safe (non-display) use? */
  const isSafeUse = (source: string, index: number, name: string): boolean => {
    // The base of a `.toLowerCase()/.includes()/.test()/.match()` chain that
    // decides which curated copy to show, not the copy itself
    // (CameraCapture's HEIC check, VinScanner's "does this look like a
    // permission error" check). Checked before the enclosing-call test
    // because the chain's outer call (often `setError(...)`) is not itself a
    // safe sink even though nothing raw reaches the user through THIS use.
    const afterName = source.slice(index + name.length);
    if (/^\s*\.(?:toLowerCase|toUpperCase|includes|test|match)\(/.test(afterName)) {
      return true;
    }
    return isSafeSink(enclosingCallName(source, index));
  };

  /**
   * How far forward from `start` the enclosing block extends, so a variable
   * search does not run into an unrelated later local of the same name
   * (both `message` and `raw` are common enough that this repo reuses them
   * in other functions in the very same file). Tracks all three bracket
   * kinds as one depth counter from `start`; the first unmatched closing
   * bracket is where the current block ends.
   */
  const enclosingBlockEnd = (source: string, start: number): number => {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        if (depth === 0) return i;
        depth--;
      }
    }
    return source.length;
  };

  const isTelemetryOnly = (source: string, matchIndex: number): boolean => {
    if (isSafeSink(enclosingCallName(source, matchIndex))) return true;

    const assign = source.slice(0, matchIndex).match(/\bconst\s+(\w+)\s*=\s*$/);
    if (!assign) return false;
    const name = assign[1];
    const stmtEnd = source.indexOf(";", matchIndex);
    if (stmtEnd === -1) return false;
    const rest = source.slice(stmtEnd + 1, enclosingBlockEnd(source, stmtEnd + 1));
    const usePattern = new RegExp(`\\b${name}\\b`, "g");
    const uses = [...rest.matchAll(usePattern)];
    // EVERY later use in the same block must be safe, not just the first.
    // The bug this closes: CameraCapture used to read
    // `/HEI[CF]/i.test(message) ? message : ...` — the first occurrence
    // (inside `.test()`) is safe, but stopping there missed the second
    // occurrence, the ternary's own display value, which was the actual leak.
    if (uses.length === 0) return false;
    return uses.every((use) => isSafeUse(source, stmtEnd + 1 + use.index!, name));
  };

  it("never puts a raw Error message straight into user-facing copy", () => {
    // Matches the ternary shape itself, not a specific sink. `\1` backrefs the
    // captured identifier so it works for `err`, `error`, `cause`, or any other
    // name; the optional `(?:\s*&&\s*\1(?:\.message)?)?` covers the
    // `err instanceof Error && err.message ? err.message : ...` variant found
    // in ShareDialog.
    const rawErrorToUser =
      /(\w+)\s+instanceof Error(?:\s*&&\s*\1(?:\.message)?)?\s*\?\s*\1\.message\s*:/g;
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      if (EXEMPT.has(file)) continue;
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      const source = blankComments(raw);
      for (const match of source.matchAll(rawErrorToUser)) {
        if (isTelemetryOnly(source, match.index!)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}`);
        break; // one offender per file is enough to fail the build
      }
    }
    expect(
      offenders,
      `raw Error message composed for the user; route it through toUiMessage:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("does not exempt a ternary that IS shown to the user, only ones fed to telemetry", () => {
    // Guards the exemption logic itself: prove it can still fail. A ternary
    // assigned to a local and then handed to setError (not a log call) must
    // still be reported, even though it takes the "assigned to a local first"
    // shape that the telemetry check also uses.
    const source = `
      function handle(err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    `;
    const rawErrorToUser =
      /(\w+)\s+instanceof Error(?:\s*&&\s*\1(?:\.message)?)?\s*\?\s*\1\.message\s*:/g;
    const match = source.match(rawErrorToUser);
    expect(match).not.toBeNull();
    expect(isTelemetryOnly(source, source.search(rawErrorToUser))).toBe(false);
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
