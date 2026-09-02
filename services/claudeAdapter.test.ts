import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildClaudeMessageBody,
  claudeAcceptsImage,
  claudeSystemPromptForTask,
  generateTextViaClaude,
  shouldFallbackToClaude,
} from "./claudeAdapter";
import { CLAUDE_MODELS, FLAGS, TASKS } from "./modelConfig";
import { createBlockedContentError } from "../utils/errorHandler";

type AnthropicPolicies = {
  buildAnthropicMessageRequest: (
    input: Record<string, unknown>,
  ) => Record<string, unknown> | null;
};

// Same loader the backend policy tests use: the PocketBase hook is plain
// CommonJS, so the real validator runs against the exact adapter body.
const loadPocketBaseRequestPolicies = (): AnthropicPolicies => {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
    "utf8",
  );
  const commonJsModule = { exports: {} as AnthropicPolicies };
  new Function("module", "exports", source)(commonJsModule, commonJsModule.exports);
  return commonJsModule.exports;
};

const policies = loadPocketBaseRequestPolicies();
const asPolicyInput = (body: unknown) => body as Record<string, unknown>;

const captionPrompt =
  "Write a polished dealership caption for this customer delivery.\n\nStore: Test Dealer\nVoice: warm and professional";
const editPrompt =
  "<original_caption>Keys in hand at Test Dealer. #TestDealer</original_caption>\n<user_edit_request>Make it warmer.</user_edit_request>";
const photo = { mimeType: "image/jpeg", data: "ZmFrZS1kZWxpdmVyeS1waG90bw==" };

describe("Claude adapter request contract", () => {
  it("builds a caption request the proxy policy accepts, with system rules and the photo", () => {
    const body = buildClaudeMessageBody(captionPrompt, {
      task: "caption",
      model: TASKS.caption.claudeFallback,
      temperature: TASKS.caption.claudeTemperature,
      maxTokens: TASKS.caption.params.maxOutputTokens,
      image: photo,
    });

    expect(body.model).toBe(TASKS.caption.claudeFallback);
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(TASKS.caption.claudeTemperature);
    expect(body.system).toBe(claudeSystemPromptForTask("caption"));
    expect(body.system.length).toBeLessThanOrEqual(5000);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: photo.data },
          },
          { type: "text", text: captionPrompt },
        ],
      },
    ]);

    const accepted = policies.buildAnthropicMessageRequest(asPolicyInput(body));
    expect(accepted).not.toBeNull();
    expect(accepted).toMatchObject({
      model: body.model,
      max_tokens: 2048,
      temperature: body.temperature,
      system: body.system,
    });
  });

  it("builds a text-only edit request the proxy policy accepts", () => {
    const body = buildClaudeMessageBody(editPrompt, {
      task: "caption_edit",
      model: TASKS.caption_edit.claudeFallback,
      temperature: TASKS.caption_edit.claudeTemperature,
      maxTokens: TASKS.caption_edit.params.maxOutputTokens,
    });

    expect(body.system).toBe(claudeSystemPromptForTask("caption_edit"));
    expect(body.system).not.toBe(claudeSystemPromptForTask("caption"));
    expect(body.messages[0].content).toEqual([{ type: "text", text: editPrompt }]);
    expect(policies.buildAnthropicMessageRequest(asPolicyInput(body))).toMatchObject({
      model: body.model,
      max_tokens: body.max_tokens,
      messages: [{ role: "user", content: [{ type: "text", text: editPrompt }] }],
    });
  });

  it("uses the modelConfig ids by default and stays inside the proxy's accepted models", () => {
    const body = buildClaudeMessageBody("Caption this");

    expect(body.model).toBe(CLAUDE_MODELS.text_fast);
    expect(body.max_tokens).toBe(TASKS.caption.params.maxOutputTokens);
    expect(policies.buildAnthropicMessageRequest(asPolicyInput(body))).not.toBeNull();
  });

  it("drops image types Claude cannot ingest so the caller can frame the missing photo", () => {
    const heic = { mimeType: "image/heic", data: "abc" };

    expect(claudeAcceptsImage(photo)).toBe(true);
    expect(claudeAcceptsImage(heic)).toBe(false);
    expect(claudeAcceptsImage({ mimeType: "image/jpeg", data: "" })).toBe(false);
    expect(claudeAcceptsImage(undefined)).toBe(false);
    expect(
      buildClaudeMessageBody(captionPrompt, { image: heic }).messages[0].content,
    ).toEqual([{ type: "text", text: captionPrompt }]);
  });
});

describe("generateTextViaClaude", () => {
  const originalFlag = FLAGS.enableClaudeFallback;

  afterEach(() => {
    FLAGS.enableClaudeFallback = originalFlag;
    vi.unstubAllGlobals();
  });

  it("refuses to run while the fallback flag is off", async () => {
    FLAGS.enableClaudeFallback = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateTextViaClaude(captionPrompt)).rejects.toThrow(
      "Claude fallback is disabled",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the policy-accepted body to the authenticated proxy and returns the text", async () => {
    FLAGS.enableClaudeFallback = true;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: "text", text: "  Keys in hand at Test Dealer. #TestDealer  " },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await generateTextViaClaude(editPrompt, {
      task: "caption_edit",
      attemptId: "attempt-1",
      requestAuthEpoch: 0,
    });

    expect(text).toBe("Keys in hand at Test Dealer. #TestDealer");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { credentials: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("/api/proxy/anthropic/v1/messages");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({
      "X-Generation-Task": "caption_edit",
      "X-Generation-Attempt-ID": "attempt-1",
    });
    const sent = JSON.parse(init.body);
    expect(sent).toEqual(buildClaudeMessageBody(editPrompt, { task: "caption_edit" }));
    expect(policies.buildAnthropicMessageRequest(sent)).not.toBeNull();
  });
});

describe("shouldFallbackToClaude", () => {
  const originalFlag = FLAGS.enableClaudeFallback;

  afterEach(() => {
    FLAGS.enableClaudeFallback = originalFlag;
  });

  it("declines typed content blocks even when the flag is on", () => {
    FLAGS.enableClaudeFallback = true;

    expect(
      shouldFallbackToClaude(createBlockedContentError("finishReason=SAFETY")),
    ).toBe(false);
    const ladderFailure = new Error(
      "This photo or wording can't be used for an AI post.",
    );
    Object.defineProperty(ladderFailure, "cause", {
      value: createBlockedContentError("finishReason=SAFETY"),
      enumerable: false,
    });
    expect(shouldFallbackToClaude(ladderFailure)).toBe(false);
    expect(
      shouldFallbackToClaude(
        new Error("The AI service could not complete this request (error 503)."),
      ),
    ).toBe(true);
  });
});
