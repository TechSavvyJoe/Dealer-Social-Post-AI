import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { triggerHapticFeedback } from "../utils/haptics";

interface VinScannerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when a VIN successfully decodes. The host can stash this in state and inject it into generation. */
  onVehicleDecoded: (vehicle: DecodedVehicle) => void;
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
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<number | null>(null);
  // Flips true on close/unmount so async decode + setTimeout chains can bail
  // before they call setState on an unmounted component.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    // Re-arm when re-opened
    if (isOpen) cancelledRef.current = false;
  }, [isOpen]);

  const [mode, setMode] = useState<"scanner" | "manual">("scanner");
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
    if (detectionIntervalRef.current) {
      window.clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
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
          // Brief success display, then close.
          window.setTimeout(() => {
            if (cancelledRef.current) return;
            onVehicleDecoded(vehicle);
            onClose();
          }, 900);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Decode failed: ${msg}`);
        logError("vin.decode.error", { vinPresent: true, message: msg });
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

        detectionIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || isDecodingRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            if (results.length > 0) {
              const raw = results[0].rawValue;
              // VIN barcodes sometimes have a leading "I" framing char — strip non-alnum
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
            // detection errors are non-fatal; loop continues
          }
        }, 400);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          msg.toLowerCase().includes("permission")
            ? "Camera permission was denied. Use Manual entry instead."
            : `Camera unavailable: ${msg}`,
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
        <div className="flex gap-2 bg-surface-950/30 p-1 rounded-xl border border-white/5">
          <Button
            variant={mode === "scanner" ? "filled" : "ghost"}
            size="sm"
            leftIcon={<ScanLine className="h-3.5 w-3.5" />}
            onClick={() => setMode("scanner")}
            disabled={!hasNativeDetector}
            className="flex-1 rounded-lg"
            title={
              hasNativeDetector
                ? "Scan VIN barcode with camera"
                : "Camera scanning not supported on this browser"
            }
          >
            Scan
          </Button>
          <Button
            variant={mode === "manual" ? "filled" : "ghost"}
            size="sm"
            leftIcon={<Camera className="h-3.5 w-3.5" />}
            onClick={() => setMode("manual")}
            className="flex-1 rounded-lg"
          >
            Type VIN
          </Button>
        </div>

        {/* Scanner viewport */}
        <AnimatePresence mode="wait">
          {mode === "scanner" && (
            <motion.div
              key="scanner-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* Targeting overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-4/5 h-1/4 border-2 border-primary-400/80 rounded-lg shadow-[0_0_24px_rgba(56,189,248,0.4)]" />
                </div>
                {/* Scan line */}
                <motion.div
                  className="absolute left-[10%] right-[10%] h-[2px] bg-primary-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]"
                  animate={{ top: ["38%", "62%", "38%"] }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>
              <p className="text-xs text-surface-300 text-center">{scanStatus}</p>
              <p className="text-[10px] text-surface-500 text-center leading-relaxed">
                Tip: the VIN barcode is usually on the driver-side door jamb or
                lower-left corner of the windshield. Hold steady, fill the frame.
              </p>
            </motion.div>
          )}

          {mode === "manual" && (
            <motion.div
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
                className="bg-white/5 border-white/10 focus:border-primary-400 font-mono uppercase tracking-wider"
              />
              <Button
                variant="filled"
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success preview */}
        <AnimatePresence>
          {lastDecoded && !lastDecoded.empty && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 bg-success-900/40 border border-success-700/50 rounded-xl p-3 text-success-100"
            >
              <Check className="h-5 w-5 text-success-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold">{lastDecoded.summary}</div>
                <div className="text-[11px] text-success-300 mt-0.5 font-mono">
                  {lastDecoded.vin}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-start gap-3 bg-error-900/40 border border-error-700/50 rounded-xl p-3 text-error-100 text-sm"
            >
              <AlertCircle className="h-5 w-5 text-error-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-error-300 hover:text-error-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
