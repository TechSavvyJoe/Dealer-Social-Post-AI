import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useRef,
  forwardRef,
  useState,
} from "react";
import { m } from "framer-motion";
import { Eraser, PenLine } from "lucide-react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** Returns a PNG data URL of the signature on transparent background. */
  toDataURL: () => string | null;
}

interface SignaturePadProps {
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
  onChange?: (isEmpty: boolean) => void;
}

/**
 * Pointer-event signature pad. Works with mouse, touch, and Apple Pencil.
 * Renders strokes onto an internal canvas; parent reads PNG via ref.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  (
    {
      width = 600,
      height = 220,
      strokeColor = "#ffffff",
      strokeWidth = 2.5,
      className,
      onChange,
    },
    ref,
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const [hasStrokes, setHasStrokes] = useState(false);
    const [signatureMethod, setSignatureMethod] = useState<"draw" | "type">("draw");
    const [typedName, setTypedName] = useState("");
    const [attested, setAttested] = useState(false);
    const typedNameId = useId();
    const statusId = useId();
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
      }),
      [clear, hasStrokes, signatureComplete, signatureMethod, typedSignatureDataUrl],
    );

    return (
      <fieldset className={className}>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-2">
          Customer signature
        </legend>
        <div
          className="mb-3 grid grid-cols-2 gap-1 rounded-md border border-hairline bg-panel p-1"
          role="group"
          aria-label="Signature method"
        >
          {(["draw", "type"] as const).map((method) => (
            <button
              key={method}
              type="button"
              aria-pressed={signatureMethod === method}
              onClick={() => setSignatureMethod(method)}
              className={`min-h-11 rounded-sm px-3 py-2 text-sm font-semibold transition-colors ${
                signatureMethod === method
                  ? "bg-brand-fill text-brand-foreground"
                  : "text-ink-2 hover:bg-fill-subtle hover:text-ink"
              }`}
            >
              {method === "draw" ? "Draw signature" : "Type name"}
            </button>
          ))}
        </div>

        {signatureMethod === "draw" ? (
          <>
            <div
              ref={canvasContainerRef}
              className="relative w-full overflow-hidden rounded-xl border border-strong bg-surface-950/60"
              style={{ maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }}
            >
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="Draw the customer's signature with a pointer, finger, or stylus"
                aria-describedby={statusId}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="absolute inset-0 block touch-none cursor-crosshair"
                style={{ touchAction: "none" }}
              />
              {!hasStrokes && (
                <m.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="flex items-center gap-2 text-xs text-ink-2">
                    <PenLine className="h-3.5 w-3.5" />
                    Sign with finger or stylus
                  </div>
                </m.div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-ink-2">
              <span
                id={statusId}
                role="status"
                aria-live="polite"
                className={hasStrokes ? "text-success-ink" : "text-ink-hint"}
              >
                {hasStrokes ? "Signature captured" : "Awaiting signature…"}
              </span>
              <button
                type="button"
                onClick={clear}
                disabled={!hasStrokes}
                className="flex min-h-11 items-center gap-1 rounded px-3 py-2 text-ink-2 transition-colors hover:bg-fill-subtle disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Eraser className="h-3 w-3" />
                Clear
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-xl border border-strong bg-surface-950/40 p-3">
            <div>
              <label
                htmlFor={typedNameId}
                className="mb-1.5 block text-xs font-medium text-ink-2"
              >
                Type the customer’s full legal name
              </label>
              <input
                id={typedNameId}
                type="text"
                autoComplete="name"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value.slice(0, 160))}
                className="min-h-11 w-full rounded-xl border-2 border-surface-700 bg-surface-900/60 px-3 py-2 text-base text-surface-50 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline p-3 text-sm text-surface-200">
              <input
                type="checkbox"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary-500"
              />
              <span>
                I am the named customer and agree that typing my name is my electronic
                signature for this photo release.
              </span>
            </label>
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className={
                typedSignatureComplete
                  ? "text-xs text-success-400"
                  : "text-xs text-surface-400"
              }
            >
              {typedSignatureComplete
                ? "Electronic signature ready"
                : "Enter the customer’s name and confirm the attestation."}
            </p>
          </div>
        )}
      </fieldset>
    );
  },
);

SignaturePad.displayName = "SignaturePad";
