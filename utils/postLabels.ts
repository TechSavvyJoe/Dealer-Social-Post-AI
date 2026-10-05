/**
 * One set of names for what a post is and where it went, shared by My work and
 * Home's My work preview. Each screen used to keep its own small map, and each
 * fell through to the wrong answer: a LinkedIn or Google share read as
 * "Facebook" and a Promotion or Community post read as a bare "Post".
 */
import type { BrandCategoryId, Dealer } from "../types";
import { brandCategoryForScenario } from "../services/creativeSystem";
import { homeTilesForDealer, type HomeTile } from "../services/storeDefaults";
import {
  postStatusFor,
  shareStatusDetail,
  type HistoryPostStatus,
  type HistoryPostStatusInput,
} from "./historyPost";

/**
 * Destination names, matching the channel chips on the Post screen so an
 * action keeps its name from the tap ("Share to Google") to My work.
 */
export const CHANNEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  facebook_feed: "Facebook",
  instagram_feed: "Instagram",
  instagram_story: "Instagram",
  marketplace: "Marketplace",
  gbp: "Google",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x_twitter: "X",
  youtube: "YouTube",
});

/** Neutral name for a destination this build does not know: never a guess. */
export const UNKNOWN_CHANNEL_LABEL = "another app";

const ownLabel = (labels: Readonly<Record<string, string>>, key: string) =>
  Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;

export const channelLabel = (channel?: string | null): string =>
  ownLabel(CHANNEL_LABELS, (channel || "").trim()) ?? UNKNOWN_CHANNEL_LABEL;

/** The six Home categories, named exactly as their tiles are. */
export const CATEGORY_LABELS: Readonly<Record<BrandCategoryId, string>> = Object.freeze(
  {
    deliveries: "Delivery",
    inventory: "New arrival",
    service: "Service",
    promotions: "Promotion",
    community: "Community",
    team: "Team",
  },
);

/**
 * The built-in scenarios that are not one of the six Home tiles (those take
 * the tile's own label). Sentence case, in the salesperson's words.
 */
export const SCENARIO_LABELS: Readonly<Record<string, string>> = Object.freeze({
  preowned_spotlight: "Pre-owned spotlight",
  trade_in_spotlight: "Trade-in spotlight",
  recall_complete: "Recall complete",
  customer_testimonial: "Customer testimonial",
  sold_by_salesperson: "Just sold",
  test_drive_invite: "Test-drive invite",
});

export const FALLBACK_POST_LABEL = "Post";

/**
 * What a saved post is, by its scenario: the dealer's Home tile first (which
 * includes the store's own custom scenarios), then a built-in scenario, then
 * the scenario's category, then "Post". Pass `tiles` when labelling a list so
 * the dealer's custom scenarios are parsed once, not once per row.
 */
export const postCategoryLabel = (
  scenarioId: string | null | undefined,
  dealer?: Dealer | null,
  tiles: readonly HomeTile[] = homeTilesForDealer(dealer),
): string => {
  const id = (scenarioId || "").trim();
  if (!id) return FALLBACK_POST_LABEL;
  const tileLabel = tiles.find((tile) => tile.scenarioId === id)?.label.trim();
  if (tileLabel) return tileLabel;
  const builtIn = ownLabel(SCENARIO_LABELS, id);
  if (builtIn) return builtIn;
  const category = brandCategoryForScenario(id, dealer?.custom_scenarios);
  return category ? CATEGORY_LABELS[category] : FALLBACK_POST_LABEL;
};

/**
 * PocketBase writes "2026-10-05 15:12:00.000Z". Some WebKit versions reject
 * the space separator, so normalise it before parsing. Null when unreadable.
 */
export const parseServerTime = (value?: string | null): Date | null => {
  const raw = (value || "").trim();
  if (!raw) return null;
  const date = new Date(raw.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "Today", "Yesterday", "Oct 5", or "Oct 5, 2025" outside this year. */
export const dayLabel = (date: Date, now: Date = new Date()): string => {
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
};

/** "Today, 3:12 PM" / "Oct 5, 3:12 PM"; empty when the time is unreadable. */
export const dayTimeLabel = (value?: string | null, now: Date = new Date()): string => {
  const date = parseServerTime(value);
  if (!date) return "";
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${dayLabel(date, now)}, ${time}`;
};

/** The day a post was made: "Today", "Oct 5"; empty when unreadable. */
export const postDayLabel = (value?: string | null, now: Date = new Date()): string => {
  const date = parseServerTime(value);
  return date ? dayLabel(date, now) : "";
};

export type PostStatusTone = "success" | "warning" | "error" | "neutral";

/** State ink for a status line; neutral states stay quiet. */
export const STATUS_TONE_CLASS: Readonly<Record<PostStatusTone, string>> =
  Object.freeze({
    success: "text-success-ink",
    warning: "text-warning-ink",
    error: "text-error-ink",
    neutral: "text-ink-2",
  });

export interface PostStatusCopy {
  status: HistoryPostStatus;
  /** The one status line. */
  label: string;
  /** A second, quieter line (My work only); never set on Home. */
  detail?: string;
  tone: PostStatusTone;
}

export interface PostStatusCopyInput extends HistoryPostStatusInput {
  rejection_reason?: string;
}

/**
 * The status line for a saved post. Both surfaces say "Shared · Facebook",
 * never "Shared to Facebook": the share sheet does not tell us which app
 * received the post (amendment B1). My work adds the honest sub-line "sent to
 * the share sheet"; Home's single line carries the time instead. A download
 * or a copied caption is named for what it was, never as a share.
 */
export const postStatusCopy = (
  record: PostStatusCopyInput,
  { surface, now = new Date() }: { surface: "work" | "home"; now?: Date },
): PostStatusCopy => {
  const status = postStatusFor(record);
  const share = record.share_summary ? shareStatusDetail(record.share_summary) : null;
  switch (status) {
    case "shared": {
      const label = `Shared · ${channelLabel(share?.channel)}`;
      if (surface === "work") {
        return { status, label, detail: "sent to the share sheet", tone: "success" };
      }
      const time = dayTimeLabel(share?.at, now);
      return { status, label: time ? `${label} · ${time}` : label, tone: "success" };
    }
    case "downloaded":
      return {
        status,
        label: `Downloaded for ${channelLabel(share?.channel)}`,
        tone: "neutral",
      };
    case "copied":
      return { status, label: "Caption copied", tone: "neutral" };
    case "waiting":
      return { status, label: "Waiting for approval", tone: "warning" };
    case "changes": {
      const reason = (record.rejection_reason || "").trim();
      return {
        status,
        label: "Changes requested",
        ...(surface === "work" && reason ? { detail: reason } : {}),
        tone: "error",
      };
    }
    case "review_blocked":
      return {
        status,
        label: "Held for safety review",
        ...(surface === "work" ? { detail: "This post can't be reopened." } : {}),
        tone: "warning",
      };
    case "draft":
      return { status, label: "Draft", tone: "neutral" };
  }
};
