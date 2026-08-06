import { z } from "@outputai/core";

export const WorkflowIdentitySchema = z.object({
  projectId: z.string().min(1),
  workflowId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
});

export const AudienceModeSchema = z.enum(["customer", "inventory"]);

export const ProviderJobSchema = z.object({
  kind: z.string(),
  requestKey: z.string(),
  providerJobId: z.string().optional(),
  status: z.string(),
});

export const SourceAssetSchema = z.object({
  id: z.string(),
  order: z.number().int().min(0),
  gcsUri: z.string().startsWith("gs://"),
  mimeType: z.enum(["video/quicktime", "video/mp4", "video/webm"]),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  finalized: z.literal(true),
});

export const ProductionContextSchema = z.object({
  projectId: z.string(),
  revision: z.number().int().nonnegative(),
  dealerId: z.string(),
  ownerId: z.string(),
  mode: AudienceModeSchema,
  productionState: z.string(),
  vehicleSnapshot: z.record(z.string(), z.string()),
  branding: z.record(z.string(), z.unknown()),
  bannedPhrases: z.array(z.string()),
  editInstructions: z.string().max(4000).optional(),
  captionsText: z.string().max(30000).optional(),
  music: z.object({
    enabled: z.boolean(),
    assetId: z.string().optional(),
    licenseId: z.string().optional(),
    renderUrl: z.string().url().optional(),
  }),
  consent: z.object({
    version: z.string(),
    video: z.boolean(),
    voice: z.boolean(),
    cloudProcessing: z.boolean(),
    youtube: z.boolean(),
    identifiableNonEmployee: z.boolean(),
  }),
  approvalRequired: z.boolean(),
  assets: z.array(SourceAssetSchema),
  providerJobs: z.array(ProviderJobSchema),
});

export const TranscriptSegmentSchema = z.object({
  sourceAssetId: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  text: z.string(),
  speaker: z.string().optional(),
});

export const PreparedMediaSchema = z.object({
  normalizedAssets: z.array(
    z.object({
      sourceAssetId: z.string(),
      gcsUri: z.string().startsWith("gs://"),
      durationSeconds: z.number().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().positive(),
      videoCodec: z.string(),
      audioCodec: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      renderUrl: z.string().url(),
    }),
  ),
  transcript: z.array(TranscriptSegmentSchema),
  measurements: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
});

export const EditDecisionSchema = z.object({
  sourceAssetId: z.string().describe("ID of an input source asset"),
  sourceStartSeconds: z.number().describe("Inclusive clip start within the source"),
  sourceEndSeconds: z.number().describe("Exclusive clip end within the source"),
  reason: z.string().describe("Grounded reason for retaining this interval"),
});

export const EditPlanSchema = z.object({
  clips: z
    .array(EditDecisionSchema)
    .describe("Chronological evidence-linked retained clips"),
  omissions: z.array(
    z.object({
      sourceAssetId: z.string(),
      sourceStartSeconds: z.number(),
      sourceEndSeconds: z.number(),
      reason: z.string(),
    }),
  ),
  overlays: z.array(
    z.object({
      text: z.string(),
      evidence: z.string(),
      atSeconds: z.number(),
      durationSeconds: z.number(),
    }),
  ),
  chapters: z.array(
    z.object({
      title: z.string(),
      atSeconds: z.number(),
    }),
  ),
  teaserClipIndexes: z.array(z.number()),
  warnings: z.array(z.string()),
});

export const RenderArtifactSchema = z.object({
  kind: z.enum([
    "proxy",
    "transcript",
    "edit_plan",
    "master",
    "teaser",
    "captions",
    "thumbnail",
  ]),
  storageKey: z.string(),
  storageGeneration: z.string().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const YoutubeMetadataSchema = z.object({
  title: z
    .string()
    .describe("Accurate specific YouTube title without unsupported claims"),
  description: z
    .string()
    .describe("Grounded description safe to share with the intended audience"),
  tags: z.array(z.string()).describe("Relevant non-sensitive tags"),
  chapters: z.array(
    z.object({
      title: z.string(),
      atSeconds: z.number(),
    }),
  ),
  thumbnailCopy: z.string(),
  claimEvidence: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
    }),
  ),
});

export const PackageEvaluationSchema = z.object({
  groundingPassed: z.boolean(),
  privacyPassed: z.boolean(),
  continuityPassed: z.boolean(),
  audioPassed: z.boolean(),
  visualPassed: z.boolean(),
  youtubeReady: z.boolean(),
  reasons: z.array(z.string()),
  reshootRequired: z.boolean(),
});

export type WorkflowIdentity = z.infer<typeof WorkflowIdentitySchema>;
export type ProductionContext = z.infer<typeof ProductionContextSchema>;
export type PreparedMedia = z.infer<typeof PreparedMediaSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type RenderArtifact = z.infer<typeof RenderArtifactSchema>;
export type YoutubeMetadata = z.infer<typeof YoutubeMetadataSchema>;
export type PackageEvaluation = z.infer<typeof PackageEvaluationSchema>;
