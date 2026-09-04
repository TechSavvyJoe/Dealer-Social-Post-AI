import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./modelConfig", () => ({
  FLAGS: { enableOpenAIFallback: true },
  OPENAI_MODELS: { image: "gpt-image-2" },
}));

import { generateImageViaOpenAI, shouldFallbackToOpenAI } from "./openaiAdapter";
import {
  createBlockedContentError,
  type ErrorKind,
  type NormalizedError,
} from "../utils/errorHandler";

describe("OpenAI image fallback adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the current GPT Image 2 request contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: "generated-image" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateImageViaOpenAI({
        prompt: "Premium dealership delivery creative",
        size: "1536x1024",
        quality: "high",
      }),
    ).resolves.toBe("data:image/png;base64,generated-image");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: "gpt-image-2",
      prompt: "Premium dealership delivery creative",
      size: "1536x1024",
      quality: "high",
      n: 1,
      output_format: "png",
    });
    expect(String(request.body)).not.toContain("response_format");
    expect(request.credentials).toBe("include");
  });
});

describe("shouldFallbackToOpenAI", () => {
  /** The exact shape services/geminiProxy.ts throws for a proxy failure. */
  const proxyError = (message: string, kind: ErrorKind, retryable = false) => {
    const error = new Error(message) as NormalizedError;
    error.kind = kind;
    error.retryable = retryable;
    return error;
  };

  it("classifies on the error kind, not the curated message text", () => {
    // The image ladder's whole purpose is surviving a Gemini rate ceiling,
    // and the proxy's copy for that ceiling contains none of the substrings
    // the old heuristic looked for.
    const quota = proxyError("Too many requests — try again in a minute.", "quota");
    expect(quota.message).not.toMatch(/quota|429|rate.?limit/i);
    expect(shouldFallbackToOpenAI(quota)).toBe(true);
    expect(
      shouldFallbackToOpenAI(
        proxyError("The AI service is temporarily unavailable.", "model_unavailable"),
      ),
    ).toBe(true);

    const ladderFailure = new Error("All models failed for task image_standard");
    Object.defineProperty(ladderFailure, "cause", {
      value: quota,
      enumerable: false,
    });
    expect(shouldFallbackToOpenAI(ladderFailure)).toBe(true);
  });

  it("never fabricates a photo for a content block, a bad session, or a cancel", () => {
    // Text-to-image would invent a scene without the customer's actual car.
    expect(
      shouldFallbackToOpenAI(createBlockedContentError("finishReason=IMAGE_SAFETY")),
    ).toBe(false);
    expect(
      shouldFallbackToOpenAI(
        proxyError("Session expired — please sign in again.", "unauthorized"),
      ),
    ).toBe(false);
    expect(
      shouldFallbackToOpenAI(
        proxyError("This version of the app is out of date.", "outdated"),
      ),
    ).toBe(false);
    expect(shouldFallbackToOpenAI(new DOMException("Task aborted", "AbortError"))).toBe(
      false,
    );
  });
});
