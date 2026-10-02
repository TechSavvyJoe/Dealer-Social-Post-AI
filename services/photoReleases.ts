/**
 * Photo-release client. After the 1748000400 rule lockdown, the
 * `photo_releases` PocketBase collection is no longer readable/writable
 * directly. The frontend goes through session-gated `/api/app/photo_releases`
 * endpoints which validate the dealer_session cookie and force the dealer
 * field server-side.
 */
import { dataUrlToBlob } from "../utils/imageUtils";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import { ApiError, readApiError } from "./apiErrors";
import { RetryError, retryWithBackoff } from "../utils/retry";
import type { GeneratedPost } from "../types";

/** Recoverable post↔release association failure. */
export type ReleaseLinkStatus = NonNullable<GeneratedPost["releaseLinkStatus"]>;

export interface PhotoReleaseInput {
  /** Kept for backwards compat; ignored — the server uses the session dealer. */
  dealerId?: string;
  customerName: string;
  /** PNG data URL produced by SignaturePad.toDataURL() */
  signaturePngDataUrl: string;
  vin?: string;
  notes?: string;
}

/**
 * In-memory captured release. The first generation attempt persists it before
 * any provider call. `releaseId` is then reused if generation is retried, so a
 * single customer signature is never uploaded twice.
 */
export interface CapturedRelease {
  customerName: string;
  signaturePngDataUrl: string;
  vin?: string;
  /** Server id assigned after the protected signature is durably stored. */
  releaseId?: string;
}

export interface PhotoReleaseRecord {
  id: string;
  customer_name: string;
  signed_at: string;
  vin?: string;
}

export interface LinkedPhotoReleaseRecord {
  id: string;
  post_id: string;
  has_release: true;
  /** Revision after the post's consent flags were durably updated. */
  post_revision: string;
}

export const saveRelease = async (
  input: PhotoReleaseInput,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<PhotoReleaseRecord> => {
  assertAuthEpoch(requestAuthEpoch);
  const sigBlob = await dataUrlToBlob(input.signaturePngDataUrl);

  const form = new FormData();
  form.append("customer_name", input.customerName.trim());
  form.append("signature_png", sigBlob, "signature.png");
  if (input.vin) form.append("vin", input.vin);
  if (input.notes) form.append("notes", input.notes);

  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch("/api/app/photo_releases", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    const detail = await readApiError(res, { requestAuthEpoch });
    throw new Error(`Photo release failed: ${detail.message}`, {
      cause: detail,
    });
  }

  const saved = (await res.json()) as PhotoReleaseRecord;
  assertAuthEpoch(requestAuthEpoch);
  return saved;
};

/**
 * Persist consent before entering the paid/provider portion of generation.
 * A rejected persistence request rejects this function before `providerTask`
 * is invoked. The assigned release id is retained on the captured object so a
 * provider failure followed by a retry does not upload the signature again.
 */
export const runWithPersistedPhotoRelease = async <T>(
  captured: CapturedRelease | undefined,
  dealershipName: string,
  providerTask: () => Promise<T>,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<{ result: T; releaseId?: string }> => {
  assertAuthEpoch(requestAuthEpoch);
  let releaseId = captured?.releaseId;

  if (captured && !releaseId) {
    const saved = await saveRelease(
      {
        customerName: captured.customerName,
        signaturePngDataUrl: captured.signaturePngDataUrl,
        vin: captured.vin,
        notes: `Released for social media use by ${dealershipName}.`,
      },
      requestAuthEpoch,
    );
    assertAuthEpoch(requestAuthEpoch);
    releaseId = saved.id;
    captured.releaseId = saved.id;
  }

  assertAuthEpoch(requestAuthEpoch);
  const result = await providerTask();
  assertAuthEpoch(requestAuthEpoch);
  return { result, releaseId };
};

/** Link an already-stored release to its generated post without re-uploading. */
export const linkReleaseToPost = async (
  releaseId: string,
  postId: string,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<LinkedPhotoReleaseRecord> => {
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(
    `/api/app/photo_releases/${encodeURIComponent(releaseId)}/link-post`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId }),
    },
  );

  if (!res.ok) {
    const detail = await readApiError(res, { requestAuthEpoch });
    throw new Error(`Photo release link failed: ${detail.message}`, {
      cause: detail,
    });
  }

  const linked = (await res.json()) as LinkedPhotoReleaseRecord;
  assertAuthEpoch(requestAuthEpoch);
  return linked;
};

/**
 * Attempts for the post↔release link. Deliberately small: the result screen
 * owns the visible "Retry saving release" action and the reconnect retry, so a
 * long silent backoff would only hold a finished post behind a spinner.
 */
const RELEASE_LINK_ATTEMPTS = 3;

/**
 * The link is a small first-party POST, so nearly every failure is transport
 * or server-side and worth another attempt. Identity changes (AbortError) and
 * authorization/validation rejections can never succeed on retry, and
 * retrying them would keep a doomed request alive across a workspace switch.
 */
export const shouldRetryReleaseLink = (error: Error): boolean => {
  if (error.name === "AbortError") return false;
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof ApiError) {
    // Every other 4xx is a permanent client-side rejection; 408 is the one
    // timeout that arrives as one.
    return cause.status === 408 || cause.status >= 500;
  }
  const message = error.message.toLowerCase();
  return !(
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("blocked")
  );
};

export interface ReleaseLinkRetryOptions {
  requestAuthEpoch?: number;
  maxAttempts?: number;
  /** Cancels the in-flight attempt and any pending backoff. */
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Link an already-stored release to its post, retrying transient failures with
 * bounded backoff. The underlying failure is rethrown rather than a RetryError
 * wrapper so callers keep classifying and logging the real error.
 */
export const linkReleaseToPostWithRetry = async (
  releaseId: string,
  postId: string,
  options: ReleaseLinkRetryOptions = {},
): Promise<LinkedPhotoReleaseRecord> => {
  const requestAuthEpoch = options.requestAuthEpoch ?? captureAuthEpoch();
  try {
    return await retryWithBackoff(
      () => linkReleaseToPost(releaseId, postId, requestAuthEpoch),
      {
        maxAttempts: options.maxAttempts ?? RELEASE_LINK_ATTEMPTS,
        initialDelay: 500,
        maxDelay: 3000,
        shouldRetry: shouldRetryReleaseLink,
        signal: options.signal,
        onRetry: options.onRetry,
      },
    );
  } catch (error) {
    if (error instanceof RetryError) throw error.lastError;
    throw error;
  }
};
