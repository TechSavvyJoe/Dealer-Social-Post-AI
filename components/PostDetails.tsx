import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ScanLine, Sparkles } from "lucide-react";
import type {
  ImageSelection,
  MediaOutputMode,
  PendingRelease,
  PostDraft,
  StyleOption,
  ToneOption,
} from "../types";
import type { PlatformId, PrimaryImageProfile } from "../services/platformCopy";
import { useAppStore } from "../stores/appStore";
import {
  buildGenerationRequest,
  PERSONAL_LINE_MAX,
} from "../services/generationRequest";
import { homeTilesForDealer, resolveStoreDefaults } from "../services/storeDefaults";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { usePhotoIntake } from "../hooks/usePhotoIntake";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { isReleaseAlreadyLinked } from "../hooks/useGeneration";
import { listWebsiteDestinations } from "../services/websitePublishing";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { ErrorBanner } from "./ui/ErrorBanner";
import { VinScanner } from "./VinScanner";
import { ReleaseSheet } from "./details/ReleaseSheet";
import { PhotoPanel } from "./details/PhotoPanel";

export interface PostDetailsProps {
  imageSrc: string;
  onGenerate: (
    style: StyleOption,
    tone: ToneOption,
    customerName: string,
    customText?: string,
    creativeBrief?: string,
    meta?: Record<string, unknown>,
    platformIds?: PlatformId[],
    outputProfile?: PrimaryImageProfile,
    mediaOutputMode?: MediaOutputMode,
  ) => void | Promise<void>;
  onBack: () => void;
  onChangePhoto: (selection: ImageSelection) => void;
  error?: string | null;
  onDismissError?: () => void;
}

const PostDetailsContent: React.FC<PostDetailsProps & { draft: PostDraft }> = ({
  imageSrc,
  onGenerate,
  onBack,
  onChangePhoto,
  error,
  onDismissError,
  draft,
}) => {
  const dealer = useAppStore((state) => state.currentDealer);
  const person = useAppStore((state) => state.currentPerson);
  const setPostDraft = useAppStore((state) => state.setPostDraft);
  const pendingRelease = useAppStore((state) => state.pendingRelease);
  const setPendingRelease = useAppStore((state) => state.setPendingRelease);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [vinOpen, setVinOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(Boolean(draft?.personalLine));
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [websiteReady, setWebsiteReady] = useState(false);

  const intake = usePhotoIntake({
    enableDrop: false,
    flattenToJpeg: true,
    onImageSelected: (selection) => {
      setPendingRelease(null);
      onChangePhoto(selection);
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    void listWebsiteDestinations(controller.signal)
      .then((items) => setWebsiteReady(items.length > 0))
      .catch(() => setWebsiteReady(false));
    return () => controller.abort();
  }, [dealer?.id]);

  const tile = useMemo(
    () =>
      homeTilesForDealer(dealer).find(
        (entry) => entry.scenarioId === draft?.scenarioId,
      ),
    [dealer, draft?.scenarioId],
  );
  const defaults = useMemo(
    () =>
      resolveStoreDefaults({
        dealer,
        person,
        categoryId: draft.categoryId,
        scenarioId: draft.scenarioId,
        websiteReady,
      }),
    [dealer, draft, person, websiteReady],
  );

  const request = buildGenerationRequest({
    dealershipName: dealer?.name || "Dealership",
    currentDealer: dealer,
    scenarioId: draft.scenarioId,
    decodedVehicle: draft.decodedVehicle || null,
    capturedRelease: pendingRelease,
    releaseAlreadyLinked:
      isReleaseAlreadyLinked(pendingRelease) || pendingRelease?.linked === true,
    customerName: toPublicCustomerLabel(pendingRelease?.customerName),
    personalLine: draft.personalLine || "",
    // Details always supports the optional personal line. Store defaults still
    // choose the correct legacy/v2 style and tone; this flag keeps the request
    // builder's identity check and brief append active for every dealership.
    creativeEnabled: true,
    resolvedStyle: defaults.style,
    resolvedTone: defaults.tone,
    playfulOffered: Boolean(defaults.playfulStyleId),
    playfulRequested: Boolean(defaults.playfulStyleId && person?.playfulDefault),
    playfulStyleId: defaults.playfulStyleId,
    captionSource: "ai",
    customMessage: "",
    effectivePlatformIds: defaults.generationPlatformIds,
    websiteSelected: defaults.websiteChannel,
    effectiveImageProfile: defaults.primaryProfile,
    effectiveMediaMode: "photo",
  });

  const gateReason = request.ok
    ? null
    : request.reason === "release_required"
      ? "Needs the customer's signature first"
      : request.reason === "identity"
        ? request.message || "Check the optional line before creating."
        : request.reason === "no_destination"
          ? "No sharing destination is configured."
          : "The signature no longer matches this customer or vehicle.";
  const reasonId = "create-post-reason";

  const createPost = async () => {
    if (!request.ok || submitting) {
      if (!request.ok && request.reason.startsWith("release")) setReleaseOpen(true);
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      const args = request.args;
      await onGenerate(
        args.style,
        args.tone,
        args.customerName,
        args.customText,
        args.creativeBrief,
        draft.personalLine
          ? { ...args.meta, personalLine: draft.personalLine }
          : args.meta,
        args.platformIds,
        args.outputProfile,
        args.mediaOutputMode,
      );
    } catch {
      setLocalError(
        "Generation was interrupted. Your photo and details are still here.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  useKeyboardShortcuts({ onPrimary: () => void createPost(), onCancel: onBack });

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-7 px-0 pb-[calc(6.5rem+var(--sab))] pt-3 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(350px,.65fr)] lg:gap-10 lg:px-8 lg:pb-10 lg:pt-10">
      <PhotoPanel
        imageSrc={imageSrc}
        categoryLabel={tile?.label || "Post"}
        categoryBlurb={tile?.blurb}
        dealerName={dealer?.name}
        isProcessing={intake.isProcessing}
        onFile={(file) => void intake.processFile(file)}
      />

      <section className="flex min-h-[430px] flex-col px-4 sm:rounded-xl sm:border sm:border-hairline sm:bg-panel sm:p-5 lg:p-6">
        <div className="hidden lg:block">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-md border border-strong bg-brand-tint text-brand-ink">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-2xs font-semibold uppercase tracking-[0.15em] text-brand-ink">
              Post setup
            </p>
          </div>
          <h1 className="font-display text-3xl font-semibold text-ink">
            {tile?.label || "Post details"}
          </h1>
          <p className="mt-1 text-ink-2">{tile?.blurb}</p>
        </div>
        {error || localError || intake.error ? (
          <ErrorBanner
            message={error || localError || intake.error || ""}
            onRetry={() => {
              setLocalError(null);
              intake.setError(null);
              onDismissError?.();
            }}
            className="mb-4 mt-4"
          />
        ) : null}

        <div className="mt-3 space-y-3 lg:mt-6">
          {defaults.releaseRequired ? (
            pendingRelease ? (
              <button
                type="button"
                onClick={() => setReleaseOpen(true)}
                className="flex min-h-16 w-full items-center gap-3 rounded-md border border-hairline bg-panel-raised px-4 text-left hover:border-strong hover:bg-fill-subtle"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-brand-tint text-brand-ink">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="flex-1">Customer&apos;s signature</span>
                <span className="text-sm font-medium text-brand-ink">
                  Signed · {pendingRelease.customerName}
                </span>
                <ChevronRight className="h-5 w-5 text-ink-hint" aria-hidden="true" />
              </button>
            ) : (
              <div className="rounded-md border border-hairline bg-panel-raised p-4">
                <div className="mb-3 flex justify-between">
                  <span>Customer&apos;s signature</span>
                  <span className="text-warning-ink">Needed</span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={() => setReleaseOpen(true)}
                >
                  Get customer&apos;s signature
                </Button>
              </div>
            )
          ) : null}

          {defaults.vehicleRelevant ? (
            <button
              type="button"
              onClick={() => setVinOpen(true)}
              className="flex min-h-16 w-full items-center gap-3 rounded-md border border-hairline bg-panel-raised px-4 text-left hover:border-strong hover:bg-fill-subtle"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-brand-tint text-brand-ink">
                <ScanLine className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="flex-1">Vehicle</span>
              <span className="max-w-[55%] truncate text-sm text-ink-hint">
                {draft.decodedVehicle?.summary || "Scan VIN · optional"}
              </span>
              <ChevronRight className="h-5 w-5 text-ink-hint" aria-hidden="true" />
            </button>
          ) : null}

          {lineOpen ? (
            <div className="rounded-md border border-hairline bg-panel-raised p-4">
              <label
                htmlFor="personal-line"
                className="mb-1.5 block text-sm text-ink-2"
              >
                Anything to mention? <span className="text-ink-hint">optional</span>
              </label>
              <textarea
                id="personal-line"
                value={draft.personalLine || ""}
                maxLength={PERSONAL_LINE_MAX}
                onChange={(event) =>
                  setPostDraft({ ...draft, personalLine: event.target.value })
                }
                className="min-h-24 w-full rounded-md border border-strong bg-panel p-3 text-base text-ink"
              />
              <div className="mt-1 text-right text-caption text-ink-hint">
                {PERSONAL_LINE_MAX - (draft.personalLine?.length || 0)} left
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLineOpen(true)}
              className="flex min-h-14 w-full items-center rounded-md border border-dashed border-strong px-4 text-left text-ink-2 hover:bg-fill-subtle"
            >
              <span className="flex-1">
                Anything to mention? <span className="text-ink-hint">optional</span>
              </span>
              <ChevronRight className="h-5 w-5 text-ink-hint" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-auto border-t border-hairline pt-6 lg:mt-8">
          {gateReason ? (
            <p id={reasonId} className="mb-2 text-center text-sm text-ink-hint">
              {gateReason}
            </p>
          ) : null}
          <Button
            type="button"
            size="lg"
            fullWidth
            loading={submitting}
            aria-disabled={Boolean(gateReason)}
            aria-describedby={gateReason ? reasonId : undefined}
            onClick={() => void createPost()}
          >
            Create post
          </Button>
        </div>
      </section>

      <Modal
        isOpen={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        title="Customer photo release"
        size="lg"
      >
        <ReleaseSheet
          dealershipName={dealer?.name || "Dealership"}
          vin={draft.decodedVehicle?.vin}
          defaultCustomerName={pendingRelease?.customerName}
          onCancel={() => setReleaseOpen(false)}
          onCaptured={(release: PendingRelease) => {
            setPendingRelease(release);
            setReleaseOpen(false);
          }}
        />
      </Modal>
      <VinScanner
        isOpen={vinOpen}
        onClose={() => setVinOpen(false)}
        onVehicleDecoded={(vehicle) => {
          if (pendingRelease && pendingRelease.vin !== vehicle.vin) {
            setPendingRelease(null);
            setLocalError("Vehicle changed — get the signature again");
          }
          setPostDraft({ ...draft, decodedVehicle: vehicle });
        }}
      />
    </div>
  );
};

export const PostDetails: React.FC<PostDetailsProps> = (props) => {
  const draft = useAppStore((state) => state.postDraft);
  return draft ? <PostDetailsContent {...props} draft={draft} /> : null;
};
