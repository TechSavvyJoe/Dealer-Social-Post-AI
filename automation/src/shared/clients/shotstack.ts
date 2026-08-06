import { credentials } from "@outputai/credentials";
import { httpClient } from "@outputai/http";

import { configuredString, mapProviderError } from "./http.js";

function client() {
  const key = configuredString(
    credentials.require("shotstack.api_key"),
    "shotstack.api_key",
  );
  const baseUrl = configuredString(
    credentials.get("shotstack.base_url", "https://api.shotstack.io/edit/stage"),
    "shotstack.base_url",
  );
  return httpClient({
    prefixUrl: baseUrl.replace(/\/$/, ""),
    timeout: 30_000,
    retry: { limit: 0 },
    headers: { "x-api-key": key },
  });
}

export async function submitShotstackRender(
  timeline: unknown,
  requestKey: string,
): Promise<{ id: string }> {
  try {
    const result = await client()
      .post("render", {
        json: timeline,
        headers: { "idempotency-key": requestKey },
      })
      .json<{ response?: { id?: string } }>();
    return { id: configuredString(result.response?.id, "Shotstack render id") };
  } catch (error: unknown) {
    return mapProviderError("Shotstack", error, true);
  }
}

export async function getShotstackRender(
  id: string,
): Promise<{ status: string; url?: string; error?: string }> {
  try {
    const result = await client()
      .get(`render/${encodeURIComponent(id)}`)
      .json<{
        response?: { status?: string; url?: string; error?: string };
      }>();
    return {
      status: configuredString(result.response?.status, "Shotstack render status"),
      url: result.response?.url,
      error: result.response?.error,
    };
  } catch (error: unknown) {
    return mapProviderError("Shotstack", error);
  }
}
