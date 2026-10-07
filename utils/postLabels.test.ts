import { describe, expect, it } from "vitest";
import type { Dealer } from "../types";
import { POST_SCENARIOS } from "../services/postScenarios";
import { HOME_TILES } from "../services/storeDefaults";
import {
  CATEGORY_LABELS,
  SCENARIO_LABELS,
  UNKNOWN_CHANNEL_LABEL,
  channelLabel,
  dayTimeLabel,
  parseServerTime,
  postCategoryLabel,
  postDayLabel,
  postStatusCopy,
  sharedLabel,
} from "./postLabels";

const dealer = (overrides: Partial<Dealer> = {}) =>
  ({ id: "dealer-1", name: "Northline Motors", ...overrides }) as Dealer;

describe("channelLabel", () => {
  it.each([
    ["facebook_feed", "Facebook"],
    ["instagram_feed", "Instagram"],
    ["instagram_story", "Instagram"],
    ["marketplace", "Marketplace"],
    ["gbp", "Google"],
    ["linkedin", "LinkedIn"],
    ["tiktok", "TikTok"],
    ["x_twitter", "X"],
    ["youtube", "YouTube"],
  ])("names %s as %s", (channel, label) => {
    expect(channelLabel(channel)).toBe(label);
  });

  it("never guesses an unknown destination", () => {
    expect(UNKNOWN_CHANNEL_LABEL).toBe("another app");
    expect(channelLabel("pinterest")).toBe("another app");
    expect(channelLabel("")).toBe("another app");
    expect(channelLabel(undefined)).toBe("another app");
    expect(channelLabel("toString")).toBe("another app");
  });
});

describe("sharedLabel", () => {
  it("names a share-sheet share by its channel, never as a share to it", () => {
    expect(sharedLabel("facebook_feed")).toBe("Shared · Facebook");
    expect(sharedLabel("gbp")).toBe("Shared · Google");
    expect(sharedLabel("pinterest")).toBe("Shared · another app");
    expect(sharedLabel(undefined)).toBe("Shared · another app");
  });

  it("is the label My work and Home show for the same share", () => {
    const record = {
      share_summary: {
        count: 1,
        last_via: "share_sheet" as const,
        last_channel: "linkedin",
        sheet_count: 1,
        last_sheet_channel: "linkedin",
        last_sheet_at: "2026-10-05 15:12:00.000Z",
      },
    };
    expect(postStatusCopy(record, { surface: "work" }).label).toBe(
      sharedLabel("linkedin"),
    );
    expect(postStatusCopy(record, { surface: "home" }).label).toMatch(
      /^Shared · LinkedIn · /,
    );
  });
});

describe("postCategoryLabel", () => {
  it.each([
    ["customer_delivery", "Delivery"],
    ["new_arrival", "New arrival"],
    ["service_promotion", "Service"],
    ["model_year_end", "Promotion"],
    ["community_event", "Community"],
    ["team_anniversary", "Team"],
  ])("names the %s tile %s", (scenarioId, label) => {
    expect(postCategoryLabel(scenarioId, dealer())).toBe(label);
  });

  it("names every built-in scenario without falling back to its category", () => {
    for (const scenario of POST_SCENARIOS) {
      const onTile = HOME_TILES.some((tile) => tile.scenarioId === scenario.id);
      const ownLabel = Object.prototype.hasOwnProperty.call(
        SCENARIO_LABELS,
        scenario.id,
      );
      expect(onTile !== ownLabel, scenario.id).toBe(true);
    }
    expect(postCategoryLabel("preowned_spotlight")).toBe("Pre-owned spotlight");
    expect(postCategoryLabel("test_drive_invite")).toBe("Test-drive invite");
  });

  it("uses the store's own name for a custom scenario", () => {
    const custom = dealer({
      custom_scenarios: JSON.stringify([
        {
          id: "custom_oil",
          label: "Oil change week",
          category: "service",
          promptAdditions: "Oil change promotion.",
        },
      ]),
    });
    expect(postCategoryLabel("custom_oil", custom)).toBe("Oil change week");
  });

  it("falls back to the category, then to Post", () => {
    const unnamed = dealer({
      custom_scenarios: JSON.stringify([
        {
          id: "custom_blank",
          label: "   ",
          category: "community",
          promptAdditions: "Local event.",
        },
      ]),
    });
    expect(postCategoryLabel("custom_blank", unnamed)).toBe(CATEGORY_LABELS.community);
    expect(postCategoryLabel("not_a_scenario", dealer())).toBe("Post");
    expect(postCategoryLabel("", dealer())).toBe("Post");
    expect(postCategoryLabel(undefined, null)).toBe("Post");
  });
});

describe("server times", () => {
  const now = new Date(2026, 9, 5, 18, 0);

  it("reads PocketBase's space-separated timestamps", () => {
    expect(parseServerTime("2026-10-05 15:12:00.000Z")?.toISOString()).toBe(
      "2026-10-05T15:12:00.000Z",
    );
    expect(parseServerTime("not a time")).toBeNull();
    expect(parseServerTime("")).toBeNull();
  });

  it("says Today, Yesterday or the date, with the year only when it differs", () => {
    const today = new Date(2026, 9, 5, 15, 12).toISOString();
    const yesterday = new Date(2026, 9, 4, 9, 5).toISOString();
    const earlier = new Date(2026, 8, 28, 9, 5).toISOString();
    const lastYear = new Date(2025, 8, 28, 9, 5).toISOString();
    expect(dayTimeLabel(today, now)).toMatch(/^Today, 3:12\sPM$/);
    expect(dayTimeLabel(yesterday, now)).toMatch(/^Yesterday, 9:05\sAM$/);
    expect(postDayLabel(earlier, now)).toBe("Sep 28");
    expect(postDayLabel(lastYear, now)).toBe("Sep 28, 2025");
    expect(dayTimeLabel("", now)).toBe("");
  });
});

describe("postStatusCopy", () => {
  const now = new Date(2026, 9, 5, 18, 0);
  const at = new Date(2026, 9, 5, 15, 12).toISOString();
  const sheetThenCopy = {
    count: 2,
    last_via: "copy" as const,
    last_channel: "instagram_feed",
    last_shared_at: at,
    sheet_count: 1,
    last_sheet_channel: "facebook_feed",
    last_sheet_at: at,
  };

  it("labels a share-sheet share honestly on both surfaces", () => {
    const work = postStatusCopy(
      { share_summary: sheetThenCopy },
      { surface: "work", now },
    );
    expect(work).toMatchObject({
      status: "shared",
      label: "Shared · Facebook",
      detail: "sent to the share sheet",
      tone: "success",
    });
    const home = postStatusCopy(
      { share_summary: sheetThenCopy },
      { surface: "home", now },
    );
    expect(home.label).toMatch(/^Shared · Facebook · Today, 3:12\sPM$/);
    expect(home.detail).toBeUndefined();
    expect(`${work.label} ${home.label}`).not.toMatch(/Shared to/);
  });

  it("names a download for its channel and a copy as a copy", () => {
    const downloaded = postStatusCopy(
      {
        share_summary: {
          count: 1,
          last_via: "download",
          last_channel: "gbp",
          sheet_count: 0,
        },
      },
      { surface: "work", now },
    );
    expect(downloaded).toMatchObject({
      label: "Downloaded for Google",
      tone: "neutral",
    });
    expect(downloaded.detail).toBeUndefined();
    const copied = postStatusCopy(
      { share_summary: { count: 1, last_via: "copy", last_channel: "linkedin" } },
      { surface: "home", now },
    );
    expect(copied).toMatchObject({ label: "Caption copied", tone: "neutral" });
  });

  it("carries a manager's reason and a safety hold on My work only", () => {
    expect(
      postStatusCopy(
        { approval_status: "rejected", rejection_reason: "Remove the price." },
        { surface: "work", now },
      ),
    ).toMatchObject({ label: "Changes requested", detail: "Remove the price." });
    expect(
      postStatusCopy(
        { approval_status: "rejected", rejection_reason: "Remove the price." },
        { surface: "home", now },
      ).detail,
    ).toBeUndefined();
    expect(
      postStatusCopy({ image_review_required: true }, { surface: "work", now }),
    ).toMatchObject({ label: "Held for safety review", tone: "warning" });
    expect(
      postStatusCopy({ approval_status: "pending" }, { surface: "home", now }),
    ).toMatchObject({ label: "Waiting for approval", tone: "warning" });
    expect(postStatusCopy({}, { surface: "home", now })).toMatchObject({
      label: "Draft",
      tone: "neutral",
    });
  });
});
