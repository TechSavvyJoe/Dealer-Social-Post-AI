import React from "react";
import { Edit3, Loader2 } from "lucide-react";

export interface PostPreviewCardProps {
  salespersonName: string;
  dealerName: string;
  image: string;
  videoUrl?: string | null;
  caption: string;
  employeeDisclosure: string;
  complianceDisclosure: string;
  editing: boolean;
  canEdit: boolean;
  isDesktopLayout: boolean;
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

export const PostPreviewCard: React.FC<PostPreviewCardProps> = ({
  salespersonName,
  dealerName,
  image,
  videoUrl,
  caption,
  employeeDisclosure,
  complianceDisclosure,
  editing,
  canEdit,
  isDesktopLayout,
  busyLabel,
  onEdit,
  onCaptionChange,
  onCaptionBlur,
}) => {
  const showEditor = canEdit && (editing || isDesktopLayout);
  return (
    <article className="overflow-hidden rounded-2xl border border-hairline bg-panel shadow-[0_16px_48px_-32px_rgb(var(--ink)/0.3)]">
      <div className="h-1 bg-brand-fill" aria-hidden="true" />
      <header className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-fill font-display text-[13px] font-semibold text-brand-foreground ring-4 ring-brand-ink/10"
        >
          {initialsFor(salespersonName)}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-ink">{salespersonName}</p>
          <p className="truncate text-xs text-ink-3">{dealerName} · Just now</p>
        </div>
      </header>

      <div className="relative w-full overflow-hidden bg-surface-base">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            muted
            playsInline
            className="block max-h-[56svh] w-full object-contain"
            aria-label="Generated post video"
          />
        ) : (
          <img
            src={image}
            alt="Generated social post creative"
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
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              Caption
            </span>
            <textarea
              aria-label="Caption"
              value={caption}
              rows={4}
              onChange={(event) => onCaptionChange(event.target.value)}
              onBlur={onCaptionBlur}
              className="min-h-28 w-full resize-y rounded-xl border border-hairline bg-panel-raised px-3.5 py-3 text-sm leading-6 text-ink outline-none transition focus:border-brand-ink focus:ring-2 focus:ring-brand-ink/20"
            />
          </label>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-5 text-ink">{caption}</p>
        )}
        {employeeDisclosure ? (
          <p className="mt-2 text-xs leading-5 text-ink-3">{employeeDisclosure}</p>
        ) : null}
        {complianceDisclosure ? (
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-ink-3">
            {complianceDisclosure}
          </p>
        ) : null}
        {canEdit && !showEditor ? (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/60"
            >
              <Edit3 className="h-4 w-4" aria-hidden="true" />
              Edit caption
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
};
