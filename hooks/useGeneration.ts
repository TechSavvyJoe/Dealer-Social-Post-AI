import { useCallback, useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { useGemini } from "./useGemini";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  AppStep,
  GeneratedPost,
  ImageQualityTier,
  LogoCornerCheck,
  MediaOutputMode,
  GenerationParams,
  SignatureLook,
} from "../types";
import { useToast } from "../components/ui/Toast";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { toUiMessage } from "../utils/errorMessages";
// The publish/compliance pipeline (posts, photo releases, platform copy,
// export rendering, caption compliance, website drafting) is loaded lazily so
// the login screen's entry chunk never carries it. Only type-level imports of
// those modules remain below — they are erased at build time.
import {
  loadPublishPipeline,
  type PublishPipelineModule,
} from "../services/publishPipeline";
import type { DealerBrandKit } from "../utils/brandKit";
import { logEvent, logError } from "../utils/telemetry";
import { resolveImageQualityTier } from "../utils/imageQualityTier";
import type { CapturedRelease } from "../services/photoReleases";
import type { DecodedVehicle } from "../services/vinDecoder";
import type { PlatformId, PrimaryImageProfile } from "../services/platformCopy";
import type { Dealer } from "../types";
import type { CaptionGenerationResult } from "../services/modelConfig";
// Pure resolver (no React, no network). While a dealership has not opted into
// `creative_system_v2` every call is a pass-through of the values the caller
// already supplied, so nothing below changes for an existing dealership.
import {
  resolveCreative,
  isSignatureLook,
  LOOK_DEFINITIONS,
} from "../services/creativeSystem";
// Kept static deliberately: stores/appStore.ts already imports this constant
// eagerly, so modelConfig rides the entry chunk either way and
// mergeCaptionProvenance can stay synchronous.
import { MODEL_POLICY_VERSION } from "../services/modelConfig";
import type {
  FinalWebsiteDraftSource,
  WebsiteDraft,
  WebsiteDraftSource,
} from "../services/websitePublishing";

const brandKitFromDealer = (dealer?: Dealer | null): DealerBrandKit | null => {
  if (!dealer) return null;
  return {
    name: dealer.name,
    default_hashtags: dealer.default_hashtags,
    default_footer: dealer.default_footer,
    required_hashtags_locked: dealer.required_hashtags_locked === true,
  };
};

/**
 * Identity-safety check over the lazily loaded compliance helpers. Callers run
 * inside async flows that have already awaited loadPublishPipeline(), so
 * passing the resolved module keeps this helper synchronous.
 */
const unauthorizedCustomerIdentities = (
  pipeline: Pick<
    PublishPipelineModule,
    "toPublicCustomerLabel" | "unauthorizedCustomerNames"
  >,
  input: {
    caption: string;
    customerName?: string;
    dealerName?: string;
    /** The OEM the dealer sells ("Ford") — a brand word, never a customer. */
    oemAffiliation?: string;
    vehicleDescription?: string;
    requireExpected?: boolean;
    identityRequired?: boolean;
  },
): string[] => {
  const publicCustomer = pipeline.toPublicCustomerLabel(input.customerName);
  // The signed-in salesperson may be named in prose ("Ask for Joe") but is
  // never the celebrated customer — the same split the server applies.
  const salesperson = useAppStore.getState().currentPerson?.name;
  return pipeline.unauthorizedCustomerNames(input.caption, publicCustomer, {
    allowedPhrases: [input.dealerName, input.oemAffiliation, input.vehicleDescription],
    maskedPhrases: [salesperson, pipeline.toPublicCustomerLabel(salesperson)],
    requireExpected: Boolean(publicCustomer && input.requireExpected),
    rejectAnyCustomerIdentity: Boolean(input.identityRequired && !publicCustomer),
  });
};

const customerIdentityIsSafe = (
  pipeline: Parameters<typeof unauthorizedCustomerIdentities>[0],
  input: Parameters<typeof unauthorizedCustomerIdentities>[1],
): boolean => unauthorizedCustomerIdentities(pipeline, input).length === 0;

/**
 * The refusal names the word that tripped the guard. A salesperson who reads
 * "not authorized for this post" with no further detail cannot tell whether
 * the model invented a person, read a name off a plate frame, or the guard
 * simply misread the town — and neither can anyone debugging their report.
 */
const customerIdentityErrorFor = (
  pipeline: Pick<PublishPipelineModule, "describeUnauthorizedNames">,
  offending: string[],
): string =>
  offending.length > 0
    ? `The caption introduced a customer name that is not authorized for this post (${pipeline.describeUnauthorizedNames(
        offending,
      )}). The previous caption was kept.`
    : customerIdentityError;

const customerIdentityError =
  "The caption introduced a customer name that is not authorized for this post. The previous caption was kept.";

/**
 * Legacy persisted posts predate this flag. Treat an absent value as a
 * customer-bound post so old work cannot silently lose identity protection;
 * preserve an explicit false for inventory, service, team, and community copy.
 */
const resolveCustomerIdentityRequired = (
  primary?: boolean,
  fallback?: boolean,
): boolean => primary ?? fallback ?? true;

const latestSuccessfulAt = (
  ...values: Array<string | null | undefined>
): string | undefined => {
  const valid = values.filter((value): value is string => {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  });
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
};

const workspaceKeyForPost = (post: GeneratedPost | null | undefined): string | null =>
  post?.postId || post?.aiMeta?.image?.attemptId || post?.image || null;

const workspaceIsCurrent = (workspaceKey: string | null): boolean =>
  workspaceKeyForPost(useAppStore.getState().generatedPost) === workspaceKey;

/**
 * A post whose image the Post screen will not let leave the phone: waiting
 * for, refused or never sent for approval, held for image review, or with a
 * photo release that did not save. Its image is set without a device recovery
 * copy, or My work could save the exact image the Post screen locks. Any
 * approval status counts: a replaced image is never the one a manager saw.
 */
const imageStaysOffDevice = (post: GeneratedPost): boolean =>
  (post.approvalStatus ?? "n_a") !== "n_a" ||
  Boolean(post.imageReviewRequired) ||
  post.releaseStatus === "save_failed";

const assertOperationAuthEpoch = (operationAuthEpoch: number): void => {
  if (operationAuthEpoch !== useAppStore.getState().authEpoch) {
    throw new DOMException(
      "The signed-in workspace changed during this operation.",
      "AbortError",
    );
  }
};

const renderExactPrimaryImage = async (
  image: string,
  formatId: PrimaryImageProfile["primaryFormatId"],
): Promise<string> => {
  // Resolves from the memoized pipeline promise the calling mutation already
  // awaited, so this never adds a download to the render step.
  const { EXPORT_FORMATS, renderFormat } = await loadPublishPipeline();
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === formatId);
  if (!format) throw new Error("Selected output format is unavailable.");
  return renderFormat(image, format);
};

/**
 * Replace caption provenance after a regeneration while retaining the image
 * provenance for the creative that is still on screen. Older saved posts may
 * predate modality metadata; their existing image is represented as unknown
 * instead of falsely attributing it to a provider or model.
 */
export const mergeCaptionProvenance = (
  current: GeneratedPost["aiMeta"] | undefined,
  captionResult: CaptionGenerationResult,
  selectedTier: ImageQualityTier,
): NonNullable<GeneratedPost["aiMeta"]> => {
  const image = current?.image ?? {
    task: selectedTier === "studio" ? "image_studio" : "image_standard",
    tier: selectedTier,
    provider: "unknown",
    model: null,
    fallbackCount: 0,
    lastSuccessAt: null,
  };
  const lastSuccessfulGenerationAt = latestSuccessfulAt(
    captionResult.aiMeta.lastSuccessAt,
    image.lastSuccessAt,
  );

  return {
    captionSource: captionResult.captionSource,
    selectedTier: current?.selectedTier ?? selectedTier,
    ...(captionResult.aiMeta.model ? { model: captionResult.aiMeta.model } : {}),
    fallbackCount: captionResult.aiMeta.fallbackCount + image.fallbackCount,
    ...(lastSuccessfulGenerationAt ? { lastSuccessfulGenerationAt } : {}),
    caption: captionResult.aiMeta,
    image,
    modelPolicyVersion: current?.modelPolicyVersion ?? MODEL_POLICY_VERSION,
  };
};

/**
 * Swap only the logo-corner note on the image provenance after Regenerate
 * image, Fun mode or Edit image. The rest of `aiMeta.image` (its attempt id
 * keys the unsaved workspace) is left as it is. No note when the new image's
 * corner is not known. Older saved posts may carry no image provenance at all
 * (see mergeCaptionProvenance); they keep their metadata as it is.
 */
const withImageLogoCorner = (
  current: GeneratedPost["aiMeta"] | undefined,
  logoCorner: LogoCornerCheck | undefined,
): GeneratedPost["aiMeta"] | undefined => {
  if (!current?.image) return current;
  const { logoCorner: previous, ...image } = current.image;
  if (!previous && !logoCorner) return current;
  return { ...current, image: logoCorner ? { ...image, logoCorner } : image };
};

/**
 * The per-channel captions a post keeps after its caption is regenerated or
 * AI-edited. One caption ships to every channel, and an older post's saved
 * variants were written for the caption being replaced, so every saved
 * channel now carries the new caption. The channel keys stay: a draft saved
 * before platform_ids existed reopens its channel list from them
 * (resolveHistoryPlatformIds). The Post screen does the same for a typed edit.
 */
const captionForSavedChannels = (
  saved: Record<string, string> | undefined,
  caption: string,
): Record<string, string> | undefined => {
  const channels = Object.keys(saved || {});
  return channels.length > 0
    ? Object.fromEntries(channels.map((channel) => [channel, caption]))
    : undefined;
};

export interface GenerationMeta {
  salespersonName?: string;
  /** When the salesperson was picked from the dealer's roster, this is the salespeople record id. */
  salespersonId?: string;
  vin?: string;
  scenarioId?: string;
  customerIdentityRequired?: boolean;
  hasRelease?: boolean;
  /** Signed-but-unsaved release captured before generation. Saved linked to the post on success so we never create orphan release records. */
  capturedRelease?: CapturedRelease;
  /** Prepare a private Customer Hub draft after AI generation. */
  websiteEnabled?: boolean;
  /** Grounded year/make/model/trim from VIN decode; never the VIN. */
  websiteVehicleDescription?: string;
  /**
   * Full decoded VIN record, carried through so it survives the remount a
   * failed generation attempt sends the customizer through (see
   * GenerationParams.decodedVehicle in ../types for why this matters).
   */
  decodedVehicle?: DecodedVehicle;
  /**
   * Dealership Playful style requested on the customize screen (spec §4.2).
   * The playful asset is a SECOND image rendered on demand from the result
   * screen — it never replaces the house-style master, so this value is
   * carried, never auto-applied here.
   */
  playfulStyleId?: string;
  /**
   * The personal line exactly as typed on Details. It already rides in the
   * creative brief; this copy only survives the remount a Cancel or a failed
   * attempt sends Details through (GenerationParams.personalLine). In memory
   * only, never persisted.
   */
  personalLine?: string;
}

/**
 * Honest Creating stages (spec §3.3). Each change is made at a real boundary
 * inside generateMutation; nothing here advances on a timer.
 *  - `signature`: a captured photo release is being durably stored. Skipped
 *    when it was stored by an earlier attempt, because a retry reuses its id.
 *  - `design`: consent is settled and the provider is producing the caption
 *    and the image in parallel. `partsReady` says which half has landed.
 *  - `checks`: the identity guard, the prohibited-claims sanitizer and the
 *    private website draft.
 *  - `saving`: logPost (approval submission included), then the release link.
 */
export type GenerationStage = "idle" | "signature" | "design" | "checks" | "saving";

export interface GenerationPartsReady {
  image: boolean;
  caption: boolean;
}

const NO_PARTS_READY: GenerationPartsReady = { image: false, caption: false };

/**
 * What cancelGeneration did (amendments B5):
 *  - `idle`: nothing was running, so nothing changed.
 *  - `cancelled`: stopped before logPost. Nothing was created and the captured
 *    release is untouched, so a retry reuses it without a new signature.
 *  - `saving`: logPost had already started, so that save is left to finish in
 *    My work (as a draft, or waiting for approval when `requiresApproval`).
 *    Only the result is discarded. `saved` resolves true once the post exists.
 */
export type GenerationCancelResult =
  | { status: "idle" }
  | { status: "cancelled" }
  | { status: "saving"; requiresApproval: boolean; saved: Promise<boolean> };

/**
 * Why a run stopped, as reported on `ai.generate.cancelled`: the salesperson
 * tapped Cancel, or a newer Create post superseded a run still going.
 */
type GenerationDetachReason = "cancel" | "superseded";

/**
 * One Create post tap. It rides in the mutation variables so every late
 * callback of a cancelled run can see that it was cancelled, even after a
 * newer run has started.
 */
interface GenerationRun {
  controller: AbortController;
  cancelled: boolean;
  /**
   * The signed-in workspace this run belongs to: the epoch at the tap, then
   * the epoch the mutation itself checks against once it starts.
   */
  authEpoch: number;
  stage: GenerationStage;
  /** logPost has started. From here a cancel lets the save finish (B5). */
  persistenceStarted: boolean;
  requiresApproval: boolean;
  /** Set together with persistenceStarted. */
  saved?: Promise<boolean>;
}

const generationCancelledError = (): DOMException =>
  new DOMException("Generation was cancelled.", "AbortError");

const assertGenerationRunActive = (run: GenerationRun): void => {
  if (run.cancelled) throw generationCancelledError();
};

/**
 * Amendments A1: a signed release is single-use. The link-post route binds it
 * to its first post permanently and answers 409 on a relink. A release is
 * recorded here as soon as a post starts saving with it, so a Create post
 * tapped while that save is still running cannot reuse it either. The record
 * is dropped only when the save ended without the link ever being attempted,
 * the one case where the release was never linked. Both the in-memory object
 * and its server id are recorded, so a copy carrying the same id is caught.
 */
const linkedReleases = new WeakSet<CapturedRelease>();
const linkedReleaseIds = new Set<string>();

const markReleaseLinked = (release: CapturedRelease, releaseId?: string): void => {
  linkedReleases.add(release);
  if (releaseId) linkedReleaseIds.add(releaseId);
};

const unmarkReleaseLinked = (release: CapturedRelease, releaseId?: string): void => {
  linkedReleases.delete(release);
  if (releaseId) linkedReleaseIds.delete(releaseId);
};

/**
 * B5: a Cancel during the `signature` stage hands the Create post guard back at
 * once, but the signature upload it interrupted keeps going, and only that
 * upload stamps its releaseId on the captured object. A retry with the same
 * release therefore waits for it instead of storing the signature a second
 * time: nothing is re-signed, no orphan release record is left on the server,
 * and the id the retry links is the one on the captured object. Each entry
 * settles (never rejects) when the upload phase ends, whether the id is now on
 * the captured object or the upload failed and the retry must store it itself.
 */
const pendingSignatureUploads = new WeakMap<CapturedRelease, Promise<void>>();

/** Record an upload about to start; the returned callback marks it over (idempotent). */
const trackSignatureUpload = (captured: CapturedRelease | undefined): (() => void) => {
  if (!captured || captured.releaseId) return () => undefined;
  let settle!: () => void;
  const upload = new Promise<void>((resolve) => {
    settle = resolve;
  });
  pendingSignatureUploads.set(captured, upload);
  return () => {
    if (pendingSignatureUploads.get(captured) === upload) {
      pendingSignatureUploads.delete(captured);
    }
    settle();
  };
};

/** Pass as buildGenerationRequest's `releaseAlreadyLinked` for the pending release. */
export const isReleaseAlreadyLinked = (
  release: CapturedRelease | null | undefined,
): boolean =>
  Boolean(
    release &&
    (linkedReleases.has(release) ||
      (release.releaseId !== undefined && linkedReleaseIds.has(release.releaseId))),
  );

export const useGeneration = () => {
  const { error: toastError, warning: toastWarning } = useToast();
  const {
    currentDealer,
    selectedImage,
    generatedPost,
    generationParams,
    preferredTone,
    deviceImageQualityTier,
    authEpoch,
    setGeneratedPost,
    setGenerationParams,
    setError,
    setStep,
  } = useAppStore(
    useShallow((state) => ({
      currentDealer: state.currentDealer,
      selectedImage: state.selectedImage,
      generatedPost: state.generatedPost,
      generationParams: state.generationParams,
      preferredTone: state.preferredTone,
      deviceImageQualityTier: state.imageQualityTier,
      authEpoch: state.authEpoch,
      setGeneratedPost: state.setGeneratedPost,
      setGenerationParams: state.setGenerationParams,
      setError: state.setError,
      setStep: state.setStep,
    })),
  );
  // Every image generation, regeneration and provenance record below uses
  // this tier: the store's choice when a manager set one, otherwise this
  // device's own setting.
  const imageQualityTier = resolveImageQualityTier(
    currentDealer?.image_quality_tier,
    deviceImageQualityTier,
  ).tier;

  const { runGeminiTask, loadGeminiService } = useGemini();

  /** Every new post image goes through here, so a locked one stays off the device. */
  const setPostImage = (post: GeneratedPost) => {
    if (imageStaysOffDevice(post)) setGeneratedPost(post, { archive: false });
    else setGeneratedPost(post);
  };

  // Removed local lastGenerationParams state in favor of store persistence

  const [generationProgress, setGenerationProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  // One controller per active video poll. Aborted on unmount so a salesperson
  // who navigates away mid-render stops eating Vertex quota.
  const videoAbortControllersRef = useRef<Set<AbortController>>(new Set());

  // Honest stages and Cancel for the Creating screen. The legacy
  // generationProgress/progressMessage above stay populated for the current
  // overlay until that screen replaces it.
  const [generationStage, setGenerationStage] = useState<GenerationStage>("idle");
  const [partsReady, setPartsReady] = useState<GenerationPartsReady>(NO_PARTS_READY);
  // B5: taken synchronously on the Create post tap, so a double tap or a
  // repeated Cmd/Ctrl+Enter is a no-op before the step changes.
  const inFlightRef = useRef(false);
  const activeRunRef = useRef<GenerationRun | null>(null);

  const advanceGenerationStage = useCallback(
    (run: GenerationRun, stage: GenerationStage) => {
      if (run.cancelled || activeRunRef.current !== run) return;
      run.stage = stage;
      setGenerationStage(stage);
    },
    [],
  );

  /**
   * A Create post from a previous signed-in workspace no longer holds the
   * guard or the stages. That run still goes on until its epoch checks discard
   * it, exactly as before, but it must not turn a Create post in this
   * workspace into a silent no-op until its discarded provider call returns.
   * Compared against the live epoch, so a run started in it is never released.
   */
  const releaseRunFromPreviousWorkspace = useCallback(() => {
    const staleRun = activeRunRef.current;
    if (!staleRun || staleRun.authEpoch === useAppStore.getState().authEpoch) return;
    activeRunRef.current = null;
    inFlightRef.current = false;
    setGenerationStage("idle");
    setPartsReady(NO_PARTS_READY);
  }, []);

  const markPartReady = useCallback(
    (run: GenerationRun, part: keyof GenerationPartsReady) => {
      if (run.cancelled || activeRunRef.current !== run) return;
      setPartsReady((current) =>
        current[part] ? current : { ...current, [part]: true },
      );
    },
    [],
  );

  const cleanupTimers = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  /**
   * Stop a run for good (amendments B5). Shared by a Cancel on the Creating
   * screen and by a newer Create post that supersedes a run still going. Before
   * logPost starts the run is aborted: the queued or running provider task is
   * cancelled, a late result is discarded, nothing is created and the captured
   * release is left as it is. After logPost has started, that save is left to
   * finish in My work (as a draft, or waiting for approval) and only the result
   * is discarded. Every late callback checks `run.cancelled`, so from here the
   * run can never set the post, the step or an error, or raise a toast. The
   * caller owns navigation and the error banner.
   */
  const detachRun = useCallback(
    (run: GenerationRun, reason: GenerationDetachReason) => {
      run.cancelled = true;
      if (activeRunRef.current === run) activeRunRef.current = null;
      inFlightRef.current = false;
      if (!run.persistenceStarted) run.controller.abort(generationCancelledError());
      cleanupTimers();
      setGenerationStage("idle");
      setPartsReady(NO_PARTS_READY);
      logEvent("ai.generate.cancelled", {
        stage: run.stage,
        saving: run.persistenceStarted,
        reason,
      });
    },
    [cleanupTimers],
  );

  const abortActiveVideoPolls = useCallback(() => {
    for (const ctrl of videoAbortControllersRef.current) {
      try {
        ctrl.abort();
      } catch {
        /* ignore */
      }
    }
    videoAbortControllersRef.current.clear();
  }, []);

  // Authentication is a hard workspace boundary. Provider calls that cannot
  // be cancelled are discarded by epoch checks below; Veo polling is aborted.
  useEffect(() => {
    cleanupTimers();
    abortActiveVideoPolls();
    releaseRunFromPreviousWorkspace();
  }, [
    abortActiveVideoPolls,
    authEpoch,
    cleanupTimers,
    releaseRunFromPreviousWorkspace,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupTimers();
      abortActiveVideoPolls();
    };
  }, [abortActiveVideoPolls, cleanupTimers]);

  const generateMutation = useMutation({
    mutationFn: async (params: {
      style: StyleOption;
      tone: ToneOption;
      customerName: string;
      customText?: string;
      creativeBrief?: string;
      platformIds?: PlatformId[];
      mediaOutputMode: MediaOutputMode;
      primaryFormatId: PrimaryImageProfile["primaryFormatId"];
      imageAspectRatio: PrimaryImageProfile["imageAspectRatio"];
      meta?: GenerationMeta;
      authEpoch: number;
      run: GenerationRun;
    }) => {
      assertOperationAuthEpoch(params.authEpoch);
      assertGenerationRunActive(params.run);
      if (!selectedImage || !currentDealer) throw new Error("Missing required data");

      // The consent gate implementation itself lives in the lazily loaded
      // pipeline chunk. Fetching that module is not a provider call, so it may
      // run before the gate — but the Gemini module load AND its execution stay
      // wrapped inside the gate callback below, which
      // services/photoReleases.test.ts enforces against this source text.
      const { runWithPersistedPhotoRelease } = await loadPublishPipeline();
      assertOperationAuthEpoch(params.authEpoch);
      assertGenerationRunActive(params.run);
      const captured = params.meta?.capturedRelease;
      // A cancelled attempt may still be storing this same signature. Wait
      // for it, so the gate below finds its releaseId and never stores the
      // signature twice.
      const earlierUpload = captured
        ? pendingSignatureUploads.get(captured)
        : undefined;
      if (earlierUpload) {
        await earlierUpload;
        assertOperationAuthEpoch(params.authEpoch);
        assertGenerationRunActive(params.run);
      }
      const endSignatureUpload = trackSignatureUpload(captured);
      const gated = await runWithPersistedPhotoRelease(
        captured,
        currentDealer.name,
        async () => {
          // The upload is over: its id is on the captured object.
          endSignatureUpload();
          assertOperationAuthEpoch(params.authEpoch);
          // A cancel during the signature upload stops here, after the
          // release id is on the captured object, so a retry reuses it.
          assertGenerationRunActive(params.run);
          // Real boundary: consent is durably stored, or none was needed.
          advanceGenerationStage(params.run, "design");
          const { generateSocialPost } = await loadGeminiService();
          assertOperationAuthEpoch(params.authEpoch);
          assertGenerationRunActive(params.run);
          const generate = (signal: AbortSignal) => {
            assertOperationAuthEpoch(params.authEpoch);
            return generateSocialPost(
              selectedImage,
              params.style,
              params.tone,
              currentDealer.name,
              params.customerName,
              currentDealer.logo,
              params.customText,
              params.creativeBrief,
              imageQualityTier,
              params.imageAspectRatio,
              params.meta?.customerIdentityRequired ?? true,
              signal,
              (part) => markPartReady(params.run, part),
              currentDealer.logo_placement,
            );
          };
          // Cancel aborts the queued or running provider task.
          const cancelSignal = params.run.controller.signal;
          return runGeminiTask("ai.generate", generate, undefined, cancelSignal);
        },
        params.authEpoch,
      ).finally(endSignatureUpload);
      assertOperationAuthEpoch(params.authEpoch);
      assertGenerationRunActive(params.run);
      const exactImage = await renderExactPrimaryImage(
        gated.result.image,
        params.primaryFormatId,
      );
      assertOperationAuthEpoch(params.authEpoch);
      assertGenerationRunActive(params.run);
      return {
        ...gated,
        result: {
          ...gated.result,
          image: exactImage,
        },
      };
    },
    onMutate: (variables) => {
      if (variables.run.cancelled) return;
      // B5: the synchronous tap guard covers a double tap or a repeated
      // Cmd/Ctrl+Enter only until the step changes. From here the run is
      // tracked by activeRunRef (stages, Cancel); a later Create post from
      // another workspace path supersedes it (detachRun stops it, as Cancel
      // would) and starts its own run, as a second Generate did before the
      // guard existed.
      inFlightRef.current = false;
      cleanupTimers();
      setStep(AppStep.GENERATING);
      setError(null);
      setGenerationProgress(0);
      setProgressMessage("Analyzing your image...");
      const captured = variables.meta?.capturedRelease;
      setPartsReady(NO_PARTS_READY);
      advanceGenerationStage(
        variables.run,
        captured && !captured.releaseId ? "signature" : "design",
      );
      setGenerationParams({
        style: variables.style,
        tone: variables.tone,
        customerName: variables.customerName,
        customText: variables.customText,
        creativeBrief: variables.creativeBrief,
        platformIds: variables.platformIds,
        scenarioId: variables.meta?.scenarioId,
        customerIdentityRequired: variables.meta?.customerIdentityRequired ?? true,
        mediaOutputMode: variables.mediaOutputMode,
        primaryFormatId: variables.primaryFormatId,
        imageAspectRatio: variables.imageAspectRatio,
        websiteEnabled: variables.meta?.websiteEnabled,
        websiteVehicleDescription: variables.meta?.websiteVehicleDescription,
        decodedVehicle: variables.meta?.decodedVehicle,
        // The rest of the Details draft, so a Cancel or a failed attempt that
        // sends Details back through its remount loses nothing. In memory only:
        // utils/persistence.ts drops both before anything reaches storage, and
        // the customizer takes the release back only while it is unlinked (A1).
        ...(captured ? { capturedRelease: captured } : {}),
        ...(variables.meta?.personalLine
          ? { personalLine: variables.meta.personalLine }
          : {}),
      });

      progressIntervalRef.current = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 95) return prev;
          const remaining = 95 - prev;
          const increment = Math.max(0.1, remaining * 0.05 * (Math.random() + 0.5));
          return prev + increment;
        });
      }, 800);

      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Consulting the style guide..."), 2000),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Crafting the perfect caption..."), 4500),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Applying final polish..."), 7000),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("AI is thinking hard... this might take a moment."),
          15000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Still working... generating high-quality content."),
          30000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Almost there! Thanks for your patience."),
          60000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Finalizing your post..."), 90000),
      );
    },
    onSuccess: async (gatedResult, variables) => {
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      // A run cancelled before logPost is discarded whole: nothing is saved,
      // no message is shown and the step stays where Cancel put it.
      if (variables.run.cancelled) return;
      cleanupTimers();
      setGenerationProgress(100);
      setProgressMessage("Complete!");
      advanceGenerationStage(variables.run, "checks");

      const result = gatedResult.result;
      const releaseId = gatedResult.releaseId;

      // The mutation already awaited this loader, so the memoized promise
      // resolves without another network fetch.
      const pipeline = await loadPublishPipeline();
      if (variables.run.cancelled) return;
      const {
        buildFallbackWebsiteDraft,
        buildWebsiteDraftPrompt,
        deliveryLanguageAllowedForBrief,
        logPost,
        parseWebsiteDraftResponse,
        prepareCaptionForDelivery,
        toPublicCustomerLabel,
      } = pipeline;

      const offendingIdentities = unauthorizedCustomerIdentities(pipeline, {
        caption: result.text,
        customerName: variables.customerName,
        dealerName: currentDealer?.name,
        oemAffiliation: currentDealer?.oem_affiliation,
        vehicleDescription: variables.meta?.websiteVehicleDescription,
        identityRequired: variables.meta?.customerIdentityRequired ?? true,
      });
      if (offendingIdentities.length > 0) {
        const message = customerIdentityErrorFor(pipeline, offendingIdentities);
        setError(message);
        toastError(message);
        setStep(AppStep.CUSTOMIZE);
        return;
      }

      if (result.aiMeta.image.provider === "original") {
        toastWarning(
          "AI styling couldn't be applied this time — showing your original photo with the generated caption.",
        );
      }

      const deliveryLanguageAllowed = deliveryLanguageAllowedForBrief(
        variables.creativeBrief,
        variables.meta?.customerIdentityRequired ?? true,
      );

      // Scan the caption for compliance triggers. Disclosures go into a
      // separate `disclosures` field so the editable caption textarea
      // never contains them (and a salesperson can't silently delete them).
      let preparedCaption;
      try {
        preparedCaption = prepareCaptionForDelivery(
          result.text,
          currentDealer?.banned_phrases,
          brandKitFromDealer(currentDealer),
          deliveryLanguageAllowed,
        );
      } catch (err) {
        const message = toUiMessage(
          err,
          "The generated caption contains a prohibited advertising claim.",
        );
        logEvent("compliance.prohibited_detected", {
          blocked: true,
        });
        setError(message);
        toastError(message);
        setStep(AppStep.CUSTOMIZE);
        return;
      }
      const compliance = preparedCaption.compliance;
      if (compliance.changed && compliance.matches.length > 0) {
        logEvent("compliance.disclosures_detected", {
          categories: Array.from(new Set(compliance.matches.map((m) => m.category))),
        });
      }
      const platformIds = variables.platformIds?.filter(Boolean) ?? [];
      const finalPost: GeneratedPost = {
        ...result,
        text: preparedCaption.caption,
        customerDisplayName: toPublicCustomerLabel(variables.customerName),
        customerIdentityRequired: variables.meta?.customerIdentityRequired ?? true,
        scenarioId: variables.meta?.scenarioId,
        isBasicFallback: result.captionSource === "basic_fallback",
        disclosures: preparedCaption.disclosures,
        disclosureCategories: preparedCaption.disclosureCategories,
        // Empty is authoritative: it represents a Website-only post.
        platformIds,
        mediaOutputMode: variables.mediaOutputMode,
        primaryFormatId: variables.primaryFormatId,
        imageAspectRatio: variables.imageAspectRatio,
      };

      // One caption ships to every channel (the Post screen shares the caption
      // on screen), so no per-channel variants are written here. Website
      // preparation runs after the approved primary caption/image exists, owns
      // a safe fallback, never blocks the main post and stays a private draft.
      const shouldPrepareWebsite = Boolean(
        variables.meta?.websiteEnabled && currentDealer && finalPost.image,
      );
      if (shouldPrepareWebsite) {
        setProgressMessage("Preparing the website draft...");
      }

      const websiteDraftTask = async () => {
        if (!shouldPrepareWebsite || !currentDealer) {
          return undefined;
        }
        const source: WebsiteDraftSource = {
          scenarioId: variables.meta?.scenarioId,
          customScenariosJson: currentDealer.custom_scenarios,
          dealerName: currentDealer.name,
          oemAffiliation: currentDealer.oem_affiliation,
          caption: preparedCaption.caption,
          customerDisplayName: finalPost.customerDisplayName,
          vehicleDescription: variables.meta?.websiteVehicleDescription,
        };
        const fallback = buildFallbackWebsiteDraft(source);
        // Customer stories carry release-bound identity. Their website copy is
        // derived deterministically from the validated caption so a metadata
        // model can never introduce a second customer.
        if (fallback.kind === "customer_story") return fallback;
        try {
          assertOperationAuthEpoch(variables.authEpoch);
          const { generateWebsiteDraftMetadata } = await loadGeminiService();
          assertOperationAuthEpoch(variables.authEpoch);
          // The proxy/model layer owns retries; malformed JSON is handled by
          // the strict parser below.
          logEvent("ai.website.draft.start", {
            kind: fallback.kind,
            category: fallback.category,
          });
          const raw = await generateWebsiteDraftMetadata(
            finalPost.image,
            buildWebsiteDraftPrompt(source),
          );
          assertOperationAuthEpoch(variables.authEpoch);
          const prepared = parseWebsiteDraftResponse(raw, source);
          logEvent("ai.website.draft.success", {
            source: prepared.source,
            kind: prepared.draft.kind,
          });
          return prepared.draft;
        } catch (err) {
          logError("ai.website.draft.failure", {
            message: err instanceof Error ? err.message : String(err),
            kind: fallback.kind,
          });
          return fallback;
        }
      };

      const websiteDraft = await websiteDraftTask();
      if (websiteDraft) finalPost.websiteDraft = websiteDraft;
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      // Last point where a cancel means nothing was created (B5).
      if (variables.run.cancelled) return;

      // Log post + (if a release was captured) link the already-persisted
      // release to it. The signature was durably saved before the provider
      // call, and this phase never uploads or duplicates it. An
      // approval-gated creative must be persisted before rendering the result,
      // because the returned id is the secure status-polling handle and the
      // manager needs the exact image/caption they are approving.
      if (currentDealer) {
        let releaseLinkAttempted = false;
        const persistPost = async () => {
          const captured = variables.meta?.capturedRelease;
          assertOperationAuthEpoch(variables.authEpoch);
          const post = await logPost(
            {
              dealerId: currentDealer.id,
              style: variables.style,
              tone: variables.tone,
              // Release linking uses the protected exact signer name. Public
              // copy uses finalPost.customerDisplayName and never this value.
              customerName: captured?.customerName || variables.customerName,
              customerIdentityRequired: variables.meta?.customerIdentityRequired,
              scenarioId: variables.meta?.scenarioId,
              vin: variables.meta?.vin,
              // The release route flips this true only after its protected
              // signature file has been durably stored. Starting false avoids a
              // false consent claim if that second write fails.
              hasRelease: false,
              hasVideo: false,
              requiresApproval: !!currentDealer.requires_approval,
              caption: finalPost.text,
              disclosures: finalPost.disclosures,
              imageDataUrl: finalPost.image,
              captionSource: finalPost.captionSource,
              generationTier: finalPost.aiMeta?.selectedTier,
              generationModel: finalPost.aiMeta?.model,
              generationFallbackCount: finalPost.aiMeta?.fallbackCount,
              generationLastSuccessAt: finalPost.aiMeta?.lastSuccessfulGenerationAt,
              modelPolicyVersion: finalPost.aiMeta?.modelPolicyVersion,
              captionAttemptId: finalPost.aiMeta?.caption.attemptId,
              imageAttemptId: finalPost.aiMeta?.image.attemptId,
              platformIds: finalPost.platformIds,
              mediaOutputMode: finalPost.mediaOutputMode,
              primaryFormatId: finalPost.primaryFormatId,
              imageAspectRatio: finalPost.imageAspectRatio,
              websiteDraft: finalPost.websiteDraft,
              grounding: {
                dealerName: currentDealer.name,
                oemAffiliation: currentDealer.oem_affiliation,
                vehicleDescription: variables.meta?.websiteVehicleDescription,
                salespersonName: useAppStore.getState().currentPerson?.name,
              },
            },
            variables.authEpoch,
          );
          assertOperationAuthEpoch(variables.authEpoch);
          let releaseStatus: NonNullable<GeneratedPost["releaseStatus"]> =
            post?.release_required && post.release_status !== "saved"
              ? "save_failed"
              : captured
                ? "save_failed"
                : "not_required";
          // Distinct from the branch above: here the signature is already
          // durably stored (runWithPersistedPhotoRelease rejects before the
          // provider call otherwise), so a failure is only a missing
          // association, and both ids needed to repair it are in hand.
          let releaseLinkStatus: GeneratedPost["releaseLinkStatus"];
          let unlinkedReleaseId: string | undefined;
          if (captured && releaseId && post) {
            const { linkReleaseToPostWithRetry } =
              await import("../services/photoReleases");
            releaseLinkAttempted = true;
            try {
              const linked = await linkReleaseToPostWithRetry(releaseId, post.id, {
                requestAuthEpoch: variables.authEpoch,
                onRetry: (attempt) =>
                  logEvent("photo_release.link_retry", {
                    attempt,
                    postId: post.id,
                  }),
              });
              assertOperationAuthEpoch(variables.authEpoch);
              post.updated = linked.post_revision;
              releaseStatus = "saved";
            } catch (err) {
              // Consent exists on the server. Keep every delivery gate closed,
              // but record that this is the recoverable variant so the result
              // screen offers a retry instead of demanding a new signature.
              releaseLinkStatus = "link_failed";
              unlinkedReleaseId = releaseId;
              logError("photo_release.link_failed", {
                message: err instanceof Error ? err.message : String(err),
                postId: post.id,
                releaseId,
              });
            }
          }
          if (captured && (!releaseId || !post)) {
            logError("photo_release.link_failed", {
              message: !releaseId
                ? "Persisted release id was unavailable"
                : "Post record was unavailable for release linking",
            });
          }
          return { post, releaseStatus, releaseLinkStatus, unlinkedReleaseId };
        };

        // Await the small first-party persistence request for every generated
        // post. Besides making metrics truthful, this gives subsequent video
        // and release updates an owner-scoped post id.
        // B5: from here a cancel lets this save finish, and only the result
        // is discarded. A1: the release is spent from the moment it starts.
        const capturedForPost = variables.meta?.capturedRelease;
        const releaseIdForPost = releaseId ?? capturedForPost?.releaseId;
        if (capturedForPost) markReleaseLinked(capturedForPost, releaseIdForPost);
        advanceGenerationStage(variables.run, "saving");
        const persistence = persistPost();
        variables.run.requiresApproval = !!currentDealer.requires_approval;
        variables.run.saved = persistence.then(
          (outcome) => Boolean(outcome.post),
          () => false,
        );
        variables.run.persistenceStarted = true;
        let persisted: Awaited<typeof persistence>;
        try {
          persisted = await persistence;
        } finally {
          if (capturedForPost && !releaseLinkAttempted) {
            unmarkReleaseLinked(capturedForPost, releaseIdForPost);
          }
        }
        if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
        // Cancelled while saving: the post stays in My work, the result
        // screen never opens for it.
        if (variables.run.cancelled) return;
        const post = persisted.post;
        finalPost.releaseStatus = persisted.releaseStatus;
        if (persisted.releaseLinkStatus && persisted.unlinkedReleaseId) {
          finalPost.releaseLinkStatus = persisted.releaseLinkStatus;
          finalPost.releaseId = persisted.unlinkedReleaseId;
        }
        if (post) {
          finalPost.postId = post.id;
          finalPost.postRevision = post.updated;
          finalPost.imageReviewRequired = Boolean(post.image_review_required);
          if (post.website_draft) finalPost.websiteDraft = post.website_draft;
          finalPost.websitePublication =
            post.website_publication ||
            (finalPost.websiteDraft
              ? {
                  status: "not_requested",
                }
              : undefined);
        } else if (finalPost.websiteDraft) {
          finalPost.websitePublication = {
            status: "failed",
            lastError: "The website draft could not be saved with this post.",
          };
        }

        // No toast for a release failure. The result screen renders one
        // authoritative banner (with the retry action and the accurate copy for
        // whichever variant this is); a toast here repeated the same sentence
        // on top of the customer's photo.

        if (finalPost.imageReviewRequired) {
          toastError(
            "This image could not be tied to the current on-pixel safety review. Copy, share, save, scheduling, approval, and website delivery are locked; create a new post to retry.",
          );
        }

        if (currentDealer.requires_approval) {
          if (post) {
            finalPost.approvalStatus = post.approval_status || "pending";
          } else {
            // Preserve the expensive generated result, but fail closed: no id
            // means there is nothing a manager can review or approve.
            finalPost.approvalStatus = "submission_failed";
            const approvalError =
              "Your post was generated, but it could not be submitted for manager approval. Save and share remain locked; check your connection and create another post to retry.";
            setError(approvalError);
            toastError(approvalError);
          }
        } else {
          finalPost.approvalStatus = "n_a";
        }

        if (!post && !currentDealer.requires_approval) {
          toastWarning(
            "Your post was created, but it could not be saved to history. You can still share and save it now.",
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      if (variables.run.cancelled) return;
      setPostImage(finalPost);
      setStep(AppStep.RESULT);
    },
    onError: (err, variables) => {
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      // Cancel already returned to Details with no error; its abort is not one.
      if (variables.run.cancelled) return;
      cleanupTimers();
      const normalized = normalizeError(err);
      const fullMsg = `Failed to generate your post. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(fullMsg);
      toastError(fullMsg);
      setStep(AppStep.CUSTOMIZE);
    },
  });

  const handleGenerate = useCallback(
    async (
      style: StyleOption,
      tone: ToneOption,
      customerName: string,
      customText?: string,
      creativeBrief?: string,
      meta?: GenerationMeta,
      platformIds?: PlatformId[],
      outputProfile?: PrimaryImageProfile,
      mediaOutputMode: MediaOutputMode = "photo",
    ) => {
      // B5: one generation at a time, decided synchronously on the tap. A run
      // from before a sign-in boundary does not count, even if this tap lands
      // before the auth-epoch effect above has run.
      releaseRunFromPreviousWorkspace();
      if (inFlightRef.current) return;
      // A run that already passed onMutate (the salesperson reopened a post
      // from My work and came back around to Generate while it was still
      // going) is superseded, not blocked, and stopped exactly as Cancel stops
      // it: it can never save a post or replace this newer workspace with its
      // stale result, and a save it had already started finishes in My work.
      // It does not navigate: this run's onMutate owns the step.
      const supersededRun = activeRunRef.current;
      if (supersededRun) detachRun(supersededRun, "superseded");
      inFlightRef.current = true;
      const run: GenerationRun = {
        controller: new AbortController(),
        cancelled: false,
        authEpoch: useAppStore.getState().authEpoch,
        stage: "idle",
        persistenceStarted: false,
        requiresApproval: false,
      };
      activeRunRef.current = run;
      try {
        // Warmed on CAPTURE by useAppController, so this usually resolves from
        // the memoized promise instead of downloading at the Generate tap.
        const { resolvePrimaryImageProfile } = await loadPublishPipeline();
        // Cancelled, or handed back by a sign-in boundary while the pipeline
        // loaded: this tap belonged to the previous workspace.
        if (run.cancelled || activeRunRef.current !== run) return;
        // Single source of truth for this post's creative parameters. Disabled
        // (every existing dealership): `style`/`tone` come back exactly as
        // passed, `platformIds`/`formatIds` are empty, and both branches below
        // fall through to today's values. Enabled: the Look owns style and tone
        // and the category owns destinations and canvases, so a stale caller can
        // never ship a post that contradicts the dealership's brand.
        const resolved = resolveCreative({
          dealer: currentDealer ?? null,
          scenarioId: meta?.scenarioId,
          fallbackStyle: style,
          fallbackTone: tone,
        });
        const resolvedPlatformIds =
          resolved.platformIds.length > 0 ? resolved.platformIds : platformIds;
        // The prescribed canvas set is authoritative: a caller-supplied profile
        // is kept only when it is one of the category's formats.
        const profileHonorsPrescription =
          resolved.formatIds.length === 0 ||
          (outputProfile !== undefined &&
            resolved.formatIds.includes(outputProfile.primaryFormatId));
        const resolvedProfile = profileHonorsPrescription
          ? (outputProfile ?? resolvePrimaryImageProfile(resolvedPlatformIds))
          : resolvePrimaryImageProfile(resolvedPlatformIds);
        const operationAuthEpoch = useAppStore.getState().authEpoch;
        run.authEpoch = operationAuthEpoch;
        await generateMutation.mutateAsync({
          style: resolved.style,
          tone: resolved.tone,
          customerName,
          customText,
          creativeBrief,
          platformIds: resolvedPlatformIds,
          mediaOutputMode,
          primaryFormatId: resolvedProfile.primaryFormatId,
          imageAspectRatio: resolvedProfile.imageAspectRatio,
          meta,
          authEpoch: operationAuthEpoch,
          run,
        });
      } catch (err) {
        // The salesperson asked for this; a cancelled run settles quietly.
        if (run.cancelled) return;
        throw err;
      } finally {
        // A cancelled run already handed the guard back to the next tap.
        if (activeRunRef.current === run) {
          activeRunRef.current = null;
          inFlightRef.current = false;
          setGenerationStage("idle");
          setPartsReady(NO_PARTS_READY);
        }
      }
    },
    [currentDealer, generateMutation, releaseRunFromPreviousWorkspace, detachRun],
  );

  /**
   * Cancel on the Creating screen (amendments B5). The run is stopped by
   * detachRun: before logPost it is aborted and nothing is created (the captured
   * release keeps its stored id, so a retry does not re-sign); after logPost
   * has started, that save is left to finish in My work and only the result
   * is discarded. Either way the salesperson is back on Details with no error,
   * and generationParams (the release and personal line included, in memory)
   * are kept so nothing needs retyping.
   */
  const cancelGeneration = useCallback((): GenerationCancelResult => {
    const run = activeRunRef.current;
    if (!run || run.cancelled) return { status: "idle" };
    detachRun(run, "cancel");
    setError(null);
    setStep(AppStep.CUSTOMIZE);
    if (run.persistenceStarted) {
      return {
        status: "saving",
        requiresApproval: run.requiresApproval,
        saved: run.saved ?? Promise.resolve(false),
      };
    }
    return { status: "cancelled" };
  }, [setError, setStep, detachRun]);

  const supersedeGeneration = useCallback(() => {
    const run = activeRunRef.current;
    if (run && !run.cancelled) detachRun(run, "superseded");
  }, [detachRun]);

  const regenerateImageMutation = useMutation({
    mutationFn: async (override?: GenerationParams) => {
      const request = override || useAppStore.getState().generationParams;
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !request || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const [{ resolvePrimaryImageProfile }, { generateSocialPost }] =
        await Promise.all([loadPublishPipeline(), loadGeminiService()]);
      assertOperationAuthEpoch(operationAuthEpoch);
      const result = await runGeminiTask("ai.regenerate.image", (signal) => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateSocialPost(
          selectedImage,
          request.style,
          request.tone,
          currentDealer.name,
          request.customerName,
          currentDealer.logo,
          request.customText || generatedPost?.text,
          request.creativeBrief,
          imageQualityTier,
          request.imageAspectRatio ??
            resolvePrimaryImageProfile(request.platformIds).imageAspectRatio,
          resolveCustomerIdentityRequired(
            sourcePost.customerIdentityRequired,
            request.customerIdentityRequired,
          ),
          signal,
          undefined,
          currentDealer.logo_placement,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        request.primaryFormatId ??
        resolvePrimaryImageProfile(sourcePost.platformIds ?? request.platformIds)
          .primaryFormatId;
      const image = await renderExactPrimaryImage(result.image, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
        params: override,
        logoCorner: result.aiMeta.image.logoCorner,
      };
    },
    onMutate: () => setError(null),
    // This control promises an image-only refresh. Preserve the caption,
    // disclosure, release, approval, and owner-scoped post metadata rather
    // than replacing the entire reviewed result with the provider response.
    onSuccess: ({ workspaceKey, operationAuthEpoch, image, params, logoCorner }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (currentPost) {
        if (params) useAppStore.getState().setGenerationParams(params);
        setPostImage({
          ...currentPost,
          image,
          aiMeta: withImageLogoCorner(currentPost.aiMeta, logoCorner),
        });
      }
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleRegenerateImage = useCallback(async () => {
    await regenerateImageMutation.mutateAsync(undefined);
  }, [regenerateImageMutation]);

  const handleChangeLook = useCallback(
    async (look: SignatureLook | StyleOption) => {
      const state = useAppStore.getState();
      const post = state.generatedPost;
      const previous = state.generationParams;
      const workspaceKey = workspaceKeyForPost(post);
      if (!post || !previous || !state.selectedImage || !state.currentDealer)
        throw new Error("The original photo is needed to change the Look.");
      if (
        post.historyReadOnly ||
        post.imageReviewRequired ||
        post.releaseStatus === "save_failed" ||
        (state.currentDealer.requires_approval && post.approvalStatus !== "n_a") ||
        post.websitePublication?.status === "published"
      ) {
        throw new Error(
          "This post is locked for review. Start a new post to change its Look.",
        );
      }
      const [{ buildSavedPostLookRequest }, { resolveStoreDefaults }] =
        await Promise.all([
          import("../services/generationRequest"),
          import("../services/storeDefaults"),
        ]);
      assertOperationAuthEpoch(state.authEpoch);
      if (!workspaceIsCurrent(workspaceKey)) return;
      const defaults = resolveStoreDefaults({
        dealer: state.currentDealer,
        person: state.currentPerson,
        categoryId: state.postDraft?.categoryId || "deliveries",
        scenarioId: post.scenarioId || previous.scenarioId || "customer_delivery",
        websiteReady: Boolean(post.websiteDraft?.enabled),
      });
      const choice = defaults.looks.find((item) => item.id === look);
      if (!choice) throw new Error("This Look is not enabled by your store.");
      const definition = isSignatureLook(look)
        ? LOOK_DEFINITIONS[look]
        : { style: look, tone: previous.tone };
      const built = buildSavedPostLookRequest(
        {
          dealershipName: state.currentDealer.name,
          currentDealer: state.currentDealer,
          scenarioId: post.scenarioId || previous.scenarioId || "customer_delivery",
          decodedVehicle:
            state.postDraft?.decodedVehicle || previous.decodedVehicle || null,
          capturedRelease: null,
          releaseAlreadyLinked: false,
          customerName: previous.customerName,
          personalLine: state.postDraft?.personalLine || previous.personalLine || "",
          creativeEnabled: true,
          resolvedStyle: definition.style,
          resolvedTone: definition.tone,
          playfulOffered: false,
          playfulRequested: false,
          captionSource: "ai",
          customMessage: "",
          effectivePlatformIds: previous.platformIds || [],
          websiteSelected: Boolean(post.websiteDraft?.enabled),
          effectiveImageProfile: {
            label: "Post image",
            primaryFormatId: post.primaryFormatId || "feed_portrait",
            imageAspectRatio: post.imageAspectRatio || "4:5",
          },
          effectiveMediaMode: previous.mediaOutputMode || "photo",
        },
        post,
      );
      if (!built.ok)
        throw new Error(
          built.message ||
            "Confirm the customer and vehicle details before changing the Look.",
        );
      await regenerateImageMutation.mutateAsync({
        ...previous,
        style: built.style,
        tone: built.tone,
        creativeBrief: built.creativeBrief,
      });
    },
    [regenerateImageMutation],
  );

  const funModeMutation = useMutation({
    mutationFn: async (styleName?: string) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const [{ resolvePrimaryImageProfile }, { generateFunSocialPostImage }] =
        await Promise.all([loadPublishPipeline(), loadGeminiService()]);
      assertOperationAuthEpoch(operationAuthEpoch);
      const generatedImage = await runGeminiTask("ai.fun", (signal) => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateFunSocialPostImage(
          selectedImage,
          currentDealer.name,
          currentDealer.logo,
          styleName,
          imageQualityTier,
          generationParams?.imageAspectRatio ??
            generatedPost?.imageAspectRatio ??
            resolvePrimaryImageProfile(
              generationParams?.platformIds ?? generatedPost?.platformIds,
            ).imageAspectRatio,
          generationParams?.creativeBrief,
          signal,
          currentDealer.logo_placement,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        generationParams?.primaryFormatId ??
        resolvePrimaryImageProfile(
          sourcePost.platformIds ?? generationParams?.platformIds,
        ).primaryFormatId;
      const image = await renderExactPrimaryImage(generatedImage, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({ workspaceKey, operationAuthEpoch, image }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      // The earlier image's logo-corner note no longer describes this one.
      if (currentPost)
        setPostImage({
          ...currentPost,
          image,
          aiMeta: withImageLogoCorner(currentPost.aiMeta, undefined),
        });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate fun image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleFunMode = useCallback(
    async (styleName?: string) => {
      await funModeMutation.mutateAsync(styleName);
    },
    [funModeMutation],
  );

  const editImageMutation = useMutation({
    mutationFn: async (editPrompt: string) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!sourcePost?.image || !editPrompt.trim() || !currentDealer)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const [{ resolvePrimaryImageProfile }, { editSocialPostImage }] =
        await Promise.all([loadPublishPipeline(), loadGeminiService()]);
      assertOperationAuthEpoch(operationAuthEpoch);
      const generatedImage = await runGeminiTask("ai.edit.image", (signal) => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return editSocialPostImage(
          sourcePost.image,
          editPrompt,
          currentDealer.name,
          currentDealer.logo,
          imageQualityTier,
          sourcePost.imageAspectRatio ??
            generationParams?.imageAspectRatio ??
            resolvePrimaryImageProfile(
              sourcePost.platformIds ?? generationParams?.platformIds,
            ).imageAspectRatio,
          signal,
          currentDealer.logo_placement,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        generationParams?.primaryFormatId ??
        resolvePrimaryImageProfile(
          sourcePost.platformIds ?? generationParams?.platformIds,
        ).primaryFormatId;
      const image = await renderExactPrimaryImage(generatedImage, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({ workspaceKey, operationAuthEpoch, image }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      // The earlier image's logo-corner note no longer describes this one.
      if (currentPost)
        setPostImage({
          ...currentPost,
          image,
          aiMeta: withImageLogoCorner(currentPost.aiMeta, undefined),
        });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to apply image edits. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleEditImage = useCallback(
    async (editPrompt: string) => {
      await editImageMutation.mutateAsync(editPrompt);
    },
    [editImageMutation],
  );

  const regenerateTextMutation = useMutation({
    mutationFn: async () => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !generationParams || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const [pipeline, { generateSocialPostTextDetailed }] = await Promise.all([
        loadPublishPipeline(),
        loadGeminiService(),
      ]);
      const { deliveryLanguageAllowedForBrief, prepareCaptionForDelivery } = pipeline;
      const customerIdentityRequired = resolveCustomerIdentityRequired(
        sourcePost.customerIdentityRequired,
        generationParams.customerIdentityRequired,
      );
      assertOperationAuthEpoch(operationAuthEpoch);
      const captionResult = await runGeminiTask("ai.regenerate.text", (signal) => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateSocialPostTextDetailed(
          selectedImage,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          true,
          generationParams.creativeBrief,
          generationParams.style,
          customerIdentityRequired,
          signal,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const prepared = prepareCaptionForDelivery(
        captionResult.text,
        currentDealer.banned_phrases,
        brandKitFromDealer(currentDealer),
        deliveryLanguageAllowedForBrief(
          generationParams.creativeBrief,
          customerIdentityRequired,
        ),
      );
      const offendingRegenerated = unauthorizedCustomerIdentities(pipeline, {
        caption: prepared.caption,
        customerName: sourcePost.customerDisplayName || generationParams.customerName,
        dealerName: currentDealer.name,
        oemAffiliation: currentDealer.oem_affiliation,
        vehicleDescription: generationParams.websiteVehicleDescription,
        identityRequired: resolveCustomerIdentityRequired(
          sourcePost.customerIdentityRequired,
          generationParams.customerIdentityRequired,
        ),
      });
      if (offendingRegenerated.length > 0) {
        throw new Error(customerIdentityErrorFor(pipeline, offendingRegenerated));
      }
      const platformIds = generationParams.platformIds ?? sourcePost.platformIds ?? [];
      return {
        workspaceKey,
        operationAuthEpoch,
        prepared,
        platformIds,
        captionResult,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({
      workspaceKey,
      operationAuthEpoch,
      prepared,
      platformIds,
      captionResult,
    }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (!currentPost) return;
      setGeneratedPost({
        ...currentPost,
        text: prepared.caption,
        captionSource: captionResult.captionSource,
        isBasicFallback: captionResult.captionSource === "basic_fallback",
        aiMeta: mergeCaptionProvenance(
          currentPost.aiMeta,
          captionResult,
          imageQualityTier,
        ),
        platformCaptions: captionForSavedChannels(
          currentPost.platformCaptions,
          prepared.caption,
        ),
        platformIds: platformIds.length > 0 ? platformIds : currentPost.platformIds,
        disclosures: prepared.disclosures,
        disclosureCategories: prepared.disclosureCategories,
      });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate text. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleRegenerateText = useCallback(async () => {
    await regenerateTextMutation.mutateAsync();
  }, [regenerateTextMutation]);

  // One-shot caption generator that RETURNS the fully-prepared caption
  // (brand kit + delivery-language gating + disclosures already applied)
  // instead of side-effecting the post. Used by CaptionAlternativesModal,
  // which spawns 3 in parallel and lets the salesperson pick — replaces
  // state itself on selection. The caller must use this result AS-IS rather
  // than re-running prepareCaptionForDelivery on it: a second pass has no
  // scenario/brandKit context of its own to get deliveryLanguageAllowed or
  // the footer right a second time.
  const generateCaptionVariant = useCallback(async (): Promise<{
    caption: string;
    disclosures: string;
    disclosureCategories: string[];
  }> => {
    const operationAuthEpoch = useAppStore.getState().authEpoch;
    if (!selectedImage || !generationParams || !currentDealer) {
      throw new Error("Missing required data for caption variant");
    }
    assertOperationAuthEpoch(operationAuthEpoch);
    const [pipeline, { generateSocialPostText }] = await Promise.all([
      loadPublishPipeline(),
      loadGeminiService(),
    ]);
    const { deliveryLanguageAllowedForBrief, prepareCaptionForDelivery } = pipeline;
    const customerIdentityRequired = resolveCustomerIdentityRequired(
      useAppStore.getState().generatedPost?.customerIdentityRequired,
      generationParams.customerIdentityRequired,
    );
    assertOperationAuthEpoch(operationAuthEpoch);
    const variant = await runGeminiTask("ai.caption.variant", (signal) => {
      assertOperationAuthEpoch(operationAuthEpoch);
      return generateSocialPostText(
        selectedImage,
        generationParams.tone,
        currentDealer.name,
        generationParams.customerName,
        true, // regeneration mode — higher temperature, guaranteed variation
        generationParams.creativeBrief,
        generationParams.style,
        customerIdentityRequired,
        signal,
      );
    });
    assertOperationAuthEpoch(operationAuthEpoch);
    const prepared = prepareCaptionForDelivery(
      variant,
      currentDealer.banned_phrases,
      brandKitFromDealer(currentDealer),
      deliveryLanguageAllowedForBrief(
        generationParams.creativeBrief,
        customerIdentityRequired,
      ),
    );
    const offendingVariant = unauthorizedCustomerIdentities(pipeline, {
      caption: prepared.caption,
      customerName:
        useAppStore.getState().generatedPost?.customerDisplayName ||
        generationParams.customerName,
      dealerName: currentDealer.name,
      oemAffiliation: currentDealer.oem_affiliation,
      vehicleDescription: generationParams.websiteVehicleDescription,
      identityRequired: customerIdentityRequired,
    });
    if (offendingVariant.length > 0) {
      throw new Error(customerIdentityErrorFor(pipeline, offendingVariant));
    }
    if (operationAuthEpoch !== useAppStore.getState().authEpoch) {
      throw new Error("Your signed-in workspace changed during caption generation.");
    }
    return {
      caption: prepared.caption,
      disclosures: prepared.disclosures,
      disclosureCategories: prepared.disclosureCategories,
    };
  }, [
    selectedImage,
    generationParams,
    currentDealer,
    loadGeminiService,
    runGeminiTask,
  ]);

  const editTextMutation = useMutation({
    mutationFn: async ({
      editPrompt,
      originalText,
      platformId,
    }: {
      editPrompt: string;
      originalText?: string;
      platformId?: string;
    }) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      const sourceText = originalText?.trim() || sourcePost?.text || "";
      if (!sourcePost || !sourceText || !editPrompt.trim())
        throw new Error("Missing required data");
      const pipeline = await loadPublishPipeline();
      const {
        deliveryLanguageAllowedForBrief,
        prepareCaptionForDelivery,
        toPublicCustomerLabel,
      } = pipeline;
      const publicCustomer =
        sourcePost.customerDisplayName ||
        toPublicCustomerLabel(generationParams?.customerName);
      const customerIdentityRequired = resolveCustomerIdentityRequired(
        sourcePost.customerIdentityRequired,
        generationParams?.customerIdentityRequired,
      );
      if (
        !customerIdentityIsSafe(pipeline, {
          caption: sourceText,
          customerName: publicCustomer,
          dealerName: currentDealer?.name,
          oemAffiliation: currentDealer?.oem_affiliation,
          vehicleDescription: generationParams?.websiteVehicleDescription,
          identityRequired: customerIdentityRequired,
        })
      ) {
        throw new Error(
          "This caption contains an unapproved customer name. Start from a corrected caption before using AI edits.",
        );
      }
      assertOperationAuthEpoch(operationAuthEpoch);
      const { editSocialPostTextDetailed } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      // The per-device tone memory is retired under the creative system: when
      // no tone is attached to this post the Look supplies it, not the last
      // value this phone happened to store. Disabled dealerships still land on
      // exactly `preferredTone`.
      const tone =
        generationParams?.tone ||
        resolveCreative({
          dealer: currentDealer ?? null,
          scenarioId: generationParams?.scenarioId,
          fallbackTone: preferredTone,
        }).tone;
      const identityInstruction = publicCustomer
        ? `Customer identity rule: the only customer label allowed is exactly "${publicCustomer}". Do not add, replace, or infer another person's name.`
        : "Customer identity rule: do not introduce any customer or personal name.";
      const identityBoundEditPrompt = `${editPrompt.trim()}\n\n${identityInstruction}`;
      const captionResult = await runGeminiTask("ai.edit.text", (signal) => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return editSocialPostTextDetailed(
          sourceText,
          identityBoundEditPrompt,
          tone,
          signal,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const prepared = prepareCaptionForDelivery(
        captionResult.text,
        currentDealer?.banned_phrases,
        brandKitFromDealer(currentDealer),
        deliveryLanguageAllowedForBrief(
          generationParams?.creativeBrief,
          customerIdentityRequired,
        ),
      );
      if (
        !customerIdentityIsSafe(pipeline, {
          caption: prepared.caption,
          customerName: publicCustomer,
          dealerName: currentDealer?.name,
          oemAffiliation: currentDealer?.oem_affiliation,
          vehicleDescription: generationParams?.websiteVehicleDescription,
          identityRequired: customerIdentityRequired,
          requireExpected: Boolean(
            publicCustomer &&
            customerIdentityIsSafe(pipeline, {
              caption: sourceText,
              customerName: publicCustomer,
              dealerName: currentDealer?.name,
              oemAffiliation: currentDealer?.oem_affiliation,
              vehicleDescription: generationParams?.websiteVehicleDescription,
              identityRequired: resolveCustomerIdentityRequired(
                sourcePost.customerIdentityRequired,
                generationParams?.customerIdentityRequired,
              ),
              requireExpected: true,
            }),
          ),
        })
      ) {
        throw new Error(customerIdentityError);
      }
      return {
        workspaceKey,
        operationAuthEpoch,
        platformId,
        prepared,
        captionResult,
      };
    },
    onMutate: () => setError(null),
    onSuccess: async ({
      workspaceKey,
      operationAuthEpoch,
      platformId,
      prepared,
      captionResult,
    }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (!currentPost) return;
      if (platformId) {
        const platformCaptions = {
          ...(currentPost.platformCaptions || {}),
          [platformId]: prepared.caption,
        };
        // Resolves from the memoized promise the mutation already awaited.
        const { analyzeCaptionSetForDelivery } = await loadPublishPipeline();
        const disclosureUnion = analyzeCaptionSetForDelivery(
          [currentPost.text, ...Object.values(platformCaptions)],
          currentDealer?.banned_phrases,
        );
        setGeneratedPost({
          ...currentPost,
          platformCaptions,
          disclosures: disclosureUnion.disclosures,
          disclosureCategories: disclosureUnion.disclosureCategories,
        });
        return;
      }
      setGeneratedPost({
        ...currentPost,
        text: prepared.caption,
        captionSource: captionResult.captionSource,
        isBasicFallback: false,
        aiMeta: mergeCaptionProvenance(
          currentPost.aiMeta,
          captionResult,
          imageQualityTier,
        ),
        disclosures: prepared.disclosures,
        disclosureCategories: prepared.disclosureCategories,
        platformCaptions: captionForSavedChannels(
          currentPost.platformCaptions,
          prepared.caption,
        ),
      });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to apply text edits. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleEditText = useCallback(
    async (
      editPrompt: string,
      originalText?: string,
      platformId?: string,
    ): Promise<string> => {
      const result = await editTextMutation.mutateAsync({
        editPrompt,
        originalText,
        platformId,
      });
      return result.prepared.caption;
    },
    [editTextMutation],
  );

  const handlePrepareFinalWebsiteDraft = useCallback(
    async (input: {
      caption: string;
      image: string;
      currentDraft: WebsiteDraft;
    }): Promise<WebsiteDraft> => {
      const state = useAppStore.getState();
      const operationAuthEpoch = state.authEpoch;
      const dealer = state.currentDealer;
      if (!dealer) throw new Error("The dealership workspace is unavailable.");
      assertOperationAuthEpoch(operationAuthEpoch);
      const {
        buildFinalWebsiteDraftFallback,
        buildFinalWebsiteDraftPrompt,
        parseFinalWebsiteDraftResponse,
        toPublicCustomerLabel,
      } = await loadPublishPipeline();
      assertOperationAuthEpoch(operationAuthEpoch);
      const source: FinalWebsiteDraftSource = {
        currentDraft: input.currentDraft,
        dealerName: dealer.name,
        oemAffiliation: dealer.oem_affiliation,
        caption: input.caption,
        customerName:
          state.generatedPost?.customerDisplayName ||
          toPublicCustomerLabel(state.generationParams?.customerName),
      };
      const fallback = buildFinalWebsiteDraftFallback(source);
      if (fallback.kind === "customer_story") return fallback;
      try {
        const { generateWebsiteDraftMetadata } = await loadGeminiService();
        assertOperationAuthEpoch(operationAuthEpoch);
        logEvent("ai.website.final.start", {
          kind: fallback.kind,
          category: fallback.category,
        });
        const raw = await generateWebsiteDraftMetadata(
          input.image,
          buildFinalWebsiteDraftPrompt(source),
        );
        assertOperationAuthEpoch(operationAuthEpoch);
        const prepared = parseFinalWebsiteDraftResponse(raw, source);
        logEvent("ai.website.final.success", {
          source: prepared.source,
          kind: prepared.draft.kind,
        });
        if (prepared.source === "deterministic_fallback") {
          toastWarning(
            "AI could not refresh the website title and image description, so safe review placeholders were used. Check them in Customer Hub before publishing.",
          );
        }
        return prepared.draft;
      } catch (err) {
        // Never turn an auth/workspace change into a usable fallback that the
        // caller could send under a newer session.
        if (operationAuthEpoch !== useAppStore.getState().authEpoch) throw err;
        logError("ai.website.final.failure", {
          message: err instanceof Error ? err.message : String(err),
          kind: fallback.kind,
        });
        toastWarning(
          "AI could not refresh the website title and image description, so safe review placeholders were used. Check them in Customer Hub before publishing.",
        );
        return fallback;
      }
    },
    [loadGeminiService, toastWarning],
  );

  const generateVideoMutation = useMutation({
    mutationFn: async ({
      style,
      options,
    }: {
      style: VideoStyle;
      options: VideoRequestOptions;
    }) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!sourcePost?.image)
        throw new Error("No image available for video generation");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { generatePostVideo } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      // Issue a controller bound to component lifecycle so the poll cancels
      // if the user navigates away.
      const controller = new AbortController();
      videoAbortControllersRef.current.add(controller);
      try {
        const url = await runGeminiTask(
          "ai.generate.video",
          (signal) => {
            assertOperationAuthEpoch(operationAuthEpoch);
            return generatePostVideo(sourcePost.image, style, options, signal);
          },
          undefined,
          controller.signal,
        );
        assertOperationAuthEpoch(operationAuthEpoch);
        if (!workspaceIsCurrent(workspaceKey)) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          throw new Error("This video finished after you opened another post.");
        }
        return { url, workspaceKey, operationAuthEpoch };
      } finally {
        videoAbortControllersRef.current.delete(controller);
      }
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate video. ${normalized.message} ${recoveryHint(normalized)}`;
      toastError(msg);
    },
  });

  const handleGenerateVideo = useCallback(
    async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
      const result = await generateVideoMutation.mutateAsync({ style, options });
      if (
        result.operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(result.workspaceKey)
      ) {
        if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
        throw new Error("This video finished after your signed-in workspace changed.");
      }
      return result.url;
    },
    [generateVideoMutation],
  );

  return {
    generationProgress,
    progressMessage,
    generationStage,
    partsReady,
    cancelGeneration,
    supersedeGeneration,
    handleGenerate,
    handleRegenerateImage,
    handleChangeLook,
    handleFunMode,
    handleEditImage,
    handleRegenerateText,
    handleEditText,
    handlePrepareFinalWebsiteDraft,
    handleGenerateVideo,
    generateCaptionVariant,
  };
};
