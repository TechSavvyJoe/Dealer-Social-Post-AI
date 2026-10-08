import { describe, expect, it } from "vitest";
import { supportDetails } from "./supportDetails";

describe("support receipts", () => {
  it("retains release and bundle locations without leaking messages or capabilities", () => {
    const error = new Error("Customer Jane, credential=private-value");
    error.stack =
      "Error: private-value\n at render (https://example.com/assets/App-abc.js:2:90)\n at https://example.com/?token=private-value";
    const receipt = supportDetails(error, "c684a6d", "#/spin/" + "a".repeat(48));
    expect(receipt).toContain("c684a6d");
    expect(receipt).toContain("/assets/App-abc.js:2:90");
    expect(receipt).toContain("customer vehicle view");
    expect(receipt).not.toMatch(/Jane|private-value|a{48}|https:/);
  });
});
