import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_PUBLISH_IDS,
  fitPublishCaptionToBudget,
  orderPublishTargets,
  PUBLISH_TARGETS,
  preparePublishShare,
  sharePrepared,
  copyTextToClipboard,
  openPreparedTarget,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publishTargets handoff strategy", () => {
  it("distinguishes a pending OS handoff from a completed share", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => new Promise<void>(() => {}),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    const pending = sharePrepared({
      target: PUBLISH_TARGETS[0],
      content: { text: "Ready" },
      caption: "Ready",
      file: new File(["image"], "post.jpg", { type: "image/jpeg" }),
      webUrl: null,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toMatchObject({
      kind: "started",
      captionCopied: true,
    });
  });

  it("starts copying before share consumes activation without waiting for the clipboard", async () => {
    let activated = true;
    const calls: string[] = [];
    let finishCopy!: () => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          expect(activated).toBe(true);
          calls.push("copy");
          return new Promise<void>((resolve) => {
            finishCopy = resolve;
          });
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => {
        activated = false;
        calls.push("share");
        return Promise.resolve();
      },
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    const result = sharePrepared({
      target: PUBLISH_TARGETS[0],
      content: { text: "Ready" },
      caption: "Ready",
      file: new File(["image"], "post.jpg", { type: "image/jpeg" }),
      webUrl: null,
    });
    expect(calls).toEqual(["copy", "share"]);
    finishCopy();
    await expect(result).resolves.toMatchObject({
      kind: "shared",
      captionCopied: true,
    });
  });

  it("removes its fallback textarea and restores focus when copy throws", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        throw new Error("Copy blocked");
      },
    });
    try {
      await expect(copyTextToClipboard("Private caption")).resolves.toBe(false);
      expect(document.querySelector("textarea")).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it.each(["gbp", "linkedin", "x_twitter"])(
    "opens %s on phones when there is no app scheme",
    (id) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const target = PUBLISH_TARGETS.find((t) => t.id === id)!;
      const content = { text: "Ready" };
      const webUrl = target.webIntentUrl!(content)!;
      expect(
        openPreparedTarget({ target, content, caption: "Ready", file: null, webUrl }),
      ).toBe("web");
      expect(open).toHaveBeenCalledWith(webUrl, "_blank", "noopener,noreferrer");
    },
  );

  it("preserves a dealership mention when a long caption is fitted", () => {
    const fitted = fitPublishCaptionToBudget(
      {
        text: `${"A polished dealership delivery. ".repeat(30)}\n\n@BobMaxeyFord`,
      },
      280,
    );

    expect(fitted).toHaveLength(280);
    expect(fitted).toMatch(/\n\n@BobMaxeyFord$/);
  });

  it("preserves both dealership attribution and compliance disclosures", () => {
    const fitted = fitPublishCaptionToBudget(
      {
        text: `${"Great financing options. ".repeat(30)}\n\n@BobMaxeyFord`,
        disclosures: "Offer subject to approved credit.",
      },
      280,
    );

    expect(fitted.length).toBeLessThanOrEqual(280);
    expect(fitted).toContain("\n\n@BobMaxeyFord\n\n— Disclosures —\n");
    expect(fitted).toMatch(/Offer subject to approved credit\.$/);
  });

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
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty("text");
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty("title");

    await expect(resultPromise).resolves.toMatchObject({
      kind: "shared",
      via: "web-share",
    });
    expect(writeText).toHaveBeenCalledWith("Delivery day");
  });

  it.each([
    ["reached", () => Promise.resolve(), true],
    ["did not reach", () => Promise.reject(new Error("NotAllowedError")), false],
  ])(
    "reports whether the caption %s the clipboard alongside the share",
    async (_label, writeTextResult, captionCopied) => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: vi.fn(() => Promise.resolve()),
      });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn(writeTextResult) },
      });
      // The legacy textarea path is the clipboard's last resort; fail it too.
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: vi.fn(() => false),
      });
      const target = PUBLISH_TARGETS.find(
        (candidate) => candidate.id === "facebook_feed",
      );

      try {
        const result = await sharePrepared({
          target: target!,
          content: { text: "Delivery day" },
          caption: "Delivery day",
          file: new File(["image"], "delivery.jpg", { type: "image/jpeg" }),
          webUrl: null,
        });

        expect(result).toMatchObject({
          kind: "shared",
          via: "web-share",
          captionCopied,
        });
      } finally {
        Reflect.deleteProperty(document, "execCommand");
      }
    },
  );

  it("keeps a prepared video available for Save when mobile canShare throws", async () => {
    const share = vi.fn();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => {
        throw new TypeError("unsupported video");
      },
    });
    const target = PUBLISH_TARGETS.find(
      (candidate) => candidate.id === "instagram_feed",
    );
    const prepared: PreparedPublishShare = {
      target: target!,
      content: { text: "Delivery day", videoUrl: "blob:video" },
      caption: "Delivery day",
      file: new File(["video"], "delivery.mp4", { type: "video/mp4" }),
      webUrl: null,
    };

    await expect(sharePrepared(prepared)).resolves.toMatchObject({
      kind: "fallback",
      via: "download-copy",
    });
    expect(share).not.toHaveBeenCalled();
    expect(prepared.file).toBeInstanceOf(File);
  });

  it("shares a selected video file-only when WebKit rejects file plus text", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => Boolean(data.files?.length) && !data.text,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
    const target = PUBLISH_TARGETS.find((candidate) => candidate.id === "native_share");
    const file = new File(["video"], "delivery.mp4", { type: "video/mp4" });
    const prepared: PreparedPublishShare = {
      target: target!,
      content: { text: "Delivery day", videoUrl: "blob:video" },
      caption: "Delivery day",
      file,
      webUrl: null,
    };

    await expect(sharePrepared(prepared)).resolves.toMatchObject({
      kind: "shared",
      via: "web-share",
    });
    expect(share).toHaveBeenCalledWith({ files: [file] });
  });

  it("uses a media-only payload on iPhone even when canShare overclaims file plus text", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    const share = vi.fn((_data: ShareData) => Promise.resolve());
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
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
    const target = PUBLISH_TARGETS.find((candidate) => candidate.id === "native_share");
    const file = new File(["video"], "delivery.mp4", { type: "video/mp4" });

    await sharePrepared({
      target: target!,
      content: { text: "Delivery day", videoUrl: "blob:video" },
      caption: "Delivery day",
      file,
      webUrl: null,
    });

    expect(share).toHaveBeenCalledWith({ files: [file] });
  });

  it("does not report a WebKit undefined share result as success", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    const target = PUBLISH_TARGETS.find(
      (candidate) => candidate.id === "instagram_feed",
    );
    const prepared: PreparedPublishShare = {
      target: target!,
      content: { text: "Delivery day", videoUrl: "blob:video" },
      caption: "Delivery day",
      file: new File(["video"], "delivery.mp4", { type: "video/mp4" }),
      webUrl: null,
    };

    await expect(sharePrepared(prepared)).resolves.toMatchObject({
      kind: "fallback",
      via: "download-copy",
    });
  });

  it("keeps Google Business video-enabled instead of silently switching to a still", () => {
    const target = PUBLISH_TARGETS.find((candidate) => candidate.id === "gbp");
    expect(target).toMatchObject({
      supportsVideo: true,
      handoff: "share-or-intent",
    });
  });

  it("blocks sharing when selected video media is not prepared", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    const target = PUBLISH_TARGETS.find(
      (candidate) => candidate.id === "instagram_feed",
    );

    await expect(
      sharePrepared({
        target: target!,
        content: { text: "Delivery day", videoUrl: "blob:missing" },
        caption: "Delivery day",
        file: null,
        webUrl: null,
      }),
    ).resolves.toMatchObject({
      kind: "error",
      message: expect.stringMatching(/still image won.t be sent in its place/i),
    });
  });

  it.each([
    {
      label: "non-success",
      response: { ok: false, status: 401 },
      error: "Could not read media (401)",
    },
    {
      label: "JSON",
      response: {
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([JSON.stringify({ error: "unauthorized" })], {
            type: "application/json",
          }),
      },
      error: "playable MP4 media",
    },
  ])(
    "refuses to prepare a broken video from a $label response",
    async ({ response, error }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );

      await expect(
        preparePublishShare("instagram_feed", {
          text: "Delivery day",
          videoUrl: "/api/video/download",
          imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
        }),
      ).rejects.toThrow(error);
    },
  );
});

describe("team-member disclosure survives destination budgets", () => {
  const DISCLOSURE = "Posted by a Bob Maxey Ford team member.";

  it("keeps the disclosure at the top when a long caption is fitted", () => {
    const fitted = fitPublishCaptionToBudget(
      {
        text: `${DISCLOSURE}\n\n${"A polished dealership delivery. ".repeat(30)}`,
        requiredPrefix: DISCLOSURE,
      },
      280,
    );

    expect(fitted.startsWith(DISCLOSURE)).toBe(true);
    expect(fitted.length).toBeLessThanOrEqual(280);
  });

  it("protects the disclosure, the mention and the compliance footer together", () => {
    const fitted = fitPublishCaptionToBudget(
      {
        text: `${DISCLOSURE}\n\n${"Drive home today. ".repeat(40)}\n\n@BobMaxeyFord`,
        disclosures: "Offer requires approved credit. See dealer for details.",
        requiredPrefix: DISCLOSURE,
      },
      560,
    );

    expect(fitted.startsWith(DISCLOSURE)).toBe(true);
    expect(fitted).toContain("@BobMaxeyFord");
    expect(fitted).toContain("Offer requires approved credit.");
    expect(fitted.length).toBeLessThanOrEqual(560);
  });

  it("fails closed instead of publishing a truncated disclosure", () => {
    expect(() =>
      fitPublishCaptionToBudget(
        {
          text: `${DISCLOSURE}\n\nDrive home today.`,
          disclosures: "Offer requires approved credit. See dealer for details.",
          requiredPrefix: DISCLOSURE,
        },
        60,
      ),
    ).toThrow(/exceed|cannot fit/i);
  });

  it("still fits a caption when no prefix is required", () => {
    const fitted = fitPublishCaptionToBudget(
      { text: `${"Drive home today. ".repeat(30)}` },
      280,
    );
    expect(fitted.length).toBeLessThanOrEqual(280);
    expect(fitted.startsWith(DISCLOSURE)).toBe(false);
  });
});

describe("the disclosure is added exactly once", () => {
  /**
   * An earlier version split requiredPrefix back off the caption with an exact
   * startsWith. That comparison ran against text normalizeCaptionHashtags had
   * already rewritten, so a disclosure containing "#ad" failed to match, was
   * treated as body, and came back doubled — the second copy fused to the
   * caption as "#AdGreat truck!". `text` is now the body alone and the fitter
   * is the single place the prefix is applied.
   */
  const countOccurrences = (haystack: string, needle: string) =>
    haystack.split(needle).length - 1;

  it("does not duplicate a disclosure containing a hashtag", () => {
    const disclosure = "Posted by a Bob Maxey Ford team member. #ad";
    const fitted = fitPublishCaptionToBudget(
      { text: "Great truck, come see it today!", requiredPrefix: disclosure },
      2000,
    );

    expect(countOccurrences(fitted, "Posted by a Bob Maxey Ford team member.")).toBe(1);
    expect(fitted.startsWith(disclosure)).toBe(true);
    // And it must not be fused to the body.
    expect(fitted).toContain(`${disclosure}\n\nGreat truck`);
  });

  it("does not duplicate one wrapped in markdown emphasis", () => {
    const disclosure = "*Posted by a Bob Maxey Ford team member.*";
    const fitted = fitPublishCaptionToBudget(
      { text: "Great truck!", requiredPrefix: disclosure },
      2000,
    );
    expect(countOccurrences(fitted, "Posted by a Bob Maxey Ford team member.")).toBe(1);
  });

  it("charges the disclosure to the budget exactly once", () => {
    const disclosure = "Posted by a Bob Maxey Ford team member.";
    const fitted = fitPublishCaptionToBudget(
      { text: "x".repeat(400), requiredPrefix: disclosure },
      280,
    );
    expect(fitted.length).toBeLessThanOrEqual(280);
    expect(countOccurrences(fitted, disclosure)).toBe(1);
  });
});
