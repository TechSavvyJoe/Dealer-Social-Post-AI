import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Images, Rotate3D, Upload, X } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { toUiMessage } from "../utils/errorMessages";
import { buildEmployeeDisclosure } from "../utils/complianceDisclosures";
import { useSpinFrameUrls } from "../hooks/useSpinFrameUrls";
import { VehicleSpinViewer } from "./VehicleSpinViewer";
import { Button } from "./ui/Button";
import { decodeVin, isValidVin, normalizeVin } from "../services/vinDecoder";
import {
  deleteVehicleSpin,
  getVehicleSpin,
  listVehicleSpins,
  loadSpinFrames,
  saveVehicleSpin,
  spinAction,
  vehicleSpinLink,
  type VehicleSpin,
} from "../services/vehicleSpins";
import {
  extractSpinFrames,
  openSpinVideo,
  type SpinBackground,
  type SpinVehicle,
} from "../utils/vehicleSpin";
import {
  composeSpinFrames,
  segmentSpinVehicle,
  type SpinSelectionPoint,
} from "../utils/vehicleSpinBackground";
import { exportSpinVideo, spinRecordingType } from "../utils/vehicleSpinExport";
import {
  savePreparedMediaToLibrary,
  saveResultToastMessage,
  invokeWebShareNow,
} from "../utils/mediaSave";

const EMPTY_VEHICLE: SpinVehicle = {
  title: "",
  vin: "",
  stock: "",
  mileage: "",
  highlights: [],
  caption: "",
};
const fieldClass =
  "mt-1 min-h-11 w-full rounded-sm border border-strong bg-canvas px-3 py-2 text-base text-ink";
const errorMessage = (error: unknown) =>
  toUiMessage(error, "That action could not finish. Please retry.");
const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const VehicleSpinStudio: React.FC<{
  onDirtyChange: (dirty: boolean) => void;
}> = ({ onDirtyChange }) => {
  const dealer = useAppStore((state) => state.currentDealer);
  const [vehicle, setVehicle] = useState<SpinVehicle>({ ...EMPTY_VEHICLE });
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [originals, setOriginals] = useState<Blob[]>([]);
  const [frames, setFrames] = useState<Blob[]>([]);
  const [cutouts, setCutouts] = useState<Blob[] | null>(null);
  const [background, setBackground] = useState<SpinBackground>("original");
  const [custom, setCustom] = useState<Blob | null>(null);
  const [picking, setPicking] = useState(false);
  const [correction, setCorrection] = useState<"keep" | "remove" | null>(null);
  const [angle, setAngle] = useState(0);
  const [selections, setSelections] = useState<SpinSelectionPoint[][]>([]);
  const [requestedBackground, setRequestedBackground] =
    useState<SpinBackground>("graphite");
  const [spin, setSpin] = useState<VehicleSpin | null>(null);
  const [library, setLibrary] = useState<VehicleSpin[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [vehicleOnly, setVehicleOnly] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [format, setFormat] = useState<"portrait" | "landscape">("portrait");
  const [exported, setExported] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const previewArea = useRef<HTMLDivElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const previewFrames = correction ? originals : frames;
  const urls = useSpinFrameUrls(previewFrames);
  const videoFrames = useMemo(() => (exported ? [exported] : []), [exported]);
  const videoUrls = useSpinFrameUrls(videoFrames);
  const locked = Boolean(spin);
  const dirty = Boolean(
    ((file || frames.length > 0) && !spin) ||
    (spin?.state === "uploading" && frames.length) ||
    busy,
  );
  useEffect(() => {
    if (picking || correction) previewArea.current?.scrollIntoView({ block: "start" });
  }, [picking, correction]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await listVehicleSpins(signal);
    if (!signal?.aborted) {
      setLibrary(result.items);
      setCanReview(result.canReview);
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(errorMessage(reason));
    });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!file) {
      setSourceUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const run = async (
    label: string,
    operation: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(label);
    setProgress(0);
    setError("");
    setNotice("");
    try {
      await operation(abort.signal);
    } catch (reason) {
      if (!isAbort(reason) && !abort.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy("");
      }
    }
  };
  const reset = () => {
    setFile(null);
    setFrames([]);
    setOriginals([]);
    setCutouts(null);
    setSpin(null);
    setVehicle({ ...EMPTY_VEHICLE });
    setReviewed(false);
    setVehicleOnly(false);
    setBackground("original");
    setCustom(null);
    setExported(null);
    setReviewNote("");
    setPicking(false);
    setCorrection(null);
    setSelections([]);
    setConfirmDelete(false);
    setNotice("");
    setError("");
  };
  const chooseVideo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    void run("Opening video", async (signal) => {
      const source = await openSpinVideo(chosen, signal);
      try {
        if (signal.aborted) return;
        reset();
        setVehicle(vehicle);
        setFile(chosen);
        setDuration(source.duration);
        setStart(0);
        setEnd(source.duration);
      } finally {
        source.close();
      }
    });
  };
  const chooseBackground = (next: SpinBackground) => {
    setCorrection(null);
    setPicking(false);
    if (next !== "original" && !cutouts) {
      setRequestedBackground(next);
      setPicking(true);
      setNotice(
        "Tap the center of the vehicle in the preview. Keep it centered throughout your recording.",
      );
      return;
    }
    void run("Applying background", async (signal) => {
      const output = await composeSpinFrames(originals, cutouts, next, custom, signal);
      if (!signal.aborted) {
        setFrames(output);
        setBackground(next);
        setReviewed(false);
      }
    });
  };
  const selectVehicle = (point: { x: number; y: number }) => {
    const correcting = correction;
    const targetAngle = angle;
    const points = correcting
      ? [
          ...(selections[targetAngle] || []),
          { ...point, remove: correcting === "remove" },
        ]
      : [point];
    setPicking(false);
    setCorrection(null);
    void run(
      correcting
        ? "Refining angle " + (targetAngle + 1)
        : "Separating vehicle from background",
      async (signal) => {
        const result = await segmentSpinVehicle(
          correcting ? [originals[targetAngle]] : originals,
          points,
          {
            signal,
            onProgress: setProgress,
          },
        );
        const nextCutouts = correcting ? [...cutouts!] : result;
        if (correcting) nextCutouts[targetAngle] = result[0];
        const nextBackground = correcting ? background : requestedBackground;
        const output = await composeSpinFrames(
          originals,
          nextCutouts,
          nextBackground,
          custom,
          signal,
        );
        if (!signal.aborted) {
          setCutouts(nextCutouts);
          setSelections((previous) =>
            correcting
              ? previous.map((entry, index) => (index === targetAngle ? points : entry))
              : originals.map(() => points),
          );
          setFrames(output);
          setBackground(nextBackground);
          setReviewed(false);
          setNotice(
            "Inspect every angle, especially mirrors, wheels and windows. Refine an edge below or restore the original background.",
          );
        }
      },
    );
  };
  const openSaved = (item: VehicleSpin) => {
    if (dirty && !window.confirm("Discard this unsaved spin and open the saved one?"))
      return;
    void run("Opening saved spin", async (signal) => {
      const current = await getVehicleSpin(item.id, signal);
      const images =
        current.state === "uploading"
          ? []
          : await loadSpinFrames(current, { signal, onProgress: setProgress });
      if (signal.aborted) return;
      reset();
      setSpin(current);
      setFrames(images);
      setVehicle(current.vehicle);
      setBackground(current.background);
      if (current.state === "uploading")
        setNotice(
          "This upload was interrupted. Delete it and create a new spin from your original recording.",
        );
    });
  };
  const caption = spin?.vehicle.caption || spin?.vehicle.title || vehicle.title;
  const copyText = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => true,
      () => false,
    ) || Promise.resolve(false);
  const shareExport = () => {
    if (!exported) return;
    const copied = copyText(caption);
    // Invoke the native sheet before awaiting the clipboard, preserving iOS activation.
    const sharing = savePreparedMediaToLibrary({
      file: exported,
      filename: exported.name,
      kind: "video",
    });
    void Promise.all([copied, sharing]).then(([didCopy, result]) =>
      setNotice(
        saveResultToastMessage(result) +
          (didCopy
            ? " Caption copied; paste only if your social app leaves it blank."
            : " Copy the caption below if your social app leaves it blank."),
      ),
    );
  };
  const changeVehicle = (key: keyof SpinVehicle, value: string | string[]) => {
    setVehicle((current) => ({ ...current, [key]: value }));
    setReviewed(false);
  };
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-ink">
            Vehicle studio
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            Every angle. One great view.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
            Turn a walk around the vehicle into a view people can spin and explore.
          </p>
        </div>
        {(file || spin || frames.length > 0) && (
          <Button
            variant="secondary"
            disabled={Boolean(busy)}
            onClick={() => {
              if (!dirty || window.confirm("Discard this unsaved spin?")) reset();
            }}
          >
            New spin
          </Button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-sm border border-error-ink bg-error-fill p-3 text-sm text-error-ink"
        >
          {error}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-sm border border-strong bg-panel p-3 text-sm leading-6 text-ink-2"
        >
          {notice}
        </p>
      )}
      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-sm border border-strong bg-panel p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink">
              {busy}… {progress > 0 ? Math.round(progress * 100) + "%" : ""}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel processing"
              onClick={() => controller.current?.abort()}
            >
              <X />
            </Button>
          </div>
          <progress
            className="mt-2 h-1 w-full accent-brand-ink"
            max={1}
            value={progress}
          />
        </div>
      )}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <div ref={previewArea} className="space-y-4 scroll-mt-4">
          {frames.length ? (
            <VehicleSpinViewer
              frames={urls}
              title={vehicle.title || "Your vehicle"}
              onAngleChange={setAngle}
              selectionLabel={
                correction === "keep"
                  ? "Tap a missing part of the vehicle"
                  : correction === "remove"
                    ? "Tap background that should be removed"
                    : undefined
              }
              onSelectVehicle={picking || correction ? selectVehicle : undefined}
            />
          ) : sourceUrl ? (
            <video
              src={sourceUrl}
              controls
              playsInline
              muted
              className="max-h-[55svh] w-full rounded-lg border border-strong bg-panel"
              aria-label="Original walkaround video"
            />
          ) : (
            <div className="rounded-lg border border-strong bg-panel px-5 py-8">
              <Rotate3D className="mb-5 h-10 w-10 text-brand-ink" aria-hidden="true" />
              <h2 className="text-xl font-semibold text-ink">
                Walk once around the vehicle
              </h2>
              <p className="mt-3 text-sm leading-6 text-ink-2">
                Park in an open area. Hold your phone level and landscape, keep the
                whole vehicle centered, and walk slowly at the same distance. Finish
                where you started.
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-2">
                Use daylight, keep people and plates you do not want to share out of the
                frame, and record 15–60 seconds. Maximum 3 minutes / 500 MB.
              </p>
            </div>
          )}
          {sourceUrl && frames.length > 0 && (
            <details className="rounded-lg border border-strong bg-panel p-3">
              <summary className="cursor-pointer text-sm text-ink">
                Review original recording
              </summary>
              <video
                src={sourceUrl}
                controls
                playsInline
                muted
                className="mt-3 max-h-[50svh] w-full"
                aria-label="Original walkaround recording"
              />
            </details>
          )}
          {!locked && (
            <>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                capture="environment"
                ref={cameraInput}
                className="sr-only"
                tabIndex={-1}
                aria-label="Record a vehicle walkaround"
                onChange={chooseVideo}
              />
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                ref={libraryInput}
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose a walkaround video"
                onChange={chooseVideo}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  disabled={Boolean(busy)}
                  leftIcon={<Camera />}
                  onClick={() => cameraInput.current?.click()}
                >
                  Record video
                </Button>
                <Button
                  variant="secondary"
                  disabled={Boolean(busy)}
                  leftIcon={<Images />}
                  onClick={() => libraryInput.current?.click()}
                >
                  Choose video
                </Button>
              </div>
              {file && (
                <section className="rounded-lg border border-strong bg-panel p-4">
                  <h2 className="text-base font-semibold text-ink">
                    Choose one complete turn
                  </h2>
                  <p className="mt-1 text-sm text-ink-2">
                    Preview the video and enter the start and end of one full circle.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-sm text-ink-2">
                      Start (seconds)
                      <input
                        className={fieldClass}
                        type="number"
                        min={0}
                        max={end - 4}
                        step={0.1}
                        value={start}
                        disabled={Boolean(busy)}
                        onChange={(event) => setStart(Number(event.target.value))}
                      />
                    </label>
                    <label className="text-sm text-ink-2">
                      End (seconds)
                      <input
                        className={fieldClass}
                        type="number"
                        min={start + 4}
                        max={duration}
                        step={0.1}
                        value={Number(end.toFixed(1))}
                        disabled={Boolean(busy)}
                        onChange={(event) => setEnd(Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <Button
                    className="mt-4"
                    fullWidth
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Building your 360° view", async (signal) => {
                        const result = await extractSpinFrames(
                          file,
                          { start, end },
                          { signal, onProgress: setProgress },
                        );
                        if (!signal.aborted) {
                          setFrames(result);
                          setOriginals(result);
                          setCutouts(null);
                          setSelections([]);
                          setCorrection(null);
                          setPicking(false);
                          setBackground("original");
                          setReviewed(false);
                        }
                      })
                    }
                  >
                    {frames.length ? "Rebuild 360° view" : "Build 360° view"}
                  </Button>
                </section>
              )}
              {frames.length > 0 && (
                <section className="rounded-lg border border-strong bg-panel p-4">
                  <h2 className="text-base font-semibold text-ink">Background</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(
                      ["original", "graphite", "pearl", "custom"] as SpinBackground[]
                    ).map((choice) => (
                      <Button
                        key={choice}
                        variant={background === choice ? "primary" : "secondary"}
                        aria-pressed={background === choice}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          choice === "custom" && !custom
                            ? backgroundInput.current?.click()
                            : chooseBackground(choice)
                        }
                      >
                        {choice === "original"
                          ? "Original"
                          : choice === "graphite"
                            ? "Graphite studio"
                            : choice === "pearl"
                              ? "Pearl studio"
                              : "Your image"}
                      </Button>
                    ))}
                  </div>
                  <input
                    ref={backgroundInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Choose a studio background"
                    onChange={(event) => {
                      const image = event.target.files?.[0];
                      event.target.value = "";
                      if (!image) return;
                      if (
                        image.size > 8000000 ||
                        !/^image\/(jpeg|png|webp)$/.test(image.type)
                      ) {
                        setError("Choose a JPEG, PNG or WebP background under 8 MB.");
                        return;
                      }
                      setCustom(image);
                      setNotice(
                        "Background selected. Separate the vehicle, then choose Your image.",
                      );
                      setRequestedBackground("custom");
                      if (!cutouts) setPicking(true);
                    }}
                  />
                  <p className="mt-3 text-xs leading-5 text-ink-2">
                    Background editing runs on this device. Review mirrors, glass and
                    tires at every angle before saving.
                  </p>
                  {cutouts && background !== "original" && !picking && (
                    <div className="mt-3 border-t border-hairline pt-3">
                      <p className="text-sm font-medium text-ink">
                        Refine angle {angle + 1}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => setCorrection("keep")}
                        >
                          Restore missing detail
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => setCorrection("remove")}
                        >
                          Remove background
                        </Button>
                      </div>
                      {correction && (
                        <p className="mt-2 text-xs text-ink-2">
                          Tap the original image above. This changes only the current
                          angle.
                        </p>
                      )}
                    </div>
                  )}
                  {(picking || correction) && (
                    <Button
                      className="mt-2"
                      variant="ghost"
                      onClick={() => {
                        setPicking(false);
                        setCorrection(null);
                      }}
                    >
                      Cancel selection
                    </Button>
                  )}
                </section>
              )}
            </>
          )}
          {spin && (
            <section className="rounded-lg border border-strong bg-panel p-4">
              <h2 className="text-base font-semibold text-ink">
                {spin.state === "pending"
                  ? "Waiting for manager review"
                  : spin.state === "rejected"
                    ? "Changes requested"
                    : spin.state === "uploading"
                      ? "Upload incomplete"
                      : spin.canDeliver
                        ? "Ready to share"
                        : "Manager review required"}
              </h2>
              {spin.reviewNote && (
                <p className="mt-2 text-sm text-ink-2">{spin.reviewNote}</p>
              )}
              <p className="mt-2 text-sm text-ink-2">
                Saved frames and vehicle details stay together. Edit a copy to make
                changes; the existing customer link keeps this version.
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                disabled={Boolean(busy)}
                onClick={() => openSaved(spin)}
              >
                Refresh status
              </Button>
              {frames.length > 0 && spin.state !== "uploading" && (
                <Button
                  variant="secondary"
                  className="ml-2 mt-3"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSpin(null);
                    setOriginals(frames);
                    setCutouts(null);
                    setSelections([]);
                    setBackground("original");
                    setReviewed(false);
                    setVehicleOnly(false);
                    setExported(null);
                    setReviewNote("");
                    setFile(null);
                    setNotice(
                      "Editing a new copy. Save and review it before sharing. Existing customer links keep their saved version.",
                    );
                  }}
                >
                  Edit a copy
                </Button>
              )}
              {canReview && ["pending", "n_a"].includes(spin.state) && (
                <>
                  <label className="mt-4 flex items-start gap-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                      className="mt-1 h-5 w-5"
                    />
                    I reviewed every angle, the background edges, and the vehicle
                    details.
                  </label>
                  <label className="mt-3 block text-sm text-ink-2">
                    Review note
                    <textarea
                      value={reviewNote}
                      maxLength={400}
                      className={fieldClass}
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["approved", "rejected"] as const).map((decision) => (
                      <Button
                        key={decision}
                        variant={decision === "approved" ? "primary" : "secondary"}
                        disabled={
                          !reviewed ||
                          Boolean(busy) ||
                          (decision === "rejected" && !reviewNote.trim())
                        }
                        onClick={() =>
                          void run("Saving review", async (signal) => {
                            const current = await spinAction(
                              spin.id,
                              "review",
                              { decision, note: reviewNote, reviewedAllAngles: true },
                              signal,
                            );
                            setSpin(current);
                            await refresh(signal);
                          })
                        }
                      >
                        {decision === "approved" ? "Approve spin" : "Request changes"}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        <div className="space-y-4">
          <section className="rounded-lg border border-strong bg-panel p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-ink">Vehicle details</h2>
            <p className="mt-1 text-sm leading-6 text-ink-2">
              These details appear beside the spin and on the video. Check them against
              the vehicle.
            </p>
            <fieldset disabled={locked || Boolean(busy)} className="mt-4 space-y-3">
              <label className="block text-sm text-ink-2">
                VIN (optional)
                <input
                  className={fieldClass}
                  value={vehicle.vin}
                  maxLength={17}
                  autoCapitalize="characters"
                  onChange={(event) =>
                    changeVehicle("vin", normalizeVin(event.target.value))
                  }
                />
              </label>
              {!locked && (
                <Button
                  variant="secondary"
                  disabled={!isValidVin(vehicle.vin) || Boolean(busy)}
                  onClick={() =>
                    void run("Looking up vehicle", async (signal) => {
                      const result = await decodeVin(vehicle.vin);
                      if (signal.aborted) return;
                      if (result.empty)
                        throw new Error(
                          "VIN details were unavailable. Enter the verified vehicle details manually.",
                        );
                      setVehicle((current) => ({
                        ...current,
                        title: [result.year, result.make, result.model, result.trim]
                          .filter(Boolean)
                          .join(" ")
                          .slice(0, 120),
                        highlights: [
                          result.driveType,
                          result.fuelType,
                          result.engineDisplacementL &&
                            result.engineDisplacementL + "L engine",
                        ]
                          .filter(Boolean)
                          .slice(0, 4) as string[],
                      }));
                      setReviewed(false);
                      setNotice(
                        "VIN details loaded. Confirm the trim and equipment before saving.",
                      );
                    })
                  }
                >
                  Look up VIN
                </Button>
              )}
              <label className="block text-sm text-ink-2">
                Vehicle name
                <input
                  className={fieldClass}
                  maxLength={120}
                  placeholder="2024 Ford Bronco Outer Banks"
                  value={vehicle.title}
                  onChange={(event) => changeVehicle("title", event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-ink-2">
                  Mileage
                  <input
                    inputMode="numeric"
                    maxLength={12}
                    className={fieldClass}
                    value={vehicle.mileage}
                    onChange={(event) => changeVehicle("mileage", event.target.value)}
                  />
                </label>
                <label className="block text-sm text-ink-2">
                  Stock number
                  <input
                    className={fieldClass}
                    maxLength={40}
                    value={vehicle.stock}
                    onChange={(event) => changeVehicle("stock", event.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm text-ink-2">
                Highlights (up to 4, one per line)
                <textarea
                  className={fieldClass}
                  rows={4}
                  value={vehicle.highlights.join("\n")}
                  onChange={(event) =>
                    changeVehicle(
                      "highlights",
                      event.target.value.split("\n").slice(0, 4),
                    )
                  }
                />
              </label>
              <label className="block text-sm text-ink-2">
                Caption and hashtags
                <textarea
                  className={fieldClass}
                  rows={4}
                  maxLength={1600}
                  value={vehicle.caption}
                  onChange={(event) => changeVehicle("caption", event.target.value)}
                />
              </label>
            </fieldset>
            {!locked && buildEmployeeDisclosure(dealer) && (
              <p className="mt-3 text-xs leading-5 text-ink-2">
                Included in your saved caption: {buildEmployeeDisclosure(dealer)}
              </p>
            )}
            {!locked && (
              <div className="mt-5 space-y-3">
                <label className="flex items-start gap-3 text-sm leading-6 text-ink">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={reviewed}
                    disabled={Boolean(busy)}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />
                  I checked all angles, the background edges, and the vehicle facts.
                </label>
                <label className="flex items-start gap-3 text-sm leading-6 text-ink">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={vehicleOnly}
                    disabled={Boolean(busy)}
                    onChange={(event) => setVehicleOnly(event.target.checked)}
                  />
                  This recording shows the vehicle without identifiable customers or
                  bystanders.
                </label>
              </div>
            )}
            {(!spin || spin.state === "uploading") && frames.length > 0 && (
              <Button
                className="mt-5"
                fullWidth
                leftIcon={<Upload />}
                disabled={
                  Boolean(busy) || !reviewed || !vehicleOnly || !vehicle.title.trim()
                }
                onClick={() =>
                  void run("Saving your spin", async (signal) => {
                    const current = await saveVehicleSpin(
                      {
                        vehicle: {
                          ...vehicle,
                          highlights: vehicle.highlights
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                        background,
                        frames,
                        existing: spin,
                      },
                      { signal, onCreated: setSpin, onProgress: setProgress },
                    );
                    setSpin(current);
                    setVehicle(current.vehicle);
                    setFile(null);
                    await refresh(signal);
                    setNotice(
                      current.canDeliver
                        ? "Saved. Create a customer link or export a video below."
                        : "Saved for your manager to review.",
                    );
                  })
                }
              >
                {spin ? "Resume upload" : "Save for sharing"}
              </Button>
            )}
          </section>
          {spin?.canDeliver && (
            <section className="rounded-lg border border-strong bg-panel p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Share the experience</h2>
              <p className="mt-2 text-sm leading-6 text-ink-2">
                Send an interactive customer link, or share a video to Facebook,
                Instagram or TikTok.
              </p>
              {!spin.linkToken ? (
                <Button
                  variant="secondary"
                  fullWidth
                  className="mt-4"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Creating customer link", async (signal) => {
                      setSpin(await spinAction(spin.id, "share", {}, signal));
                      setNotice("Customer link ready. Use Share link to send it.");
                    })
                  }
                >
                  Create customer link
                </Button>
              ) : (
                <div className="mt-4 space-y-2">
                  <label className="block text-sm text-ink-2">
                    Customer link
                    <input
                      readOnly
                      className={fieldClass}
                      value={vehicleSpinLink(spin.linkToken)}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <Button
                    fullWidth
                    onClick={() => {
                      const link = vehicleSpinLink(spin.linkToken!);
                      const copied = copyText(link);
                      const shared = invokeWebShareNow({
                        title: spin.vehicle.title,
                        text: caption,
                        url: link,
                      });
                      void Promise.all([copied, shared]).then(([didCopy, result]) =>
                        setNotice(
                          result.kind === "cancelled"
                            ? "Sharing cancelled. Your link is still available."
                            : result.kind === "completed"
                              ? "Link handed to the selected app."
                              : didCopy
                                ? "Link copied. Paste it into your message or post."
                                : "Select and copy the customer link above.",
                        ),
                      );
                    }}
                  >
                    Share link
                  </Button>
                  <Button
                    variant="ghost"
                    fullWidth
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Turning off link", async (signal) => {
                        setSpin(await spinAction(spin.id, "revoke", {}, signal));
                        setNotice("The previous customer link is now unavailable.");
                      })
                    }
                  >
                    Turn off customer link
                  </Button>
                </div>
              )}
              <label className="mt-5 block text-sm text-ink-2">
                Video layout
                <select
                  className={fieldClass}
                  value={format}
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    setFormat(event.target.value as typeof format);
                    setExported(null);
                  }}
                >
                  <option value="portrait">Vertical · Reels, Stories & TikTok</option>
                  <option value="landscape">Landscape · Facebook & websites</option>
                </select>
              </label>
              <Button
                fullWidth
                className="mt-3"
                disabled={Boolean(busy) || !spinRecordingType()}
                onClick={() =>
                  void run(
                    "Preparing vehicle video — keep this screen open",
                    async (signal) => {
                      const approved = await spinAction(spin.id, "export", {}, signal);
                      const savedFrames = await loadSpinFrames(approved, { signal });
                      const result = await exportSpinVideo(
                        savedFrames,
                        approved.vehicle,
                        approved.dealerName,
                        format,
                        { signal, onProgress: setProgress },
                      );
                      if (!signal.aborted) {
                        setExported(result);
                        setNotice(
                          "Video ready. Share / Save will also copy your caption and hashtags.",
                        );
                      }
                    },
                  )
                }
              >
                {exported ? "Rebuild video" : "Create vehicle video"}
              </Button>
              {!spinRecordingType() && (
                <p className="mt-2 text-xs text-ink-2">
                  Video export is unavailable in this browser. Your saved spin can be
                  opened on another device.
                </p>
              )}
              {exported && (
                <div className="mt-4 space-y-3">
                  <video
                    src={videoUrls[0]}
                    controls
                    muted
                    playsInline
                    className="max-h-[50svh] w-full rounded-sm"
                    aria-label="Exported vehicle video"
                  />
                  <p className="text-xs text-ink-2">
                    {exported.type === "video/mp4"
                      ? "MP4"
                      : "WebM · some social apps require MP4; use Safari or a browser with MP4 recording support."}
                  </p>
                  <Button fullWidth onClick={shareExport}>
                    Share / Save video
                  </Button>
                </div>
              )}
            </section>
          )}
          {spin && (
            <div className="rounded-lg border border-strong bg-panel p-4">
              {confirmDelete ? (
                <>
                  <p className="text-sm text-ink">
                    Delete this saved spin and turn off its customer link?
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="danger"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("Deleting spin", async (signal) => {
                          await deleteVehicleSpin(spin.id, signal);
                          reset();
                          await refresh(signal);
                        })
                      }
                    >
                      Delete spin
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete saved spin
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <section className="mt-8 border-t border-strong pt-5">
        <h2 className="text-xl font-semibold text-ink">
          {canReview ? "Dealership spins" : "Your saved spins"}
        </h2>
        {!library.length ? (
          <p className="mt-3 text-sm text-ink-2">
            Saved vehicle views will appear here.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {library.map((item) => (
              <button
                key={item.id}
                disabled={Boolean(busy)}
                className="flex min-h-20 items-center gap-3 rounded-lg border border-strong bg-panel p-3 text-left hover:bg-panel-raised disabled:opacity-50"
                onClick={() => openSaved(item)}
              >
                {item.state !== "uploading" && (
                  <img
                    src={"/api/app/vehicle-spins/" + item.id + "/frames/0"}
                    alt=""
                    className="h-16 w-24 rounded-sm object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">
                    {item.vehicle.title}
                  </span>
                  <span className="mt-1 block text-xs text-ink-2">
                    {item.state === "pending"
                      ? "Needs review"
                      : item.state === "rejected"
                        ? "Changes requested"
                        : item.state === "uploading"
                          ? "Upload incomplete"
                          : item.canDeliver
                            ? "Ready to share"
                            : "Review required"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
