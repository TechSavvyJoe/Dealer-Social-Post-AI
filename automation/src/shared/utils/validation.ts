import { FatalError, ValidationError } from "@outputai/core";

import type {
  EditPlan,
  PreparedMedia,
  ProductionContext,
  YoutubeMetadata,
} from "../schemas/walkaround.js";

export const MAX_CLIPS = 12;
export const MAX_DURATION_SECONDS = 20 * 60;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;

export function validateProductionContext(context: ProductionContext): void {
  if (context.assets.length < 1 || context.assets.length > MAX_CLIPS) {
    throw new ValidationError(`Walkaround must contain 1-${MAX_CLIPS} finalized clips`);
  }

  const ordered = [...context.assets].sort((left, right) => left.order - right.order);
  const firstOrder = ordered[0]?.order;
  if (
    (firstOrder !== 0 && firstOrder !== 1) ||
    ordered.some((asset, index) => asset.order !== firstOrder + index)
  ) {
    throw new ValidationError("Source clip ordering must be contiguous");
  }

  const totalBytes = context.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  const totalDuration = context.assets.reduce(
    (sum, asset) => sum + asset.durationSeconds,
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES || totalDuration > MAX_DURATION_SECONDS) {
    throw new ValidationError(
      "Walkaround exceeds the 10 GB or 20 minute processing boundary",
    );
  }

  if (!context.consent.video || !context.consent.cloudProcessing) {
    throw new FatalError("Current video and cloud-processing consent is required");
  }
  if (context.consent.identifiableNonEmployee && !context.consent.voice) {
    throw new FatalError("Voice consent is required for identifiable non-employees");
  }
  if (
    context.music.enabled &&
    (!context.music.assetId || !context.music.licenseId || !context.music.renderUrl)
  ) {
    throw new FatalError(
      "Enabled music must reference a manager-approved licensed asset",
    );
  }
}

export function validateEditPlan(
  plan: EditPlan,
  media: PreparedMedia,
  bannedPhrases: string[],
): EditPlan {
  const sources = new Map(
    media.normalizedAssets.map((asset) => [asset.sourceAssetId, asset]),
  );
  const ordered = plan.clips.every((clip, index) => {
    const previous = plan.clips[index - 1];
    if (!previous) return true;
    const previousSourceIndex = media.normalizedAssets.findIndex(
      (asset) => asset.sourceAssetId === previous.sourceAssetId,
    );
    const sourceIndex = media.normalizedAssets.findIndex(
      (asset) => asset.sourceAssetId === clip.sourceAssetId,
    );
    return (
      sourceIndex > previousSourceIndex ||
      (sourceIndex === previousSourceIndex &&
        clip.sourceStartSeconds >= previous.sourceStartSeconds)
    );
  });
  if (!ordered || plan.clips.length === 0) {
    throw new ValidationError(
      "Edit plan must preserve source chronology and contain at least one clip",
    );
  }

  for (const clip of plan.clips) {
    const source = sources.get(clip.sourceAssetId);
    if (
      !source ||
      clip.sourceStartSeconds < 0 ||
      clip.sourceEndSeconds <= clip.sourceStartSeconds ||
      clip.sourceEndSeconds > source.durationSeconds
    ) {
      throw new ValidationError("Edit plan references an invalid source interval");
    }
  }

  const forbidden = bannedPhrases.map((phrase) => phrase.toLocaleLowerCase());
  for (const overlay of plan.overlays) {
    if (forbidden.some((phrase) => overlay.text.toLocaleLowerCase().includes(phrase))) {
      throw new ValidationError("Edit plan contains a dealer-banned overlay phrase");
    }
  }
  const teaserDuration = plan.teaserClipIndexes.reduce((total, index) => {
    const clip = plan.clips[index];
    if (!clip) throw new ValidationError("Teaser references an invalid clip index");
    return total + clip.sourceEndSeconds - clip.sourceStartSeconds;
  }, 0);
  if (teaserDuration > 30)
    throw new ValidationError("Teaser selection exceeds 30 seconds");
  return plan;
}

export function validateMetadata(
  metadata: YoutubeMetadata,
  bannedPhrases: string[],
): YoutubeMetadata {
  const combined =
    `${metadata.title}\n${metadata.description}\n${metadata.tags.join(" ")}`.toLocaleLowerCase();
  const alwaysForbidden = [
    "monthly payment",
    "apr",
    "guaranteed",
    "clean carfax",
    "accident free",
  ];
  if (
    [
      ...alwaysForbidden,
      ...bannedPhrases.map((phrase) => phrase.toLocaleLowerCase()),
    ].some((phrase) => combined.includes(phrase))
  ) {
    throw new ValidationError(
      "Generated metadata contains a prohibited or unsupported claim",
    );
  }
  return metadata;
}
