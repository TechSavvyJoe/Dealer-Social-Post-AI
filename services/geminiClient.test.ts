import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGeminiClient } from "./geminiClient";
import { fetchFromProxy } from "./geminiProxy";

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
});
