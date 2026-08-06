import { credentials } from "@outputai/credentials";
import { httpClient } from "@outputai/http";

import { configuredString, mapProviderError } from "./http.js";

function client() {
  const key = configuredString(
    credentials.require("auphonic.api_key"),
    "auphonic.api_key",
  );
  const baseUrl = configuredString(
    credentials.get("auphonic.base_url", "https://auphonic.com/api"),
    "auphonic.base_url",
  );
  return httpClient({
    prefixUrl: baseUrl.replace(/\/$/, ""),
    timeout: 30_000,
    retry: { limit: 0 },
    headers: { authorization: `Bearer ${key}` },
  });
}

export async function submitAuphonicProduction(
  input: unknown,
  requestKey: string,
): Promise<{ uuid: string }> {
  try {
    const result = await client()
      .post("productions.json", {
        json: input,
        headers: { "idempotency-key": requestKey },
      })
      .json<{ data?: { uuid?: string } }>();
    return { uuid: configuredString(result.data?.uuid, "Auphonic production uuid") };
  } catch (error: unknown) {
    return mapProviderError("Auphonic", error, true);
  }
}

export async function startAuphonicProduction(uuid: string): Promise<void> {
  try {
    await client().post(`production/${encodeURIComponent(uuid)}/start.json`);
  } catch (error: unknown) {
    return mapProviderError("Auphonic", error);
  }
}

export async function getAuphonicProduction(
  uuid: string,
): Promise<{ status: number; outputUrl?: string; error?: string }> {
  try {
    const result = await client()
      .get(`production/${encodeURIComponent(uuid)}.json`)
      .json<{
        data?: {
          status?: number;
          output_files?: Array<{ download_url?: string }>;
          error_message?: string;
        };
      }>();
    return {
      status: Number(result.data?.status ?? 0),
      outputUrl: result.data?.output_files?.[0]?.download_url,
      error: result.data?.error_message,
    };
  } catch (error: unknown) {
    return mapProviderError("Auphonic", error);
  }
}
