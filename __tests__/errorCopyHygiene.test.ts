import { readFileSync } from "node:fs";
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
  const files = [
    "components/AdminDashboard.tsx",
    "components/ApprovalQueue.tsx",
    "components/DealerAdminDashboard.tsx",
    "components/ImpersonationBanner.tsx",
    "components/PostHistory.tsx",
    "components/PostResult.tsx",
    "components/ShareDialog.tsx",
  ];

  // components/SystemHealthPanel.tsx is deliberately absent: it is the
  // super-admin health diagnostic, where an operator debugging an incident
  // needs the exact transport error ("Network disconnected"), not curated copy.
  // __tests__/SystemHealthPanel.test.tsx pins that behavior.
  it("never puts a raw Error message straight into a toast or error banner", () => {
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} still shows a raw err.message to the user`).not.toMatch(
        // Catches both the single-line form and the wrapped ternary.
        /(?:toast\.error|setError)\(\s*err instanceof Error\s*\?\s*err\.message/,
      );
    }
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
