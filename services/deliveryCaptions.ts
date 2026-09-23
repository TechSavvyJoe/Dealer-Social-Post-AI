/**
 * Pure delivery-caption composition extracted from components/PostResult.tsx.
 *
 * Everything here is copied verbatim from the original inline computation —
 * only the shape (function arguments instead of closed-over component state)
 * changed. See docs/superpowers/specs/2026-09-22-streamlined-posting-flow-design.md
 * §5 for the invariant this preserves: the disclosure stays outside the
 * editable body and inside every outgoing caption.
 */
import type { Dealer } from "../types";
import type { PlatformShareCaption } from "../components/ShareDialog";
import {
  analyzeCaptionForDelivery,
  prependEmployeeDisclosure,
  prohibitedClaimsMessage,
  type DealerBannedPhrases,
  type EmployeeDisclosureDealer,
} from "../utils/complianceDisclosures";
import { appendDealershipMention } from "../utils/socialAttribution";
import { checkCaptionIdentity, type CaptionIdentityContext } from "../utils/postLocks";

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
 * disclosure. This is the body of PostResult.tsx's former
 * `sharePlatformCaptions` memo, verbatim, plus the PR2b-only
 * `bodyEditSupersedesPack` opt-in (see the field doc above).
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
    const attributed = appendDealershipMention(base, id, input.dealer);
    const scanned = analyzeCaptionForDelivery(
      attributed,
      input.bannedPhrases,
      undefined,
      input.deliveryLanguageAllowed,
    );
    // Scan the disclosure-prepended text (unchanged from before), so the
    // identity-safety and prohibited-claims checks see exactly what the
    // caption will look like once a delivery path adds requiredPrefix.
    const prepared = {
      ...scanned,
      caption: prependEmployeeDisclosure(scanned.caption, input.dealer),
    };
    const identitySafe = checkCaptionIdentity(prepared.caption, input.identity);
    out[id] = {
      // Body only — `scanned.caption`, NOT `prepared.caption`. Every consumer
      // of this pack (handleShareDelivery, contentForTarget in ShareDialog,
      // the fitter in services/publishTargets.ts) already treats
      // requiredPrefix as the one channel for the disclosure. Storing the
      // prepended string here duplicated it: ShareDialog spreads `...content`
      // (which still carries requiredPrefix) and only overrides `text`, so
      // the fitter added the disclosure a second time on top of a caption
      // that already opened with it, corrupting both the published post and
      // the budget it was fit against.
      text: scanned.caption,
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
 * `handleCopy`'s attribute-then-scan-then-prepend-then-append chain,
 * verbatim. The disclosure is prepended after the scan (see the note in
 * `buildShareCaptions`): this path pastes straight into destinations with no
 * budget fitter behind it, so a disclosure lost here is simply absent from
 * the published post.
 */
export const buildCopyText = (input: BuildCopyTextInput): CopyTextResult => {
  const attributedCaption = input.copyDestinationId
    ? appendDealershipMention(input.editedText, input.copyDestinationId, input.dealer)
    : input.editedText;
  const preparedCopy = analyzeCaptionForDelivery(
    attributedCaption,
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
  const text = appendDisclosureText(
    prependEmployeeDisclosure(preparedCopy.caption, input.dealer),
    preparedCopy.disclosures,
  );
  return { text };
};
