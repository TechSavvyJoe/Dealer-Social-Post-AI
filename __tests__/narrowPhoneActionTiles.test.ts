import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The result screen's secondary actions (Video, Fun mode, Schedule) sit in a
 * 3-column grid on phones, where `truncate` rendered them as "Vi…", "Fu…" and
 * "Sc…" — observed in a 390px render.
 *
 * The cutoff is 400px and that is verified, not assumed. A synthetic model of a
 * full-width 3-column row says the labels fit from 375px up, so a review
 * flagged 400px as needlessly hiding them on iPhone SE and iPhone 12-15.
 * Lowering it to 375px and re-rendering at 390px brought the truncation back:
 * this grid shares its row with the "More" control, so each column is roughly
 * 87px, not the 115px a full-width model predicts. Do not raise the cutoff on
 * the strength of a calculation; render it.
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
