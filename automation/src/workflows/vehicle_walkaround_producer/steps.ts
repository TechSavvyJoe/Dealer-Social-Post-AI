import { FatalError, step, z } from "@outputai/core";
import { generateText, Output } from "@outputai/llm";

import {
  submitAuphonicProduction,
  startAuphonicProduction,
  getAuphonicProduction,
} from "../../shared/clients/auphonic.js";
import { assertRevision, backend } from "../../shared/clients/backend.js";
import { mediaWorker } from "../../shared/clients/media_worker.js";
import {
  getShotstackRender,
  submitShotstackRender,
} from "../../shared/clients/shotstack.js";
import {
  ProductionContextSchema,
  type ProductionContext,
} from "../../shared/schemas/walkaround.js";
import {
  validateEditPlan,
  validateMetadata,
  validateProductionContext,
} from "../../shared/utils/validation.js";
import {
  AudioStatusSchema,
  AudioSubmissionSchema,
  EditPlanSchema,
  FinalPackageSchema,
  PackageEvaluationSchema,
  PreparedMediaSchema,
  ProducerInputSchema,
  ProviderReservationSchema,
  RenderStatusSchema,
  RenderSubmissionSchema,
  YoutubeMetadataSchema,
} from "./types.js";

const EventResultSchema = z.object({ revision: z.number().int().nonnegative() });

export const loadProductionContext = step({
  name: "load_production_context",
  description: "Load trusted dealer, consent, vehicle, branding, and asset context",
  inputSchema: ProducerInputSchema,
  outputSchema: ProductionContextSchema,
  fn: async (input) => {
    const context = await backend.productionContext<ProductionContext>(input.projectId);
    const parsed = ProductionContextSchema.parse(context);
    assertRevision(parsed.revision, input.expectedRevision);
    validateProductionContext(parsed);
    return parsed;
  },
});

export const recordProductionState = step({
  name: "record_production_state",
  description: "Persist an idempotent production state transition",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    productionState: z.string(),
    payloadJson: z.string().optional(),
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "state_transition",
        productionState: input.productionState,
        payload: input.payloadJson ? JSON.parse(input.payloadJson) : undefined,
      },
      input.eventId,
    ),
});

export const recordProductionFailure = step({
  name: "record_production_failure",
  description: "Persist a fail-closed redacted production failure state",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    productionState: z.enum(["retryable_failed", "terminal_failed"]),
    errorCode: z.string().regex(/^[A-Z0-9_]+$/),
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "state_transition",
        productionState: input.productionState,
        redactedError: { code: input.errorCode },
      },
      input.eventId,
    ),
});

export const reserveProductionJob = step({
  name: "reserve_production_provider_job",
  description: "Persist the paid-operation request key before contacting a provider",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    kind: z.string(),
    requestKey: z.string(),
  }),
  outputSchema: ProviderReservationSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: `reserve:${input.requestKey}`,
        type: "provider_job_reserved",
        providerJob: {
          kind: input.kind,
          requestKey: input.requestKey,
          status: "reserved",
        },
      },
      `reserve:${input.requestKey}`,
    ),
});

export const recordProductionJobAccepted = step({
  name: "record_production_provider_job_accepted",
  description:
    "Persist a provider job identifier immediately after provider acceptance",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    kind: z.string(),
    requestKey: z.string(),
    providerJobId: z.string(),
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: `accepted:${input.requestKey}`,
        type: "provider_job_accepted",
        providerJob: {
          kind: input.kind,
          requestKey: input.requestKey,
          providerJobId: input.providerJobId,
          status: "accepted",
        },
      },
      `accepted:${input.requestKey}`,
    ),
});

export const recordProductionArtifact = step({
  name: "record_production_artifact",
  description: "Persist one verified private artifact with an idempotent event",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    artifact: FinalPackageSchema.shape.artifacts.element,
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "artifact_ready",
        productionState: "quality_check",
        artifact: {
          ...input.artifact,
          mime: input.artifact.mimeType,
        },
      },
      input.eventId,
    ),
});

export const recordReviewReadyPackage = step({
  name: "record_review_ready_package",
  description: "Persist grounded metadata and QC at the review-ready transition",
  inputSchema: z.object({
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
    eventId: z.string(),
    metadata: YoutubeMetadataSchema,
    evaluation: PackageEvaluationSchema,
  }),
  outputSchema: EventResultSchema,
  fn: (input) =>
    backend.productionEvent(
      input.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        type: "review_ready",
        productionState: "review_ready",
        metadata: {
          ...input.metadata,
          madeForKids: false,
        },
        qc: {
          passed: true,
          summary: input.evaluation,
        },
      },
      input.eventId,
    ),
});

export const prepareWalkaroundMedia = step({
  name: "prepare_walkaround_media",
  description:
    "Malware-check, probe, normalize, measure, and transcribe finalized media",
  inputSchema: z.object({
    context: ProductionContextSchema,
    requestKey: z.string(),
  }),
  outputSchema: PreparedMediaSchema,
  fn: async ({ context, requestKey }) =>
    PreparedMediaSchema.parse(
      await mediaWorker.prepare(
        {
          projectId: context.projectId,
          sources: context.assets,
          output: {
            normalizeVideo: true,
            transcribe: true,
            normalizeHdr: true,
            normalizeVariableFrameRate: true,
            malwareScan: true,
          },
        },
        requestKey,
      ),
    ),
});

export const planWalkaroundEdit = step({
  name: "plan_walkaround_edit",
  description: "Create a conservative evidence-linked edit decision list",
  inputSchema: z.object({
    context: ProductionContextSchema,
    media: PreparedMediaSchema,
    workflowId: z.string(),
    expectedRevision: z.number(),
    requestKey: z.string(),
  }),
  outputSchema: EditPlanSchema,
  options: {
    activityOptions: { startToCloseTimeout: "10m", retry: { maximumAttempts: 1 } },
  },
  fn: async ({ context, media, workflowId, expectedRevision, requestKey }) => {
    const generated = await generateText({
      prompt: "plan_walkaround_edit@v1",
      variables: {
        mode: context.mode,
        vehicle_json: JSON.stringify(context.vehicleSnapshot),
        transcript_json: JSON.stringify(media.transcript),
        measurements_json: JSON.stringify(media.measurements),
        sources_json: JSON.stringify(media.normalizedAssets),
        banned_phrases_json: JSON.stringify(context.bannedPhrases),
        edit_instructions: context.editInstructions ?? "",
        caption_corrections: context.captionsText ?? "",
      },
      output: Output.object({ schema: EditPlanSchema }),
    }).catch(async (error) => {
      await backend.productionEvent(
        context.projectId,
        {
          workflowId,
          expectedRevision,
          eventId: `reconcile:${requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_edit_plan",
            requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_EDIT_AMBIGUOUS" },
        },
        `reconcile:${requestKey}`,
      );
      throw error;
    });
    if (!generated.response.id) {
      await backend.productionEvent(
        context.projectId,
        {
          workflowId,
          expectedRevision,
          eventId: `reconcile:${requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_edit_plan",
            requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_RESPONSE_ID_MISSING" },
        },
        `reconcile:${requestKey}`,
      );
      throw new FatalError("Vertex completed without a provider response ID");
    }
    await backend.productionEvent(
      context.projectId,
      {
        workflowId,
        expectedRevision,
        eventId: `accepted:${requestKey}`,
        type: "provider_job_accepted",
        providerJob: {
          kind: "vertex_edit_plan",
          requestKey,
          providerJobId: generated.response.id,
          status: "completed",
        },
      },
      `accepted:${requestKey}`,
    );
    return validateEditPlan(generated.output, media, context.bannedPhrases);
  },
});

export const submitWalkaroundRender = step({
  name: "submit_walkaround_render",
  description: "Submit deterministic master and teaser timelines to Shotstack",
  inputSchema: z.object({
    context: ProductionContextSchema,
    media: PreparedMediaSchema,
    editPlan: EditPlanSchema,
    format: z.enum(["master", "teaser"]),
    requestKey: z.string(),
    existingProviderJobId: z.string().optional(),
    workflowId: z.string(),
    expectedRevision: z.number(),
  }),
  outputSchema: RenderSubmissionSchema,
  fn: async (input) => {
    if (input.existingProviderJobId) {
      return {
        providerJobId: input.existingProviderJobId,
        requestKey: input.requestKey,
      };
    }
    const selected =
      input.format === "master"
        ? input.editPlan.clips
        : input.editPlan.clips.filter((_, index) =>
            input.editPlan.teaserClipIndexes.includes(index),
          );
    const clips = selected.map((clip, index) => {
      const source = input.media.normalizedAssets.find(
        (asset) => asset.sourceAssetId === clip.sourceAssetId,
      );
      if (!source) throw new FatalError("Render clip lost its normalized source");
      const start = selected
        .slice(0, index)
        .reduce(
          (total, prior) => total + prior.sourceEndSeconds - prior.sourceStartSeconds,
          0,
        );
      return {
        asset: { type: "video", src: source.renderUrl, trim: clip.sourceStartSeconds },
        start,
        length: clip.sourceEndSeconds - clip.sourceStartSeconds,
        transition: { in: "fade", out: "fade" },
      };
    });
    const overlayClips = input.editPlan.overlays.map((overlay) => ({
      asset: {
        type: "title",
        text: overlay.text,
        style: "minimal",
        position: "bottom",
      },
      start: overlay.atSeconds,
      length: overlay.durationSeconds,
      transition: { in: "fade", out: "fade" },
    }));
    try {
      const response = await submitShotstackRender(
        {
          timeline: {
            background: "#000000",
            soundtrack: input.context.music.enabled
              ? {
                  src: input.context.music.renderUrl,
                  volume: 0.08,
                  effect: "fadeInFadeOut",
                }
              : undefined,
            tracks: [{ clips: overlayClips }, { clips }],
          },
          output: {
            format: "mp4",
            resolution: "1080",
            aspectRatio: input.format === "master" ? "16:9" : "9:16",
            fps: 30,
          },
          callback: false,
        },
        input.requestKey,
      );
      return { providerJobId: response.id, requestKey: input.requestKey };
    } catch (error: unknown) {
      await backend.productionEvent(
        input.context.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: `shotstack_${input.format}`,
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "SHOTSTACK_CREATE_AMBIGUOUS" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw error;
    }
  },
});

export const pollWalkaroundRender = step({
  name: "poll_walkaround_render",
  description: "Re-fetch authoritative Shotstack render status",
  inputSchema: z.string(),
  outputSchema: RenderStatusSchema,
  fn: async (id) => {
    const status = await getShotstackRender(id);
    if (["done", "failed"].includes(status.status))
      return RenderStatusSchema.parse(status);
    return {
      status:
        status.status === "rendering" ? ("rendering" as const) : ("queued" as const),
    };
  },
});

export const submitAudioPolish = step({
  name: "submit_walkaround_audio_polish",
  description: "Submit audio-only narration cleanup without changing edit timing",
  inputSchema: z.object({
    masterUrl: z.string().url(),
    requestKey: z.string(),
    existingProviderJobId: z.string().optional(),
    projectId: z.string(),
    workflowId: z.string(),
    expectedRevision: z.number(),
  }),
  outputSchema: AudioSubmissionSchema,
  fn: async (input) => {
    if (input.existingProviderJobId)
      return {
        providerJobId: input.existingProviderJobId,
        requestKey: input.requestKey,
      };
    try {
      const production = await submitAuphonicProduction(
        {
          input_file: input.masterUrl,
          algorithms: {
            filtering: true,
            normloudness: true,
            leveler: true,
            denoise: true,
          },
          output_files: [{ format: "wav" }],
        },
        input.requestKey,
      );
      return { providerJobId: production.uuid, requestKey: input.requestKey };
    } catch (error: unknown) {
      await backend.productionEvent(
        input.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "auphonic_master",
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "AUPHONIC_CREATE_AMBIGUOUS" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw error;
    }
  },
});

export const startAudioPolish = step({
  name: "start_walkaround_audio_polish",
  description: "Idempotently start an already persisted Auphonic production",
  inputSchema: z.string(),
  fn: async (uuid) => startAuphonicProduction(uuid),
});

export const pollAudioPolish = step({
  name: "poll_walkaround_audio_polish",
  description: "Re-fetch authoritative Auphonic production status",
  inputSchema: z.string(),
  outputSchema: AudioStatusSchema,
  fn: async (uuid) => {
    const result = await getAuphonicProduction(uuid);
    if (result.status === 3) return { status: "done", url: result.outputUrl } as const;
    if (result.status < 0) return { status: "failed", error: result.error } as const;
    return { status: result.status === 2 ? "processing" : "queued" } as const;
  },
});

export const finalizeWalkaroundPackage = step({
  name: "finalize_walkaround_package",
  description:
    "Mux polished audio, ingest artifacts to private GCS, and run deterministic media QC",
  inputSchema: z.object({
    context: ProductionContextSchema,
    media: PreparedMediaSchema,
    editPlan: EditPlanSchema,
    masterRenderUrl: z.string().url(),
    teaserRenderUrl: z.string().url(),
    polishedAudioUrl: z.string().url(),
    requestKey: z.string(),
  }),
  outputSchema: FinalPackageSchema,
  fn: async (input) => {
    const result = FinalPackageSchema.parse(
      await mediaWorker.finalize(input, input.requestKey),
    );
    const kinds = new Set(result.artifacts.map((artifact) => artifact.kind));
    for (const required of [
      "transcript",
      "edit_plan",
      "master",
      "teaser",
      "captions",
      "thumbnail",
    ]) {
      if (!kinds.has(required as never))
        throw new FatalError(`Final package is missing ${required}`);
    }
    return result;
  },
});

export const writeGroundedYoutubeMetadata = step({
  name: "write_grounded_youtube_metadata",
  description: "Generate editable YouTube metadata grounded only in supplied evidence",
  inputSchema: z.object({
    context: ProductionContextSchema,
    media: PreparedMediaSchema,
    editPlan: EditPlanSchema,
    workflowId: z.string(),
    expectedRevision: z.number(),
    requestKey: z.string(),
  }),
  outputSchema: YoutubeMetadataSchema,
  options: {
    activityOptions: { startToCloseTimeout: "10m", retry: { maximumAttempts: 1 } },
  },
  fn: async (input) => {
    const generated = await generateText({
      prompt: "write_grounded_youtube_metadata@v1",
      variables: {
        mode: input.context.mode,
        vehicle_json: JSON.stringify(input.context.vehicleSnapshot),
        transcript_json: JSON.stringify(input.media.transcript),
        edit_plan_json: JSON.stringify(input.editPlan),
        banned_phrases_json: JSON.stringify(input.context.bannedPhrases),
        caption_corrections: input.context.captionsText ?? "",
      },
      output: Output.object({ schema: YoutubeMetadataSchema }),
    }).catch(async (error) => {
      await backend.productionEvent(
        input.context.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_metadata",
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_METADATA_AMBIGUOUS" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw error;
    });
    if (!generated.response.id) {
      await backend.productionEvent(
        input.context.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_metadata",
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_RESPONSE_ID_MISSING" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw new FatalError("Vertex completed without a provider response ID");
    }
    await backend.productionEvent(
      input.context.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: `accepted:${input.requestKey}`,
        type: "provider_job_accepted",
        providerJob: {
          kind: "vertex_metadata",
          requestKey: input.requestKey,
          providerJobId: generated.response.id,
          status: "completed",
        },
      },
      `accepted:${input.requestKey}`,
    );
    return validateMetadata(generated.output, input.context.bannedPhrases);
  },
});

export const evaluateWalkaroundWithGemini = step({
  name: "evaluate_walkaround_with_gemini",
  description:
    "Evaluate grounding, privacy, continuity, audio, visual quality, and YouTube readiness",
  inputSchema: z.object({
    context: ProductionContextSchema,
    media: PreparedMediaSchema,
    editPlan: EditPlanSchema,
    finalPackage: FinalPackageSchema,
    metadata: YoutubeMetadataSchema,
    workflowId: z.string(),
    expectedRevision: z.number(),
    requestKey: z.string(),
  }),
  outputSchema: PackageEvaluationSchema,
  options: {
    activityOptions: { startToCloseTimeout: "10m", retry: { maximumAttempts: 1 } },
  },
  fn: async (input) => {
    const generated = await generateText({
      prompt: "evaluate_walkaround_package@v1",
      variables: {
        mode: input.context.mode,
        vehicle_json: JSON.stringify(input.context.vehicleSnapshot),
        transcript_json: JSON.stringify(input.media.transcript),
        edit_plan_json: JSON.stringify(input.editPlan),
        deterministic_qc_json: JSON.stringify(input.finalPackage.deterministicQc),
        metadata_json: JSON.stringify(input.metadata),
      },
      output: Output.object({ schema: PackageEvaluationSchema }),
    }).catch(async (error) => {
      await backend.productionEvent(
        input.context.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_evaluation",
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_EVALUATION_AMBIGUOUS" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw error;
    });
    if (!generated.response.id) {
      await backend.productionEvent(
        input.context.projectId,
        {
          workflowId: input.workflowId,
          expectedRevision: input.expectedRevision,
          eventId: `reconcile:${input.requestKey}`,
          type: "provider_job_reconciliation",
          productionState: "retryable_failed",
          providerJob: {
            kind: "vertex_evaluation",
            requestKey: input.requestKey,
            status: "reconciliation_required",
          },
          redactedError: { code: "VERTEX_RESPONSE_ID_MISSING" },
        },
        `reconcile:${input.requestKey}`,
      );
      throw new FatalError("Vertex completed without a provider response ID");
    }
    await backend.productionEvent(
      input.context.projectId,
      {
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
        eventId: `accepted:${input.requestKey}`,
        type: "provider_job_accepted",
        providerJob: {
          kind: "vertex_evaluation",
          requestKey: input.requestKey,
          providerJobId: generated.response.id,
          status: "completed",
        },
      },
      `accepted:${input.requestKey}`,
    );
    return generated.output;
  },
});
