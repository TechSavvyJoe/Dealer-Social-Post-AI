import { describe, it, expect } from "vitest";
import { GeminiVideoOperationSchema, resolveVeoVideoOutcome } from "./schemas";

/**
 * The Veo operation shape is a production contract, not a convenience type:
 * before these schemas existed, `response` was `z.any()` and four call sites
 * probed seven key spellings between them, so a provider rename degraded into
 * the generic "no video found" toast with nothing in the logs to act on.
 */
describe("Veo operation schema", () => {
  const documentedOperation = {
    name: "models/veo-3.1-fast-generate-preview/operations/abc123",
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [
          {
            video: {
              uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
            },
          },
        ],
      },
    },
  };

  it("accepts the documented Gemini Developer API shape", () => {
    const parsed = GeminiVideoOperationSchema.parse(documentedOperation);
    expect(parsed.done).toBe(true);
    expect(resolveVeoVideoOutcome(parsed.response)).toEqual({
      kind: "uri",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
    });
  });

  it("keeps the one documented alternate: the response body hoisted to the top level", () => {
    expect(
      resolveVeoVideoOutcome({
        generatedSamples: [{ video: { uri: "https://example.test/hoisted" } }],
      }),
    ).toEqual({ kind: "uri", uri: "https://example.test/hoisted" });
  });

  it("reads inline base64 bytes under the documented encodedVideo key", () => {
    expect(
      resolveVeoVideoOutcome({
        generateVideoResponse: {
          generatedSamples: [
            { video: { encodedVideo: "AAAAGGZ0eXA=", encoding: "video/mp4" } },
          ],
        },
      }),
    ).toEqual({ kind: "inline", data: "AAAAGGZ0eXA=" });
  });

  it("tolerates unknown extra provider keys rather than failing the whole lane", () => {
    // Google adding a field must not take video generation down; what is strict
    // is the structure this app reads, not the absence of new keys.
    const parsed = GeminiVideoOperationSchema.parse({
      ...documentedOperation,
      response: {
        ...documentedOperation.response,
        someFutureField: { nested: true },
      },
    });
    expect(resolveVeoVideoOutcome(parsed.response)).toEqual({
      kind: "uri",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
    });
  });

  it("classifies a content-filtered operation as blocked, not as an empty result", () => {
    expect(
      resolveVeoVideoOutcome({
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: ["Blocked by responsible AI filters."],
        },
      }),
    ).toEqual({
      kind: "blocked",
      reasons: ["Blocked by responsible AI filters."],
    });

    // A count with no reason list still has to read as a refusal.
    expect(
      resolveVeoVideoOutcome({
        generateVideoResponse: { raiMediaFilteredCount: 1 },
      }),
    ).toEqual({ kind: "blocked", reasons: ["RAI media filter"] });
  });

  it("rejects a mangled shape and names the keys that arrived", () => {
    const outcome = resolveVeoVideoOutcome({
      generateVideoResponse: {
        // A provider rename of `video` — previously silent, now loud.
        generatedSamples: [{ clip: { downloadUri: "https://example.test/x" } }],
      },
    });
    expect(outcome.kind).toBe("unrecognized");
    expect(outcome.kind === "unrecognized" && outcome.received).toContain(
      "generateVideoResponse",
    );
    // Diagnostics carry key names only — never URIs, prompts, or media bytes.
    expect(outcome.kind === "unrecognized" && outcome.received).not.toContain(
      "example.test",
    );
  });

  it("rejects a wrongly typed documented field instead of coercing it", () => {
    const outcome = resolveVeoVideoOutcome({
      generateVideoResponse: { generatedSamples: "one video" },
    });
    expect(outcome.kind).toBe("unrecognized");
  });

  it("treats a done operation with no response at all as unrecognized", () => {
    expect(resolveVeoVideoOutcome(undefined).kind).toBe("unrecognized");
    expect(resolveVeoVideoOutcome({}).kind).toBe("unrecognized");
  });

  it("no longer accepts the speculative probe spellings the old code guessed at", () => {
    for (const speculative of [
      { generatedVideos: [{ video: { uri: "https://example.test/a" } }] },
      { videos: [{ uri: "https://example.test/b" }] },
      { predictions: [{ bytesBase64Encoded: "AAAA" }] },
      { candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] },
      {
        generateVideoResponse: {
          generatedSamples: [{ video: { downloadUri: "https://example.test/c" } }],
        },
      },
    ]) {
      expect(resolveVeoVideoOutcome(speculative).kind).toBe("unrecognized");
    }
  });
});
