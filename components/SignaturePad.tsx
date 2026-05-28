import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
} from "react";
import { motion } from "framer-motion";
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
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const [hasStrokes, setHasStrokes] = useState(false);

    // Size the canvas using devicePixelRatio so strokes are crisp.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
      }
    }, [width, height, strokeColor, strokeWidth]);

    const getRelativePoint = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) * canvas.width) / rect.width / (window.devicePixelRatio || 1),
          y: ((e.clientY - rect.top) * canvas.height) / rect.height / (window.devicePixelRatio || 1),
        };
      },
      []
    );

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
        onChange?.(false);
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
      onChange?.(true);
    }, [strokeColor, strokeWidth, onChange]);

    useImperativeHandle(
      ref,
      () => ({
        clear,
        isEmpty: () => !hasStrokes,
        toDataURL: () => {
          const canvas = canvasRef.current;
          if (!canvas || !hasStrokes) return null;
          return canvas.toDataURL("image/png");
        },
      }),
      [clear, hasStrokes]
    );

    return (
      <div className={className}>
        <div className="relative rounded-xl border border-white/20 bg-surface-950/60 overflow-hidden">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="block w-full touch-none cursor-crosshair"
            style={{ touchAction: "none" }}
          />
          {!hasStrokes && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="flex items-center gap-2 text-surface-500 text-xs">
                <PenLine className="h-3.5 w-3.5" />
                Sign with finger or stylus
              </div>
            </motion.div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-surface-400">
          <span className={hasStrokes ? "text-success-400" : "text-surface-500"}>
            {hasStrokes ? "Signature captured" : "Awaiting signature…"}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={!hasStrokes}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-surface-300"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>
    );
  }
);

SignaturePad.displayName = "SignaturePad";
