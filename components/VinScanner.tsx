import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { readVinPhoto } from "../services/vinPhotoReader";
import { triggerHapticFeedback } from "../utils/haptics";

interface VinScannerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the user confirms a decoded vehicle. The host can use the verified facts. */
  onVehicleDecoded: (vehicle: DecodedVehicle) => void;
  initialMode?: "scanner" | "manual";
}

/** Native barcode support is optional; native photo capture is available separately. */
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
  type Mode = "scanner" | "photo" | "manual";
  const defaultMode = (): Mode =>
    initialMode === "manual" ? "manual" : getBarcodeDetector() ? "scanner" : "photo";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const chooseInput = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selection = useRef<DecodedVehicle | null>(null);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [cameraSession, setCameraSession] = useState(0);
  const [manualVin, setManualVin] = useState("");
  const [isDecoding, setIsDecoding] = useState(false);
  const isDecodingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState("Point at the VIN barcode");
  const [lastDecoded, setLastDecoded] = useState<DecodedVehicle | null>(null);

  const stopCamera = useCallback(() => {
    if (detectionTimerRef.current !== null)
      window.clearTimeout(detectionTimerRef.current);
    detectionTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);
  const cancelRequest = useCallback(() => {
    generation.current++;
    selection.current = null;
    controller.current?.abort();
    controller.current = null;
    isDecodingRef.current = false;
  }, []);
  // Layout cleanup invalidates the previous open session before async work can
  // finish into a reopened modal, even if a transport ignores cancellation.
  useLayoutEffect(() => {
    cancelRequest();
    stopCamera();
    setMode(defaultMode());
    setManualVin("");
    setError(null);
    setLastDecoded(null);
    setIsDecoding(false);
    setScanStatus("Point at the VIN barcode");
    return () => {
      cancelRequest();
      stopCamera();
    };
  }, [isOpen, initialMode, cancelRequest, stopCamera]);

  const beginRequest = () => {
    cancelRequest();
    const abort = new AbortController();
    controller.current = abort;
    const identity = generation.current;
    setError(null);
    setLastDecoded(null);
    setIsDecoding(true);
    isDecodingRef.current = true;
    return {
      signal: abort.signal,
      current: () =>
        openRef.current && generation.current === identity && !abort.signal.aborted,
      finish: () => {
        if (generation.current !== identity) return;
        controller.current = null;
        isDecodingRef.current = false;
        setIsDecoding(false);
      },
    };
  };
  const handleDecode = async (raw: string) => {
    const vin = normalizeVin(raw);
    if (!isValidVin(vin)) {
      setError("Check the VIN: it needs 17 characters and cannot contain I, O, or Q.");
      return;
    }
    stopCamera();
    const request = beginRequest();
    setManualVin(vin);
    setScanStatus("Looking up the vehicle…");
    try {
      const vehicle = await decodeVin(vin, request.signal);
      if (!request.current()) return;
      setMode("manual");
      if (vehicle.empty || vehicle.vin !== vin) {
        setError(
          vehicle.vin === vin
            ? vehicle.summary
            : "The returned vehicle does not match this VIN. Check the characters and try again.",
        );
        logEvent("vin.decode.empty", { vinPresent: true });
        return;
      }
      selection.current = vehicle;
      setLastDecoded(vehicle);
      logEvent("vin.decode.success", {
        vinPresent: true,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
      });
      triggerHapticFeedback();
    } catch (reason) {
      if (!request.current()) return;
      setError(
        toUiMessage(
          reason,
          "Could not look up this VIN. Check your connection and try again.",
        ),
      );
      logError("vin.decode.error", { vinPresent: true });
    } finally {
      request.finish();
    }
  };
  const handleDecodeRef = useRef(handleDecode);
  handleDecodeRef.current = handleDecode;
  const changeMode = (next: Mode) => {
    cancelRequest();
    stopCamera();
    setIsDecoding(false);
    setLastDecoded(null);
    setError(null);
    setScanStatus("Point at the VIN barcode");
    setMode(next);
    if (next === "scanner") setCameraSession((current) => current + 1);
  };
  const openPhoto = (capture: boolean) => {
    cancelRequest();
    stopCamera();
    setIsDecoding(false);
    setLastDecoded(null);
    setManualVin("");
    setError(null);
    setMode("photo");
    (capture ? photoInput : chooseInput).current?.click();
  };
  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stopCamera();
    setMode("photo");
    const request = beginRequest();
    setScanStatus("Reading the VIN photo…");
    try {
      const vin = await readVinPhoto(file, request.signal);
      if (!request.current()) return;
      setManualVin(vin);
      setMode("manual");
      setScanStatus("Check every character against the vehicle, then look it up.");
    } catch (reason) {
      if (!request.current()) return;
      setError(
        toUiMessage(
          reason,
          "Could not read the VIN. Retake a close, sharp photo or type the 17 characters.",
        ),
      );
    } finally {
      request.finish();
    }
  };

  useEffect(() => {
    if (!isOpen || mode !== "scanner") return;
    const Detector = getBarcodeDetector();
    if (!Detector) return;
    let cancelled = false;
    const identity = generation.current;
    const current = () =>
      !cancelled && openRef.current && generation.current === identity;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!current()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const formats = await resolveSupportedFormats(Detector);
        if (!current()) return;
        let detector: InstanceType<BarcodeDetectorConstructor>;
        try {
          detector = new Detector({ formats });
        } catch {
          detector = new Detector();
        }
        const schedule = (delay = 400) => {
          if (!current() || !streamRef.current) return;
          detectionTimerRef.current = window.setTimeout(async () => {
            detectionTimerRef.current = null;
            if (!current() || !videoRef.current || !streamRef.current) return;
            if (isDecodingRef.current) {
              schedule();
              return;
            }
            try {
              const results = await detector.detect(videoRef.current);
              if (!current() || !streamRef.current) return;
              for (const result of results) {
                // Code39 may frame the entire value with asterisks; do not
                // pick a VIN-shaped substring from an unrelated barcode.
                const candidate = normalizeVin(result.rawValue).replace(
                  /^\*(.*)\*$/,
                  "$1",
                );
                if (isValidVin(candidate)) {
                  stopCamera();
                  void handleDecodeRef.current(candidate);
                  return;
                }
              }
              if (results.length)
                setScanStatus(
                  "Barcode found. Keep the complete VIN label in view, or take a photo.",
                );
            } catch {
              /* A detection miss is non-fatal. */
            } finally {
              schedule();
            }
          }, delay);
        };
        schedule(0);
      } catch (reason) {
        if (!current()) return;
        setError(
          "The live camera could not open. Take a VIN photo, choose a photo, or type the VIN instead.",
        );
        logError("vin.scanner.camera_error", { cameraAvailable: false });
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, mode, cameraSession, stopCamera]);

  const handleClose = () => {
    cancelRequest();
    stopCamera();
    setIsDecoding(false);
    setLastDecoded(null);
    onClose();
  };
  const hasNativeDetector = getBarcodeDetector() !== null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Scan VIN" size="md">
      <div className="space-y-4">
        <div className="flex gap-2" role="group" aria-label="VIN entry method">
          {hasNativeDetector && (
            <Button
              variant={mode === "scanner" ? "primary" : "ghost"}
              onClick={() => changeMode("scanner")}
              aria-pressed={mode === "scanner"}
              className="flex-1"
            >
              Live barcode
            </Button>
          )}
          <Button
            variant={mode === "photo" ? "primary" : "ghost"}
            onClick={() => changeMode("photo")}
            aria-pressed={mode === "photo"}
            className="flex-1"
          >
            VIN photo
          </Button>
          <Button
            variant={mode === "manual" ? "primary" : "ghost"}
            onClick={() => changeMode("manual")}
            aria-pressed={mode === "manual"}
            className="flex-1"
          >
            Type VIN
          </Button>
        </div>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label="Take VIN photo"
          aria-hidden="true"
          onChange={(event) => void handlePhoto(event)}
        />
        <input
          ref={chooseInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose VIN photo"
          aria-hidden="true"
          onChange={(event) => void handlePhoto(event)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            leftIcon={<Camera className="h-4 w-4" />}
            onClick={() => openPhoto(true)}
          >
            Take VIN photo
          </Button>
          <Button variant="secondary" onClick={() => openPhoto(false)}>
            Choose VIN photo
          </Button>
        </div>
        <p className="text-sm text-ink-2">
          Photograph only the VIN label. Keep all 17 characters sharp and readable.
          Photo reading uses your dealership’s AI service; check the result before using
          it.
        </p>
        {mode === "scanner" && (
          <div className="space-y-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-strong bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
                aria-label="Live camera view for VIN barcode scanning"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-1/4 w-4/5 rounded-sm border border-strong" />
              </div>
            </div>
            <p role="status" aria-live="polite" className="text-sm text-ink-2">
              {scanStatus}
            </p>
          </div>
        )}
        {mode === "photo" && (
          <p role="status" aria-live="polite" className="text-sm text-ink-2">
            {isDecoding
              ? scanStatus
              : "Take or choose a close photo of the door-jamb or windshield VIN label."}
          </p>
        )}
        {mode === "manual" && (
          <div className="space-y-3">
            <Input
              label="VIN (17 characters)"
              value={manualVin}
              onChange={(event) => {
                cancelRequest();
                setIsDecoding(false);
                setLastDecoded(null);
                setError(null);
                setManualVin(event.target.value.toUpperCase());
              }}
              placeholder="17-character VIN"
              maxLength={17}
              fullWidth
              className="font-mono"
            />
            <p className="text-sm text-ink-2">
              Check every character against the vehicle before looking it up.
            </p>
            <Button
              fullWidth
              disabled={!isValidVin(manualVin) || isDecoding}
              onClick={() => void handleDecode(manualVin)}
              leftIcon={
                isDecoding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )
              }
            >
              {isDecoding ? "Looking up…" : "Decode VIN"}
            </Button>
          </div>
        )}
        {lastDecoded && !lastDecoded.empty && (
          <div className="space-y-3 rounded-md border border-strong bg-success-fill p-3 text-success-ink">
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="flex gap-2"
            >
              <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{lastDecoded.summary}</p>
                <p className="font-mono text-sm">{lastDecoded.vin}</p>
              </div>
            </div>
            <p className="text-sm">
              Confirm the VIN and vehicle match. VIN lookup does not verify price,
              mileage, paint color, or every option.
            </p>
            <Button
              fullWidth
              onClick={() => {
                if (
                  !openRef.current ||
                  selection.current !== lastDecoded ||
                  isDecoding ||
                  normalizeVin(manualVin) !== lastDecoded.vin
                )
                  return;
                const vehicle = lastDecoded;
                cancelRequest();
                setLastDecoded(null);
                onVehicleDecoded(vehicle);
                onClose();
              }}
            >
              Use this vehicle
            </Button>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-error-ink/40 bg-error-fill p-3 text-sm text-error-ink"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="flex-1">{error}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setError(null)}
              className="grid h-11 w-11 shrink-0 place-items-center"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
