import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVeoVideoOutcome } from "../utils/schemas";

type Adapter = {
  MODEL: string;
  buildOmniVideoRequest: (body: unknown) => any;
  providerInteractionId: (raw: unknown) => string | null;
  isOmniOperationName: (name: unknown) => boolean;
  projectOmniVideoResponse: (raw: unknown, name: string) => any;
};
const module = { exports: {} as Adapter };
new Function(
  "module",
  "exports",
  readFileSync(resolve("pb_hooks/omniVideo.js"), "utf8"),
)(module, module.exports);
const adapter = module.exports;
const name = "operations/omni-" + "a".repeat(32);
// ISO BMFF ftyp box plus a minimal following box; no real customer media.
const mp4 = Buffer.from(
  "000000186674797069736f6d0000020069736f6d6d703432000000086d646174",
  "hex",
).toString("base64");
const completed = (data: unknown = mp4) => ({
  id: "provider-private-id",
  status: "completed",
  steps: [
    { type: "user_input", content: [{ type: "image", data: "private-input" }] },
    { type: "thought", content: [{ type: "video", data: "private-thought" }] },
    {
      type: "model_output",
      content: [{ type: "video", mime_type: "video/mp4", data }],
    },
  ],
});
const request = (resolution = "720p", durationSeconds = 6) => ({
  instances: [
    {
      prompt: "Animate the car.",
      image: { mimeType: "image/jpeg", bytesBase64Encoded: "aGVsbG8=" },
    },
  ],
  parameters: {
    aspectRatio: "16:9",
    durationSeconds,
    resolution,
    personGeneration: "allow_adult",
    negativePrompt: "No speech, no second car.",
  },
});

describe("Omni video compatibility adapter", () => {
  it.each([
    ["720p", 6],
    ["1080p", 8],
    ["720p", 4],
  ])(
    "translates the %s/%ss lane into a single image-to-video interaction",
    (resolution, seconds) => {
      const result = adapter.buildOmniVideoRequest(
        request(String(resolution), Number(seconds)),
      );
      expect(result).toEqual({
        model: "gemini-omni-1.1-flash",
        background: true,
        store: true,
        stream: false,
        input: [
          { type: "image", data: "aGVsbG8=", mime_type: "image/jpeg" },
          {
            type: "text",
            text: "Animate the car.\nAvoid the following: No speech, no second car.",
          },
        ],
        response_format: {
          type: "video",
          aspect_ratio: "16:9",
          duration: `${seconds}s`,
          resolution,
          delivery: "inline",
        },
        generation_config: { video_config: { task: "image_to_video" } },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /personGeneration|negativePrompt|generate_audio/,
      );
    },
  );

  it("does not forward extra provider knobs and handles absent exclusions", () => {
    const body = request();
    delete (body.parameters as Partial<typeof body.parameters>).negativePrompt;
    Object.assign(body, { tools: [{ type: "google_search" }] });
    expect(adapter.buildOmniVideoRequest(body).input[1].text).toBe("Animate the car.");
    expect(adapter.buildOmniVideoRequest(body)).not.toHaveProperty("tools");
    expect(adapter.buildOmniVideoRequest(null)).toBeNull();
    expect(adapter.buildOmniVideoRequest(request("4k", 10))).toBeNull();
  });

  it("bounds opaque private IDs without asserting a provider alphabet", () => {
    expect(adapter.providerInteractionId({ id: "v1_opaque+/:=☃" })).toBe(
      "v1_opaque+/:=☃",
    );
    expect(adapter.providerInteractionId('{"id":"example"}')).toBe("example");
    for (const id of ["", " ", "x\nsecret", "x\u0085", "a".repeat(2049), 42])
      expect(adapter.providerInteractionId({ id })).toBeNull();
    expect(adapter.providerInteractionId("not-json")).toBeNull();
  });

  it("recognizes only locally issued operation handles", () => {
    expect(adapter.isOmniOperationName(name)).toBe(true);
    for (const value of [
      "operations/omni-provider-id",
      name + "/",
      name + "?x",
      "v1_opaque",
      undefined,
    ])
      expect(adapter.isOmniOperationName(value)).toBe(false);
    expect(adapter.projectOmniVideoResponse(completed(), "invalid")).toBeNull();
  });

  it.each(["queued", "in_progress"])(
    "projects %s without leaking provider fields",
    (status) => {
      expect(
        adapter.projectOmniVideoResponse(
          { ...completed(), status, errors: [{ message: "private" }] },
          name,
        ),
      ).toEqual({ name, done: false });
    },
  );

  it("returns an inline outcome understood by the existing frontend", () => {
    const result = adapter.projectOmniVideoResponse(JSON.stringify(completed()), name);
    expect(result.done).toBe(true);
    expect(resolveVeoVideoOutcome(result.response)).toEqual({
      kind: "inline",
      data: mp4,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /provider-private|private-input|private-thought|steps/,
    );
  });

  it.each([
    "failed",
    "cancelled",
    "incomplete",
    "requires_action",
    "budget_exceeded",
    "unknown",
    undefined,
  ])("turns %s into a safe terminal failure", (status) => {
    const result = adapter.projectOmniVideoResponse(
      { status, errors: [{ message: "private prompt credential" }] },
      name,
    );
    expect(result).toMatchObject({
      name,
      done: true,
      error: { code: 13, status: "INTERNAL" },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|credential/);
  });

  it("rejects missing, URI-only, wrong MIME, non-MP4, duplicate and malformed output", () => {
    const uri = completed();
    (uri.steps[2].content as any) = [
      { type: "video", mime_type: "video/mp4", uri: "https://private.example/video" },
    ];
    const wrongMime = completed();
    (wrongMime.steps[2].content[0] as any).mime_type = "video/webm";
    const duplicate = completed();
    duplicate.steps.push(duplicate.steps[2]);
    const thoughtOnly = completed();
    thoughtOnly.steps = [thoughtOnly.steps[1]];
    const invalidSize = Buffer.from(
      "ffffffff6674797069736f6d0000020069736f6d6d703432",
      "hex",
    ).toString("base64");
    for (const raw of [
      null,
      "broken-json",
      {},
      { status: "completed", steps: [] },
      uri,
      wrongMime,
      duplicate,
      thoughtOnly,
      completed(""),
      completed("data:video/mp4;base64," + mp4),
      completed(Buffer.from("not a video".repeat(5)).toString("base64")),
      completed(invalidSize),
      completed(mp4 + "\n"),
    ]) {
      expect(adapter.projectOmniVideoResponse(raw, name)).toMatchObject({
        done: true,
        error: { code: 13 },
      });
    }
  });

  it("rejects oversized JSON, oversized media and cyclic records safely", () => {
    expect(
      adapter.projectOmniVideoResponse(" ".repeat(30 * 1024 * 1024 + 1), name),
    ).toHaveProperty("error");
    expect(
      adapter.projectOmniVideoResponse(completed("A".repeat(28 * 1024 * 1024)), name),
    ).toHaveProperty("error");
    const cyclic: any = { status: "completed" };
    cyclic.self = cyclic;
    expect(adapter.projectOmniVideoResponse(cyclic, name)).toHaveProperty("error");
  });
});
