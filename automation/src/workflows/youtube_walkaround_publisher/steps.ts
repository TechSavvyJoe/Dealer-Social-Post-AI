import { FatalError, step, z } from "@outputai/core";

import { assertRevision, backend } from "../../shared/clients/backend.js";
import {
  PublicationContextSchema,
  PublisherInputSchema,
  UploadProgressSchema,
  YoutubeStatusSchema,
  type PublicationContext,
} from "./types.js";

const EventResultSchema = z.object({ revision: z.number().int().nonnegative() });

export function validatePublicationContext(context: PublicationContext): void {
  if (!context.channel.connected)
    throw new FatalError("The dealer YouTube channel is not connected");
  if (!context.consent.youtube)
    throw new FatalError("Current YouTube publication consent is required");
  if (!context.approval.approved)
    throw new FatalError("Explicit review approval is required before publication");
  if (
    context.approval.masterSha256 !== context.master.sha256 ||
    context.approval.metadataRevision !== context.metadataRevision
  ) {
    throw new FatalError(
      "Approval does not match the current master and metadata revision",
    );
  }
  if (context.approvalRequired && !context.approval.approverId) {
    throw new FatalError("Manager approval is required by dealer policy");
  }
  if (context.mode === "customer" && context.requestedVisibility !== "unlisted") {
    throw new FatalError("Customer walkarounds may only be published as unlisted");
  }
  if (
    context.requestedVisibility === "public" &&
    (context.mode !== "inventory" || !context.availabilityAttestationId)
  ) {
    throw new FatalError(
      "Public inventory publication requires a current availability attestation",
    );
  }
}

export const loadPublicationContext = step({
  name: "load_walkaround_publication_context",
  description:
    "Load trusted approval, master, metadata, visibility, and dealer channel context",
  inputSchema: PublisherInputSchema,
  outputSchema: PublicationContextSchema,
  fn: async (input) => {
    const parsed = PublicationContextSchema.parse(
      await backend.publicationContext<PublicationContext>(input.projectId),
    );
    assertRevision(parsed.revision, input.expectedRevision);
    validatePublicationContext(parsed);
    return parsed;
  },
});

export const recordPublicationState = step({
  name: "record_walkaround_publication_state",
  description: "Persist an idempotent publication state transition",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    publicationState: z.string(),
    publicationJson: z.string().optional(),
  }),
  outputSchema: EventResultSchema,
  fn: (input) => {
    const publication = input.publicationJson
      ? (JSON.parse(input.publicationJson) as Record<string, unknown>)
      : {};
    return backend.publicationEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "state_transition",
        publicationState: input.publicationState,
        ...publication,
      },
      input.eventId,
    );
  },
});

export const recordPublicationFailure = step({
  name: "record_walkaround_publication_failure",
  description: "Persist a redacted failed or reconciliation-required publication state",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    publicationState: z.enum(["reconciliation_required", "failed"]),
    errorCode: z.string().regex(/^[A-Z0-9_]+$/),
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.publicationEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "state_transition",
        publicationState: input.publicationState,
        redactedError: { code: input.errorCode },
      },
      input.eventId,
    ),
});

export const createPrivateYoutubeUpload = step({
  name: "create_private_youtube_upload",
  description:
    "Have the backend create and persist one private resumable YouTube upload session",
  inputSchema: z.object({
    context: PublicationContextSchema,
    workflowId: z.string(),
    expectedRevision: z.number(),
    requestKey: z.string(),
  }),
  outputSchema: UploadProgressSchema,
  fn: (input) =>
    backend.createYoutubeUpload(
      input.context.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        masterSha256: input.context.master.sha256,
        metadataRevision: input.context.metadataRevision,
        title: input.context.metadata.title,
        description: input.context.metadata.description,
        tags: input.context.metadata.tags,
        madeForKids: input.context.madeForKids,
        privacyStatus: "private",
      },
      input.requestKey,
    ),
});

export const uploadNextYoutubeChunk = step({
  name: "upload_next_youtube_chunk",
  description:
    "Ask the backend to upload and durably acknowledge the next canonical media chunk",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    providerJobId: z.string(),
    nextOffset: z.number().int().nonnegative(),
  }),
  outputSchema: UploadProgressSchema,
  fn: (input) =>
    backend.uploadYoutubeNext(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        providerJobId: input.providerJobId,
      },
      `${input.workflowId}:youtube:chunk:${input.nextOffset}`,
    ),
});

export const getYoutubeProcessingStatus = step({
  name: "get_youtube_processing_status",
  description:
    "Re-fetch authoritative YouTube processing and playback status through the backend",
  inputSchema: z.object({ projectId: z.string(), videoId: z.string() }),
  outputSchema: YoutubeStatusSchema,
  fn: (input) => backend.youtubeStatus(input.projectId, input.videoId),
});

export const publishYoutubeVisibility = step({
  name: "publish_youtube_visibility",
  description: "Change a verified private video to the approved final visibility",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    videoId: z.string(),
    visibility: z.enum(["unlisted", "public"]),
    availabilityAttestationId: z.string().optional(),
  }),
  outputSchema: YoutubeStatusSchema.extend({
    revision: z.number().int().nonnegative(),
  }),
  fn: (input) =>
    backend.youtubeVisibility(
      input.projectId,
      input.videoId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        visibility: input.visibility,
        availabilityAttestationId: input.availabilityAttestationId,
      },
      `${input.workflowId}:youtube:visibility:${input.visibility}`,
    ),
});
