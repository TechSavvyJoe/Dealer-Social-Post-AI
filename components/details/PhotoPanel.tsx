import React, { useRef } from "react";
import { Camera } from "lucide-react";

export interface PhotoPanelProps {
  imageSrc: string;
  categoryLabel: string;
  isProcessing?: boolean;
  onFile: (file: File) => void;
  /** Grid placement from the parent layout. */
  className?: string;
}

/**
 * The photo is the hero: a print lying on the lit table, at its own aspect,
 * with no blur, scrim or band over it (spec §4.3). Full-bleed on phones.
 */
export const PhotoPanel: React.FC<PhotoPanelProps> = ({
  imageSrc,
  categoryLabel,
  isProcessing,
  onFile,
  className,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`flex min-w-0 flex-col ${className ?? ""}`.trim()}>
      <div className="flex w-full items-center justify-center bg-panel sm:table-lit sm:rounded-lg sm:border sm:border-hairline sm:p-3 lg:flex-1 lg:p-4">
        <img
          src={imageSrc}
          alt={`${categoryLabel} photo`}
          className="print mx-auto block h-auto max-h-[62svh] w-auto max-w-full object-contain"
        />
      </div>

      <div className="flex items-center justify-end gap-4 px-4 pt-1 sm:justify-between sm:px-0 sm:pt-2">
        <p className="hidden text-caption text-ink-hint sm:block">
          Your photo stays unchanged until you create the post.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
        <button
          type="button"
          disabled={isProcessing}
          aria-busy={isProcessing || undefined}
          onClick={() => fileRef.current?.click()}
          className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm px-2 text-sm font-semibold text-brand-ink transition-colors duration-120 ease-out hover:bg-fill-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Change photo
        </button>
      </div>
    </div>
  );
};
