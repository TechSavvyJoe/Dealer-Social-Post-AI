import { z } from "@outputai/core";

import {
  AudienceModeSchema,
  WorkflowIdentitySchema,
  YoutubeMetadataSchema,
} from "../../shared/schemas/walkaround.js";

export const PublisherInputSchema = WorkflowIdentitySchema;

export const PublicationContextSchema = z.object({
  projectId: z.string(),
  revision: z.number().int().nonnegative(),
  dealerId: z.string(),
  ownerId: z.string(),
  mode: AudienceModeSchema,
  productionState: z.literal("review_ready"),
  publicationState: z.string(),
  consent: z.object({
    version: z.string(),
    youtube: z.boolean(),
  }),
  approvalRequired: z.boolean(),
  approval: z.object({
    approved: z.boolean(),
    masterSha256: z.string(),
    metadataRevision: z.number().int().nonnegative(),
    approverId: z.string().optional(),
  }),
  master: z.object({
    assetId: z.string(),
    gcsUri: z.string().startsWith("gs://"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
  }),
  metadataRevision: z.number().int().nonnegative(),
  metadata: YoutubeMetadataSchema,
  madeForKids: z.boolean(),
  requestedVisibility: z.enum(["unlisted", "public"]),
  availabilityAttestationId: z.string().optional(),
  channel: z.object({
    connected: z.boolean(),
    channelId: z.string(),
    title: z.string(),
  }),
  providerJob: z
    .object({
      requestKey: z.string(),
      providerJobId: z.string(),
      status: z.string(),
      nextOffset: z.number().int().nonnegative().optional(),
      videoId: z.string().optional(),
    })
    .optional(),
});

export const UploadProgressSchema = z.object({
  providerJobId: z.string(),
  state: z.enum(["reserved", "uploading", "processing"]),
  nextOffset: z.number().int().nonnegative(),
  videoId: z.string().optional(),
  revision: z.number().int().nonnegative(),
});

export const YoutubeStatusSchema = z.object({
  uploadStatus: z.string(),
  processingStatus: z.enum(["processing", "succeeded", "failed"]),
  playbackVerified: z.boolean(),
  privacyStatus: z.enum(["private", "unlisted", "public"]),
  revision: z.number().int().nonnegative().optional(),
});

export const PublisherOutputSchema = z.object({
  projectId: z.string(),
  publicationState: z.enum(["published_unlisted", "published_public"]),
  revision: z.number().int().nonnegative(),
  videoId: z.string(),
  visibility: z.enum(["unlisted", "public"]),
  shareUrl: z.string().url(),
  channelId: z.string(),
  channelTitle: z.string(),
});

export type PublisherInput = z.infer<typeof PublisherInputSchema>;
export type PublisherOutput = z.infer<typeof PublisherOutputSchema>;
export type PublicationContext = z.infer<typeof PublicationContextSchema>;
