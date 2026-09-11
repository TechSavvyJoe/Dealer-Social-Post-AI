import React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Film,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { toUiMessage } from "../utils/errorMessages";
import {
  approveWalkaround,
  completeYouTubeConnection,
  createWalkaroundProject,
  deleteWalkaround,
  getWalkaroundProject,
  findPersistedUploadForFile,
  matchExistingSourceAsset,
  publishWalkaround,
  requestWalkaroundReedit,
  saveWalkaroundRelease,
  startYouTubeConnection,
  startWalkaroundProcessing,
  updateWalkaroundReview,
  uploadWalkaroundFile,
  validateWalkaroundClips,
  type WalkaroundAudience,
  type WalkaroundCaptureMode,
  type WalkaroundClipInput,
  type WalkaroundMetadata,
  type WalkaroundProject,
  type WalkaroundVisibility,
} from "../services/walkarounds";
import {
  WalkaroundReleaseModal,
  type CapturedWalkaroundRelease,
} from "./WalkaroundReleaseModal";

interface WalkaroundStudioProps {
  dealerId: string;
  dealerName: string;
  requiresApproval: boolean;
  canManageYouTube?: boolean;
  onBack: () => void;
}

type PendingClip = WalkaroundClipInput & { key: string; progress: number };

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.round(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
};

const readDuration = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const finish = () => URL.revokeObjectURL(url);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      finish();
      Number.isFinite(duration) && duration > 0
        ? resolve(duration)
        : reject(new Error("Video duration is unavailable"));
    };
    video.onerror = () => {
      finish();
      reject(new Error("Video metadata could not be read"));
    };
    video.src = url;
  });

const statusLabel = (project: WalkaroundProject) =>
  project.publicationState !== "not_requested"
    ? project.publicationState.replaceAll("_", " ")
    : project.productionState.replaceAll("_", " ");

export const WalkaroundStudio: React.FC<WalkaroundStudioProps> = ({
  dealerId,
  dealerName,
  requiresApproval,
  canManageYouTube = false,
  onBack,
}) => {
  const [audience, setAudience] = React.useState<WalkaroundAudience>("inventory");
  const [captureMode, setCaptureMode] =
    React.useState<WalkaroundCaptureMode>("one_take");
  const [clips, setClips] = React.useState<PendingClip[]>([]);
  const [vin, setVin] = React.useState("");
  const [customerLabel, setCustomerLabel] = React.useState("");
  const [identifiableNonEmployee, setIdentifiableNonEmployee] = React.useState(false);
  const [capturedRelease, setCapturedRelease] =
    React.useState<CapturedWalkaroundRelease | null>(null);
  const [releaseOpen, setReleaseOpen] = React.useState(false);
  const [releaseSaved, setReleaseSaved] = React.useState(false);
  const [project, setProject] = React.useState<WalkaroundProject | null>(null);
  const [metadata, setMetadata] = React.useState<WalkaroundMetadata>({
    title: "",
    description: "",
    tags: [],
    madeForKids: false,
  });
  const [chaptersDraft, setChaptersDraft] = React.useState("");
  const [visibility, setVisibility] = React.useState<WalkaroundVisibility>("unlisted");
  const [availabilityAttested, setAvailabilityAttested] = React.useState(false);
  const [youtubeConnection, setYoutubeConnection] = React.useState<{
    connected: boolean;
    channelTitle?: string;
    reason?: string;
  } | null>(null);
  const [youtubeAuthorizationUrl, setYoutubeAuthorizationUrl] = React.useState("");
  const [youtubeStateReference, setYoutubeStateReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<"publish" | "delete" | "reedit" | null>(
    null,
  );
  const [reeditInstructions, setReeditInstructions] = React.useState("");
  const currentProjectKey = `dealer-social:walkaround-current:v1:${dealerId}`;

  const validation = React.useMemo(
    () => validateWalkaroundClips(clips, captureMode),
    [captureMode, clips],
  );

  React.useEffect(() => {
    if (audience === "customer") {
      setVisibility("unlisted");
      setAvailabilityAttested(false);
      setIdentifiableNonEmployee(true);
    }
  }, [audience]);

  React.useEffect(() => {
    if (!project) return;
    if (project.releaseValid) setReleaseSaved(true);
    setMetadata(
      project.metadata || { title: "", description: "", tags: [], madeForKids: false },
    );
    setChaptersDraft(
      (project.metadata?.chapters || [])
        .map(
          (chapter) =>
            `${Math.floor(chapter.seconds / 60)}:${String(chapter.seconds % 60).padStart(2, "0")} ${chapter.label}`,
        )
        .join("\n"),
    );
    if (project.youtube?.visibility) setVisibility(project.youtube.visibility);
  }, [project]);

  React.useEffect(() => {
    if (project?.productionState !== "review_ready") return;
    if (project.youtubeChannel) {
      setYoutubeConnection(project.youtubeChannel);
      return;
    }
    setYoutubeConnection({
      connected: false,
      reason:
        "YouTube channel status is unavailable. Ask a manager to verify the connection.",
    });
  }, [project?.productionState, project?.youtubeChannel]);

  React.useEffect(() => {
    let active = true;
    let projectId: string | null = null;
    try {
      projectId = localStorage.getItem(currentProjectKey);
    } catch {
      // The studio remains usable without cross-reload convenience.
    }
    if (!projectId)
      return () => {
        active = false;
      };
    void getWalkaroundProject(projectId)
      .then((saved) => {
        if (active && saved.productionState !== "deleted") setProject(saved);
      })
      .catch(() => {
        // A stale/other-tenant id is never trusted; the server remains authoritative.
      });
    return () => {
      active = false;
    };
  }, [currentProjectKey]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(toUiMessage(cause, "The request failed safely."));
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (
      !files?.length ||
      (project && !["draft", "uploading"].includes(project.productionState))
    )
      return;
    setError(null);
    const additions: PendingClip[] = [];
    for (const file of Array.from(files)) {
      try {
        const durationSeconds = await readDuration(file);
        additions.push({
          file,
          durationSeconds,
          progress: 0,
          key: `${file.name}:${file.size}:${file.lastModified}`,
        });
      } catch {
        additions.push({
          file,
          durationSeconds: 0,
          progress: 0,
          key: `${file.name}:${file.size}:${file.lastModified}`,
        });
      }
    }
    setClips((current) =>
      (project?.captureMode || captureMode) === "one_take"
        ? additions.slice(0, 1)
        : [...current, ...additions],
    );
  };

  const moveClip = (index: number, direction: -1 | 1) => {
    setClips((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };

  const uploadAndProcess = async (target: WalkaroundProject) => {
    const sources = (target.assets || []).filter((asset) => asset.kind === "source");
    const usedAssetIds = new Set<string>();
    let newSourceOffset = 0;
    for (let order = 0; order < clips.length; order += 1) {
      const clip = clips[order];
      const persisted = findPersistedUploadForFile(target.id, clip.file);
      const allowOrderMatch = clips.length >= sources.length;
      const matching = matchExistingSourceAsset(
        sources,
        clip.file,
        allowOrderMatch ? order : -1,
        usedAssetIds,
        persisted?.assetId,
      );
      if (matching) usedAssetIds.add(matching.id);
      if (matching?.state === "verified") {
        setClips((current) =>
          current.map((entry) =>
            entry.key === clip.key ? { ...entry, progress: 1 } : entry,
          ),
        );
        continue;
      }
      const resumeAssetId =
        matching && ["uploading", "pending_upload"].includes(matching.state)
          ? matching.id
          : undefined;
      if (matching && !resumeAssetId) {
        throw new Error(
          "This clip cannot be resumed automatically. Its prior upload must be cleared by a manager before trying again.",
        );
      }
      if (
        !matching &&
        sources.some((asset) => ["uploading", "pending_upload"].includes(asset.state))
      ) {
        throw new Error(
          "This paused clip cannot be matched safely. Resume from the browser that started the upload or ask a manager for support.",
        );
      }
      const originalOrder = matching
        ? matching.order - 1
        : sources.length + newSourceOffset++;
      await uploadWalkaroundFile(
        target.id,
        clip.file,
        originalOrder,
        clip.durationSeconds,
        (progress) => {
          setClips((current) =>
            current.map((entry) =>
              entry.key === clip.key ? { ...entry, progress } : entry,
            ),
          );
        },
        resumeAssetId,
      );
    }
    setProject(await startWalkaroundProcessing(target.id));
  };

  const createAndUpload = () =>
    run(async () => {
      if (!validation.valid) throw new Error(validation.errors[0]);
      if (identifiableNonEmployee && !capturedRelease) {
        throw new Error(
          "Capture the expanded video and voice release before processing.",
        );
      }
      const created = await createWalkaroundProject({
        audience,
        captureMode,
        vin: vin.trim() || undefined,
        containsIdentifiableNonEmployee: identifiableNonEmployee,
      });
      setProject(created);
      try {
        localStorage.setItem(currentProjectKey, created.id);
      } catch {
        // Server project and upload progress remain authoritative.
      }
      if (identifiableNonEmployee && capturedRelease) {
        await saveWalkaroundRelease(created.id, capturedRelease);
        setReleaseSaved(true);
      }
      await uploadAndProcess(created);
    });

  const resumeUpload = () =>
    project &&
    run(async () => {
      const result = validateWalkaroundClips(clips, project.captureMode);
      if (!result.valid) throw new Error(result.errors[0]);
      if (project.containsIdentifiableNonEmployee && !releaseSaved) {
        if (!capturedRelease)
          throw new Error("Capture the customer walkaround release before resuming.");
        await saveWalkaroundRelease(project.id, capturedRelease);
        setReleaseSaved(true);
      }
      await uploadAndProcess(project);
    });

  const refresh = () =>
    project && run(async () => setProject(await getWalkaroundProject(project.id)));

  const retryProcessing = () =>
    project && run(async () => setProject(await startWalkaroundProcessing(project.id)));

  const saveReview = () =>
    project &&
    run(async () => {
      if (!metadata.title.trim() || !metadata.description.trim()) {
        throw new Error("Title and description are required before approval.");
      }
      setProject(
        await updateWalkaroundReview(project.id, project.reviewRevision, metadata),
      );
    });

  const approve = () =>
    project?.masterSha256 &&
    run(async () =>
      setProject(
        await approveWalkaround(
          project.id,
          project.reviewRevision,
          project.masterSha256!,
        ),
      ),
    );

  const publish = () =>
    project?.masterSha256 &&
    run(async () => {
      const selectedVisibility =
        project.audience === "customer" ? "unlisted" : visibility;
      if (selectedVisibility === "public" && !availabilityAttested) {
        throw new Error(
          "Confirm current vehicle availability before publishing publicly.",
        );
      }
      setProject(
        await publishWalkaround(project.id, {
          revision: project.reviewRevision,
          masterSha256: project.masterSha256!,
          visibility: selectedVisibility,
          availabilityAttested,
        }),
      );
      setConfirm(null);
    });

  const removeProject = () =>
    project &&
    run(async () => {
      await deleteWalkaround(project.id);
      try {
        localStorage.removeItem(currentProjectKey);
      } catch {
        // The deleted server state prevents reuse even if local cleanup fails.
      }
      setProject(null);
      setClips([]);
      setConfirm(null);
    });

  const requestReedit = () =>
    project &&
    run(async () => {
      const instructions = reeditInstructions.trim();
      if (instructions.length < 10 || instructions.length > 4000) {
        throw new Error(
          "Re-edit instructions must be between 10 and 4,000 characters.",
        );
      }
      setProject(
        await requestWalkaroundReedit(project.id, {
          revision: project.reviewRevision,
          instructions,
          captionsText: metadata.captionsText,
        }),
      );
      setReeditInstructions("");
      setConfirm(null);
    });

  const beginYouTubeConnection = () =>
    run(async () => {
      const started = await startYouTubeConnection();
      setYoutubeAuthorizationUrl(started.authorizationUrl);
    });

  const finishYouTubeConnection = () =>
    run(async () => {
      const stateReference = youtubeStateReference.trim();
      if (!stateReference)
        throw new Error("Paste the one-time authorization return code.");
      const connected = await completeYouTubeConnection(stateReference);
      setYoutubeConnection(connected);
      setYoutubeAuthorizationUrl("");
      setYoutubeStateReference("");
    });

  const inputClass =
    "min-h-11 w-full rounded-xl border border-hairline bg-surface-950/45 px-3 py-2 text-surface-50 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/30 disabled:opacity-60";

  const ready = project?.productionState === "review_ready";
  const approved =
    !requiresApproval || project?.approvedRevision === project?.reviewRevision;
  const reviewed = project?.reviewedRevision === project?.reviewRevision;
  const published = project?.publicationState.startsWith("published_");
  const updateChapters = (value: string) => {
    setChaptersDraft(value);
    const chapters = value
      .split(/\r?\n/)
      .map((line) => {
        const match = /^\s*(\d+):(\d{2})\s+(.+?)\s*$/.exec(line);
        return match
          ? { seconds: Number(match[1]) * 60 + Number(match[2]), label: match[3] }
          : null;
      })
      .filter((chapter): chapter is { seconds: number; label: string } =>
        Boolean(chapter),
      );
    setMetadata((current) => ({ ...current, chapters }));
  };

  const shareVerifiedLink = async () => {
    const url = project?.youtube?.watchUrl;
    if (!url) return;
    if (navigator.share) {
      await navigator.share({
        title: metadata.title || "Vehicle walkaround",
        text: "Your vehicle walkaround is ready.",
        url,
      });
      return;
    }
    await navigator.clipboard.writeText(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-300">
            {dealerName}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-surface-50 sm:text-3xl">
            Vehicle Walkaround Studio
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-surface-300">
            Upload your real walkaround. The studio prepares edits, captions, a 1080p
            master, and a vertical teaser for review before YouTube.
          </p>
        </div>
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Photo studio
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-error-500/35 bg-error-500/10 p-4 text-sm text-error-100 [.theme-light_&]:text-error-800"
        >
          <strong className="block">Nothing was published.</strong>
          {error}
        </div>
      )}

      {!project ? (
        <section className="space-y-5 rounded-2xl border border-hairline bg-surface-900/65 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-surface-100">
                Audience
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(["inventory", "customer"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={audience === value}
                    onClick={() => setAudience(value)}
                    className={`min-h-12 rounded-xl border px-3 text-sm font-semibold capitalize ${audience === value ? "border-primary-400 bg-primary-500/20 text-primary-100 [.theme-light_&]:text-primary-950" : "border-hairline text-surface-300"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-surface-400">
                Locked after the project is created.
              </p>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-surface-100">
                Recording style
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(["one_take", "multi_clip"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={captureMode === value}
                    onClick={() => {
                      setCaptureMode(value);
                      if (value === "one_take")
                        setClips((current) => current.slice(0, 1));
                    }}
                    className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${captureMode === value ? "border-primary-400 bg-primary-500/20 text-primary-100 [.theme-light_&]:text-primary-950" : "border-hairline text-surface-300"}`}
                  >
                    {value === "one_take" ? "One take" : "Multiple clips"}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-950/35 p-4 text-sm text-surface-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={identifiableNonEmployee}
              disabled={audience === "customer"}
              onChange={(event) => {
                setIdentifiableNonEmployee(event.target.checked);
                if (!event.target.checked) setCapturedRelease(null);
              }}
            />
            <span>
              <strong className="block text-surface-100">
                Does any identifiable customer or non-employee appear or speak?
              </strong>
              <span className="mt-1 block text-xs text-surface-400">
                This includes a visible face, recognizable voice, name, or other
                identifying detail. A signed walkaround release is required regardless
                of audience mode.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-surface-200">
              VIN or stock number (optional)
              <input
                className={`${inputClass} mt-2`}
                value={vin}
                onChange={(event) => setVin(event.target.value)}
              />
            </label>
            {audience === "customer" && (
              <label className="text-sm font-medium text-surface-200">
                Customer label (optional, no contact details)
                <input
                  className={`${inputClass} mt-2`}
                  value={customerLabel}
                  onChange={(event) => setCustomerLabel(event.target.value)}
                />
              </label>
            )}
          </div>

          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary-400/45 bg-primary-500/[0.07] p-5 text-center focus-within:ring-2 focus-within:ring-primary-400">
            <Upload className="mb-2 h-6 w-6 text-primary-300" aria-hidden="true" />
            <span className="font-semibold text-surface-100">
              Shoot or choose {captureMode === "one_take" ? "a video" : "videos"}
            </span>
            <span className="mt-1 text-xs text-surface-400">
              MOV, MP4, or WebM · up to 12 clips · 20 minutes · 10 GB total
            </span>
            <input
              aria-label="Walkaround videos"
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm"
              capture="environment"
              multiple={captureMode === "multi_clip"}
              className="sr-only"
              onChange={(event) => void addFiles(event.target.files)}
            />
          </label>

          {clips.length > 0 && (
            <div className="space-y-2" aria-label="Selected clips">
              {clips.map((clip, index) => (
                <div
                  key={clip.key}
                  className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-950/35 p-3"
                >
                  <Film
                    className="h-5 w-5 shrink-0 text-primary-300"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-surface-100">
                      {index + 1}. {clip.file.name}
                    </p>
                    <p className="text-xs text-surface-400">
                      {clip.durationSeconds > 0
                        ? formatDuration(clip.durationSeconds)
                        : "Duration unavailable"}{" "}
                      · {(clip.file.size / 1024 / 1024).toFixed(1)} MB
                      {clip.progress > 0
                        ? ` · ${Math.round(clip.progress * 100)}% uploaded`
                        : ""}
                    </p>
                  </div>
                  {captureMode === "multi_clip" && (
                    <>
                      <Button
                        aria-label={`Move ${clip.file.name} up`}
                        variant="plain"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => moveClip(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label={`Move ${clip.file.name} down`}
                        variant="plain"
                        size="icon"
                        disabled={index === clips.length - 1}
                        onClick={() => moveClip(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    aria-label={`Remove ${clip.file.name}`}
                    variant="plain"
                    size="icon"
                    onClick={() =>
                      setClips((current) =>
                        current.filter((item) => item.key !== clip.key),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!validation.valid && clips.length > 0 && (
            <ul className="space-y-1 text-sm text-warning-300">
              {validation.errors.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          )}

          {identifiableNonEmployee && (
            <div className="space-y-3 rounded-xl border border-warning-400/30 bg-warning-500/10 p-4">
              <div className="flex gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning-300" />
                <p className="text-sm text-warning-100">
                  Customer videos require a saved release covering video, voice, cloud
                  AI processing, and YouTube sharing before upload processing can begin.
                </p>
              </div>
              {capturedRelease ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-success-300">
                  <CheckCircle2 className="h-5 w-5" />
                  Release captured for {capturedRelease.signedName}. It will be saved
                  before media processing.
                </p>
              ) : (
                <Button variant="outline" onClick={() => setReleaseOpen(true)}>
                  Capture video and voice release
                </Button>
              )}
            </div>
          )}

          <Button
            fullWidth
            loading={busy}
            disabled={
              !validation.valid || (identifiableNonEmployee && !capturedRelease)
            }
            onClick={createAndUpload}
            leftIcon={<Upload className="h-5 w-5" />}
          >
            Upload and prepare walkaround
          </Button>
          <p className="text-center text-xs text-surface-400">
            Processing never starts if upload, consent, or backend configuration cannot
            be verified.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-hairline bg-surface-900/65 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-surface-400">
                  {project.audience} · {project.captureMode.replaceAll("_", " ")}
                </p>
                <h2 className="mt-1 text-xl font-semibold capitalize text-surface-50">
                  {statusLabel(project)}
                </h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={refresh}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                Refresh
              </Button>
            </div>
            {!ready && (
              <p className="mt-3 text-sm text-surface-300">
                You can leave this screen. Durable processing continues, but YouTube is
                not contacted before review.
              </p>
            )}
            {project.productionState === "retryable_failed" && (
              <div className="mt-4 rounded-xl border border-warning-400/35 bg-warning-500/10 p-4">
                <p className="text-sm text-warning-100">
                  Processing stopped after a temporary provider or worker failure. Your
                  verified source media is preserved.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  loading={busy}
                  onClick={retryProcessing}
                >
                  Retry processing
                </Button>
              </div>
            )}
            {project.productionState === "terminal_failed" && (
              <div className="mt-4 rounded-xl border border-error-400/35 bg-error-500/10 p-4 text-sm text-error-100 [.theme-light_&]:text-error-800">
                <strong className="block">
                  This project cannot be retried automatically.
                </strong>
                Review the quality warning, reshoot unusable footage, or ask a manager
                for support. No video was published.
              </div>
            )}
            {project.publicationState === "reconciliation_required" && (
              <div className="mt-4 rounded-xl border border-warning-400/35 bg-warning-500/10 p-4 text-sm text-warning-100 [.theme-light_&]:text-warning-900">
                <strong className="block">YouTube reconciliation is required.</strong>A
                manager must verify the existing YouTube upload before any new
                publication attempt. Do not upload it again.
              </div>
            )}
            {["draft", "uploading"].includes(project.productionState) && (
              <div className="mt-4 space-y-3 rounded-xl border border-primary-400/25 bg-primary-500/[0.07] p-4">
                <p className="text-sm text-surface-200">
                  Upload paused. Re-select the same source{" "}
                  {project.captureMode === "one_take" ? "file" : "files"} to resume from
                  the last acknowledged chunk.
                </p>
                <label className="block cursor-pointer rounded-xl border border-dashed border-primary-400/45 p-3 text-center text-sm font-semibold text-primary-200">
                  Re-select source{" "}
                  {project.captureMode === "one_take" ? "video" : "videos"}
                  <input
                    aria-label="Resume walkaround videos"
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm"
                    multiple={project.captureMode === "multi_clip"}
                    className="sr-only"
                    onChange={(event) => void addFiles(event.target.files)}
                  />
                </label>
                {project.containsIdentifiableNonEmployee && !releaseSaved && (
                  <Button variant="outline" onClick={() => setReleaseOpen(true)}>
                    {capturedRelease
                      ? `Release captured for ${capturedRelease.signedName}`
                      : "Capture customer release"}
                  </Button>
                )}
                <Button
                  fullWidth
                  loading={busy}
                  disabled={
                    !validateWalkaroundClips(clips, project.captureMode).valid ||
                    (project.containsIdentifiableNonEmployee &&
                      !releaseSaved &&
                      !capturedRelease)
                  }
                  onClick={resumeUpload}
                >
                  Resume upload and processing
                </Button>
              </div>
            )}
            {project.qcWarnings?.length ? (
              <div className="mt-4 rounded-xl border border-warning-400/35 bg-warning-500/10 p-4">
                <p className="flex items-center gap-2 font-semibold text-warning-100">
                  <AlertTriangle className="h-5 w-5" />
                  Review or reshoot recommended
                </p>
                <ul className="mt-2 space-y-1 text-sm text-warning-200">
                  {project.qcWarnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-warning-200">
                  The studio will not claim severely dark, blurry, shaky, or clipped
                  footage was repaired.
                </p>
              </div>
            ) : null}
          </section>

          {ready && (
            <section className="space-y-4 rounded-2xl border border-hairline bg-surface-900/65 p-4 sm:p-6">
              <div>
                <h2 className="text-xl font-semibold text-surface-50">
                  Review the exact export
                </h2>
                <p className="mt-1 text-sm text-surface-400">
                  Editing title, description, or video creates a new revision and
                  invalidates prior approval.
                </p>
              </div>
              {project.masterPreviewUrl && (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full rounded-xl bg-black"
                  src={project.masterPreviewUrl}
                >
                  Your browser cannot preview this video.
                </video>
              )}
              {project.thumbnailUrl && (
                <div>
                  <p className="mb-2 text-sm font-medium text-surface-200">
                    YouTube thumbnail preview
                  </p>
                  <img
                    src={project.thumbnailUrl}
                    alt="Generated YouTube thumbnail preview"
                    className="aspect-video w-full max-w-lg rounded-xl object-cover"
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-surface-200">
                  YouTube title
                  <input
                    className={`${inputClass} mt-2`}
                    value={metadata.title}
                    maxLength={100}
                    onChange={(event) =>
                      setMetadata((value) => ({ ...value, title: event.target.value }))
                    }
                  />
                </label>
                <label className="text-sm font-medium text-surface-200">
                  Tags (comma separated)
                  <input
                    className={`${inputClass} mt-2`}
                    value={metadata.tags.join(", ")}
                    onChange={(event) =>
                      setMetadata((value) => ({
                        ...value,
                        tags: event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      }))
                    }
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-surface-200">
                Description
                <textarea
                  className={`${inputClass} mt-2 min-h-36`}
                  value={metadata.description}
                  onChange={(event) =>
                    setMetadata((value) => ({
                      ...value,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-surface-200">
                  Thumbnail copy
                  <input
                    className={`${inputClass} mt-2`}
                    value={metadata.thumbnailText || ""}
                    maxLength={100}
                    onChange={(event) =>
                      setMetadata((value) => ({
                        ...value,
                        thumbnailText: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="text-sm font-medium text-surface-200">
                  Chapters (one per line: 0:00 Label)
                  <textarea
                    className={`${inputClass} mt-2 min-h-28 font-mono text-sm`}
                    value={chaptersDraft}
                    onChange={(event) => updateChapters(event.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-surface-200">
                Captions / correction notes
                <textarea
                  className={`${inputClass} mt-2 min-h-32`}
                  value={metadata.captionsText || ""}
                  placeholder="Review generated captions and enter exact corrections before saving this revision."
                  onChange={(event) =>
                    setMetadata((value) => ({
                      ...value,
                      captionsText: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="rounded-xl border border-hairline bg-surface-950/35 p-4">
                <label className="block text-sm font-medium text-surface-200">
                  Request changes to the actual video edit
                  <textarea
                    className={`${inputClass} mt-2 min-h-28`}
                    minLength={10}
                    maxLength={4000}
                    value={reeditInstructions}
                    placeholder="Example: Remove the first false start, keep the full rear-seat explanation, and lower the music under speech."
                    onChange={(event) => setReeditInstructions(event.target.value)}
                  />
                </label>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-surface-400">
                    This starts a new render and invalidates the current review and
                    approval.
                  </p>
                  <Button
                    variant="outline"
                    disabled={
                      reeditInstructions.trim().length < 10 ||
                      reeditInstructions.trim().length > 4000
                    }
                    onClick={() => setConfirm("reedit")}
                  >
                    Request re-edit
                  </Button>
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm text-surface-200">
                <input
                  type="checkbox"
                  checked={metadata.madeForKids}
                  onChange={(event) =>
                    setMetadata((value) => ({
                      ...value,
                      madeForKids: event.target.checked,
                    }))
                  }
                />
                This video is made for kids
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" loading={busy} onClick={saveReview}>
                  {reviewed
                    ? "Save a new reviewed revision"
                    : "Confirm review and save"}
                </Button>
                {reviewed && (
                  <span className="flex items-center gap-1 text-sm text-success-300">
                    <CheckCircle2 className="h-4 w-4" />
                    Exact master and metadata reviewed
                  </span>
                )}
                {requiresApproval && project.canApprove ? (
                  <Button
                    loading={busy}
                    disabled={
                      !reviewed ||
                      !project.masterSha256 ||
                      project.approvedRevision === project.reviewRevision
                    }
                    onClick={approve}
                  >
                    Approve exact revision
                  </Button>
                ) : requiresApproval &&
                  project.approvedRevision !== project.reviewRevision ? (
                  <p className="text-sm font-medium text-warning-200">
                    Waiting for manager approval of this exact revision.
                  </p>
                ) : null}
              </div>
            </section>
          )}

          {ready && (
            <section className="space-y-4 rounded-2xl border border-hairline bg-surface-900/65 p-4 sm:p-6">
              <div>
                <h2 className="text-xl font-semibold text-surface-50">
                  YouTube publication
                </h2>
                <p className="mt-1 text-sm text-surface-400">
                  The upload starts private. Visibility changes only after YouTube
                  processing and playback verification.
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 text-sm ${youtubeConnection?.connected ? "border-success-400/30 bg-success-500/10 text-success-200 [.theme-light_&]:text-success-800" : "border-warning-400/30 bg-warning-500/10 text-warning-100 [.theme-light_&]:text-warning-900"}`}
              >
                {youtubeConnection === null
                  ? "Checking the dealership YouTube channel…"
                  : youtubeConnection.connected
                    ? `Connected channel: ${youtubeConnection.channelTitle || "Verified dealership channel"}`
                    : youtubeConnection.reason ||
                      "YouTube is not connected for this dealership."}
              </div>
              {canManageYouTube && !youtubeConnection?.connected && (
                <div className="space-y-3 rounded-xl border border-primary-400/25 bg-primary-500/[0.07] p-4">
                  <p className="text-sm text-surface-200">
                    Managers can connect the dealership YouTube channel. Tokens and
                    channel IDs remain server-side.
                  </p>
                  {!youtubeAuthorizationUrl ? (
                    <Button
                      variant="outline"
                      loading={busy}
                      onClick={beginYouTubeConnection}
                    >
                      Start YouTube connection
                    </Button>
                  ) : (
                    <>
                      <a
                        className="inline-flex min-h-11 items-center rounded-xl bg-primary-500 px-4 py-2 font-semibold text-white"
                        href={youtubeAuthorizationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Authorize with Google
                      </a>
                      <label className="block text-sm font-medium text-surface-200">
                        One-time authorization return code
                        <input
                          className={`${inputClass} mt-2`}
                          autoComplete="off"
                          value={youtubeStateReference}
                          onChange={(event) =>
                            setYoutubeStateReference(event.target.value)
                          }
                        />
                      </label>
                      <Button
                        loading={busy}
                        disabled={!youtubeStateReference.trim()}
                        onClick={finishYouTubeConnection}
                      >
                        Complete YouTube connection
                      </Button>
                    </>
                  )}
                </div>
              )}
              {project.audience === "customer" ? (
                <div className="rounded-xl border border-warning-400/30 bg-warning-500/10 p-3 text-sm text-warning-100 [.theme-light_&]:text-warning-900">
                  Customer walkarounds are always unlisted. Anyone with the link can
                  forward it.
                </div>
              ) : (
                <>
                  <label className="block text-sm font-medium text-surface-200">
                    Final visibility
                    <select
                      className={`${inputClass} mt-2`}
                      value={visibility}
                      onChange={(event) =>
                        setVisibility(event.target.value as WalkaroundVisibility)
                      }
                    >
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  {visibility === "public" && (
                    <label className="flex items-start gap-3 rounded-xl border border-warning-400/30 bg-warning-500/10 p-3 text-sm text-warning-100 [.theme-light_&]:text-warning-900">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={availabilityAttested}
                        onChange={(event) =>
                          setAvailabilityAttested(event.target.checked)
                        }
                      />
                      I verified this vehicle is currently available and the video
                      contains no stale pricing or unsupported claims.
                    </label>
                  )}
                </>
              )}
              {!published ? (
                <Button
                  disabled={
                    !reviewed ||
                    !approved ||
                    !project.masterSha256 ||
                    !youtubeConnection?.connected ||
                    (visibility === "public" && !availabilityAttested)
                  }
                  onClick={() => setConfirm("publish")}
                >
                  Publish reviewed video
                </Button>
              ) : project.youtube?.playbackVerified && project.youtube.watchUrl ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="gradient-teal"
                    onClick={() => void shareVerifiedLink()}
                  >
                    Share with customer
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(project.youtube!.watchUrl!)
                    }
                    leftIcon={<Copy className="h-4 w-4" />}
                  >
                    Copy link
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-surface-300">
                  YouTube accepted the upload. Link sharing remains locked until
                  playback is verified.
                </p>
              )}
            </section>
          )}

          <Button
            variant="danger"
            disabled={busy}
            onClick={() => setConfirm("delete")}
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            Delete walkaround project
          </Button>
        </div>
      )}

      <Modal
        isOpen={confirm === "publish"}
        onClose={() => setConfirm(null)}
        title="Publish this exact revision?"
        description="This starts a private YouTube upload; it does not skip processing checks."
        disableClose={busy}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Keep reviewing
            </Button>
            <Button loading={busy} onClick={publish}>
              Start private upload
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-surface-300">
          Confirm the title, description, thumbnail, audience setting, channel, and
          final video are correct.{" "}
          {project?.audience === "customer"
            ? "The final link will be unlisted but can still be forwarded."
            : visibility === "public"
              ? "After verification, this inventory video will be public."
              : "After verification, this inventory video will be unlisted."}
        </p>
      </Modal>
      <Modal
        isOpen={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete this walkaround?"
        description="This removes the app project, originals, and derived media."
        disableClose={busy}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Keep project
            </Button>
            <Button variant="danger" loading={busy} onClick={removeProject}>
              Delete project
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-surface-300">
          <p>This cannot be undone after the storage deletion completes.</p>
          <p>
            <strong className="text-surface-100">
              A published YouTube video is not deleted automatically.
            </strong>{" "}
            Remove it from YouTube separately if needed.
          </p>
        </div>
      </Modal>
      <Modal
        isOpen={confirm === "reedit"}
        onClose={() => setConfirm(null)}
        title="Start a new video edit?"
        description="The current review and manager approval will be invalidated."
        disableClose={busy}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Keep current edit
            </Button>
            <Button loading={busy} onClick={requestReedit}>
              Queue re-edit
            </Button>
          </>
        }
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-surface-300">
          {reeditInstructions}
        </p>
      </Modal>
      <WalkaroundReleaseModal
        isOpen={releaseOpen}
        dealerName={dealerName}
        defaultName={customerLabel}
        onClose={() => setReleaseOpen(false)}
        onCaptured={(release) => {
          setCapturedRelease(release);
          setCustomerLabel(release.signedName);
        }}
      />
    </div>
  );
};
