import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The result screen's secondary actions (Video, Fun mode, Schedule) sit in a
 * 3-column grid on phones. Below ~400px each column is too narrow for a
 * two-word label, and `truncate` rendered them as "Vi…", "Fu…" and "Sc…" —
 * observed in a 390px headless render. The e2e matrix goes down to a 280px
 * fold width, so this is not an edge case.
 */
describe("result-screen action tiles on narrow phones", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/PostResult.tsx"),
    "utf8",
  );

  it("hides the label instead of truncating it to two characters", () => {
    expect(source).toContain(
      '<span className="truncate max-[399px]:hidden">{label}</span>',
    );
  });

  it("keeps an accessible name when the visible label is hidden", () => {
    // Without this fallback an icon-only tile would announce as an unnamed
    // button to a screen reader.
    expect(source).toContain("aria-label={ariaLabel || label}");
  });

  it("centers the icon once the label is gone", () => {
    expect(source).toContain('"max-[399px]:justify-center"');
  });
});
