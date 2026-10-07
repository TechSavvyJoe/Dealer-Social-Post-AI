/**
 * Pure delivery-caption composition extracted from components/PostResult.tsx.
 *
 * It started as a verbatim copy of the original inline computation, with only
 * the shape (function arguments instead of closed-over component state)
 * changed. One deliberate change since: the dealership page tag is added
 * after the compliance scan, not before it, and a store tag the caption
 * already closes with is kept out of the scan too (see `buildShareCaptions`
 * and `splitClosingStoreTags`). See
 * docs/superpowers/specs/2026-09-22-streamlined-posting-flow-design.md §5 for
 * the invariant this preserves: the disclosure stays outside the editable body
 * and inside every outgoing caption.
 */
import type { Dealer } from "../types";
import {
  analyzeCaptionForDelivery,
  prependEmployeeDisclosure,
  prohibitedClaimsMessage,
  type DealerBannedPhrases,
  type EmployeeDisclosureDealer,
} from "../utils/complianceDisclosures";
import {
  appendDealershipMention,
  dealershipMentionFor,
} from "../utils/socialAttribution";
import { checkCaptionIdentity, type CaptionIdentityContext } from "../utils/postLocks";

/** One destination's outgoing caption: body only, plus its compliance disclosures. */
export interface PlatformShareCaption {
  text: string;
  disclosures?: string;
  blockedReason?: string;
}

/** One destination per network with a store tag or handle (see dealershipMentionFor). */
const STORE_TAG_NETWORKS = [
  "facebook_feed",
  "instagram_feed",
  "tiktok",
  "x_twitter",
  "linkedin",
] as const;

const tagKey = (value: string): string => value.trim().normalize("NFKC").toLowerCase();

/**
 * Splits off the store's own tags when they close the caption, each on its own
 * line: a salesperson typed one, or pasted a shared caption back in. The
 * compliance scan must not see them there. Its brand-kit pass reads hashtags
 * from the LAST line only, so a caption ending in "@Tag" had its real hashtag
 * line read as prose and got a second line of filler hashtags under the tag.
 *
 * Only a line that is exactly one of this store's configured tags (any
 * network's, since one caption on screen feeds every channel) is split off,
 * so anyone else's @handle and any line with words in it are scanned as
 * before. The first line is never split off, so the scan always has a body.
 */
const splitClosingStoreTags = (
  caption: string,
  dealer: Dealer | null | undefined,
): { body: string; tags: string[] } => {
  const storeTags = new Set(
    STORE_TAG_NETWORKS.map((id) => dealershipMentionFor(id, dealer))
      .filter(Boolean)
      .map(tagKey),
  );
  const tags: string[] = [];
  let body = caption.trim();
  while (storeTags.size > 0) {
    const lastBreak = body.lastIndexOf("\n");
    if (lastBreak < 0) break;
    const line = body.slice(lastBreak + 1).trim();
    const rest = body.slice(0, lastBreak).trim();
    if (!storeTags.has(tagKey(line))) break;
    tags.unshift(line);
    body = rest;
  }
  return tags.length > 0 ? { body, tags } : { body: caption, tags };
};

/**
 * The scanned body, then the store tags split off before the scan, as typed,
 * then this destination's own tag when the caption does not already carry it.
 * Each tag is its own line after a blank line, so the page tag closes the
 * caption, after its one hashtag line.
 */
const closeWithStoreTags = (
  scannedCaption: string,
  closingTags: string[],
  destinationId: string | undefined,
  dealer: Dealer | null | undefined,
): string => {
  const closed = [scannedCaption.trim(), ...closingTags].filter(Boolean).join("\n\n");
  return destinationId
    ? appendDealershipMention(closed, destinationId, dealer)
    : closed;
};

/**
 * The on-screen caption textarea never contains disclosures (they're stored
 * separately so the salesperson can't silently delete them). For copy +
 * share + download the caption and disclosure block are always pasted back
 * together so the dealer's actual social post is compliant.
 */
export const appendDisclosureText = (caption: string, disclosures: string): string => {
  const cap = caption.trim();
  const disclosureText = disclosures.trim();
  if (!disclosureText) return cap;
  return `${cap}\n\n${
    disclosureText.startsWith("— Disclosures —")
      ? disclosureText
      : `— Disclosures —\n${disclosureText}`
  }`;
};

/**
 * What actually reaches the destination, including the FTC team-member
 * disclosure that every delivery path prepends as a protected prefix.
 *
 * `appendDisclosureText(editedText, disclosures)` is body + compliance
 * footer and stops there, so anything measuring or previewing it without
 * this wrapper was short by the length of the disclosure plus its blank
 * line. Idempotent, so a salesperson who typed the disclosure themselves
 * does not see it twice.
 */
export const deliveredCaptionFor = (
  editedText: string,
  disclosures: string,
  dealer: EmployeeDisclosureDealer | null | undefined,
): string =>
  prependEmployeeDisclosure(appendDisclosureText(editedText, disclosures), dealer);

/**
 * Merges the saved per-platform caption pack with local (unsaved) edits.
 * Verbatim move of PostResult.tsx's former `effectivePack` memo (L770-775):
 * undefined when there is neither a saved pack nor any override, so callers
 * that gate on "is there a pack at all" keep working unchanged.
 */
export const effectivePackFor = (
  platformCaptions: Record<string, string> | undefined,
  packOverrides: Record<string, string>,
): Record<string, string> | undefined => {
  if (!platformCaptions && Object.keys(packOverrides).length === 0) {
    return undefined;
  }
  return { ...(platformCaptions || {}), ...packOverrides };
};

/**
 * The pack-override reducer shared by the "persist textarea edits into the
 * active pack slot" effect and the tab-switch flush in `selectCaptionPlatform`
 * (PostResult.tsx, formerly inlined in both places). A no-op (same `prev`
 * reference) when there is no active platform or the trimmed text is empty
 * or unchanged, so callers can call this unconditionally without adding an
 * extra render.
 */
export const withPackEdit = (
  prev: Record<string, string>,
  platformId: string | null,
  editedText: string,
): Record<string, string> => {
  if (!platformId) return prev;
  const trimmed = editedText.trim();
  if (!trimmed) return prev;
  if (prev[platformId] === trimmed) return prev;
  return { ...prev, [platformId]: trimmed };
};

export interface BuildShareCaptionsInput {
  effectivePack: Record<string, string> | undefined;
  activeCaptionPlatform: string | null;
  editedText: string;
  dealer: Dealer | null | undefined;
  bannedPhrases?: DealerBannedPhrases;
  deliveryLanguageAllowed: boolean;
  identity: CaptionIdentityContext;
  /** = identityGateMessage; the single precomputed identity-lock message. */
  identityBlockedMessage: string;
  /**
   * PR2b opt-in only — the old multi-tab screen never sets this and must not
   * change behaviour. When true AND `activeCaptionPlatform` is null (the
   * salesperson is editing the shared body, not a single per-channel tab),
   * every channel is derived from `editedText` instead of its stale saved
   * AI variant, so an edit to the body invalidates every per-channel pack
   * instead of shipping captions the salesperson never saw. The sanitizer
   * (compliance scan, identity check, disclosure) still runs per channel,
   * so each channel's disclosure/attribution is re-appended correctly.
   */
  bodyEditSupersedesPack?: boolean;
}

/**
 * Re-scan every outgoing variant; one platform can trigger a different
 * disclosure. This was the body of PostResult.tsx's former
 * `sharePlatformCaptions` memo, plus the PR2b-only `bodyEditSupersedesPack`
 * opt-in (see the field doc above), with the page tag now added after the
 * scan instead of before it.
 */
export const buildShareCaptions = (
  input: BuildShareCaptionsInput,
): Record<string, PlatformShareCaption> | undefined => {
  const { effectivePack } = input;
  if (!effectivePack) return undefined;
  const bodyEditsEveryChannel =
    Boolean(input.bodyEditSupersedesPack) && input.activeCaptionPlatform === null;
  const out: Record<string, PlatformShareCaption> = {};
  for (const [id, cap] of Object.entries(effectivePack)) {
    // Active platform: use live editor text (includes in-progress edits).
    // Opt-in body-edit mode: every channel follows the edited body instead.
    const base = bodyEditsEveryChannel
      ? input.editedText.trim()
      : id === input.activeCaptionPlatform
        ? input.editedText.trim()
        : cap?.trim();
    if (!base) continue;
    // The disclosure is applied AFTER the compliance/normalisation pass, never
    // before. analyzeCaptionForDelivery runs cleanSocialCaption, whose
    // assistant-preamble heuristic drops an entire first line starting with
    // "I have", "I've", "Here's" or "Sure" — exactly how a compliance officer
    // words a material-connection line. Prepending first silently deleted the
    // disclosure for four of five realistic wordings.
    //
    // The page tag goes on after the scan as well. The scan's brand-kit pass
    // (applyDealerBrandKit) looks for hashtags on the LAST line only, so a
    // caption that already ended in "@Tag" had its hashtag line read as prose
    // and got a second line of filler hashtags written under the tag: every
    // Facebook and Instagram caption of a store with a tag carried the same
    // tags twice. For the same reason a store tag the caption on screen
    // already closes with is set aside for the scan and put back after it.
    const closing = splitClosingStoreTags(base, input.dealer);
    const scanned = analyzeCaptionForDelivery(
      closing.body,
      input.bannedPhrases,
      undefined,
      input.deliveryLanguageAllowed,
    );
    const attributed = closeWithStoreTags(
      scanned.caption,
      closing.tags,
      id,
      input.dealer,
    );
    // Check the disclosure-prepended text, so the identity-safety check sees
    // exactly what the caption will look like once a delivery path adds
    // requiredPrefix, page tag included.
    const prepared = {
      ...scanned,
      caption: prependEmployeeDisclosure(attributed, input.dealer),
    };
    const identitySafe = checkCaptionIdentity(prepared.caption, input.identity);
    out[id] = {
      // Body only — `attributed`, NOT `prepared.caption`. Every consumer of
      // this pack (handleShareDelivery, contentForTarget in ShareDialog, the
      // fitter in services/publishTargets.ts) already treats requiredPrefix as
      // the one channel for the disclosure. Storing the prepended string here
      // duplicated it: ShareDialog spreads `...content` (which still carries
      // requiredPrefix) and only overrides `text`, so the fitter added the
      // disclosure a second time on top of a caption that already opened with
      // it, corrupting both the published post and the budget it was fit
      // against.
      text: attributed,
      disclosures: prepared.disclosures || undefined,
      blockedReason: !identitySafe
        ? input.identityBlockedMessage
        : prepared.compliance.prohibited.length > 0
          ? prohibitedClaimsMessage(prepared.compliance.prohibited)
          : undefined,
    };
  }
  if (out.instagram_feed && !out.instagram_reel) {
    out.instagram_reel = out.instagram_feed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export interface BuildCopyTextInput {
  editedText: string;
  copyDestinationId?: string;
  dealer: Dealer | null | undefined;
  bannedPhrases?: DealerBannedPhrases;
  deliveryLanguageAllowed: boolean;
}

export interface CopyTextResult {
  /** The exact text to place on the clipboard. Empty when blocked. */
  text: string;
  /** Set when the copy is blocked by a prohibited claim. */
  blockedReason?: string;
}

/**
 * The copy chain: set aside any store tag the caption closes with, scan, then
 * put the tags back and add the page tag, then prepend the disclosure, then
 * append the disclosures block. The page tag and the disclosure both go
 * on after the scan (see the notes in `buildShareCaptions`): this path pastes
 * straight into destinations with no budget fitter behind it, so a disclosure
 * lost here is simply absent from the published post, and a second hashtag
 * line written under the tag is simply in it.
 */
export const buildCopyText = (input: BuildCopyTextInput): CopyTextResult => {
  const closing = splitClosingStoreTags(input.editedText, input.dealer);
  const preparedCopy = analyzeCaptionForDelivery(
    closing.body,
    input.bannedPhrases,
    undefined,
    input.deliveryLanguageAllowed,
  );
  if (preparedCopy.compliance.prohibited.length > 0) {
    return {
      text: "",
      blockedReason: prohibitedClaimsMessage(preparedCopy.compliance.prohibited),
    };
  }
  const attributedCaption = closeWithStoreTags(
    preparedCopy.caption,
    closing.tags,
    input.copyDestinationId,
    input.dealer,
  );
  const text = appendDisclosureText(
    prependEmployeeDisclosure(attributedCaption, input.dealer),
    preparedCopy.disclosures,
  );
  return { text };
};
