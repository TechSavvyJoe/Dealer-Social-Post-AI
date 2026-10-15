import React, { useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../ui/Button";
import * as db from "../../services/database";
import { fetchSession, useAppStore } from "../../stores/appStore";
import type { Dealer, LogoCorner } from "../../types";
import { cn } from "../../utils/classNames";
import { toUiMessage } from "../../utils/errorMessages";
import { LOGO_ACCEPT, LOGO_CORNER_OPTIONS, LOGO_MAX_BYTES } from "./settingsModel";
import { ErrorNote, FIELD_LABEL, ROW_HELPER, ROW_LABEL } from "./SettingsRows";

const ACCEPTED_TYPES = LOGO_ACCEPT.split(",");

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * The logo URL the server now has on file. The dealer PATCH answers with only
 * `{ id }`, and the stored file name gets a random suffix, so the new address
 * is read back from the session (the same record login returns). Null when
 * that read fails or answers for another store.
 */
const readSavedLogo = async (dealerId: string): Promise<string | null> => {
  try {
    const response = await fetchSession({ method: "GET" });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      dealer?: { id?: unknown; logo?: unknown };
    };
    const logo = body?.dealer?.id === dealerId ? body.dealer.logo : null;
    return typeof logo === "string" && logo.trim() ? logo : null;
  } catch {
    return null;
  }
};

/**
 * What the corner does, true for the form as it stands: generation asks the
 * image model for the store's logo in the saved corner and size
 * (services/logoPlacement.ts), and leaves the corner to the model when none
 * is saved. "Ask for" because the model can still place it elsewhere.
 */
const placementHelp = (hasLogo: boolean, corner: LogoCorner | ""): string => {
  if (!hasLogo) {
    return "Once you upload a logo, new designed photos ask for it in the corner you pick.";
  }
  return corner
    ? "New designed photos ask for your logo in this corner."
    : "No corner picked, so each new designed photo picks one for your logo.";
};

/**
 * The Logo size helper, true under the same rule as the corner's: the size
 * reaches a prompt only with a corner picked and a logo on file. With no logo,
 * generation uses the store name as a text watermark and asks for no size.
 */
export const logoSizeHelp = (hasLogo: boolean, corner: LogoCorner | ""): string => {
  if (!corner) {
    return hasLogo
      ? "Percent of the photo width. Pick a corner under Placement on photos to use it."
      : "Percent of the photo width. Upload a logo and pick a corner under Placement on photos to use it.";
  }
  return hasLogo
    ? "Percent of the photo width. New designed photos ask for your logo at about this size."
    : "Percent of the photo width. Once you upload a logo, new designed photos ask for it at about this size.";
};

interface LogoFieldProps {
  /** The saved record: the logo shown is the one on file. */
  dealer: Dealer;
  corner: LogoCorner | "";
  onCornerChange: (corner: LogoCorner) => void;
  onClearPlacement: () => void;
}

/**
 * The logo row: the current logo and Replace logo on the left, the corner
 * grid on the right. Replacing the logo saves at once and is not part of the
 * settings form (Save changes does not send it); the corner is part of it.
 */
export const LogoField: React.FC<LogoFieldProps> = ({
  dealer,
  corner,
  onCornerChange,
  onClearPlacement,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const cornerRefs = useRef<Record<LogoCorner, HTMLButtonElement | null>>({
    top_left: null,
    top_right: null,
    bottom_left: null,
    bottom_right: null,
  });
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  // Shown at once after an upload, before the saved record reaches the prop.
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const placementId = useId();
  const placementHelpId = useId();
  const shownLogo = uploadedLogo || dealer.logo || "";

  const replaceLogo = async (file: File) => {
    if (file.size > LOGO_MAX_BYTES) {
      setUpload({
        kind: "error",
        message:
          "That file is larger than 5 MB. Choose a smaller PNG, JPEG or WebP image.",
      });
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUpload({ kind: "error", message: "Choose a PNG, JPEG or WebP image." });
      return;
    }
    setUpload({ kind: "uploading" });
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const updated = await db.updateDealerWithFile(dealer.id, fd);
      const logo =
        (await readSavedLogo(dealer.id)) ||
        (typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "");
      // Merged into the session dealer the way the settings save merges its
      // fields, so the app header and the sample show the new logo now.
      useAppStore.setState((state) => ({
        currentDealer:
          state.currentDealer && state.currentDealer.id === dealer.id
            ? {
                ...state.currentDealer,
                ...updated,
                ...(logo ? { logo } : {}),
              }
            : state.currentDealer,
      }));
      if (logo) setUploadedLogo(logo);
      setUpload({ kind: "done" });
    } catch (err) {
      setUpload({
        kind: "error",
        message: toUiMessage(err, "Could not upload the logo."),
      });
    }
  };

  const moveCorner = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: 3,
      ArrowDown: 2,
      ArrowUp: 2,
    };
    if (!(event.key in step)) return;
    event.preventDefault();
    const ids = LOGO_CORNER_OPTIONS.map((option) => option.id);
    const current = Math.max(0, ids.indexOf(corner as LogoCorner));
    const next = ids[(current + step[event.key]) % ids.length];
    onCornerChange(next);
    requestAnimationFrame(() => cornerRefs.current[next]?.focus());
  };

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4 border-t border-hairline py-4">
      <div className="flex min-w-0 flex-[1_1_15rem] flex-col gap-3">
        <div>
          <p className={ROW_LABEL}>Logo</p>
          <p className={cn("mt-0.5", ROW_HELPER)}>
            Shown in the app header and on every designed photo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {shownLogo ? (
            <img
              src={shownLogo}
              alt={`Current logo for ${dealer.name}`}
              className="h-14 max-w-[10rem] rounded-sm border border-hairline bg-panel-raised object-contain p-1.5"
            />
          ) : (
            <p className="text-sm text-ink-3">No logo yet</p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="px-3.5 text-sm"
            disabled={upload.kind === "uploading"}
            onClick={() => inputRef.current?.click()}
          >
            {shownLogo ? "Replace logo" : "Upload logo"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT}
            hidden
            data-testid="logo-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file again still fires a change.
              event.target.value = "";
              if (file) void replaceLogo(file);
            }}
          />
        </div>
        <div aria-live="polite" className="min-w-0">
          {upload.kind === "uploading" ? (
            <p className={ROW_HELPER}>Uploading…</p>
          ) : upload.kind === "done" ? (
            <p className={cn("flex items-center gap-1.5", ROW_HELPER)}>
              <Check
                className="h-4 w-4 shrink-0"
                strokeWidth={2.25}
                aria-hidden="true"
              />
              Logo updated
            </p>
          ) : null}
        </div>
        {upload.kind === "error" ? <ErrorNote>{upload.message}</ErrorNote> : null}
      </div>

      <div className="flex w-full flex-col sm:w-50">
        <p id={placementId} className={cn("mb-2", FIELD_LABEL)}>
          Placement on photos
        </p>
        <div
          role="radiogroup"
          aria-labelledby={placementId}
          aria-describedby={placementHelpId}
          onKeyDown={moveCorner}
          className="grid grid-cols-2 gap-1.5 rounded-sm bg-panel-raised p-1.5"
        >
          {LOGO_CORNER_OPTIONS.map((option, index) => {
            const selected = corner === option.id;
            const focusable = selected || (!corner && index === 0);
            return (
              <button
                key={option.id}
                ref={(element) => {
                  cornerRefs.current[option.id] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                tabIndex={focusable ? 0 : -1}
                onClick={() => onCornerChange(option.id)}
                className={cn(
                  "flex h-11 items-center justify-center rounded-[6px] transition-colors duration-120 ease-out",
                  selected
                    ? "border-2 border-brand-ink bg-overlay text-ink"
                    : "border border-strong hover:bg-fill-subtle",
                )}
              >
                {selected ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
        <p id={placementHelpId} className={cn("mt-2", ROW_HELPER)}>
          {placementHelp(Boolean(shownLogo), corner)}
        </p>
        {corner ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="-ml-3 mt-1 px-3 text-sm"
              onClick={onClearPlacement}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
