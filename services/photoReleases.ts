/**
 * Photo-release client. After the 1748000400 rule lockdown, the
 * `photo_releases` PocketBase collection is no longer readable/writable
 * directly. The frontend goes through session-gated `/api/app/photo_releases`
 * endpoints which validate the dealer_session cookie and force the dealer
 * field server-side.
 */
import { dataUrlToBlob } from "../utils/imageUtils";

export interface PhotoReleaseInput {
  /** Kept for backwards compat; ignored — the server uses the session dealer. */
  dealerId?: string;
  customerName: string;
  /** PNG data URL produced by SignaturePad.toDataURL() */
  signaturePngDataUrl: string;
  vin?: string;
  notes?: string;
  /** The post this release is linked to. Set after generation succeeds so we don't create orphan release records. */
  postId?: string;
}

/**
 * In-memory captured release. Held in component state until the user
 * actually generates a post — at which point we save it linked to the
 * resulting post_id. If they never generate, no PocketBase record is created.
 */
export interface CapturedRelease {
  customerName: string;
  signaturePngDataUrl: string;
  vin?: string;
}

export interface PhotoReleaseRecord {
  id: string;
  customer_name: string;
  signed_at: string;
  vin?: string;
}

export const saveRelease = async (
  input: PhotoReleaseInput
): Promise<PhotoReleaseRecord> => {
  const sigBlob = await dataUrlToBlob(input.signaturePngDataUrl);

  const form = new FormData();
  form.append("customer_name", input.customerName.trim());
  form.append("signature_png", sigBlob, "signature.png");
  form.append("signed_at", new Date().toISOString());
  if (input.vin) form.append("vin", input.vin);
  if (input.notes) form.append("notes", input.notes);
  if (input.postId) form.append("post_id", input.postId);
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    form.append("user_agent", navigator.userAgent.slice(0, 500));
  }

  const res = await fetch("/api/app/photo_releases", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error || detail;
    } catch {
      /* not json */
    }
    throw new Error(`Photo release failed: ${detail}`);
  }

  return await res.json();
};
