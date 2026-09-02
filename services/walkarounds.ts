import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import { readApiError } from "./apiErrors";

export const WALKAROUND_LIMITS = {
  maxClips: 12,
  maxDurationSeconds: 20 * 60,
  maxBytes: 10 * 1024 * 1024 * 1024,
  chunkBytes: 8 * 1024 * 1024,
} as const;

// Re-exported for existing importers; the definition lives in
// ./walkaroundFlags so eager shell code can read the flag without pulling
// this whole service into the entry chunk.
export { isWalkaroundStudioEnabled } from "./walkaroundFlags";

export type WalkaroundAudience = "customer" | "inventory";
export type WalkaroundCaptureMode = "one_take" | "multi_clip";
export type WalkaroundVisibility = "unlisted" | "public";
export type WalkaroundProductionState =
  | "draft"
  | "uploading"
  | "uploaded"
  | "queued"
  | "analyzing"
  | "rendering"
  | "audio_polish"
  | "quality_check"
  | "review_ready"
  | "retryable_failed"
  | "terminal_failed"
  | "cancelled"
  | "deleting"
  | "deleted";
export type WalkaroundPublicationState =
  | "not_requested"
  | "uploading_private"
  | "processing"
  | "publishing"
  | "published_unlisted"
  | "published_public"
  | "reconciliation_required"
  | "failed";

export interface WalkaroundMetadata {
  title: string;
  description: string;
  tags: string[];
  chapters?: Array<{ seconds: number; label: string }>;
  thumbnailText?: string;
  captionsText?: string;
  madeForKids: boolean;
}

export interface WalkaroundProject {
  id: string;
  audience: WalkaroundAudience;
  captureMode: WalkaroundCaptureMode;
  containsIdentifiableNonEmployee?: boolean;
  productionState: WalkaroundProductionState;
  publicationState: WalkaroundPublicationState;
  reviewRevision: number;
  reviewedRevision?: number;
  approvedRevision?: number;
  approvalRequired: boolean;
  canApprove?: boolean;
  releaseValid?: boolean;
  masterSha256?: string;
  masterPreviewUrl?: string;
  teaserPreviewUrl?: string;
  thumbnailUrl?: string;
  qcWarnings?: string[];
  metadata?: WalkaroundMetadata;
  youtube?: {
    channelTitle?: string;
    videoId?: string;
    watchUrl?: string;
    visibility?: WalkaroundVisibility;
    playbackVerified?: boolean;
  };
  youtubeChannel?: { connected: boolean; channelTitle?: string };
  assets?: WalkaroundAsset[];
}

export interface WalkaroundAsset {
  id: string;
  kind: string;
  order: number;
  state: string;
  filename: string;
  sizeBytes: number;
  durationMs?: number;
}

export const matchExistingSourceAsset = (
  assets: WalkaroundAsset[],
  file: File,
  selectedOrder: number,
  usedAssetIds: ReadonlySet<string> = new Set(),
  persistedAssetId?: string,
): WalkaroundAsset | undefined => {
  const candidates = assets.filter(
    (asset) =>
      asset.kind === "source" &&
      asset.filename === file.name &&
      asset.sizeBytes === file.size &&
      !usedAssetIds.has(asset.id),
  );
  if (persistedAssetId)
    return candidates.find((asset) => asset.id === persistedAssetId);
  if (selectedOrder < 0) return undefined;
  return candidates.find((asset) => asset.order === selectedOrder + 1);
};

export interface WalkaroundClipInput {
  file: File;
  durationSeconds: number;
}

export interface WalkaroundValidationResult {
  valid: boolean;
  errors: string[];
  totalBytes: number;
  totalDurationSeconds: number;
}

const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export const walkaroundContentType = (file: File): string => {
  if (ACCEPTED_VIDEO_TYPES.has(file.type.toLowerCase())) return file.type.toLowerCase();
  if (!file.type) {
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension === "mov") return "video/quicktime";
    if (extension === "mp4") return "video/mp4";
    if (extension === "webm") return "video/webm";
  }
  return "";
};

export const validateWalkaroundClips = (
  clips: WalkaroundClipInput[],
  captureMode: WalkaroundCaptureMode,
): WalkaroundValidationResult => {
  const errors: string[] = [];
  const totalBytes = clips.reduce((sum, clip) => sum + clip.file.size, 0);
  const totalDurationSeconds = clips.reduce(
    (sum, clip) => sum + Math.max(0, clip.durationSeconds || 0),
    0,
  );

  if (!clips.length) errors.push("Add at least one walkaround video.");
  if (captureMode === "one_take" && clips.length > 1) {
    errors.push("One-take mode accepts exactly one video.");
  }
  if (clips.length > WALKAROUND_LIMITS.maxClips) {
    errors.push(`Use no more than ${WALKAROUND_LIMITS.maxClips} clips.`);
  }
  if (totalDurationSeconds > WALKAROUND_LIMITS.maxDurationSeconds) {
    errors.push("Keep the combined walkaround at 20 minutes or less.");
  }
  if (totalBytes > WALKAROUND_LIMITS.maxBytes) {
    errors.push("Keep the combined upload at 10 GB or less.");
  }
  clips.forEach(({ file, durationSeconds }, index) => {
    if (!walkaroundContentType(file)) {
      errors.push(`Clip ${index + 1} must be MOV, MP4, or WebM.`);
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      errors.push(`Clip ${index + 1} duration could not be verified.`);
    }
  });

  return { valid: errors.length === 0, errors, totalBytes, totalDurationSeconds };
};

interface UploadSession {
  assetId: string;
  sessionUrl: string;
  expiresAt?: string;
  nextByte?: number;
  headers?: Record<string, string>;
}

const PRODUCTION_STATES = new Set<WalkaroundProductionState>([
  "draft",
  "uploading",
  "uploaded",
  "queued",
  "analyzing",
  "rendering",
  "audio_polish",
  "quality_check",
  "review_ready",
  "retryable_failed",
  "terminal_failed",
  "cancelled",
  "deleting",
  "deleted",
]);
const PUBLICATION_STATES = new Set<WalkaroundPublicationState>([
  "not_requested",
  "uploading_private",
  "processing",
  "publishing",
  "published_unlisted",
  "published_public",
  "reconciliation_required",
  "failed",
]);

const parseProject = (value: unknown): WalkaroundProject => {
  if (!value || typeof value !== "object") {
    throw new Error(
      "Walkaround service returned an invalid project. Nothing was published.",
    );
  }
  const raw = value as Partial<WalkaroundProject> & {
    audienceMode?: WalkaroundAudience;
    metadataRevision?: number;
    approved?: boolean;
    publication?: {
      videoId?: string | null;
      visibility?: string;
      playbackVerified?: boolean;
      shareUrl?: string | null;
    } | null;
    qcSummary?: { warnings?: string[] } | string[] | null;
    captionsText?: string;
  };
  const rawMetadata =
    raw.metadata && typeof raw.metadata === "object"
      ? (raw.metadata as unknown as Omit<WalkaroundMetadata, "chapters"> & {
          thumbnailCopy?: string;
          chapters?: Array<{
            seconds?: number;
            label?: string;
            atSeconds?: number;
            title?: string;
          }>;
        })
      : undefined;
  const normalizedMetadata = rawMetadata
    ? {
        ...rawMetadata,
        thumbnailText: rawMetadata.thumbnailText ?? rawMetadata.thumbnailCopy,
        captionsText: rawMetadata.captionsText ?? raw.captionsText,
        chapters: Array.isArray(rawMetadata.chapters)
          ? rawMetadata.chapters
              .map((chapter) => ({
                seconds: chapter.seconds ?? chapter.atSeconds,
                label: chapter.label ?? chapter.title,
              }))
              .filter(
                (chapter): chapter is { seconds: number; label: string } =>
                  Number.isFinite(chapter.seconds) &&
                  typeof chapter.label === "string" &&
                  Boolean(chapter.label.trim()),
              )
          : undefined,
      }
    : raw.metadata;
  const candidate: Partial<WalkaroundProject> = {
    ...raw,
    audience: raw.audience ?? raw.audienceMode,
    captureMode:
      raw.captureMode === ("continuous" as WalkaroundCaptureMode)
        ? "one_take"
        : raw.captureMode === ("clips" as WalkaroundCaptureMode)
          ? "multi_clip"
          : raw.captureMode,
    reviewRevision: raw.reviewRevision ?? raw.metadataRevision,
    approvedRevision:
      raw.approvedRevision ??
      (raw.approved ? (raw.reviewRevision ?? raw.metadataRevision) : undefined),
    qcWarnings: Array.isArray(raw.qcSummary)
      ? raw.qcSummary.filter((entry): entry is string => typeof entry === "string")
      : raw.qcSummary?.warnings?.filter(
          (entry): entry is string => typeof entry === "string",
        ),
    youtube: raw.publication
      ? {
          videoId: raw.publication.videoId || undefined,
          watchUrl: raw.publication.shareUrl || undefined,
          visibility:
            raw.publication.visibility === "public" ||
            raw.publication.visibility === "unlisted"
              ? raw.publication.visibility
              : undefined,
          playbackVerified: Boolean(raw.publication.playbackVerified),
        }
      : raw.youtube,
    metadata: normalizedMetadata as WalkaroundMetadata | undefined,
  };
  if (
    typeof candidate.id !== "string" ||
    !candidate.id ||
    (candidate.audience !== "customer" && candidate.audience !== "inventory") ||
    (candidate.captureMode !== "one_take" && candidate.captureMode !== "multi_clip") ||
    !PRODUCTION_STATES.has(candidate.productionState as WalkaroundProductionState) ||
    !PUBLICATION_STATES.has(candidate.publicationState as WalkaroundPublicationState) ||
    typeof candidate.reviewRevision !== "number" ||
    typeof candidate.approvalRequired !== "boolean"
  ) {
    throw new Error(
      "Walkaround service returned an invalid project. Nothing was published.",
    );
  }
  return candidate as WalkaroundProject;
};

const parseUploadSession = (value: unknown): UploadSession => {
  if (!value || typeof value !== "object") {
    throw new Error("Upload session was not configured. No media was uploaded.");
  }
  const raw = value as Partial<UploadSession> & { url?: string; offset?: number };
  const candidate: Partial<UploadSession> = {
    ...raw,
    sessionUrl: raw.sessionUrl ?? raw.url,
    nextByte: raw.nextByte ?? raw.offset,
  };
  if (
    typeof candidate.assetId !== "string" ||
    !candidate.assetId ||
    typeof candidate.sessionUrl !== "string" ||
    !candidate.sessionUrl
  ) {
    throw new Error("Upload session was not configured. No media was uploaded.");
  }
  return candidate as UploadSession;
};

export interface PersistedWalkaroundUpload {
  projectId: string;
  assetId: string;
  filename: string;
  size: number;
  lastModified: number;
  nextByte: number;
  expiresAt?: string;
}

const progressKey = (projectId: string, assetId: string) =>
  `dealer-social:walkaround-upload:v1:${projectId}:${assetId}`;

export const loadUploadProgress = (
  projectId: string,
  assetId: string,
): PersistedWalkaroundUpload | null => {
  try {
    const raw = localStorage.getItem(progressKey(projectId, assetId));
    return raw ? (JSON.parse(raw) as PersistedWalkaroundUpload) : null;
  } catch {
    return null;
  }
};

const saveUploadProgress = (progress: PersistedWalkaroundUpload): void => {
  try {
    localStorage.setItem(
      progressKey(progress.projectId, progress.assetId),
      JSON.stringify(progress),
    );
  } catch {
    // Upload remains usable in memory; the UI warns that reload resume may be unavailable.
  }
};

const clearUploadProgress = (projectId: string, assetId: string): void => {
  try {
    localStorage.removeItem(progressKey(projectId, assetId));
  } catch {
    // Successful server finalization is authoritative.
  }
};

const appJson = async <T>(
  path: string,
  init: RequestInit = {},
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<T> => {
  assertAuthEpoch(requestAuthEpoch);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new Error(
      "Walkaround Studio is unavailable. Nothing was uploaded or published.",
      {
        cause: error,
      },
    );
  }
  if (!response.ok) {
    const detail = await readApiError(response, { requestAuthEpoch });
    throw new Error(detail.message || "Walkaround request failed safely.", {
      cause: detail,
    });
  }
  assertAuthEpoch(requestAuthEpoch);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const createWalkaroundProject = (input: {
  audience: WalkaroundAudience;
  captureMode: WalkaroundCaptureMode;
  vin?: string;
  containsIdentifiableNonEmployee?: boolean;
}): Promise<WalkaroundProject> =>
  appJson<unknown>("/api/app/walkarounds", {
    method: "POST",
    body: JSON.stringify({
      audience: input.audience,
      captureMode: input.captureMode,
      scenarioId: input.audience === "customer" ? "customer_walkaround" : "new_arrival",
      vehicleSnapshot: { vinOrStock: input.vin?.trim() || "not_provided" },
      containsIdentifiableNonEmployee: Boolean(input.containsIdentifiableNonEmployee),
    }),
  }).then(parseProject);

export const saveWalkaroundRelease = (
  projectId: string,
  input: { signedName: string; signaturePngDataUrl: string },
): Promise<{ id: string; consentVersion: "walkaround-v1"; signedAt: string }> =>
  appJson(`/api/app/walkarounds/${encodeURIComponent(projectId)}/release`, {
    method: "POST",
    body: JSON.stringify({
      signedName: input.signedName,
      signaturePngDataUrl: input.signaturePngDataUrl,
      consentVersion: "walkaround-v1",
      videoConsent: true,
      voiceConsent: true,
      cloudProcessingConsent: true,
      youtubeConsent: true,
    }),
  });

export const getWalkaroundProject = (projectId: string): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}`).then(
    parseProject,
  );

export const startWalkaroundProcessing = (
  projectId: string,
): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/process`, {
    method: "POST",
    body: JSON.stringify({}),
  }).then(() => getWalkaroundProject(projectId));

export const updateWalkaroundReview = (
  projectId: string,
  revision: number,
  metadata: WalkaroundMetadata,
): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ revision, metadata }),
  }).then(() => getWalkaroundProject(projectId));

export const requestWalkaroundReedit = (
  projectId: string,
  input: { revision: number; instructions: string; captionsText?: string },
): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/re-edit`, {
    method: "POST",
    body: JSON.stringify(input),
  }).then(() => getWalkaroundProject(projectId));

export const approveWalkaround = (
  projectId: string,
  revision: number,
  masterSha256: string,
): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ revision, masterSha256 }),
  }).then(() => getWalkaroundProject(projectId));

export const publishWalkaround = (
  projectId: string,
  input: {
    revision: number;
    masterSha256: string;
    visibility: WalkaroundVisibility;
    availabilityAttested: boolean;
  },
): Promise<WalkaroundProject> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/publish`, {
    method: "POST",
    body: JSON.stringify(input),
  }).then(() => getWalkaroundProject(projectId));

export const deleteWalkaround = (projectId: string): Promise<void> =>
  appJson(`/api/app/walkarounds/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });

export const getYouTubeConnection = (): Promise<{
  connected: boolean;
  channelTitle?: string;
  reason?: string;
}> => appJson("/api/app/walkarounds/youtube/status");

export const startYouTubeConnection = async (): Promise<{
  authorizationUrl: string;
}> => {
  const result = await appJson<unknown>("/api/app/walkarounds/youtube/connect", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const authorizationUrl =
    result &&
    typeof result === "object" &&
    typeof (result as { authorizationUrl?: unknown }).authorizationUrl === "string"
      ? (result as { authorizationUrl: string }).authorizationUrl
      : "";
  if (!authorizationUrl.startsWith("https://accounts.google.com/")) {
    throw new Error("YouTube authorization could not be started safely.");
  }
  return { authorizationUrl };
};

export const completeYouTubeConnection = async (
  stateReference: string,
): Promise<{ connected: true; channelTitle: string }> => {
  const result = await appJson<unknown>("/api/app/walkarounds/youtube/complete", {
    method: "POST",
    body: JSON.stringify({ stateReference }),
  });
  const candidate = result as { connected?: unknown; channelTitle?: unknown } | null;
  if (
    !candidate ||
    candidate.connected !== true ||
    typeof candidate.channelTitle !== "string" ||
    !candidate.channelTitle.trim()
  ) {
    throw new Error("YouTube authorization was not verified.");
  }
  return { connected: true, channelTitle: candidate.channelTitle };
};

export const disconnectYouTubeConnection = async (): Promise<{ connected: false }> => {
  const result = await appJson<unknown>("/api/app/walkarounds/youtube/disconnect", {
    method: "DELETE",
  });
  if (
    !result ||
    typeof result !== "object" ||
    (result as { connected?: unknown }).connected !== false
  ) {
    throw new Error("YouTube disconnect could not be verified.");
  }
  return { connected: false };
};

export const createWalkaroundUploadSession = (
  projectId: string,
  file: File,
  order: number,
  durationSeconds: number,
  resumeAssetId?: string,
): Promise<UploadSession> =>
  appJson<unknown>(`/api/app/walkarounds/${encodeURIComponent(projectId)}/uploads`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mime: walkaroundContentType(file),
      sizeBytes: file.size,
      durationMs: Math.round(durationSeconds * 1000),
      lastModified: file.lastModified,
      order,
      resumeAssetId,
    }),
  }).then(parseUploadSession);

export const findPersistedUploadForFile = (
  projectId: string,
  file: File,
): PersistedWalkaroundUpload | null => {
  try {
    const prefix = `dealer-social:walkaround-upload:v1:${projectId}:`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const saved = JSON.parse(
        localStorage.getItem(key) || "null",
      ) as PersistedWalkaroundUpload | null;
      if (
        saved &&
        saved.filename === file.name &&
        saved.size === file.size &&
        saved.lastModified === file.lastModified
      )
        return saved;
    }
  } catch {
    // A normal authenticated create call still works when storage is unavailable.
  }
  return null;
};

export const uploadWalkaroundFile = async (
  projectId: string,
  file: File,
  order: number,
  durationSeconds: number,
  onProgress?: (fraction: number) => void,
  resumeAssetId?: string,
): Promise<{ assetId: string }> => {
  const requestAuthEpoch = captureAuthEpoch();
  const prior = findPersistedUploadForFile(projectId, file);
  const created = await createWalkaroundUploadSession(
    projectId,
    file,
    order,
    durationSeconds,
    resumeAssetId ?? prior?.assetId,
  );
  const persisted = loadUploadProgress(projectId, created.assetId);
  let nextByte =
    persisted &&
    persisted.filename === file.name &&
    persisted.size === file.size &&
    persisted.lastModified === file.lastModified
      ? (created.nextByte ?? persisted.nextByte)
      : created.nextByte || 0;

  while (nextByte < file.size) {
    assertAuthEpoch(requestAuthEpoch);
    const endExclusive = Math.min(nextByte + WALKAROUND_LIMITS.chunkBytes, file.size);
    let response: Response;
    try {
      response = await fetch(created.sessionUrl, {
        method: "PUT",
        headers: {
          ...(created.headers || {}),
          "Content-Type": walkaroundContentType(file),
          "Content-Range": `bytes ${nextByte}-${endExclusive - 1}/${file.size}`,
        },
        body: file.slice(nextByte, endExclusive),
      });
    } catch (error) {
      throw new Error("Upload paused. Re-select the same file to resume safely.", {
        cause: error,
      });
    }

    if (!(response.ok || response.status === 308)) {
      throw new Error("Upload paused before completion. No processing was started.");
    }
    if (response.status === 308) {
      const range = response.headers.get("Range") || "";
      const match = /^bytes=0-(\d+)$/.exec(range.trim());
      const acknowledgedLastByte = match ? Number(match[1]) : Number.NaN;
      if (
        !Number.isSafeInteger(acknowledgedLastByte) ||
        acknowledgedLastByte < nextByte ||
        acknowledgedLastByte >= file.size
      ) {
        throw new Error(
          "Upload paused because the server did not confirm the saved byte range.",
        );
      }
      nextByte = acknowledgedLastByte + 1;
    } else {
      nextByte = endExclusive;
    }
    saveUploadProgress({
      projectId,
      assetId: created.assetId,
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified,
      nextByte,
      expiresAt: created.expiresAt,
    });
    onProgress?.(nextByte / file.size);
  }

  await appJson(
    `/api/app/walkarounds/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(created.assetId)}/finalize`,
    { method: "POST", body: JSON.stringify({ size: file.size }) },
    requestAuthEpoch,
  );
  clearUploadProgress(projectId, created.assetId);
  return { assetId: created.assetId };
};
