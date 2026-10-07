import type { PostShareVia } from "../types";
import type { PlatformDestinationId } from "./platformOutputs";
import { recordPostShared } from "./posts";
import { ApiError } from "./apiErrors";
import { logError } from "../utils/telemetry";
import { connectionManager } from "../utils/connectionManager";
import { useAppStore } from "../stores/appStore";

export interface ShareReceipt {
  postId: string;
  channel: PlatformDestinationId;
  via: PostShareVia;
  /** Revision of the exact saved copy that was shared. */
  expectedPostRevision: string;
  captionMode?: "primary";
  disclosures?: string;
}

interface PendingReceipt extends ShareReceipt {
  /** The signed-in workspace that made the share. */
  authEpoch: number;
  retried: boolean;
}

/**
 * One pending receipt per post revision, channel and method: a later Copy caption must
 * not discard a share-sheet receipt still waiting for the connection.
 */
const receiptKey = ({ postId, channel, via, expectedPostRevision }: ShareReceipt) =>
  `${postId}\u0000${channel}\u0000${via}\u0000${expectedPostRevision}`;

/** 4xx statuses that mean "try again later", not "this receipt is refused". */
const TRANSIENT_CLIENT_STATUSES = new Set([408, 425, 429]);

/**
 * The server refused the receipt itself (stale revision, delivery lock, bad
 * input). Sending the same receipt again can only be refused again, so it is
 * logged and dropped. Timeouts, rate limits, 5xx and network failures are
 * transport problems and keep the single reconnect retry.
 */
const isRejectedReceipt = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  !TRANSIENT_CLIENT_STATUSES.has(error.status);

/**
 * The receipt echoes the revision whose delivery locks were checked. Adopt a
 * different one only while the store still holds the token the receipt was
 * sent with: a draft save that finished meanwhile owns a newer token, and
 * rolling it back would make the next autosave look like a conflict.
 */
const adoptReceiptRevision = (
  postId: string,
  sentRevision: string,
  receiptRevision: string | undefined,
  authEpoch: number,
): void => {
  if (!receiptRevision || receiptRevision === sentRevision) return;
  const store = useAppStore.getState();
  if (store.authEpoch !== authEpoch) return;
  const current = store.generatedPost;
  if (current?.postId !== postId || current.postRevision !== sentRevision) return;
  store.setGeneratedPost(
    { ...current, postRevision: receiptRevision },
    { archive: false },
  );
};

/**
 * Receipts waiting for the connection. They live here, not in the Post
 * screen: Done or any other navigation closes that screen, and the share it
 * reported has already happened.
 */
const pendingReceipts = new Map<string, PendingReceipt>();
let unsubscribeReconnect: (() => void) | null = null;

const retryPendingReceipts = (online: boolean): void => {
  if (!online) return;
  const authEpoch = useAppStore.getState().authEpoch;
  for (const [key, pending] of pendingReceipts) {
    if (pending.retried) continue;
    // A receipt belongs to the signed-in workspace that shared. Signing out,
    // or in as someone else, ends it the same way it clears that work.
    if (pending.authEpoch !== authEpoch) {
      pendingReceipts.delete(key);
      continue;
    }
    pending.retried = true;
    void recordPostShared(pending.postId, {
      channel: pending.channel,
      via: pending.via,
      expectedPostRevision: pending.expectedPostRevision,
      captionMode: pending.captionMode,
      disclosures: pending.disclosures,
    })
      .then((recorded) => {
        adoptReceiptRevision(
          pending.postId,
          pending.expectedPostRevision,
          recorded?.post_revision,
          pending.authEpoch,
        );
      })
      .catch((error) => {
        // One retry only. Whatever the reason, the receipt is dropped now.
        logError(
          isRejectedReceipt(error)
            ? "post.share_receipt_rejected"
            : "post.share_receipt_failed",
          {
            postId: pending.postId,
            status: error instanceof ApiError ? error.status : undefined,
            errorCode:
              error instanceof ApiError
                ? error.code || String(error.status)
                : error instanceof Error
                  ? error.name
                  : "unknown",
          },
        );
      })
      .finally(() => {
        if (pendingReceipts.get(key) === pending) pendingReceipts.delete(key);
      });
  }
};

/**
 * Record a completed share, copy or download. A transport failure keeps the
 * receipt for one retry on the next reconnect, whether or not the screen that
 * made it is still open.
 */
export const submitShareReceipt = async (receipt: ShareReceipt): Promise<void> => {
  const authEpoch = useAppStore.getState().authEpoch;
  const key = receiptKey(receipt);
  try {
    const recorded = await recordPostShared(receipt.postId, {
      channel: receipt.channel,
      via: receipt.via,
      expectedPostRevision: receipt.expectedPostRevision,
      captionMode: receipt.captionMode,
      disclosures: receipt.disclosures,
    });
    adoptReceiptRevision(
      receipt.postId,
      receipt.expectedPostRevision,
      recorded?.post_revision,
      authEpoch,
    );
    // Only this receipt is settled; another method's may still be waiting.
    pendingReceipts.delete(key);
  } catch (error) {
    if (useAppStore.getState().authEpoch !== authEpoch) return;
    // The share itself already happened and is shown locally. A rejected
    // receipt (stale revision, delivery lock) can only be rejected again,
    // so only a transport failure is retried when the device reconnects.
    // Re-reading the revision to resend is deliberately not done: that
    // would record a share against content the salesperson did not share.
    if (isRejectedReceipt(error)) {
      logError("post.share_receipt_rejected", {
        postId: receipt.postId,
        status: error.status,
        // "code" is a redacted telemetry key; keep the server code readable.
        errorCode: error.code || String(error.status),
      });
      pendingReceipts.delete(key);
      return;
    }
    pendingReceipts.set(key, { ...receipt, authEpoch, retried: false });
    unsubscribeReconnect ??= connectionManager.subscribe(retryPendingReceipts);
  }
};

/** Forget every waiting receipt. Tests start from an empty queue with it. */
export const clearPendingShareReceipts = (): void => {
  pendingReceipts.clear();
  unsubscribeReconnect?.();
  unsubscribeReconnect = null;
};
