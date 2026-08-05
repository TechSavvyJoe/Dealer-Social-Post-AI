import { z } from "@outputai/core";

import {
  EditPlanSchema,
  PackageEvaluationSchema,
  PreparedMediaSchema,
  RenderArtifactSchema,
  WorkflowIdentitySchema,
  YoutubeMetadataSchema,
} from "../../shared/schemas/walkaround.js";

export const ProducerInputSchema = WorkflowIdentitySchema;

export const ProducerOutputSchema = z.object({
  projectId: z.string(),
  productionState: z.literal("review_ready"),
  revision: z.number().int().nonnegative(),
  artifacts: z.array(RenderArtifactSchema),
  editPlan: EditPlanSchema,
  metadata: YoutubeMetadataSchema,
  evaluation: PackageEvaluationSchema,
  warnings: z.array(z.string()),
});

export const ProviderReservationSchema = z.object({
  requestKey: z.string(),
  providerJobId: z.string().optional(),
  status: z.string(),
  revision: z.number().int().nonnegative(),
});

export const RenderSubmissionSchema = z.object({
  providerJobId: z.string(),
  requestKey: z.string(),
});

export const RenderStatusSchema = z.object({
  status: z.enum(["queued", "rendering", "done", "failed"]),
  url: z.string().url().optional(),
  error: z.string().optional(),
});

export const AudioSubmissionSchema = z.object({
  providerJobId: z.string(),
  requestKey: z.string(),
});

export const AudioStatusSchema = z.object({
  status: z.enum(["queued", "processing", "done", "failed"]),
  url: z.string().url().optional(),
  error: z.string().optional(),
});

export const FinalPackageSchema = z.object({
  artifacts: z.array(RenderArtifactSchema),
  transcriptAssetId: z.string(),
  captionsAssetId: z.string(),
  thumbnailAssetId: z.string(),
  deterministicQc: z.object({
    passed: z.boolean(),
    reasons: z.array(z.string()),
  }),
});

export {
  EditPlanSchema,
  PackageEvaluationSchema,
  PreparedMediaSchema,
  YoutubeMetadataSchema,
};

export type ProducerInput = z.infer<typeof ProducerInputSchema>;
export type ProducerOutput = z.infer<typeof ProducerOutputSchema>;
