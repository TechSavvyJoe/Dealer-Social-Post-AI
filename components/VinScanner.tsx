import React, { useCallback, useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Loader2, ScanLine, AlertCircle, Check, X, Camera } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import {
  decodeVin,
  isValidVin,
  normalizeVin,
  DecodedVehicle,
} from "../services/vinDecoder";
import { logEvent, logError } from "../utils/telemetry";
import { toUiMessage } from "../utils/errorMessages";
import { triggerHapticFeedback } from "../utils/haptics";

interface VinScannerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when a VIN successfully decodes. The host can stash this in state and inject it into generation. */
  onVehicleDecoded: (vehicle: DecodedVehicle) => void;
  initialMode?: "scanner" | "manual";
}

/**
 * Native BarcodeDetector is supported on:
 *   - Chrome / Edge (desktop & Android) since 2020
 *   - Android WebView
 * It is NOT supported on iOS Safari (as of iOS 17). On iOS we fall back to
 * manual VIN entry — which is still a huge UX improvement because we then
 * decode + inject the vehicle data automatically.
 */
type BarcodeDetectorConstructor = (new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}) & {
  getSupportedFormats?: () => Promise<string[]>;
};

const getBarcodeDetector = (): BarcodeDetectorConstructor | null => {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - BarcodeDetector is not in TS lib.dom yet for older targets
  return window.BarcodeDetector || null;
};

/** VIN-friendly formats in priority order. We intersect with what the browser
 * reports it can decode so we never pass an unsupported format to the
 * constructor (which throws on Chrome/Edge when the spec changes). */
const DESIRED_FORMATS = ["code_39", "code_128", "data_matrix"];

const resolveSupportedFormats = async (
  Detector: BarcodeDetectorConstructor,
): Promise<string[]> => {
  try {
    if (typeof Detector.getSupportedFormats === "function") {
      const supported = await Detector.getSupportedFormats();
      const filtered = DESIRED_FORMATS.filter((f) => supported.includes(f));
      if (filtered.length > 0) return filtered;
      // None of our desired formats supported — fall back to whatever the
      // browser supports rather than throwing. VIN barcodes have a chance
      // of decoding under code_93 / itf etc on some hardware.
      return supported.slice(0, 4);
    }
  } catch {
    /* probe not available — try defaults */
  }
  return DESIRED_FORMATS;
};

export const VinScanner: React.FC<VinScannerProps> = ({
  isOpen,
  onClose,
  onVehicleDecoded,
  initialMode,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  // Flips true on close/unmount so async decode + setTimeout chains can bail
  // before they call setState on an unmounted component.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const [mode, setMode] = useState<"scanner" | "manual">(
    () => initialMode ?? (getBarcodeDetector() ? "scanner" : "manual"),
  );

  useEffect(() => {
    // Re-arm when re-opened and choose the usable entry surface up front.
    if (isOpen) {
      cancelledRef.current = false;
      setMode(initialMode ?? (getBarcodeDetector() ? "scanner" : "manual"));
    }
  }, [initialMode, isOpen]);
  const [manualVin, setManualVin] = useState("");
  const [isDecoding, setIsDecoding] = useState(false);
  // Mirror of `isDecoding` read inside the detection interval. Keeping it in a
  // ref (rather than the effect dep array) stops the camera from being torn
  // down and re-acquired every time a decode starts/finishes.
  const isDecodingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string>("Point at the VIN barcode");
  const [lastDecoded, setLastDecoded] = useState<DecodedVehicle | null>(null);

  const stopCamera = useCallback(() => {
    if (detectionTimerRef.current !== null) {
      window.clearTimeout(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleDecode = useCallback(
    async (rawVin: string) => {
      const cleaned = normalizeVin(rawVin);
      if (!isValidVin(cleaned)) {
        setError(`"${cleaned}" doesn't look like a valid 17-character VIN.`);
        return;
      }
      setError(null);
      setIsDecoding(true);
      isDecodingRef.current = true;
      setScanStatus(`Looking up ${cleaned}…`);
      try {
        const vehicle = await decodeVin(cleaned);
        if (cancelledRef.current) return; // user closed mid-decode
        setLastDecoded(vehicle);
        if (vehicle.empty) {
          setError(vehicle.summary);
          logEvent("vin.decode.empty", { vinPresent: true });
        } else {
          logEvent("vin.decode.success", {
            vinPresent: true,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          });
          triggerHapticFeedback();
          // Leave enough time for assistive technology to announce the result.
          window.setTimeout(() => {
            if (cancelledRef.current) return;
            onVehicleDecoded(vehicle);
            onClose();
          }, 1600);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        // Telemetry keeps the raw message; the on-screen copy is mapped to
        // friendly text so transport errors never render verbatim.
        const raw = err instanceof Error ? err.message : String(err);
        setError(`Decode failed: ${toUiMessage(err, "Could not decode this VIN.")}`);
        logError("vin.decode.error", { vinPresent: true, message: raw });
      } finally {
        isDecodingRef.current = false;
        if (!cancelledRef.current) setIsDecoding(false);
      }
    },
    [onClose, onVehicleDecoded],
  );

  // Keep a stable ref to the latest handleDecode so the camera effect can call
  // it without listing it (or its unstable parent callbacks) as a dependency.
  const handleDecodeRef = useRef(handleDecode);
  handleDecodeRef.current = handleDecode;

  // Start camera + barcode detection loop when scanner mode is active.
  useEffect(() => {
    if (!isOpen || mode !== "scanner") {
      stopCamera();
      return;
    }

    const Detector = getBarcodeDetector();
    if (!Detector) {
      setScanStatus(
        "Camera barcode scanning isn't supported on this browser. Switch to Manual.",
      );
      return;
    }

    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const formats = await resolveSupportedFormats(Detector);
        let detector: InstanceType<BarcodeDetectorConstructor>;
        try {
          detector = new Detector({ formats });
        } catch (err) {
          // Last-ditch attempt without explicit formats — some browsers
          // refuse the `formats` option but still scan defaults.
          console.warn(
            "[VinScanner] Detector formats rejected; falling back to defaults",
            err,
          );
          detector = new Detector();
        }

        const scheduleDetection = (delay = 400) => {
          if (cancelled || cancelledRef.current || !streamRef.current) return;
          detectionTimerRef.current = window.setTimeout(async () => {
            detectionTimerRef.current = null;
            if (
              cancelled ||
              cancelledRef.current ||
              !videoRef.current ||
              !streamRef.current
            ) {
              return;
            }
            if (isDecodingRef.current) {
              scheduleDetection();
              return;
            }

            try {
              // Schedule the next scan only after this promise settles. Some
              // mobile detectors take longer than 400ms and must not overlap.
              const results = await detector.detect(videoRef.current);
              if (cancelled || cancelledRef.current || !streamRef.current) return;
              if (results.length > 0) {
                const raw = results[0].rawValue;
                // VIN barcodes sometimes have a leading framing char.
                const candidate = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
                // Look for any 17-char substring that's a valid VIN.
                for (let i = 0; i + 17 <= candidate.length; i++) {
                  const slice = candidate.slice(i, i + 17);
                  if (isValidVin(slice)) {
                    stopCamera();
                    void handleDecodeRef.current(slice);
                    return;
                  }
                }
                setScanStatus(`Detected "${candidate.slice(0, 24)}…" — keep aiming`);
              }
            } catch {
              // Detection errors are non-fatal; the serialized loop continues.
            } finally {
              if (!cancelled && !cancelledRef.current && streamRef.current) {
                scheduleDetection();
              }
            }
          }, delay);
        };
        scheduleDetection(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          msg.toLowerCase().includes("permission")
            ? "Camera permission was denied. Use Manual entry instead."
            : `Camera unavailable: ${toUiMessage(err, "Could not start the camera.")}`,
        );
        logError("vin.scanner.camera_error", { message: msg });
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // `isDecoding` and `handleDecode` are intentionally read via refs above so
    // they don't re-trigger camera acquisition. Keep deps minimal.
  }, [isOpen, mode, stopCamera]);

  // Clean up on unmount
  useEffect(() => stopCamera, [stopCamera]);

  const handleManualSubmit = useCallback(() => {
    void handleDecode(manualVin);
  }, [manualVin, handleDecode]);

  const handleClose = useCallback(() => {
    cancelledRef.current = true;
    stopCamera();
    setManualVin("");
    setError(null);
    setLastDecoded(null);
    setScanStatus("Point at the VIN barcode");
    onClose();
  }, [stopCamera, onClose]);

  const hasNativeDetector = getBarcodeDetector() !== null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Scan VIN" size="md">
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2" role="group" aria-label="VIN entry method">
          <Button
            variant={mode === "scanner" ? "primary" : "ghost"}
            size="md"
            leftIcon={<ScanLine className="h-3.5 w-3.5" />}
            onClick={() => setMode("scanner")}
            aria-pressed={mode === "scanner"}
            disabled={!hasNativeDetector}
            className="flex-1"
            title={
              hasNativeDetector
                ? "Scan VIN barcode with camera"
                : "Camera scanning not supported on this browser"
            }
          >
            Scan
          </Button>
          <Button
            variant={mode === "manual" ? "primary" : "ghost"}
            size="md"
            leftIcon={<Camera className="h-3.5 w-3.5" />}
            onClick={() => setMode("manual")}
            aria-pressed={mode === "manual"}
            className="flex-1"
          >
            Type VIN
          </Button>
        </div>

        {/* Scanner viewport */}
        <AnimatePresence mode="wait">
          {mode === "scanner" && (
            <m.div
              key="scanner-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-hairline bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                  aria-label="Live camera view for VIN barcode scanning"
                />
                {/* Targeting rails — a static frame, no sweep and no glow. */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-1/4 w-4/5 rounded-sm border border-strong" />
                </div>
              </div>
              <p
                role="status"
                aria-live="polite"
                className="text-center text-sm text-ink-2"
              >
                {scanStatus}
              </p>
              <p className="text-center text-caption leading-relaxed text-ink-hint">
                Tip: the VIN barcode is usually on the driver-side door jamb or
                lower-left corner of the windshield. Hold steady, fill the frame.
              </p>
            </m.div>
          )}

          {mode === "manual" && (
            <m.div
              key="manual-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <Input
                label="VIN (17 characters)"
                value={manualVin}
                onChange={(e) => setManualVin(e.target.value.toUpperCase())}
                placeholder="1FMSK8DH5NGA12345"
                maxLength={17}
                fullWidth
                className="font-mono"
              />
              <Button
                variant="primary"
                size="md"
                fullWidth
                disabled={!isValidVin(manualVin) || isDecoding}
                leftIcon={
                  isDecoding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )
                }
                onClick={handleManualSubmit}
              >
                {isDecoding ? "Decoding…" : "Decode VIN"}
              </Button>
            </m.div>
          )}
        </AnimatePresence>

        {/* Success preview */}
        <AnimatePresence>
          {lastDecoded && !lastDecoded.empty && (
            <m.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="flex items-start gap-3 rounded-md border border-hairline bg-success-fill p-3 text-success-ink"
            >
              <Check className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div className="text-sm">
                <div className="font-semibold">{lastDecoded.summary}</div>
                <div className="mt-0.5 font-mono text-caption">{lastDecoded.vin}</div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <m.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              role="alert"
              className="flex items-start gap-3 rounded-md border border-error-ink/40 bg-error-fill p-3 text-sm text-error-ink"
            >
              <AlertCircle
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="grid h-11 w-11 -my-1 shrink-0 place-items-center rounded-sm transition-colors duration-120 ease-out hover:bg-fill-subtle"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
