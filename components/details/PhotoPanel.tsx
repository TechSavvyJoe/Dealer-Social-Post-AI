import React, { useRef } from "react";
import { Camera, ImageIcon } from "lucide-react";

export interface PhotoPanelProps {
  imageSrc: string;
  categoryLabel: string;
  categoryBlurb?: string;
  dealerName?: string;
  isProcessing?: boolean;
  onFile: (file: File) => void;
}

export const PhotoPanel: React.FC<PhotoPanelProps> = ({
  imageSrc,
  categoryLabel,
  categoryBlurb,
  dealerName,
  isProcessing,
  onFile,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section className="sm:rounded-xl sm:border sm:border-hairline sm:bg-panel sm:p-3 lg:p-4">
      <div className="hidden min-h-12 items-center justify-between px-1 pb-3 sm:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-fill text-brand-foreground">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {dealerName || "Your store"}
            </p>
            <p className="text-xs text-ink-2">Original photo · ready to create</p>
          </div>
        </div>
        <span className="rounded-full border border-hairline bg-brand-tint px-2.5 py-1 text-xs font-semibold text-ink">
          {categoryLabel}
        </span>
      </div>

      <div className="relative h-[270px] overflow-hidden bg-panel-raised sm:aspect-[4/3] sm:h-auto sm:rounded-lg sm:border sm:border-hairline">
        <img
          src={imageSrc}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-overlay/20" aria-hidden="true" />
        <img
          src={imageSrc}
          alt={`${categoryLabel} photo`}
          className="relative h-full w-full object-contain"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-overlay/80 px-4 py-3 backdrop-blur-sm sm:hidden">
          <div>
            <p className="font-display text-xl font-semibold text-surface-50">
              {categoryLabel}
            </p>
            {categoryBlurb ? (
              <p className="text-xs text-surface-200">{categoryBlurb}</p>
            ) : null}
          </div>
          <span className="rounded-full border border-surface-500 bg-surface-950/70 px-2 py-1 text-2xs font-semibold text-surface-100">
            Photo ready
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-hairline px-4 py-2 sm:border-b-0 sm:px-1 sm:pb-0 sm:pt-3">
        <p className="hidden text-xs text-ink-hint sm:block">
          Your photo stays unchanged until you create the post.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a different photo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => fileRef.current?.click()}
          className="ml-auto inline-flex min-h-11 items-center gap-2 px-1 font-medium text-brand-ink disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Change photo
        </button>
      </div>
    </section>
  );
};
