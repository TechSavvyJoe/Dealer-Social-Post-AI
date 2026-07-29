/**
 * Photo-release client. After the 1748000400 rule lockdown, the
 * `photo_releases` PocketBase collection is no longer readable/writable
 * directly. The frontend goes through session-gated `/api/app/photo_releases`
 * endpoints which validate the dealer_session cookie and force the dealer
 * field server-side.
 */
import { dataUrlToBlob } from "../utils/imageUtils";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import { readApiError } from "./apiErrors";

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
