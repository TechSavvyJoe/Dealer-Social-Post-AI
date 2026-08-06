import { credentials } from "@outputai/credentials";
import { httpClient } from "@outputai/http";

import { configuredString, mapProviderError } from "./http.js";

function client() {
  const baseUrl = configuredString(
    credentials.require("walkaround.media_worker_base_url"),
    "walkaround.media_worker_base_url",
  );
  const token = configuredString(
    credentials.require("walkaround.media_worker_token"),
    "walkaround.media_worker_token",
  );
  return httpClient({
    prefixUrl: baseUrl.replace(/\/$/, ""),
    timeout: 3_600_000,
    retry: { limit: 0 },
    headers: { authorization: `Bearer ${token}` },
  });
}

async function post<T>(path: string, input: unknown, requestKey: string): Promise<T> {
  try {
    return await client()
      .post(path, {
        json: input,
        headers: { "idempotency-key": requestKey },
      })
      .json<T>();
  } catch (error: unknown) {
    return mapProviderError("Media worker", error);
  }
}

export const mediaWorker = {
  prepare: <T>(input: unknown, requestKey: string) =>
    post<T>("v1/walkarounds/prepare", input, requestKey),
  finalize: <T>(input: unknown, requestKey: string) =>
    post<T>("v1/walkarounds/finalize", input, requestKey),
  qualityCheck: <T>(input: unknown, requestKey: string) =>
    post<T>("v1/walkarounds/quality-check", input, requestKey),
  deleteObjects: <T>(input: unknown, requestKey: string) =>
    post<T>("v1/walkarounds/delete-objects", input, requestKey),
};
