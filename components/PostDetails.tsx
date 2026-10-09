import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, MessageSquareText, PenLine, ScanLine } from "lucide-react";
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
import { Badge } from "./ui/Badge";
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

const REASON_ID = "create-post-reason";
const LINE_COUNT_ID = "personal-line-count";

/** One tappable row: icon, label with its status tag, value, chevron. */
const DetailRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
  value?: string;
  valueClassName?: string;
  onClick: () => void;
}> = ({ icon, label, badge, value, valueClassName = "max-w-[40%]", onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex min-h-16 w-full items-center gap-3 rounded-md border border-hairline bg-panel-raised px-4 py-3 text-left text-ink transition-colors duration-120 ease-out hover:border-strong"
  >
    <span className="shrink-0 text-ink-2 [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
      {icon}
    </span>
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-base">{label}</span>
      {badge}
    </span>
    {value ? (
      <span className={`${valueClassName} truncate text-sm text-ink-2`}>{value}</span>
    ) : null}
    <ChevronRight className="h-5 w-5 shrink-0 text-ink-hint" aria-hidden="true" />
  </button>
);

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
  const role = useAppStore((state) => state.role);
  const setPostDraft = useAppStore((state) => state.setPostDraft);
  const pendingRelease = useAppStore((state) => state.pendingRelease);
  const setPendingRelease = useAppStore((state) => state.setPendingRelease);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [vinOpen, setVinOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(Boolean(draft?.personalLine));
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [websiteReady, setWebsiteReady] = useState(false);
  const [websiteDiscovery, setWebsiteDiscovery] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [websiteDiscoveryAttempt, setWebsiteDiscoveryAttempt] = useState(0);
  const lineRef = useRef<HTMLTextAreaElement>(null);
  const focusLineOnOpen = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState<number | null>(null);

  // Phones: the action bar is fixed over the page, and a long gate reason can
  // wrap to several lines, so the page reserves the bar's measured height
  // (plus a gap) instead of a guess that would hide the bottom of the form.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

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
    let active = true;
    setWebsiteReady(false);
    setWebsiteDiscovery("loading");
    void listWebsiteDestinations(controller.signal)
      .then((items) => {
        if (!active) return;
        setWebsiteReady(items.some((item) => item.enabled));
        setWebsiteDiscovery("ready");
      })
      .catch(() => {
        if (active) setWebsiteDiscovery("failed");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [dealer?.id, websiteDiscoveryAttempt]);

  // Opening "Anything to mention?" swaps the row for the field, so focus
  // follows it instead of falling back to the page.
  useEffect(() => {
    if (lineOpen && focusLineOnOpen.current) {
      focusLineOnOpen.current = false;
      lineRef.current?.focus();
    }
  }, [lineOpen]);

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

  // A1: a signature is single-use. Once it backs a post (Back from Post returns
  // here with the same pendingRelease) it can never back another one.
  const releaseSpent =
    isReleaseAlreadyLinked(pendingRelease) || pendingRelease?.linked === true;

  const request = buildGenerationRequest({
    dealershipName: dealer?.name || "Dealership",
    currentDealer: dealer,
    scenarioId: draft.scenarioId,
    decodedVehicle: draft.decodedVehicle || null,
    capturedRelease: pendingRelease,
    releaseAlreadyLinked: releaseSpent,
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

  // With no usable signature (none yet, already used, or no longer matching
  // this customer or vehicle) the primary action IS getting one; every other
  // gate disables Create post and says why. A fresh capture binds the current
  // VIN, so it always clears a mismatch.
  const signatureMismatch = !request.ok && request.reason === "release_mismatch";
  const needsSignature =
    !request.ok &&
    (request.reason === "release_required" ||
      (signatureMismatch && defaults.releaseRequired));
  const signed = Boolean(pendingRelease) && !releaseSpent && !signatureMismatch;
  // Managers sign in as dealer admins and can add a channel themselves.
  const canSetUpStore = role === "dealer_admin" || role === "super_admin";

  const gateReason =
    (request.ok || request.reason === "no_destination") &&
    websiteDiscovery === "loading"
      ? "Checking your store’s destinations…"
      : (request.ok || request.reason === "no_destination") &&
          websiteDiscovery === "failed" &&
          !request.ok
        ? "Your store’s destinations could not be checked. Retry before creating."
        : request.ok
          ? null
          : request.reason === "release_required"
            ? request.detail === "release_already_used"
              ? "This signature was used for your last post — get a new signature"
              : null
            : request.reason === "identity"
              ? request.message || "Check the optional line before creating."
              : request.reason === "no_destination"
                ? canSetUpStore
                  ? "No place to share is set up for your store yet. Add one in dealership setup."
                  : "No place to share is set up for your store yet. Ask your manager."
                : "The signature no longer matches this customer or vehicle — get a new signature.";

  const openRelease = () => setReleaseOpen(true);

  const createPost = async () => {
    if (!request.ok || submitting || websiteDiscovery === "loading") return;
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
        "Creating the post stopped. Your photo and details are still here.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const primaryAction = () => {
    if (needsSignature) openRelease();
    else void createPost();
  };

  useKeyboardShortcuts({ onPrimary: primaryAction, onCancel: onBack });

  const bannerMessage = error || localError || intake.error;
  const categoryLabel = tile?.label || "Post";

  return (
    <div
      style={
        barHeight
          ? ({ "--details-bar-space": `${barHeight + 24}px` } as React.CSSProperties)
          : undefined
      }
      className="mx-auto grid w-full max-w-[1240px] gap-4 pb-[var(--details-bar-space,calc(8.5rem+var(--sab)))] sm:gap-6 sm:px-6 sm:pt-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(350px,.65fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6 lg:px-8 lg:pb-10 lg:pt-10"
    >
      {/* The header carries the category title on phones; this heading names
          the page for screen readers there and is the display title on desktop. */}
      <div className="max-lg:sr-only lg:col-start-2 lg:row-start-1">
        <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">
          {categoryLabel}
        </h1>
        {tile?.blurb ? <p className="mt-1 text-base text-ink-2">{tile.blurb}</p> : null}
      </div>

      <PhotoPanel
        className="lg:col-start-1 lg:row-span-2 lg:row-start-1"
        imageSrc={imageSrc}
        categoryLabel={categoryLabel}
        isProcessing={intake.isProcessing}
        onFile={(file) => void intake.processFile(file)}
      />

      <section className="flex min-w-0 flex-col px-4 sm:px-0 lg:col-start-2 lg:row-start-2">
        {draft.replacementReason ? (
          <p
            className="mb-3 rounded-sm border border-warning-ink/30 bg-warning-fill px-4 py-3 text-sm leading-5 text-ink"
            role="status"
          >
            <span className="font-semibold">Your manager asked for a change: </span>
            {draft.replacementReason} Review these details before creating the
            replacement.
          </p>
        ) : null}
        {bannerMessage ? (
          <ErrorBanner
            message={bannerMessage}
            actionLabel="Dismiss"
            onRetry={() => {
              setLocalError(null);
              intake.setError(null);
              onDismissError?.();
            }}
            className="mb-3"
          />
        ) : null}

        <div className="space-y-3 lg:pb-8">
          <DetailRow
            icon={<ScanLine />}
            label="Vehicle"
            badge={<Badge variant="neutral">Optional</Badge>}
            value={draft.decodedVehicle?.summary || "Scan VIN"}
            valueClassName="max-w-[55%]"
            onClick={() => setVinOpen(true)}
          />

          {defaults.releaseRequired ? (
            <DetailRow
              icon={<PenLine />}
              label="Customer's signature"
              badge={
                signed ? (
                  <Badge variant="success">Signed</Badge>
                ) : (
                  <Badge variant="warning">Needed</Badge>
                )
              }
              value={signed ? pendingRelease?.customerName : undefined}
              onClick={openRelease}
            />
          ) : null}

          {lineOpen ? (
            <div className="rounded-md border border-hairline bg-panel-raised p-4">
              <label
                htmlFor="personal-line"
                className="mb-2 flex flex-wrap items-center gap-2 text-base text-ink"
              >
                Anything to mention? <Badge variant="neutral">Optional</Badge>
              </label>
              <textarea
                ref={lineRef}
                id="personal-line"
                value={draft.personalLine || ""}
                maxLength={PERSONAL_LINE_MAX}
                aria-describedby={LINE_COUNT_ID}
                onChange={(event) =>
                  setPostDraft({ ...draft, personalLine: event.target.value })
                }
                className="min-h-24 w-full resize-none rounded-sm border border-strong bg-panel px-3 py-2.5 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
              />
              <div
                id={LINE_COUNT_ID}
                className="mt-1 text-right text-caption text-ink-hint"
              >
                {PERSONAL_LINE_MAX - (draft.personalLine?.length || 0)} left
              </div>
            </div>
          ) : (
            <DetailRow
              icon={<MessageSquareText />}
              label="Anything to mention?"
              badge={<Badge variant="neutral">Optional</Badge>}
              onClick={() => {
                focusLineOnOpen.current = true;
                setLineOpen(true);
              }}
            />
          )}
        </div>

        {/* Phones: a bar pinned to the bottom so the one action is always in
            reach (same pattern as Post). Desktop: the foot of the column. */}
        <div
          ref={barRef}
          className="phone-action-bar max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:border-hairline max-lg:bg-panel max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(12px,var(--sab))] sm:max-lg:px-6 lg:mt-auto lg:border-t lg:border-hairline lg:pt-6"
        >
          {gateReason ? (
            <p
              id={REASON_ID}
              className="mb-2 text-sm font-medium text-warning-ink max-lg:text-center"
            >
              {gateReason}
            </p>
          ) : null}
          {websiteDiscovery === "failed" ? (
            <div className="mb-3 space-y-2">
              {request.ok ? (
                <p className="text-sm text-ink-2" role="status">
                  Website destinations are unavailable. You can still create this post
                  for your store’s social channels.
                </p>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => setWebsiteDiscoveryAttempt((value) => value + 1)}
              >
                Retry destinations
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!needsSignature && Boolean(gateReason)}
            aria-describedby={gateReason ? REASON_ID : undefined}
            onClick={primaryAction}
          >
            {needsSignature
              ? "Get customer's signature"
              : websiteDiscovery === "failed" && request.ok
                ? "Create social post"
                : "Create post"}
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
            setLocalError(
              "You changed the vehicle, so the customer needs to sign again.",
            );
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
