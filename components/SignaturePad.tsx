import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useRef,
  forwardRef,
  useState,
} from "react";
import { Eraser, PenLine } from "lucide-react";
import { Button } from "./ui/Button";
import { TYPED_SIGNATURE_ATTESTATION } from "./details/releaseConsent";

/** What the visible mode still needs before it counts as signed. */
export type SignatureGap = "drawing" | "typed_name" | "attestation";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** Returns a PNG data URL of the signature on transparent background. */
  toDataURL: () => string | null;
  /** The step still missing in the visible mode, or null when signed. */
  missingStep: () => SignatureGap | null;
}

interface SignaturePadProps {
  width?: number;
  height?: number;
  /** Stroke and typed-signature colour. Defaults to the theme's `--ink`. */
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
  onChange?: (isEmpty: boolean) => void;
  /** Id of a message about the signature (e.g. the sheet's inline error). */
  describedBy?: string;
}

/**
 * The theme's ink as a canvas colour, read from `--ink` on the document root
 * (where `.theme-light` is toggled). A canvas cannot use the CSS variable
 * itself, and a fixed white stroke disappears on the Sunlight pad. Returns
 * undefined when the token is missing or malformed.
 */
export const readInkColor = (): string | undefined => {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return undefined;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ink");
  const channels = raw
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
  if (
    channels.length !== 3 ||
    channels.some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
    )
  ) {
    return undefined;
  }
  return `rgb(${channels.join(", ")})`;
};

/**
 * Pointer-event signature pad. Works with mouse, touch, and Apple Pencil.
 * Renders strokes onto an internal canvas; parent reads PNG via ref.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  (
    {
      width = 600,
      height = 220,
      strokeColor: strokeColorProp,
      strokeWidth = 2.5,
      className,
      onChange,
      describedBy,
    },
    ref,
  ) => {
    // Read once per mount: the pad lives inside a sheet that remounts on open.
    // "currentColor" only applies when --ink is unreadable; the canvas carries
    // text-ink so it still resolves to the theme's ink.
    const [themeInk] = useState(readInkColor);
    const strokeColor = strokeColorProp ?? themeInk ?? "currentColor";
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const [hasStrokes, setHasStrokes] = useState(false);
    const [signatureMethod, setSignatureMethod] = useState<"draw" | "type">("draw");
    const [typedName, setTypedName] = useState("");
    const [attested, setAttested] = useState(false);
    const labelId = useId();
    const typedNameId = useId();
    const drawStatusId = useId();
    const typedStatusId = useId();
    const typedSignatureComplete = typedName.trim().length > 0 && attested;
    const signatureComplete =
      signatureMethod === "draw" ? hasStrokes : typedSignatureComplete;

    const configureContext = useCallback(
      (canvas: HTMLCanvasElement, dpr: number) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        return ctx;
      },
      [strokeColor, strokeWidth],
    );

    // Size the bitmap from the rendered container so signatures stay crisp
    // without overflowing narrow phones. Preserve existing strokes on resize.
    // The canvas stays mounted while the typed mode is showing (it is only
    // hidden), so strokes survive a switch to "Type name instead" and back.
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = canvasContainerRef.current;
      if (!canvas || !container) return;

      const resize = (nextWidth: number) => {
        const cssWidth = Math.max(1, Math.min(width, Math.round(nextWidth || width)));
        const cssHeight = Math.max(1, Math.round((cssWidth * height) / width));
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const nextBitmapWidth = Math.round(cssWidth * dpr);
        const nextBitmapHeight = Math.round(cssHeight * dpr);
        if (canvas.width === nextBitmapWidth && canvas.height === nextBitmapHeight) {
          configureContext(canvas, dpr);
          return;
        }

        const snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        if (canvas.width > 0 && canvas.height > 0) {
          snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
        }

        canvas.width = nextBitmapWidth;
        canvas.height = nextBitmapHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const ctx = configureContext(canvas, dpr);
        if (ctx && snapshot.width > 0 && snapshot.height > 0) {
          ctx.drawImage(snapshot, 0, 0, cssWidth, cssHeight);
        }
      };

      resize(container.getBoundingClientRect().width || width);
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
        const nextWidth = entries[0]?.contentRect.width;
        if (nextWidth) resize(nextWidth);
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, [width, height, configureContext]);

    useEffect(() => {
      onChange?.(!signatureComplete);
    }, [onChange, signatureComplete]);

    const getRelativePoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x:
          ((e.clientX - rect.left) * canvas.width) /
          rect.width /
          (window.devicePixelRatio || 1),
        y:
          ((e.clientY - rect.top) * canvas.height) /
          rect.height /
          (window.devicePixelRatio || 1),
      };
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const pt = getRelativePoint(e);
      lastPointRef.current = pt;
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const pt = getRelativePoint(e);
      const last = lastPointRef.current;
      if (!pt || !last) return;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      lastPointRef.current = pt;
      if (!hasStrokes) {
        setHasStrokes(true);
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      drawingRef.current = false;
      lastPointRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
      }
    };

    const clear = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Re-apply line settings (clearRect doesn't lose state, but be defensive)
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      setHasStrokes(false);
      setTypedName("");
      setAttested(false);
    }, [strokeColor, strokeWidth]);

    const typedSignatureDataUrl = useCallback(() => {
      if (!typedSignatureComplete) return null;
      const output = document.createElement("canvas");
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      output.width = width * dpr;
      output.height = height * dpr;
      const ctx = output.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = strokeColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `italic ${Math.max(32, Math.round(height * 0.3))}px "Segoe Script", "Bradley Hand", cursive`;
      ctx.fillText(typedName.trim(), width / 2, height / 2, width - 48);
      return output.toDataURL("image/png");
    }, [height, strokeColor, typedName, typedSignatureComplete, width]);

    useImperativeHandle(
      ref,
      () => ({
        clear,
        isEmpty: () => !signatureComplete,
        toDataURL: () => {
          if (signatureMethod === "type") return typedSignatureDataUrl();
          const canvas = canvasRef.current;
          if (!canvas || !hasStrokes) return null;
          return canvas.toDataURL("image/png");
        },
        missingStep: () => {
          if (signatureMethod === "draw") return hasStrokes ? null : "drawing";
          if (!typedName.trim()) return "typed_name";
          return attested ? null : "attestation";
        },
      }),
      [
        attested,
        clear,
        hasStrokes,
        signatureComplete,
        signatureMethod,
        typedName,
        typedSignatureDataUrl,
      ],
    );

    return (
      <fieldset
        className={className}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
      >
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
          <span id={labelId} className="text-sm font-medium text-ink-2">
            Customer&apos;s signature
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-3 min-h-11 px-3 text-brand-ink"
            onClick={() =>
              setSignatureMethod((method) => (method === "draw" ? "type" : "draw"))
            }
          >
            {signatureMethod === "draw" ? "Type name instead" : "Draw instead"}
          </Button>
        </div>

        <div hidden={signatureMethod !== "draw"}>
          <div
            ref={canvasContainerRef}
            className="relative w-full overflow-hidden rounded-lg border border-strong bg-panel-raised"
            style={{ maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Draw the customer's signature with a pointer, finger, or stylus"
              aria-describedby={drawStatusId}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="absolute inset-0 block cursor-crosshair touch-none text-ink"
              style={{ touchAction: "none" }}
            />
            {!hasStrokes && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-ink-2">
                <PenLine className="h-4 w-4" aria-hidden="true" />
                Sign with finger or stylus
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span
              id={drawStatusId}
              role="status"
              aria-live="polite"
              className={`text-caption ${hasStrokes ? "text-success-ink" : "text-ink-hint"}`}
            >
              {hasStrokes ? "Signed" : "Not signed yet"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-3 min-h-11 px-3"
              leftIcon={<Eraser />}
              onClick={clear}
              disabled={!hasStrokes}
            >
              Clear
            </Button>
          </div>
        </div>

        <div
          hidden={signatureMethod !== "type"}
          className="space-y-4 rounded-lg border border-strong bg-panel-raised p-4"
        >
          <div>
            <label
              htmlFor={typedNameId}
              className="mb-1.5 block text-sm font-medium text-ink-2"
            >
              Type the customer’s full legal name
            </label>
            {/* Never offer AutoFill here: the phone belongs to the salesperson,
                so a suggested name would be theirs, not the customer's. */}
            <input
              id={typedNameId}
              type="text"
              name="typed-signature"
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              value={typedName}
              onChange={(event) => setTypedName(event.target.value.slice(0, 160))}
              className="min-h-11 w-full rounded-sm border border-strong bg-panel px-3 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-fill"
            />
            <span>{TYPED_SIGNATURE_ATTESTATION}</span>
          </label>
          <p
            id={typedStatusId}
            role="status"
            aria-live="polite"
            className={`text-caption ${
              typedSignatureComplete ? "text-success-ink" : "text-ink-hint"
            }`}
          >
            {typedSignatureComplete
              ? "Electronic signature ready"
              : "Enter the customer’s name and confirm the attestation."}
          </p>
        </div>
      </fieldset>
    );
  },
);

SignaturePad.displayName = "SignaturePad";
