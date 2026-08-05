import { createHmac } from "node:crypto";

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

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const config = backendConfig();
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", config.signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const client = httpClient({
    prefixUrl: config.baseUrl,
    timeout: 30_000,
    retry: { limit: 0 },
    headers: {
      authorization: `Bearer ${config.bearerToken}`,
      "x-walkaround-timestamp": timestamp,
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
