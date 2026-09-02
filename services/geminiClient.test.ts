import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGeminiClient } from "./geminiClient";
import { fetchFromProxy } from "./geminiProxy";
import { normalizeError } from "../utils/errorHandler";

vi.mock("./geminiProxy", () => ({
  fetchFromProxy: vi.fn(),
}));

describe("proxied Gemini client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps provider credentials server-side and sends the REST request shape", async () => {
    vi.mocked(fetchFromProxy).mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { text: "First " },
              { inlineData: { mimeType: "image/png", data: "abc" } },
              { text: "second" },
            ],
          },
        },
      ],
    });

    const response = await getGeminiClient().models.generateContent({
      model: "gemini-3.6-flash",
      task: "caption",
      contents: { parts: [{ text: "Write a caption" }] },
      generationConfig: { maxOutputTokens: 2048 },
    });

    expect(fetchFromProxy).toHaveBeenCalledWith(
      "POST",
      "v1beta/models/gemini-3.6-flash:generateContent",
      {
        contents: [{ parts: [{ text: "Write a caption" }] }],
        generationConfig: { maxOutputTokens: 2048 },
      },
      "caption",
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(response.text()).toBe("First second");
  });

  it("preserves an already-normalized multi-turn contents array", async () => {
    vi.mocked(fetchFromProxy).mockResolvedValue({ candidates: [] });
    const contents = [
      { role: "user", parts: [{ text: "First" }] },
      { role: "model", parts: [{ text: "Second" }] },
    ];

    await getGeminiClient().models.generateContent({
      model: "gemini-3.6-flash",
      task: "caption_regenerate",
      contents,
    });

    expect(fetchFromProxy).toHaveBeenCalledWith(
      "POST",
      "v1beta/models/gemini-3.6-flash:generateContent",
      { contents },
      "caption_regenerate",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("forwards cancellation to the authenticated proxy request", async () => {
    vi.mocked(fetchFromProxy).mockResolvedValue({ candidates: [] });
    const controller = new AbortController();

    await getGeminiClient().models.generateContent({
      model: "gemini-3.6-flash",
      task: "caption",
      contents: { parts: [{ text: "Write a caption" }] },
      signal: controller.signal,
    });

    expect(fetchFromProxy).toHaveBeenCalledWith(
      "POST",
      "v1beta/models/gemini-3.6-flash:generateContent",
      { contents: [{ parts: [{ text: "Write a caption" }] }] },
      "caption",
      undefined,
      undefined,
      controller.signal,
      undefined,
    );
  });

  it("forwards the usage-ledger purpose to the proxy without touching the body", async () => {
    vi.mocked(fetchFromProxy).mockResolvedValue({ candidates: [] });

    await getGeminiClient().models.generateContent({
      model: "gemini-3.6-flash",
      task: "caption_regenerate",
      purpose: "vision_review",
      contents: { parts: [{ text: "Review the image" }] },
    });

    expect(fetchFromProxy).toHaveBeenCalledWith(
      "POST",
      "v1beta/models/gemini-3.6-flash:generateContent",
      { contents: [{ parts: [{ text: "Review the image" }] }] },
      "caption_regenerate",
      undefined,
      undefined,
      undefined,
      "vision_review",
    );
  });

  it("rejects an invalid model path before contacting the proxy", async () => {
    await expect(
      getGeminiClient().models.generateContent({
        model: "../unexpected/path",
        task: "caption",
        contents: { parts: [{ text: "test" }] },
      }),
    ).rejects.toThrow("model identifier is invalid");

    expect(fetchFromProxy).not.toHaveBeenCalled();
  });

  it("rejects missing contents before contacting the proxy", async () => {
    await expect(
      getGeminiClient().models.generateContent({
        model: "gemini-3.6-flash",
        task: "caption",
        contents: null,
      }),
    ).rejects.toThrow("contents are required");

    expect(fetchFromProxy).not.toHaveBeenCalled();
  });

  describe("blocked and truncated responses", () => {
    const generate = (task: "caption" | "image_standard" = "caption") =>
      getGeminiClient().models.generateContent({
        model: "gemini-3.6-flash",
        task,
        contents: { parts: [{ text: "Write a caption" }] },
      });

    it.each(["SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY"])(
      "throws a terminal blocked error for finishReason %s",
      async (finishReason) => {
        vi.mocked(fetchFromProxy).mockResolvedValue({
          candidates: [{ finishReason, content: { parts: [] } }],
        });

        const error: unknown = await generate().catch((err) => err);

        const normalized = normalizeError(error);
        expect(normalized.kind).toBe("blocked");
        expect(normalized.retryable).toBe(false);
        expect(normalized.message).toBe(
          "This photo or wording can't be used for an AI post.",
        );
        expect(String((normalized.original as Error).message)).toContain(finishReason);
      },
    );

    it("throws a blocked error when the prompt itself was refused", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValue({
        promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
      });

      const error: unknown = await generate().catch((err) => err);

      expect(normalizeError(error).kind).toBe("blocked");
    });

    it("treats an empty RECITATION stop as blocked but keeps partial recitation text", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValueOnce({
        candidates: [{ finishReason: "RECITATION", content: { parts: [] } }],
      });
      const blocked: unknown = await generate().catch((err) => err);
      expect(normalizeError(blocked).kind).toBe("blocked");

      vi.mocked(fetchFromProxy).mockResolvedValueOnce({
        candidates: [
          {
            finishReason: "RECITATION",
            content: { parts: [{ text: "Partial caption" }] },
          },
        ],
      });
      const response = await generate();
      expect(response.text()).toBe("Partial caption");
    });

    it("throws a retryable error when MAX_TOKENS left only reasoning parts", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValue({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: {
              parts: [{ thought: true, text: "Let me think about the dealership..." }],
            },
          },
        ],
      });

      const error: unknown = await generate().catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("MAX_TOKENS");
      const normalized = normalizeError(error);
      expect(normalized.kind).not.toBe("blocked");
      expect(normalized.retryable).toBe(true);
    });

    it("returns visible text when MAX_TOKENS still produced a caption", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValue({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: {
              parts: [
                { thought: true, text: "internal reasoning" },
                { text: "Keys in hand at Test Dealer. #TestDealer" },
              ],
            },
          },
        ],
      });

      const response = await generate();

      expect(response.text()).toBe("Keys in hand at Test Dealer. #TestDealer");
    });

    it("never surfaces reasoning-only text as the caption", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValue({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ thought: true, text: "internal reasoning" }] },
          },
        ],
      });

      const response = await generate();

      expect(response.text()).toBe("");
    });

    it("keeps an image response with only inline data usable under MAX_TOKENS", async () => {
      vi.mocked(fetchFromProxy).mockResolvedValue({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }],
            },
          },
        ],
      });

      await expect(generate("image_standard")).resolves.toMatchObject({
        candidates: [{ finishReason: "MAX_TOKENS" }],
      });
    });
  });
});
