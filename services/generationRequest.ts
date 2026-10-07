/**
 * Extracted verbatim from components/PostCustomizer.tsx (PR2-0 unit U01).
 *
 * composeGenerationCreativeBrief is the same brief assembler PostCustomizer
 * exported before this move (it is re-exported there for compatibility).
 * buildGenerationRequest is the guard + brief-assembly body of
 * PostCustomizer's handleGenerate, unchanged in behavior: same guard order,
 * same brief sections, same failure reasons and messages. The caller (still
 * PostCustomizer for now) keeps the customizer.decisions telemetry call and
 * clears a stale capturedRelease on release_mismatch itself — see amendments
 * B6 and A1.
 */
import {
  StyleOption,
  ToneOption,
  type Dealer,
  type MediaOutputMode,
  type GeneratedPost,
} from "../types";
import { DecodedVehicle, vehicleToCreativeBrief } from "./vinDecoder";
import { CapturedRelease } from "./photoReleases";
import {
  POST_SCENARIOS,
  scenarioToCreativeBrief,
  getScenariosForDealer,
  stripIdMarkerSpoof,
} from "./postScenarios";
import {
  platformsToCreativeBrief,
  type PrimaryImageProfile,
  type PlatformId,
} from "./platformCopy";
import { brandHashtagFromName, formatHashtag } from "../utils/hashtags";
import { releaseAuthorizesPublicLabel } from "../utils/customerIdentity";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";

const normalizeReleaseVin = (value: string | undefined): string =>
  (value || "").trim().toUpperCase();

/**
 * Spec §4.5: the personal line is appended after the caption body — it is
 * never a replacement caption — and is capped so it cannot become a second
 * caption in disguise.
 */
export const PERSONAL_LINE_MAX = 140;

// Design-DNA hints per style, moved out of PostCustomizer's STYLE_INFO map.
// PostCustomizer keeps STYLE_INFO for icon/desc/detail (UI-only) and sources
// its own aiHint field from this map, so the picker copy is unchanged.
export const STYLE_AI_HINTS: Record<StyleOption, string> = {
  [StyleOption.Luxury]:
    "Soft luxury grade and elegant type over the real delivery photo — no car swap.",
  [StyleOption.Modern]:
    "Crisp modern type and contrast on the real photo — keep people and vehicle locked.",
  [StyleOption.Friendly]:
    "Warm, friendly polish on the real moment — lively without cartoon rebuilds.",
  [StyleOption.Sporty]:
    "Sporty type energy while preserving the exact car and customers from the photo.",
  [StyleOption.DepthPop]:
    "Oversized headline tucked behind the real car with a glow outline — modern 3D depth.",
};

export type CaptionSource = "ai" | "custom";

interface CreativeBriefSections {
  dealershipName: string;
  scenarioBlock?: string;
  vehicleBlock?: string;
  oemBlock?: string;
  designBlock: string;
  /** Dealer brand voice — a brand contract, so it rides inside the caption window. */
  voiceBlock?: string;
  supportingBlocks: string[];
  platformBlock?: string;
}

/** Keep immutable grounding facts ahead of verbose destination guidance. */
export const composeGenerationCreativeBrief = ({
  dealershipName,
  scenarioBlock,
  vehicleBlock,
  oemBlock,
  designBlock,
  voiceBlock,
  supportingBlocks,
  platformBlock,
}: CreativeBriefSections): string => {
  const bounded = (value: string | undefined, limit: number) =>
    (value || "").trim().slice(0, limit);
  // scenarioToCreativeBrief embeds the ONE trusted "[id:...]" marker
  // creativeSkills.ts's classifier keys off of, and its own docstring is
  // explicit that this only works if no OTHER "[id:...]"-shaped text can
  // reach the composed brief ahead of it — the classifier trusts whichever
  // one it finds FIRST. Every field here except scenarioBlock is dealer-
  // editable free text (dealer.brand_voice for voiceBlock, dealer name,
  // hand-typed vehicle/OEM/design notes) that reaches this brief without
  // ever passing through scenarioToCreativeBrief's own sanitization, so a
  // dealer typing "[id:sold_by_salesperson]" into, say, their Brand Voice
  // settings would otherwise forge that scenario's classification (and,
  // downstream, deliveryLanguageAllowedForBrief) for every post regardless
  // of which scenario was actually picked. Strip the same marker shape out
  // of all of them; scenarioBlock is the one field intentionally exempt.
  const boundedSafe = (value: string | undefined, limit: number) =>
    bounded(stripIdMarkerSpoof(value || ""), limit);
  // The caption model intentionally reads only the first 900 characters of
  // this shared brief. Keep every immutable grounding block inside an 850-char
  // worst-case envelope so a verbose custom scenario cannot push vehicle, OEM,
  // or design facts out of the live caption prompt. The remaining budget is
  // still available to the image model for dealer and destination guidance.
  // Brand voice sits second: identity + voice never exceed 320 chars, so the
  // dealership's voice can no longer be pushed out of the caption window by a
  // verbose scenario or VIN block. Design DNA is last because the caption
  // model also receives style guidance through its own styleHint.
  const essential = [
    `Dealership identity (use this exact name): "${boundedSafe(dealershipName, 100)}".`,
    boundedSafe(voiceBlock, 220),
    bounded(scenarioBlock, 240),
    boundedSafe(vehicleBlock, 220),
    boundedSafe(oemBlock, 120),
    boundedSafe(designBlock, 120),
  ].filter(Boolean);
  const supporting = supportingBlocks
    .map((part) => boundedSafe(part, 220))
    .filter(Boolean);
  const platform = boundedSafe(platformBlock, 500);
  return [...essential, ...supporting, platform]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1400);
};

/** The exact tuple useGeneration.handleGenerate (onGenerate) accepts. */
export interface GenerationRequestArgs {
  style: StyleOption;
  tone: ToneOption;
  customerName: string;
  customText?: string;
  creativeBrief: string;
  meta: {
    salespersonName?: string;
    salespersonId?: string;
    vin?: string;
    scenarioId?: string;
    customerIdentityRequired?: boolean;
    hasRelease?: boolean;
    capturedRelease?: CapturedRelease;
    websiteEnabled?: boolean;
    websiteVehicleDescription?: string;
    decodedVehicle?: DecodedVehicle;
    playfulStyleId?: string;
  };
  platformIds: PlatformId[];
  outputProfile: PrimaryImageProfile;
  mediaOutputMode: MediaOutputMode;
}

export type GenerationRequestFailureReason =
  "no_destination" | "release_required" | "release_mismatch" | "identity";

export type BuildGenerationRequestResult =
  | { ok: true; args: GenerationRequestArgs }
  | {
      ok: false;
      reason: GenerationRequestFailureReason;
      message?: string;
      /** A1: the pending release was already linked to another post and cannot back this one. */
      detail?: "release_already_used";
    };

export interface BuildGenerationRequestInput {
  dealershipName: string;
  currentDealer: Dealer | null | undefined;
  /** Undefined, unknown or deleted scenario ids fail closed to POST_SCENARIOS[0]. */
  scenarioId: string;
  decodedVehicle: DecodedVehicle | null;
  capturedRelease: CapturedRelease | null;
  /**
   * A1 (amendments): a signed release is single-use — the link-post route binds it
   * to its first post permanently (409 on relink). When the caller knows the
   * pending release has already been linked, pass true and the builder demands
   * a fresh signature instead of reusing it.
   */
  releaseAlreadyLinked?: boolean;
  customerName: string;
  personalLine: string;
  creativeEnabled: boolean;
  /** resolved.style / resolved.tone from services/creativeSystem.ts's resolveCreative. */
  resolvedStyle: StyleOption;
  resolvedTone: ToneOption;
  playfulOffered: boolean;
  playfulRequested: boolean;
  playfulStyleId?: string | null;
  captionSource: CaptionSource;
  customMessage: string;
  effectivePlatformIds: PlatformId[];
  websiteSelected: boolean;
  effectiveImageProfile: PrimaryImageProfile;
  effectiveMediaMode: MediaOutputMode;
}

/**
 * The guard + brief-assembly body of PostCustomizer's handleGenerate, moved
 * verbatim. The caller still owns: triggerHapticFeedback, the isSubmitting
 * state, calling onGenerate with the returned args, clearing a stale
 * capturedRelease on release_mismatch, and the customizer.decisions telemetry
 * call (amendments B6).
 */
const buildRequest = (
  input: BuildGenerationRequestInput,
  savedPostRelease = false,
): BuildGenerationRequestResult => {
  const {
    dealershipName,
    currentDealer,
    scenarioId,
    decodedVehicle,
    capturedRelease: capturedReleaseInput,
    releaseAlreadyLinked = false,
    customerName,
    personalLine,
    creativeEnabled,
    resolvedStyle,
    resolvedTone,
    playfulOffered,
    playfulRequested,
    playfulStyleId,
    captionSource,
    customMessage,
    effectivePlatformIds,
    websiteSelected,
    effectiveImageProfile,
    effectiveMediaMode,
  } = input;

  // A3: an undefined/unknown/deleted scenario resolves to a scenario that
  // REQUIRES a release (today: POST_SCENARIOS[0]) — fail closed, never open.
  const activeScenario =
    getScenariosForDealer(currentDealer?.custom_scenarios).find(
      (scenario) => scenario.id === scenarioId,
    ) || POST_SCENARIOS[0];
  const scenarioNeedsCustomerRelease =
    activeScenario.requiresCustomer || activeScenario.category === "delivery";
  // A1: a release already linked to another post backs nothing. A scenario
  // that requires one asks for a fresh signature below; one that never needed
  // it drops the spent release here, so persistence never attempts a link
  // that is guaranteed to fail and lock the post.
  const capturedRelease =
    capturedReleaseInput && releaseAlreadyLinked && !scenarioNeedsCustomerRelease
      ? null
      : capturedReleaseInput;

  if (effectivePlatformIds.length === 0 && !websiteSelected) {
    return { ok: false, reason: "no_destination" };
  }
  if (scenarioNeedsCustomerRelease && !capturedRelease && !savedPostRelease) {
    return { ok: false, reason: "release_required" };
  }
  if (scenarioNeedsCustomerRelease && capturedRelease && releaseAlreadyLinked) {
    return {
      ok: false,
      reason: "release_required",
      detail: "release_already_used",
    };
  }
  if (
    capturedRelease &&
    (!releaseAuthorizesPublicLabel(capturedRelease.customerName, customerName) ||
      normalizeReleaseVin(capturedRelease.vin) !==
        normalizeReleaseVin(decodedVehicle?.vin))
  ) {
    // A signature is authority for one exact customer/vehicle pair. If
    // restored or stale UI state ever diverges, the caller discards it
    // before any provider request and requires a fresh acknowledgement.
    return { ok: false, reason: "release_mismatch" };
  }

  let preparedText: string | undefined;

  const styleAiHint = STYLE_AI_HINTS[resolvedStyle];
  const supportingBriefParts: string[] = [];

  const vehiclePhrase =
    decodedVehicle && !decodedVehicle.empty
      ? [
          decodedVehicle.year,
          decodedVehicle.make,
          decodedVehicle.model,
          decodedVehicle.trim,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;

  // Spec §4.5: the personal line rides in the brief as an appended sentence,
  // never as a replacement caption, and passes the same identity lock the
  // free-text caption path uses.
  const trimmedPersonalLine = creativeEnabled
    ? personalLine.trim().slice(0, PERSONAL_LINE_MAX)
    : "";
  if (trimmedPersonalLine) {
    if (
      !captionUsesOnlyExpectedCustomer(trimmedPersonalLine, customerName, {
        allowedPhrases: [dealershipName, currentDealer?.oem_affiliation, vehiclePhrase],
        rejectAnyCustomerIdentity: scenarioNeedsCustomerRelease && !customerName,
      })
    ) {
      return {
        ok: false,
        reason: "identity",
        message: customerName
          ? `Your personal line appears to name someone other than ${customerName}. Fix it before you create the post.`
          : "Your personal line names a customer, but no approved customer name is attached to this post. Remove the name or add the approved customer first name.",
      };
    }
    supportingBriefParts.push(
      `Personal line (append verbatim after the caption body): "${trimmedPersonalLine}"`,
    );
  }

  // Scenario context (Customer Delivery / Pre-Owned Spotlight / Service
  // Promo / etc). This goes near the top of the brief so it dominates the
  // default delivery-post framing where the scenarios diverge from it.
  // Custom dealer scenarios resolve via the dealer's custom_scenarios JSON.
  const scenarioBlock = scenarioToCreativeBrief(
    scenarioId,
    currentDealer?.custom_scenarios,
  );
  const platformBrief = platformsToCreativeBrief(effectivePlatformIds, dealershipName);

  // Inject decoded vehicle context if a VIN was scanned. This grounds the
  // model in concrete facts (year/make/model/trim/powertrain) so the caption
  // stops hallucinating equipment that isn't on the car.
  let vehicleBlock = "";
  if (decodedVehicle && !decodedVehicle.empty) {
    const vehicleBrief = vehicleToCreativeBrief(decodedVehicle);
    if (vehicleBrief) {
      vehicleBlock = `Vehicle facts (do not contradict): ${vehicleBrief}`;
    }
  }

  const oemBlock = currentDealer?.oem_affiliation?.trim()
    ? `OEM affiliation: ${currentDealer.oem_affiliation.trim()}. Respect that manufacturer's brand-guideline tone and avoid claims that conflict with their advertising standards.`
    : "";

  // Per-dealer brand voice / banned phrases / OEM affiliation. These come
  // from the dealers PocketBase record so each dealership can tune voice
  // without a code change.
  const voiceBlock = currentDealer?.brand_voice?.trim()
    ? `Brand voice (match this exactly): ${currentDealer.brand_voice.trim()}`
    : "";
  if (currentDealer?.banned_phrases?.trim()) {
    const banned = currentDealer.banned_phrases
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (banned.length > 0) {
      supportingBriefParts.push(
        `Forbidden phrases (do not use, even as a near-match): ${banned
          .map((p) => `"${p}"`)
          .join(", ")}.`,
      );
    }
  }

  // Identity context — tagline, website, address, hours give the model
  // grounded facts to weave in naturally (and never invent).
  const identityFacts: string[] = [];
  if (currentDealer?.tagline?.trim())
    identityFacts.push(`Tagline: "${currentDealer.tagline.trim()}"`);
  if (currentDealer?.website?.trim())
    identityFacts.push(`Website: ${currentDealer.website.trim()}`);
  if (currentDealer?.address?.trim())
    identityFacts.push(`Address: ${currentDealer.address.trim()}`);
  if (currentDealer?.hours?.trim())
    identityFacts.push(`Hours: ${currentDealer.hours.trim()}`);
  if (currentDealer?.phone?.trim())
    identityFacts.push(`Phone: ${currentDealer.phone.trim()}`);
  if (identityFacts.length > 0) {
    supportingBriefParts.push(
      `Dealership facts (may be referenced, never contradicted): ${identityFacts.join("; ")}.`,
    );
  }

  // Default hashtags + footer — sanitize to #PascalCase so IG/FB/TikTok
  // recognize every tag (spaces inside #tags break platforms).
  const dealerHashtags = (currentDealer?.default_hashtags || "")
    .split(/[\n,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => formatHashtag(h))
    .filter(Boolean);
  const brandTag = currentDealer?.name ? brandHashtagFromName(currentDealer.name) : "";
  const requiredTags = Array.from(
    new Set([brandTag, ...dealerHashtags].filter(Boolean)),
  );
  if (requiredTags.length > 0) {
    supportingBriefParts.push(
      `Required hashtags (each is one continuous #PascalCase token, space-separated on the last line): ${requiredTags.join(" ")}.`,
    );
  }
  const dealerFooter = (currentDealer?.default_footer || "").trim();
  if (dealerFooter) {
    supportingBriefParts.push(
      `Required footer (append verbatim AFTER the caption, BEFORE the hashtags): "${dealerFooter}"`,
    );
  }

  // Immutable scenario, dealer, vehicle, and OEM facts lead. Destination
  // guidance is useful but expendable when the prompt budget is full.
  const creativeBrief = composeGenerationCreativeBrief({
    dealershipName,
    scenarioBlock,
    vehicleBlock,
    oemBlock,
    designBlock: `Design DNA: ${styleAiHint}`,
    voiceBlock,
    supportingBlocks: supportingBriefParts,
    platformBlock: platformBrief,
  });

  // The free-text "Write my own" path is a legacy-only caption source. Under
  // the creative system the personal line above is the only typed copy, and
  // it never replaces the caption body.
  if (!creativeEnabled && captionSource === "custom" && customMessage.trim()) {
    if (
      !captionUsesOnlyExpectedCustomer(customMessage, customerName, {
        allowedPhrases: [dealershipName, currentDealer?.oem_affiliation, vehiclePhrase],
        rejectAnyCustomerIdentity: scenarioNeedsCustomerRelease && !customerName,
      })
    ) {
      return {
        ok: false,
        reason: "identity",
        message: customerName
          ? `This caption appears to name someone other than ${customerName}. Correct the caption before generating.`
          : "This caption names a customer, but no approved customer name is attached to this post. Remove the name or add the approved customer first name.",
      };
    }
    preparedText = customMessage.trim();
  }

  return {
    ok: true,
    args: {
      style: resolvedStyle,
      tone: resolvedTone,
      customerName,
      customText: preparedText,
      creativeBrief,
      meta: {
        vin: decodedVehicle?.vin,
        scenarioId,
        customerIdentityRequired: scenarioNeedsCustomerRelease,
        hasRelease: !!capturedRelease,
        capturedRelease: capturedRelease || undefined,
        websiteEnabled: websiteSelected,
        websiteVehicleDescription: vehiclePhrase,
        decodedVehicle: decodedVehicle || undefined,
        // Carries the dealership's single Playful style to the result step,
        // where it renders a second image beside the house-style master.
        playfulStyleId:
          playfulOffered && playfulRequested ? playfulStyleId || undefined : undefined,
      },
      platformIds: effectivePlatformIds,
      outputProfile: effectiveImageProfile,
      mediaOutputMode: effectiveMediaMode,
    },
  };
};

/** Creation always requires a fresh, single-use signature. */
export const buildGenerationRequest = (input: BuildGenerationRequestInput) =>
  buildRequest(input);

/** Image-only edits of the same durable post reuse its linked consent, never its signature.
 * Returns only appearance inputs so this path cannot create or link a new post.
 */
export const buildSavedPostLookRequest = (
  input: BuildGenerationRequestInput,
  post: GeneratedPost,
):
  | { ok: true; style: StyleOption; tone: ToneOption; creativeBrief: string }
  | { ok: false; message: string } => {
  const scenario = getScenariosForDealer(input.currentDealer?.custom_scenarios).find(
    (item) => item.id === input.scenarioId,
  );
  if (
    !post.postId ||
    !scenario ||
    post.scenarioId !== input.scenarioId ||
    post.historyReadOnly ||
    post.imageReviewRequired ||
    post.releaseLinkStatus ||
    ((scenario.requiresCustomer || scenario.category === "delivery") &&
      post.releaseStatus !== "saved")
  ) {
    return {
      ok: false,
      message:
        "This post needs its saved consent and original details before its Look can change.",
    };
  }
  const built = buildRequest(
    { ...input, capturedRelease: null, releaseAlreadyLinked: false },
    true,
  );
  if (!built.ok)
    return {
      ok: false,
      message: built.message || "Confirm the post details before changing its Look.",
    };
  return {
    ok: true,
    style: built.args.style,
    tone: built.args.tone,
    creativeBrief: built.args.creativeBrief,
  };
};
