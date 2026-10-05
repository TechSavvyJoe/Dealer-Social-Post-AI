import React, { useEffect, useRef } from "react";
import { Edit3, Loader2 } from "lucide-react";
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

const protectedLine = "whitespace-pre-wrap text-caption leading-[18px] text-ink-2";

export const PostPreviewCard: React.FC<PostPreviewCardProps> = ({
  salespersonName,
  dealerName,
  image,
  videoUrl,
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
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            muted
            playsInline
            className="block max-h-[56svh] w-full object-contain"
            aria-label="Post video"
          />
        ) : (
          <img
            src={image}
            alt="Post image"
            className="block max-h-[56svh] w-full object-contain"
          />
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
