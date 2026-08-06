import { FatalError, sleep, workflow } from "@outputai/core";

import {
  createPrivateYoutubeUpload,
  getYoutubeProcessingStatus,
  loadPublicationContext,
  publishYoutubeVisibility,
  recordPublicationFailure,
  recordPublicationState,
  uploadNextYoutubeChunk,
} from "./steps.js";
import {
  PublisherInputSchema,
  PublisherOutputSchema,
  type PublisherInput,
  type PublisherOutput,
} from "./types.js";

export default workflow({
  name: "youtube_walkaround_publisher",
  description:
    "Publishes an exactly approved walkaround through private upload, processing verification, and final visibility",
  inputSchema: PublisherInputSchema,
  outputSchema: PublisherOutputSchema,
  options: {
    activityOptions: {
      startToCloseTimeout: "10m",
      retry: {
        maximumAttempts: 3,
        initialInterval: "1s",
        maximumInterval: "10s",
        backoffCoefficient: 2,
      },
    },
  },
  fn: async (input: PublisherInput): Promise<PublisherOutput> => {
    const context = await loadPublicationContext(input);
    if (context.providerJob?.status === "reconciliation_required") {
      throw new FatalError("YouTube upload requires provider reconciliation");
    }
    const uploading = await recordPublicationState({
      ...input,
      eventId: `${input.workflowId}:uploading-private`,
      publicationState: "uploading_private",
    });
    const uploadKey = `${input.workflowId}:youtube:upload:v1`;
    const resumableProcessing =
      !!context.providerJob?.videoId &&
      ["processing", "succeeded"].includes(context.providerJob.status);
    const initialUpload = context.providerJob
      ? {
          providerJobId: context.providerJob.providerJobId,
          state: resumableProcessing ? ("processing" as const) : ("uploading" as const),
          nextOffset: context.providerJob.nextOffset ?? 0,
          videoId: context.providerJob.videoId,
          revision: uploading.revision,
        }
      : await createPrivateYoutubeUpload({
          context,
          workflowId: input.workflowId,
          expectedRevision: uploading.revision,
          requestKey: uploadKey,
        }).catch(async (error) => {
          await recordPublicationFailure({
            ...input,
            expectedRevision: uploading.revision,
            eventId: `${input.workflowId}:upload-session-ambiguous`,
            publicationState: "reconciliation_required",
            errorCode: "YOUTUBE_SESSION_AMBIGUOUS",
          });
          throw error;
        });

    const uploadStates = [initialUpload];
    for (const attempt of Array.from({ length: 2048 }, (_, index) => index)) {
      const current = uploadStates.at(-1);
      if (!current) throw new FatalError("YouTube upload progress was lost");
      if (current.state === "processing") break;
      const next = await uploadNextYoutubeChunk({
        projectId: input.projectId,
        workflowId: input.workflowId,
        expectedRevision: current.revision,
        providerJobId: current.providerJobId,
        nextOffset: current.nextOffset,
      }).catch(async (error) => {
        await recordPublicationFailure({
          ...input,
          expectedRevision: current.revision,
          eventId: `${input.workflowId}:upload-chunk-ambiguous:${current.nextOffset}`,
          publicationState: "reconciliation_required",
          errorCode: "YOUTUBE_CHUNK_AMBIGUOUS",
        });
        throw error;
      });
      uploadStates.push(next);
      if (attempt === 2047)
        throw new FatalError("YouTube upload exceeded the bounded chunk count");
    }
    const uploaded = uploadStates.at(-1);
    if (!uploaded?.videoId || uploaded.state !== "processing") {
      throw new FatalError("YouTube upload did not reach processing with a video ID");
    }

    const processing = await recordPublicationState({
      ...input,
      expectedRevision: uploaded.revision,
      eventId: `${input.workflowId}:processing`,
      publicationState: "processing",
      publicationJson: JSON.stringify({
        videoId: uploaded.videoId,
        actualVisibility: "private",
      }),
    });
    const statuses = [];
    for (const attempt of Array.from({ length: 180 }, (_, index) => index)) {
      const status = await getYoutubeProcessingStatus({
        projectId: input.projectId,
        videoId: uploaded.videoId,
      });
      statuses.push(status);
      if (status.processingStatus === "failed") {
        await recordPublicationFailure({
          ...input,
          expectedRevision: processing.revision,
          eventId: `${input.workflowId}:processing-failed`,
          publicationState: "failed",
          errorCode: "YOUTUBE_PROCESSING_FAILED",
        });
        throw new FatalError("YouTube processing failed");
      }
      if (status.processingStatus === "succeeded" && status.playbackVerified) break;
      if (attempt === 179) {
        await recordPublicationFailure({
          ...input,
          expectedRevision: processing.revision,
          eventId: `${input.workflowId}:processing-timeout`,
          publicationState: "failed",
          errorCode: "YOUTUBE_PROCESSING_TIMEOUT",
        });
        throw new FatalError("YouTube processing exceeded the 30 minute wait boundary");
      }
      await sleep("10s");
    }
    const verified = statuses.at(-1);
    if (!verified?.playbackVerified || verified.processingStatus !== "succeeded") {
      await recordPublicationFailure({
        ...input,
        expectedRevision: processing.revision,
        eventId: `${input.workflowId}:playback-unverified`,
        publicationState: "failed",
        errorCode: "YOUTUBE_PLAYBACK_UNVERIFIED",
      });
      throw new FatalError("YouTube playback could not be verified");
    }

    const publishing = await recordPublicationState({
      ...input,
      expectedRevision: processing.revision,
      eventId: `${input.workflowId}:publishing`,
      publicationState: "publishing",
    });
    const visible = await publishYoutubeVisibility({
      projectId: input.projectId,
      workflowId: input.workflowId,
      expectedRevision: publishing.revision,
      videoId: uploaded.videoId,
      visibility: context.requestedVisibility,
      availabilityAttestationId: context.availabilityAttestationId,
    }).catch(async (error) => {
      await recordPublicationFailure({
        ...input,
        expectedRevision: publishing.revision,
        eventId: `${input.workflowId}:visibility-failed`,
        publicationState: "failed",
        errorCode: "YOUTUBE_VISIBILITY_FAILED",
      });
      throw error;
    });
    if (
      visible.privacyStatus !== context.requestedVisibility ||
      !visible.playbackVerified
    ) {
      await recordPublicationFailure({
        ...input,
        expectedRevision: visible.revision,
        eventId: `${input.workflowId}:visibility-mismatch`,
        publicationState: "failed",
        errorCode: "YOUTUBE_VISIBILITY_MISMATCH",
      });
      throw new FatalError(
        "Final YouTube visibility or playback verification did not match the approved target",
      );
    }
    const finalState =
      context.requestedVisibility === "public"
        ? ("published_public" as const)
        : ("published_unlisted" as const);
    const published = await recordPublicationState({
      ...input,
      expectedRevision: visible.revision,
      eventId: `${input.workflowId}:${finalState}`,
      publicationState: finalState,
      publicationJson: JSON.stringify({
        videoId: uploaded.videoId,
        actualVisibility: context.requestedVisibility,
        playbackVerified: true,
      }),
    });
    return {
      projectId: input.projectId,
      publicationState: finalState,
      revision: published.revision,
      videoId: uploaded.videoId,
      visibility: context.requestedVisibility,
      shareUrl: `https://youtu.be/${uploaded.videoId}`,
      channelId: context.channel.channelId,
      channelTitle: context.channel.title,
    };
  },
});
