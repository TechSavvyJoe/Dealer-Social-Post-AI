import { afterEach, describe, expect, it } from "vitest";
import { FLAGS } from "./modelConfig";
import {
  editImagePrompt,
  generateFunPrompt,
  generateImagePrompt,
} from "./promptConfig";
import {
  logoCornerCheck,
  logoPlacementPriority,
  logoPlacementWording,
  readObservedLogoCorner,
  storeLogoPlacement,
} from "./logoPlacement";
import { StyleOption, type LogoCorner, type LogoPlacement } from "../types";

const DEALER = "Bob Maxey Ford of Howell";
const LOGO = "data:image/png;base64,bG9nbw==";

/**
 * Every image prompt builder, called the way generation calls it. `logo`
 * false is the text-watermark fallback (no logo uploaded).
 */
const imagePrompts = (logo: boolean, placement?: LogoPlacement | null) => ({
  generate: generateImagePrompt(
    StyleOption.Modern,
    DEALER,
    logo,
    undefined,
    undefined,
    placement,
  ),
  fun: generateFunPrompt(
    DEALER,
    logo ? LOGO : undefined,
    "pixar",
    undefined,
    placement,
  ),
  edit: editImagePrompt(
    "Make the sky a deeper blue",
    DEALER,
    logo ? LOGO : undefined,
    placement,
  ),
});

describe("image prompts for a store that never chose a logo corner", () => {
  const originalFlag = FLAGS.useV2Prompts;
  afterEach(() => {
    FLAGS.useV2Prompts = originalFlag;
  });

  // The snapshots were recorded from the prompts as they were before logo
  // placement reached generation, so a store with no corner gets exactly the
  // prompt it always got.
  for (const v2 of [true, false]) {
    for (const logo of [true, false]) {
      it(`keeps the ${v2 ? "V2" : "classic"} prompts byte-identical ${
        logo ? "with a logo" : "for the text watermark"
      }`, () => {
        FLAGS.useV2Prompts = v2;
        const recorded = imagePrompts(logo);
        expect(recorded).toMatchSnapshot();
        expect(imagePrompts(logo, null)).toEqual(recorded);
        expect(imagePrompts(logo, undefined)).toEqual(recorded);
      });
    }
  }
});

const CORNERS: Array<[LogoCorner, string]> = [
  ["top_left", "top-left"],
  ["top_right", "top-right"],
  ["bottom_left", "bottom-left"],
  ["bottom_right", "bottom-right"],
];

describe("logoPlacementWording", () => {
  it.each(CORNERS)(
    "words the %s corner and the size as a share of the width",
    (corner, words) => {
      expect(logoPlacementWording({ corner, scale: 0.18 }, "in a lower corner")).toBe(
        `in the ${words} corner, about 18% of the image width, inside a safe zone away from people`,
      );
    },
  );

  it("rounds the size and keeps it inside the settings' 4% to 50% bounds", () => {
    const at = (scale: unknown) =>
      logoPlacementWording({ corner: "top_left", scale } as LogoPlacement, "legacy");
    expect(at(0.234)).toContain("about 23% of the image width");
    expect(at(0.01)).toContain("about 4% of the image width");
    expect(at(0.9)).toContain("about 50% of the image width");
    expect(at("wide")).toContain("about 18% of the image width");
    expect(at(undefined)).toContain("about 18% of the image width");
  });

  it("returns the prompt's own wording, byte for byte, when no valid corner is set", () => {
    const legacy =
      "as a small, tasteful watermark in a lower corner of the final image";
    for (const placement of [
      null,
      undefined,
      { corner: "middle", scale: 0.2 },
      { scale: 0.2 },
    ] as unknown as Array<LogoPlacement | null | undefined>) {
      expect(logoPlacementWording(placement, legacy)).toBe(legacy);
      expect(logoPlacementPriority(placement)).toBe("");
      expect(storeLogoPlacement(placement)).toBeNull();
    }
  });

  it("puts the store's corner and size ahead of any other logo wording", () => {
    expect(logoPlacementPriority({ corner: "bottom_left", scale: 0.3 })).toBe(
      " This corner and size override any other logo position or size.",
    );
  });
});

describe("the image review's logo corner", () => {
  it("reads a corner however the reviewer spells it, and anything else as unknown", () => {
    expect(readObservedLogoCorner("bottom_right")).toBe("bottom_right");
    expect(readObservedLogoCorner(" Top-Left ")).toBe("top_left");
    expect(readObservedLogoCorner("lower right")).toBe("bottom_right");
    expect(readObservedLogoCorner("upper_left")).toBe("top_left");
    expect(readObservedLogoCorner("not_in_corner")).toBe("not_in_corner");
    for (const value of [
      "center",
      "",
      "bottom",
      3,
      null,
      undefined,
      { corner: "top_left" },
    ]) {
      expect(readObservedLogoCorner(value), JSON.stringify(value)).toBeUndefined();
    }
  });

  it("records a match, a miss, or an unknown against the store's corner", () => {
    const placement: LogoPlacement = { corner: "top_right", scale: 0.2 };
    expect(logoCornerCheck(placement, "top_right")).toEqual({
      requested: "top_right",
      observed: "top_right",
      matched: true,
    });
    expect(logoCornerCheck(placement, "bottom_left")).toEqual({
      requested: "top_right",
      observed: "bottom_left",
      matched: false,
    });
    expect(logoCornerCheck(placement, "not_in_corner")).toEqual({
      requested: "top_right",
      observed: "not_in_corner",
      matched: false,
    });
    expect(logoCornerCheck(placement, undefined)).toEqual({ requested: "top_right" });
    expect(logoCornerCheck(placement, "somewhere")).toEqual({ requested: "top_right" });
    expect(logoCornerCheck(null, "top_right")).toBeUndefined();
  });
});

/**
 * The most a store corner may add to one image prompt. The 3D Depth Pop
 * prompt plus its retry addenda can come within about 100 characters of
 * requestLimits.maxPromptChars (20,000 per text part) before any corner.
 */
const MAX_ADDED_CHARS = 160;

describe("image prompts for a store that chose a logo corner", () => {
  const originalFlag = FLAGS.useV2Prompts;
  afterEach(() => {
    FLAGS.useV2Prompts = originalFlag;
  });

  for (const v2 of [true, false]) {
    it.each(CORNERS)(
      `asks every ${v2 ? "V2" : "classic"} logo prompt for the %s corner at the store's size`,
      (corner, words) => {
        FLAGS.useV2Prompts = v2;
        const prompts = imagePrompts(true, { corner, scale: 0.27 });
        for (const [builder, prompt] of Object.entries(prompts)) {
          expect(prompt, builder).toContain(
            `in the ${words} corner, about 27% of the image width, inside a safe zone away from people`,
          );
          expect(prompt, builder).toContain(
            "This corner and size override any other logo position or size.",
          );
          // No leftover "lower corner" request for the supplied logo.
          expect(prompt, builder).not.toMatch(/logo[^.\n]*lower[ -]corner/i);
        }
      },
    );

    it(`adds at most ${MAX_ADDED_CHARS} characters to each ${v2 ? "V2" : "classic"} logo prompt`, () => {
      // The 3D Depth Pop retry prompts already sit close to the proxy's
      // per-part limit, so the corner's wording must stay short.
      FLAGS.useV2Prompts = v2;
      const before = imagePrompts(true);
      const after = imagePrompts(true, { corner: "bottom_right", scale: 0.5 });
      for (const builder of Object.keys(before) as Array<keyof typeof before>) {
        expect(after[builder], builder).not.toBe(before[builder]);
        expect(
          after[builder].length - before[builder].length,
          builder,
        ).toBeLessThanOrEqual(MAX_ADDED_CHARS);
      }
    });

    it(`keeps the ${v2 ? "V2" : "classic"} text watermark wording when no logo is uploaded`, () => {
      FLAGS.useV2Prompts = v2;
      expect(imagePrompts(false, { corner: "top_left", scale: 0.3 })).toEqual(
        imagePrompts(false),
      );
    });
  }
});
