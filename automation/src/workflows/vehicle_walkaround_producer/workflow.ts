import { FatalError, sleep, workflow } from "@outputai/core";

import { evaluateWalkaroundAcceptance } from "./evaluators.js";
import {
  evaluateWalkaroundWithGemini,
  finalizeWalkaroundPackage,
  loadProductionContext,
  planWalkaroundEdit,
  pollAudioPolish,
  pollWalkaroundRender,
  prepareWalkaroundMedia,
  recordProductionArtifact,
  recordProductionFailure,
  recordProductionJobAccepted,
  recordProductionState,
  recordReviewReadyPackage,
  reserveProductionJob,
  submitAudioPolish,
  submitWalkaroundRender,
  startAudioPolish,
  writeGroundedYoutubeMetadata,
} from "./steps.js";
import {
  ProducerInputSchema,
  ProducerOutputSchema,
  type ProducerInput,
  type ProducerOutput,
} from "./types.js";

export default workflow({
  name: "vehicle_walkaround_producer",
  description:
    "Durably prepares, edits, polishes, evaluates, and stages a private vehicle walkaround for review",
  inputSchema: ProducerInputSchema,
  outputSchema: ProducerOutputSchema,
  options: {
    activityOptions: {
      startToCloseTimeout: "1h",
      retry: {
        maximumAttempts: 3,
        initialInterval: "1s",
        maximumInterval: "10s",
        backoffCoefficient: 2,
      },
    },
  },
  fn: async (input: ProducerInput): Promise<ProducerOutput> => {
    const context = await loadProductionContext(input);
    const analyzing = await recordProductionState({
      ...input,
      eventId: `${input.workflowId}:analyzing`,
      productionState: "analyzing",
    });
    const prepareKey = `${input.workflowId}:media-prepare:v1`;
    const media = await prepareWalkaroundMedia({ context, requestKey: prepareKey });
    const editKey = `${input.workflowId}:vertex:edit-plan:v1`;
    const editReservation = await reserveProductionJob({
      ...input,
      expectedRevision: analyzing.revision,
      kind: "vertex_edit_plan",
      requestKey: editKey,
    });
    if (editReservation.status === "reconciliation_required") {
      throw new FatalError("Vertex edit request requires provider reconciliation");
    }
    const editPlan = await planWalkaroundEdit({
      context,
      media,
      workflowId: input.workflowId,
      expectedRevision: editReservation.revision,
      requestKey: editKey,
    });

    const rendering = await recordProductionState({
      ...input,
      expectedRevision: editReservation.revision,
      eventId: `${input.workflowId}:rendering`,
      productionState: "rendering",
    });
    const masterKey = `${input.workflowId}:shotstack:master:v1`;
    const masterReservation = await reserveProductionJob({
      ...input,
      expectedRevision: rendering.revision,
      kind: "shotstack_master",
      requestKey: masterKey,
    });
    if (masterReservation.status === "reconciliation_required") {
      throw new FatalError("Shotstack master request requires provider reconciliation");
    }
    const masterSubmission = await submitWalkaroundRender({
      context,
      media,
      editPlan,
      format: "master",
      requestKey: masterKey,
      existingProviderJobId: masterReservation.providerJobId,
      workflowId: input.workflowId,
      expectedRevision: masterReservation.revision,
    });
    const masterAccepted = await recordProductionJobAccepted({
      ...input,
      expectedRevision: masterReservation.revision,
      kind: "shotstack_master",
      requestKey: masterKey,
      providerJobId: masterSubmission.providerJobId,
    });
    const teaserKey = `${input.workflowId}:shotstack:teaser:v1`;
    const teaserReservation = await reserveProductionJob({
      ...input,
      expectedRevision: masterAccepted.revision,
      kind: "shotstack_teaser",
      requestKey: teaserKey,
    });
    if (teaserReservation.status === "reconciliation_required") {
      throw new FatalError("Shotstack teaser request requires provider reconciliation");
    }
    const teaserSubmission = await submitWalkaroundRender({
      context,
      media,
      editPlan,
      format: "teaser",
      requestKey: teaserKey,
      existingProviderJobId: teaserReservation.providerJobId,
      workflowId: input.workflowId,
      expectedRevision: teaserReservation.revision,
    });
    const teaserAccepted = await recordProductionJobAccepted({
      ...input,
      expectedRevision: teaserReservation.revision,
      kind: "shotstack_teaser",
      requestKey: teaserKey,
      providerJobId: teaserSubmission.providerJobId,
    });

    const masterStatuses = [];
    const teaserStatuses = [];
    for (const attempt of Array.from({ length: 180 }, (_, index) => index)) {
      const [masterStatus, teaserStatus] = await Promise.all([
        pollWalkaroundRender(masterSubmission.providerJobId),
        pollWalkaroundRender(teaserSubmission.providerJobId),
      ]);
      masterStatuses.push(masterStatus);
      teaserStatuses.push(teaserStatus);
      if (masterStatus.status === "failed" || teaserStatus.status === "failed") {
        await recordProductionFailure({
          ...input,
          expectedRevision: teaserAccepted.revision,
          eventId: `${input.workflowId}:render-failed`,
          productionState: "terminal_failed",
          errorCode: "SHOTSTACK_RENDER_FAILED",
        });
        throw new FatalError(
          `Shotstack render failed: ${masterStatus.error ?? teaserStatus.error ?? "no safe detail"}`,
        );
      }
      if (masterStatus.status === "done" && teaserStatus.status === "done") break;
      if (attempt === 179) {
        await recordProductionFailure({
          ...input,
          expectedRevision: teaserAccepted.revision,
          eventId: `${input.workflowId}:render-timeout`,
          productionState: "retryable_failed",
          errorCode: "SHOTSTACK_RENDER_TIMEOUT",
        });
        throw new FatalError("Shotstack renders exceeded the 30 minute wait boundary");
      }
      await sleep("10s");
    }
    const masterRender = masterStatuses.at(-1);
    const teaserRender = teaserStatuses.at(-1);
    if (!masterRender?.url || !teaserRender?.url) {
      await recordProductionFailure({
        ...input,
        expectedRevision: teaserAccepted.revision,
        eventId: `${input.workflowId}:render-output-invalid`,
        productionState: "terminal_failed",
        errorCode: "SHOTSTACK_OUTPUT_INVALID",
      });
      throw new FatalError("Shotstack completed without both artifact URLs");
    }

    const audioPolishState = await recordProductionState({
      ...input,
      expectedRevision: teaserAccepted.revision,
      eventId: `${input.workflowId}:audio-polish`,
      productionState: "audio_polish",
    });
    const audioKey = `${input.workflowId}:auphonic:master:v1`;
    const audioReservation = await reserveProductionJob({
      ...input,
      expectedRevision: audioPolishState.revision,
      kind: "auphonic_master",
      requestKey: audioKey,
    });
    if (audioReservation.status === "reconciliation_required") {
      throw new FatalError("Auphonic request requires provider reconciliation");
    }
    const audioSubmission = await submitAudioPolish({
      masterUrl: masterRender.url,
      requestKey: audioKey,
      existingProviderJobId: audioReservation.providerJobId,
      projectId: input.projectId,
      workflowId: input.workflowId,
      expectedRevision: audioReservation.revision,
    });
    const audioAccepted = await recordProductionJobAccepted({
      ...input,
      expectedRevision: audioReservation.revision,
      kind: "auphonic_master",
      requestKey: audioKey,
      providerJobId: audioSubmission.providerJobId,
    });
    await startAudioPolish(audioSubmission.providerJobId).catch(async (error) => {
      await recordProductionFailure({
        ...input,
        expectedRevision: audioAccepted.revision,
        eventId: `${input.workflowId}:audio-start-failed`,
        productionState: "retryable_failed",
        errorCode: "AUPHONIC_START_FAILED",
      });
      throw error;
    });
    const audioStatuses = [];
    for (const attempt of Array.from({ length: 180 }, (_, index) => index)) {
      const status = await pollAudioPolish(audioSubmission.providerJobId);
      audioStatuses.push(status);
      if (status.status === "failed") {
        await recordProductionFailure({
          ...input,
          expectedRevision: audioAccepted.revision,
          eventId: `${input.workflowId}:audio-failed`,
          productionState: "terminal_failed",
          errorCode: "AUPHONIC_PROCESSING_FAILED",
        });
        throw new FatalError(`Auphonic failed: ${status.error ?? "no safe detail"}`);
      }
      if (status.status === "done") break;
      if (attempt === 179) {
        await recordProductionFailure({
          ...input,
          expectedRevision: audioAccepted.revision,
          eventId: `${input.workflowId}:audio-timeout`,
          productionState: "retryable_failed",
          errorCode: "AUPHONIC_PROCESSING_TIMEOUT",
        });
        throw new FatalError("Auphonic exceeded the 30 minute wait boundary");
      }
      await sleep("10s");
    }
    const audioStatus = audioStatuses.at(-1);
    if (!audioStatus?.url) {
      await recordProductionFailure({
        ...input,
        expectedRevision: audioAccepted.revision,
        eventId: `${input.workflowId}:audio-output-invalid`,
        productionState: "terminal_failed",
        errorCode: "AUPHONIC_OUTPUT_INVALID",
      });
      throw new FatalError("Auphonic completed without a polished audio artifact");
    }

    const qualityState = await recordProductionState({
      ...input,
      expectedRevision: audioAccepted.revision,
      eventId: `${input.workflowId}:quality-check`,
      productionState: "quality_check",
    });
    const finalPackage = await finalizeWalkaroundPackage({
      context,
      media,
      editPlan,
      masterRenderUrl: masterRender.url,
      teaserRenderUrl: teaserRender.url,
      polishedAudioUrl: audioStatus.url,
      requestKey: `${input.workflowId}:finalize:v1`,
    });
    if (!finalPackage.deterministicQc.passed) {
      await recordProductionFailure({
        ...input,
        expectedRevision: qualityState.revision,
        eventId: `${input.workflowId}:deterministic-qc-failed`,
        productionState: "terminal_failed",
        errorCode: "DETERMINISTIC_QC_FAILED",
      });
      throw new FatalError(
        `Deterministic media QC failed: ${finalPackage.deterministicQc.reasons.join("; ")}`,
      );
    }
    const metadataKey = `${input.workflowId}:vertex:metadata:v1`;
    const metadataReservation = await reserveProductionJob({
      ...input,
      expectedRevision: qualityState.revision,
      kind: "vertex_metadata",
      requestKey: metadataKey,
    });
    if (metadataReservation.status === "reconciliation_required") {
      throw new FatalError("Vertex metadata request requires provider reconciliation");
    }
    const metadata = await writeGroundedYoutubeMetadata({
      context,
      media,
      editPlan,
      workflowId: input.workflowId,
      expectedRevision: metadataReservation.revision,
      requestKey: metadataKey,
    });
    const evaluationKey = `${input.workflowId}:vertex:evaluation:v1`;
    const evaluationReservation = await reserveProductionJob({
      ...input,
      expectedRevision: metadataReservation.revision,
      kind: "vertex_evaluation",
      requestKey: evaluationKey,
    });
    if (evaluationReservation.status === "reconciliation_required") {
      throw new FatalError(
        "Vertex evaluation request requires provider reconciliation",
      );
    }
    const evaluation = await evaluateWalkaroundWithGemini({
      context,
      media,
      editPlan,
      finalPackage,
      metadata,
      workflowId: input.workflowId,
      expectedRevision: evaluationReservation.revision,
      requestKey: evaluationKey,
    });
    const acceptance = await evaluateWalkaroundAcceptance(evaluation);
    if (!acceptance.value) {
      await recordProductionFailure({
        ...input,
        expectedRevision: qualityState.revision,
        eventId: `${input.workflowId}:quality-evaluation-failed`,
        productionState: "terminal_failed",
        errorCode: evaluation.reshootRequired
          ? "RESHOOT_REQUIRED"
          : "PACKAGE_EVALUATION_FAILED",
      });
      throw new FatalError(
        `Walkaround requires review or reshoot: ${acceptance.reasoning}`,
      );
    }

    for (const artifact of finalPackage.artifacts) {
      await recordProductionArtifact({
        ...input,
        expectedRevision: qualityState.revision,
        eventId: `${input.workflowId}:artifact:${artifact.kind}:${artifact.sha256}`,
        artifact,
      });
    }
    const ready = await recordReviewReadyPackage({
      ...input,
      expectedRevision: qualityState.revision,
      eventId: `${input.workflowId}:review-ready`,
      metadata,
      evaluation,
    });
    return {
      projectId: input.projectId,
      productionState: "review_ready",
      revision: ready.revision,
      artifacts: finalPackage.artifacts,
      editPlan,
      metadata,
      evaluation,
      warnings: [...media.warnings, ...editPlan.warnings],
    };
  },
});
