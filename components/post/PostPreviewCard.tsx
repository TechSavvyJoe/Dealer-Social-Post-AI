import React, { useEffect, useRef, useState } from "react";
import { Edit3, Film, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { captionIncludesEmployeeDisclosure } from "../../utils/complianceDisclosures";

const DISCLOSURE_HEADING = "— Disclosures —";

export interface OutboundPreviewParts {
  /** The protected team-member disclosure, or "" when the body already opens with it. */
  prefix: string;
  /** The caption body exactly as it is sent (attribution included). */
  body: string;
  /** The compliance footer under its canonical heading, or "". */
  disclosureBlock: string;
}

/**
 * Splits one outbound caption into the three parts the destination receives,
 * in the order `fitPublishCaptionToBudget` (services/publishTargets.ts)
 * assembles them: the team-member disclosure first (skipped when the body
 * already opens with it), then the body, then the disclosures under the
 * "— Disclosures —" heading. Nothing is reworded; this only decides placement.
 */
export const outboundPreviewParts = (
  text: string,
  requiredPrefix: string | undefined,
  disclosures: string | undefined,
): OutboundPreviewParts => {
  const markerIndex = text.indexOf(DISCLOSURE_HEADING);
  const body = (markerIndex >= 0 ? text.slice(0, markerIndex) : text).trim();
  const disclosure = (
    disclosures || (markerIndex >= 0 ? text.slice(markerIndex) : "")
  ).trim();
  const disclosureBlock = disclosure
    ? disclosure.startsWith(DISCLOSURE_HEADING)
      ? disclosure
      : `${DISCLOSURE_HEADING}\n${disclosure}`
    : "";
  const prefix = (requiredPrefix || "").trim();
  const prefixAlreadySent = Boolean(
    prefix && body && captionIncludesEmployeeDisclosure(body, prefix),
  );
  return { prefix: prefixAlreadySent ? "" : prefix, body, disclosureBlock };
};

export interface PostPreviewCardProps {
  salespersonName: string;
  dealerName: string;
  image: string;
  videoUrl?: string | null;
  availableVideoUrl?: string | null;
  onSelectMedia?: (kind: "image" | "video") => void;
  mediaSelectionDisabled?: boolean;
  /** The one editable caption body. */
  caption: string;
  /** The body that ships for the selected channel (attribution and compliance pass applied). */
  outboundText: string;
  /** The protected team-member disclosure that every share puts first. */
  employeeDisclosure: string;
  /** The compliance disclosures that ship for the selected channel. */
  disclosures?: string;
  editing: boolean;
  canEdit: boolean;
  busyLabel?: string;
  onEdit: () => void;
  onCaptionChange: (caption: string) => void;
  onCaptionBlur: () => void;
}

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "DS";

// Reserve room for the app header, destination choices, caption, and fixed
// actions on short phones. Keep a usable preview in landscape and the larger
// original cap on desktop, where the actions sit beside the preview.
const mediaPreviewClass =
  "block max-h-[clamp(120px,calc(100svh-470px),56svh)] w-full object-contain lg:max-h-[56svh]";

const protectedLine = "whitespace-pre-wrap text-caption leading-[18px] text-ink-2";

export const PostPreviewCard: React.FC<PostPreviewCardProps> = ({
  salespersonName,
  dealerName,
  image,
  videoUrl,
  availableVideoUrl,
  onSelectMedia,
  mediaSelectionDisabled = false,
  caption,
  outboundText,
  employeeDisclosure,
  disclosures,
  editing,
  canEdit,
  busyLabel,
  onEdit,
  onCaptionChange,
  onCaptionBlur,
}) => {
  const showEditor = canEdit && editing;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRailRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const scrollSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipUrl = availableVideoUrl || videoUrl;
  const selectedMedia = videoUrl ? "video" : "image";
  const [playback, setPlayback] = useState<{
    url: string | null | undefined;
    state: "loading" | "ready" | "buffering" | "error";
  }>({ url: clipUrl, state: "loading" });
  const playbackState = playback.url === clipUrl ? playback.state : "loading";
  const updatePlayback = (state: typeof playback.state) =>
    setPlayback({ url: clipUrl, state });
  useEffect(() => {
    const rail = mediaRailRef.current;
    if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
    let alignedWidth = rail?.clientWidth ?? 0;
    const align = () => {
      if (rail && clipUrl) {
        alignedWidth = rail.clientWidth;
        rail.scrollLeft = videoUrl ? 0 : alignedWidth;
      }
    };
    align();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            // Media decoding can change only the rail's height during a swipe.
            // Align again only when its slide width changes, as on rotation.
            if (rail && rail.clientWidth !== alignedWidth) align();
          })
        : null;
    if (rail) observer?.observe(rail);
    if (!videoUrl) playerRef.current?.pause();
    return () => {
      observer?.disconnect();
      if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
    };
  }, [clipUrl, videoUrl]);
  const parts = outboundPreviewParts(outboundText, employeeDisclosure, disclosures);
  // While editing, the body is the textarea, so the protected prefix is shown
  // whenever the dealership has one: the share adds it unless the edited body
  // already opens with it, which the outbound view then reflects on blur.
  const editorPrefix = (employeeDisclosure || "").trim();

  useEffect(() => {
    if (!showEditor) return;
    const field = textareaRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [showEditor]);

  return (
    <article className="overflow-hidden rounded-md border border-hairline bg-panel">
      <header className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-fill font-display text-caption font-semibold text-brand-foreground"
        >
          {initialsFor(salespersonName)}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-ink">{salespersonName}</p>
          <p className="truncate text-xs text-ink-2">{dealerName} · Just now</p>
        </div>
      </header>

      <div className="relative w-full overflow-hidden bg-canvas">
        {clipUrl ? (
          <>
            <div className="flex items-center justify-between gap-2 border-y border-hairline bg-panel px-3 py-1.5">
              <div className="flex gap-1" role="group" aria-label="Preview version">
                {(["video", "image"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={selectedMedia === kind}
                    disabled={mediaSelectionDisabled}
                    onClick={() => onSelectMedia?.(kind)}
                    className={`flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium disabled:opacity-50 ${selectedMedia === kind ? "bg-brand-fill text-brand-foreground" : "text-ink-2 hover:bg-panel-raised"}`}
                  >
                    {kind === "video" ? (
                      <Film className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                    {kind === "video" ? "Video" : "Image"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-ink-2">Swipe to switch</span>
            </div>
            <div
              ref={mediaRailRef}
              tabIndex={0}
              className={`flex snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] ${mediaSelectionDisabled ? "overflow-x-hidden" : "overflow-x-auto"}`}
              role="group"
              aria-label="Image and video previews"
              onScroll={(event) => {
                if (mediaSelectionDisabled) return;
                const rail = event.currentTarget;
                if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
                // Let the native swipe settle before selecting the delivery.
                // Selecting mid-gesture would snap the rail under the finger.
                scrollSettleRef.current = setTimeout(() => {
                  if (!rail.clientWidth) return;
                  const kind =
                    rail.scrollLeft >= rail.clientWidth / 2 ? "image" : "video";
                  if (kind !== selectedMedia) onSelectMedia?.(kind);
                }, 120);
              }}
            >
              <div
                className="w-full shrink-0 snap-center"
                aria-hidden={selectedMedia !== "video"}
              >
                <video
                  key={clipUrl}
                  ref={playerRef}
                  src={clipUrl}
                  poster={image}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  tabIndex={selectedMedia === "video" ? 0 : -1}
                  className={mediaPreviewClass}
                  aria-label="Post video"
                  onLoadStart={() => updatePlayback("loading")}
                  onLoadedMetadata={() => updatePlayback("ready")}
                  onLoadedData={() => updatePlayback("ready")}
                  onCanPlay={() => updatePlayback("ready")}
                  onPlaying={() => updatePlayback("ready")}
                  onWaiting={() => updatePlayback("buffering")}
                  onError={() => updatePlayback("error")}
                />
                {selectedMedia === "video" && playbackState === "error" ? (
                  <div className="border-t border-hairline px-4 py-3">
                    <p role="alert" className="text-sm text-ink">
                      This video couldn’t play. Retry the preview without creating
                      another video.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => {
                        updatePlayback("loading");
                        playerRef.current?.load();
                      }}
                    >
                      Retry preview
                    </Button>
                  </div>
                ) : selectedMedia === "video" && playbackState !== "ready" ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-ink-2"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {playbackState === "buffering"
                      ? "Buffering video…"
                      : "Loading video…"}
                  </p>
                ) : null}
              </div>
              <div
                className="w-full shrink-0 snap-center"
                aria-hidden={selectedMedia !== "image"}
              >
                <img src={image} alt="Post image" className={mediaPreviewClass} />
              </div>
            </div>
          </>
        ) : (
          <img src={image} alt="Post image" className={mediaPreviewClass} />
        )}
        {busyLabel ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-overlay/85 px-6 text-center text-ink"
            role="status"
          >
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
            <span className="font-semibold">{busyLabel}</span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-hairline px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        {showEditor ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="post-caption" className="text-sm font-medium text-ink-2">
              Caption
            </label>
            {editorPrefix ? <p className={protectedLine}>{editorPrefix}</p> : null}
            <textarea
              id="post-caption"
              ref={textareaRef}
              value={caption}
              rows={4}
              onChange={(event) => onCaptionChange(event.target.value)}
              onBlur={onCaptionBlur}
              className="min-h-28 w-full resize-y rounded-sm border border-strong bg-panel-raised px-3.5 py-3 text-base leading-6 text-ink transition-colors duration-120 focus:border-brand-ink"
            />
            {parts.disclosureBlock ? (
              <p className={protectedLine}>{parts.disclosureBlock}</p>
            ) : null}
            {editorPrefix || parts.disclosureBlock ? (
              <p className="text-caption text-ink-2">
                The disclosure lines go out with this post and can't be edited.
              </p>
            ) : null}
          </div>
        ) : (
          <div data-testid="post-outbound-preview">
            {parts.prefix ? (
              <p data-outbound-part="prefix" className={`mb-2 ${protectedLine}`}>
                {parts.prefix}
              </p>
            ) : null}
            <p
              data-outbound-part="body"
              className="whitespace-pre-wrap text-base leading-6 text-ink sm:text-[15px] sm:leading-[22px]"
            >
              {parts.body}
            </p>
            {parts.disclosureBlock ? (
              <p data-outbound-part="disclosures" className={`mt-2 ${protectedLine}`}>
                {parts.disclosureBlock}
              </p>
            ) : null}
          </div>
        )}
        {canEdit && !showEditor ? (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="md"
              className="px-3"
              leftIcon={<Edit3 />}
              onClick={onEdit}
            >
              Edit caption
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
};
