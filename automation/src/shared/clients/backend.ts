import { createHash, createHmac, randomBytes } from "node:crypto";

import { credentials } from "@outputai/credentials";
import { FatalError } from "@outputai/core";
import { httpClient } from "@outputai/http";

import { configuredString, mapProviderError } from "./http.js";

type Method = "get" | "post";

function backendConfig() {
  return {
    baseUrl: configuredString(
      credentials.require("walkaround.backend_base_url"),
      "walkaround.backend_base_url",
    ).replace(/\/$/, ""),
    bearerToken: configuredString(
      credentials.require("walkaround.worker_bearer_token"),
      "walkaround.worker_bearer_token",
    ),
    signingSecret: configuredString(
      credentials.require("walkaround.worker_signing_secret"),
      "walkaround.worker_signing_secret",
    ),
  };
}

/**
 * v2 signing contract, mirrored by `internalAuth` in pb_hooks/walkarounds.js:
 *
 *   message   = "v2." + timestamp + "." + nonce + "." + METHOD + "." + path
 *               + "." + idempotencyKey + "." + sha256hex(rawBody)
 *   signature = hmacSha256Hex(message, signingSecret)
 *
 * Binding the method, exact request path, and idempotency key into the
 * signature means a captured request cannot be replayed against another
 * project/asset path or re-leased with a fresh idempotency key; the
 * single-use nonce closes exact replay inside the freshness window.
 */
export function signWalkaroundRequest(options: {
  method: string;
  path: string;
  rawBody: string;
  idempotencyKey?: string;
  signingSecret: string;
  timestamp?: string;
  nonce?: string;
}): { timestamp: string; nonce: string; signature: string } {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  const bodyHash = createHash("sha256").update(options.rawBody).digest("hex");
  const canonicalPath = options.path.startsWith("/")
    ? options.path
    : `/${options.path}`;
  const message = [
    "v2",
    timestamp,
    nonce,
    options.method.toUpperCase(),
    canonicalPath,
    options.idempotencyKey ?? "",
    bodyHash,
  ].join(".");
  const signature = createHmac("sha256", options.signingSecret)
    .update(message)
    .digest("hex");
  return { timestamp, nonce, signature };
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const config = backendConfig();
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const { timestamp, nonce, signature } = signWalkaroundRequest({
    method,
    path,
    rawBody,
    idempotencyKey,
    signingSecret: config.signingSecret,
  });
  const client = httpClient({
    prefixUrl: config.baseUrl,
    timeout: 30_000,
    retry: { limit: 0 },
    headers: {
      authorization: `Bearer ${config.bearerToken}`,
      "x-walkaround-timestamp": timestamp,
      "x-walkaround-nonce": nonce,
      "x-walkaround-signature-version": "2",
      "x-walkaround-signature": signature,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
  });

  try {
    const response =
      method === "get"
        ? await client.get(path)
        : await client.post(path, {
            body: rawBody,
            headers: { "content-type": "application/json" },
          });
    if (response.status === 204) return undefined as T;
    return await response.json<T>();
  } catch (error: unknown) {
    return mapProviderError("Walkaround backend", error);
  }
}

export const backend = {
  productionContext: <T>(projectId: string) =>
    request<T>(
      "get",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/production-context`,
    ),
  productionEvent: <T>(projectId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/production-events`,
      body,
      eventId,
    ),
  publicationContext: <T>(projectId: string) =>
    request<T>(
      "get",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/publication-context`,
    ),
  publicationEvent: <T>(projectId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/publication-events`,
      body,
      eventId,
    ),
  signedRead: <T>(
    projectId: string,
    assetId: string,
    purpose: string,
    eventId: string,
  ) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/signed-read`,
      { purpose, expiresInSeconds: 900 },
      eventId,
    ),
  createYoutubeUpload: <T>(projectId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/youtube/upload-session`,
      body,
      eventId,
    ),
  uploadYoutubeNext: <T>(projectId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/youtube/upload-next`,
      body,
      eventId,
    ),
  youtubeStatus: <T>(projectId: string, videoId: string) =>
    request<T>(
      "get",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/youtube/videos/${encodeURIComponent(videoId)}`,
    ),
  youtubeVisibility: <T>(
    projectId: string,
    videoId: string,
    body: unknown,
    eventId: string,
  ) =>
    request<T>(
      "post",
      `api/internal/walkarounds/${encodeURIComponent(projectId)}/youtube/videos/${encodeURIComponent(videoId)}/visibility`,
      body,
      eventId,
    ),
  claimTask: <T>(body: unknown, eventId: string) =>
    request<T>("post", "api/internal/walkaround-tasks/claim", body, eventId),
  ackTask: <T>(taskId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkaround-tasks/${encodeURIComponent(taskId)}/ack`,
      body,
      eventId,
    ),
  renewTask: <T>(taskId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkaround-tasks/${encodeURIComponent(taskId)}/renew`,
      body,
      eventId,
    ),
  nackTask: <T>(taskId: string, body: unknown, eventId: string) =>
    request<T>(
      "post",
      `api/internal/walkaround-tasks/${encodeURIComponent(taskId)}/nack`,
      body,
      eventId,
    ),
};

export function assertRevision(actual: number, expected: number): void {
  if (actual !== expected)
    throw new FatalError(
      `Stale walkaround revision: expected ${expected}, received ${actual}`,
    );
}
