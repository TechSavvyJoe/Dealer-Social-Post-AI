import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_PUBLISH_IDS,
  orderPublishTargets,
  PUBLISH_TARGETS,
  sharePrepared,
  type PreparedPublishShare,
} from "./publishTargets";

const originalShareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
const originalCanShareDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "canShare",
);
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

afterEach(() => {
  for (const [key, descriptor] of [
    ["share", originalShareDescriptor],
    ["canShare", originalCanShareDescriptor],
    ["clipboard", originalClipboardDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
  vi.restoreAllMocks();
});

describe("publishTargets handoff strategy", () => {
  it("uses photos-then-app for Facebook so web re-login is not the happy path", () => {
    const fb = PUBLISH_TARGETS.find((t) => t.id === "facebook_feed");
    expect(fb?.handoff).toBe("photos-then-app");
    const market = PUBLISH_TARGETS.find((t) => t.id === "marketplace");
    expect(market?.handoff).toBe("photos-then-app");
  });

  it("uses share-file for Instagram and TikTok so media can hit the sheet", () => {
    expect(PUBLISH_TARGETS.find((t) => t.id === "instagram_feed")?.handoff).toBe(
      "share-file",
    );
    expect(PUBLISH_TARGETS.find((t) => t.id === "tiktok")?.handoff).toBe("share-file");
  });

  it("always lists Facebook in the first core row", () => {
    const ordered = orderPublishTargets(["tiktok"]);
    const ids = ordered.map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual([...CORE_PUBLISH_IDS]);
    expect(ids).toContain("facebook_feed");
  });

  it("opens the native share sheet synchronously from the Share now action", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const target = PUBLISH_TARGETS.find(
      (candidate) => candidate.id === "instagram_feed",
    );
    expect(target).toBeDefined();
    const prepared: PreparedPublishShare = {
      target: target!,
      content: { text: "Delivery day" },
      caption: "Delivery day",
      file: new File(["image"], "delivery.jpg", { type: "image/jpeg" }),
      webUrl: null,
    };

    const resultPromise = sharePrepared(prepared);

    // This assertion intentionally runs before awaiting. Safari requires the
    // share call to happen during the fresh click's transient activation.
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0]).toMatchObject({
      files: [prepared.file],
    });

    await expect(resultPromise).resolves.toMatchObject({
      kind: "shared",
      via: "web-share",
    });
    expect(writeText).toHaveBeenCalledWith("Delivery day");
  });
});
