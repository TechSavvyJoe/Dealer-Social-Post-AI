import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./modelConfig", () => ({
  FLAGS: { enableOpenAIFallback: true },
  OPENAI_MODELS: { image: "gpt-image-2" },
}));

import { generateImageViaOpenAI } from "./openaiAdapter";

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
