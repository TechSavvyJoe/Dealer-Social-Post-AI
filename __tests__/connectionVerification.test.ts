import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
function load(file: string, globals: Record<string, any> = {}) {
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  new Function("module", "exports", ...Object.keys(globals), source(file))(
    module,
    module.exports,
    ...Object.values(globals),
  );
  return module.exports;
}
const responses: Record<string, any> = {
  gemini: {
    candidates: [
      { finishReason: "STOP", content: { parts: [{ text: "DS_CONNECTION_OK" }] } },
    ],
  },
  anthropic: {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "DS_CONNECTION_OK" }],
  },
  openai: {
    choices: [{ finish_reason: "stop", message: { content: "DS_CONNECTION_OK" } }],
  },
};
function harness(
  options: {
    replay?: boolean;
    status?: number;
    body?: any;
    throws?: boolean;
    invalidPolicy?: boolean;
  } = {},
) {
  const events: string[] = [];
  const snapshot = {
    values: {
      GEMINI_API_KEY: "synthetic-google-test",
      ANTHROPIC_API_KEY: "synthetic-anthropic-test",
      OPENAI_API_KEY: "synthetic-openai-test",
    },
  };
  const policies = load("pb_hooks/requestPolicies.js");
  if (options.invalidPolicy)
    policies.geminiModelPolicySnapshot = () => ({
      models: { textFast: "https://evil.example" },
    });
  const ticket = {
    snapshot,
    replay: !!options.replay,
    result: { state: "verified-replay" },
  };
  const config = {
    reserveVerification: vi.fn(() => {
      events.push("reserve");
      return ticket;
    }),
    finalizeVerification: vi.fn((_ticket: any, proof: any) => {
      events.push("finalize");
      return proof;
    }),
    getPublicConfig: vi.fn(() => ({ state: "testing" })),
  };
  const send = vi.fn((request: any) => {
    events.push("send");
    if (options.throws) throw new Error("synthetic raw credential error");
    const service = request.url.includes("googleapis")
      ? "gemini"
      : request.url.includes("anthropic")
        ? "anthropic"
        : "openai";
    const json = options.body === undefined ? responses[service] : options.body;
    return { statusCode: options.status ?? 200, json, raw: JSON.stringify(json) };
  });
  const api = load("pb_hooks/connectionVerification.js", {
    __hooks: "/hooks",
    require: (name: string) =>
      name.endsWith("connectionConfig.js")
        ? config
        : name.endsWith("safeHttp.js")
          ? { send }
          : policies,
    $http: {
      send: () => {
        throw new Error("unsafe legacy transport");
      },
    },
  });
  return { api, config, send, events, snapshot, policies };
}
describe("fixed provider connection probes", () => {
  it.each(["gemini", "anthropic", "openai"])(
    "makes one bounded %s text request after durable reservation",
    (service) => {
      const h = harness();
      const actor = { role: "super_admin" };
      const operation = { idempotencyKey: "synthetic-operation" };
      const proof = h.api.runProviderTest(service, 4, actor, operation);
      expect(h.events).toEqual(["reserve", "send", "finalize"]);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.config.reserveVerification).toHaveBeenCalledWith(
        service,
        undefined,
        4,
        actor,
        operation,
      );
      const request = h.send.mock.calls[0][0];
      const body = JSON.parse(request.body);
      expect(request.timeout).toBe(15);
      expect(request.method).toBe("POST");
      expect(proof).toEqual({ ok: true, capabilities: ["text"] });
      expect(request.body).not.toMatch(
        /inlineData|image_url|customer|tools|responseModalities/,
      );
      if (service === "gemini") {
        expect(request.url).toBe(
          "https://generativelanguage.googleapis.com/v1beta/models/" +
            h.policies.geminiModelPolicySnapshot().models.textFast +
            ":generateContent",
        );
        expect(body.generationConfig.maxOutputTokens).toBe(128);
        expect(body.contents[0].parts).toEqual([
          { text: "Reply with exactly DS_CONNECTION_OK and nothing else." },
        ]);
      }
      if (service === "anthropic") {
        expect(body.model).toBe("claude-haiku-4-5-20251001");
        expect(body.max_tokens).toBe(32);
        expect(body.temperature).toBe(0);
      }
      if (service === "openai") {
        expect(body.model).toBe("gpt-4.1-nano");
        expect(body.max_tokens).toBe(32);
        expect(body.messages).toHaveLength(1);
      }
    },
  );
  it("replays without contacting a provider or finalizing again", () => {
    const h = harness({ replay: true });
    expect(h.api.runProviderTest("gemini", 0, {}, {})).toEqual({
      state: "verified-replay",
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.config.finalizeVerification).not.toHaveBeenCalled();
  });
  it("rejects non-provider service before reservation", () => {
    const h = harness();
    expect(() => h.api.runProviderTest("website", 0, {}, {})).toThrow(
      "CONNECTION_PROVIDER_INVALID",
    );
    expect(h.config.reserveVerification).not.toHaveBeenCalled();
  });
  it.each([
    [401, "CONNECTION_AUTH_FAILED"],
    [403, "CONNECTION_AUTH_FAILED"],
    [429, "CONNECTION_RATE_LIMITED"],
    [500, "CONNECTION_RESPONSE_INVALID"],
  ])("reports safe code for HTTP %s", (status, code) => {
    const h = harness({
      status: status as number,
      body: { error: { message: "synthetic-secret-returned-by-provider" } },
    });
    const result = h.api.runProviderTest("openai", 0, {}, {});
    expect(result).toEqual({ ok: false, capabilities: [], code });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("leaves an ambiguous transport loss pending with no retry or raw error", () => {
    const h = harness({ throws: true });
    expect(h.api.runProviderTest("gemini", 0, {}, {})).toEqual({ state: "testing" });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.config.finalizeVerification).not.toHaveBeenCalled();
  });
  it("rejects invalid model policy before any external effect", () => {
    const h = harness({ invalidPolicy: true });
    expect(h.api.runProviderTest("gemini", 0, {}, {})).toEqual({
      ok: false,
      capabilities: [],
      code: "CONNECTION_MODEL_POLICY_INVALID",
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["gemini", "anthropic", "openai"])(
    "requires exact marker and completed %s response",
    (service) => {
      const h = harness();
      expect(
        h.api.exactResponse(service, { statusCode: 200, json: responses[service] }),
      ).toBe(true);
      for (const json of [
        null,
        {},
        [],
        {
          candidates: [null],
          choices: [null],
          content: [null],
          stop_reason: "end_turn",
        },
      ])
        expect(h.api.exactResponse(service, { statusCode: 200, json })).toBe(false);
      expect(
        h.api.exactResponse(service, {
          statusCode: 200,
          json: JSON.parse(
            JSON.stringify(responses[service]).replace(
              "DS_CONNECTION_OK",
              "DS_CONNECTION_OK extra",
            ),
          ),
        }),
      ).toBe(false);
      expect(
        h.api.exactResponse(service, {
          statusCode: 200,
          json: responses[service],
          raw: "x".repeat(32769),
        }),
      ).toBe(false);
    },
  );
  it("rejects thought, inline image, tool or incomplete outputs", () => {
    const h = harness();
    expect(
      h.api.exactResponse("gemini", {
        statusCode: 200,
        json: {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "DS_CONNECTION_OK", thought: true }] },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      h.api.exactResponse("gemini", {
        statusCode: 200,
        json: {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "DS_CONNECTION_OK" }, { inlineData: {} }] },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      h.api.exactResponse("anthropic", {
        statusCode: 200,
        json: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "DS_CONNECTION_OK", image: {} }],
        },
      }),
    ).toBe(false);
    expect(
      h.api.exactResponse("openai", {
        statusCode: 200,
        json: {
          choices: [
            {
              finish_reason: "stop",
              message: { content: "DS_CONNECTION_OK", tool_calls: [] },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      h.api.exactResponse("openai", {
        statusCode: 200,
        json: {
          choices: [
            { finish_reason: "length", message: { content: "DS_CONNECTION_OK" } },
          ],
        },
      }),
    ).toBe(false);
  });
});
