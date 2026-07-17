import { describe, expect, it } from "vitest";
import {
  CORE_PUBLISH_IDS,
  orderPublishTargets,
  PUBLISH_TARGETS,
} from "./publishTargets";

describe("publishTargets handoff strategy", () => {
  it("never sends Facebook through the Apple share-sheet path", () => {
    const fb = PUBLISH_TARGETS.find((t) => t.id === "facebook_feed");
    expect(fb?.handoff).toBe("clipboard-open");
    const market = PUBLISH_TARGETS.find((t) => t.id === "marketplace");
    expect(market?.handoff).toBe("clipboard-open");
  });

  it("uses share-file for Instagram and TikTok so media can hit the sheet", () => {
    expect(
      PUBLISH_TARGETS.find((t) => t.id === "instagram_feed")?.handoff,
    ).toBe("share-file");
    expect(PUBLISH_TARGETS.find((t) => t.id === "tiktok")?.handoff).toBe(
      "share-file",
    );
  });

  it("always lists Facebook in the first core row", () => {
    const ordered = orderPublishTargets(["tiktok"]);
    const ids = ordered.map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual([...CORE_PUBLISH_IDS]);
    expect(ids).toContain("facebook_feed");
  });
});
