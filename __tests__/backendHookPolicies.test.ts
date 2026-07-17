import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Policies = {
  serializeProxyBody: (requestInfo: unknown) => string;
  initialApprovalStatus: (dealer: unknown) => "pending" | "n_a";
  isValidAdminDealerCode: (value: unknown) => boolean;
  isAllowedProxyPath: (path: string) => boolean;
  isAllowedProxyRequest: (path: string, method: string) => boolean;
  buildGeminiProxyRequest: (
    path: string,
    input: unknown,
  ) => Record<string, unknown> | null;
  buildOpenAIImageRequest: (
    input: Record<string, unknown>,
  ) => Record<string, unknown> | null;
  buildAnthropicMessageRequest: (
    input: Record<string, unknown>,
  ) => Record<string, unknown> | null;
  proxyCostPolicy: (
    path: string,
  ) => { bucket: string; maxRequests: number; windowMs: number } | null;
};

type Helpers = {
  secureRandomString: (length: number, alphabet: string) => string;
  mintSessionToken: () => string;
  serializeDealer: (record: unknown) => Record<string, unknown>;
  logAuthEvent: (kind: string, options: Record<string, unknown>) => void;
};

function loadPocketBaseCommonJs<T>(relativePath: string): T {
  const file = resolve(process.cwd(), relativePath);
  const source = readFileSync(file, "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const policies = loadPocketBaseCommonJs<Policies>(
  "pb_hooks/requestPolicies.js",
);
const helpers = loadPocketBaseCommonJs<Helpers>("pb_hooks/helpers.js");

const textPath = "v1beta/models/gemini-3.5-flash:generateContent";
const proImagePath = "v1beta/models/gemini-3-pro-image:generateContent";
const flashImagePath = "v1beta/models/gemini-3.1-flash-image:generateContent";
const liteImagePath =
  "v1beta/models/gemini-3.1-flash-lite-image:generateContent";
const veoPath = "v1beta/models/veo-3.1-generate-preview:predictLongRunning";
const inlineImage = {
  inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" },
};

function imageRequest(imageSize: "1K" | "2K" | "4K" = "2K") {
  return {
    contents: [
      {
        parts: [inlineImage, { text: "Create a premium delivery post" }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize },
      maxOutputTokens: 4096,
    },
  };
}

function veoRequest(durationSeconds = 6, resolution = "720p") {
  return {
    instances: [
      {
        prompt: "A polished cinematic vehicle reveal",
        image: {
          bytesBase64Encoded: inlineImage.inlineData.data,
          mimeType: inlineImage.inlineData.mimeType,
        },
      },
    ],
    parameters: {
      aspectRatio: "16:9",
      personGeneration: "allow_adult",
      durationSeconds,
      resolution,
    },
  };
}

describe("PocketBase request policies", () => {
  it("serializes POST data from the PocketBase 0.22 RequestInfo contract", () => {
    expect(
      policies.serializeProxyBody({
        method: "POST",
        data: { contents: [{ parts: [{ text: "hello" }] }] },
        body: { attackerControlledLegacyField: true },
      }),
    ).toBe('{"contents":[{"parts":[{"text":"hello"}]}]}');
  });

  it("does not fall back to the unsupported RequestInfo.body field", () => {
    expect(
      policies.serializeProxyBody({ method: "POST", body: { ignored: true } }),
    ).toBe("");
  });

  it("derives initial approval exclusively from the authenticated dealer", () => {
    const requiresApproval = { getBool: () => true };
    const noApproval = { getBool: () => false };

    expect(policies.initialApprovalStatus(requiresApproval)).toBe("pending");
    expect(policies.initialApprovalStatus(noApproval)).toBe("n_a");
  });

  it("accepts only deployable super-admin codes", () => {
    expect(policies.isValidAdminDealerCode("999999")).toBe(true);
    expect(policies.isValidAdminDealerCode("DealerA7")).toBe(true);
    expect(policies.isValidAdminDealerCode(" short ")).toBe(false);
    expect(policies.isValidAdminDealerCode("with-hyphen")).toBe(false);
    expect(policies.isValidAdminDealerCode("waytoolongadmincode")).toBe(false);
  });

  it("applies tighter budgets only to expensive generation starts", () => {
    expect(
      policies.proxyCostPolicy(
        "v1beta/models/veo-3.1-generate-preview:predictLongRunning",
      ),
    ).toMatchObject({ bucket: "video-start", maxRequests: 3 });
    expect(
      policies.proxyCostPolicy(
        "v1beta/models/gemini-3.1-flash-image:generateContent",
      ),
    ).toMatchObject({ bucket: "image-start", maxRequests: 10 });
    expect(policies.proxyCostPolicy("v1beta/operations/job-123")).toBeNull();
    expect(
      policies.proxyCostPolicy(
        "v1beta/models/gemini-3.5-flash:generateContent",
      ),
    ).toBeNull();
  });

  it("allows only the configured Gemini model and method pairs", () => {
    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/gemini-3.5-flash:generateContent",
      ),
    ).toBe(true);
    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/gemini-3.1-flash-lite-image:generateContent",
      ),
    ).toBe(true);
    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/veo-3.1-generate-preview:predictLongRunning",
      ),
    ).toBe(true);
    expect(policies.isAllowedProxyPath("v1beta/operations/video-job_123")).toBe(
      true,
    );
    expect(
      policies.isAllowedProxyPath("v1beta/files/generated-video:download"),
    ).toBe(true);
    expect(
      policies.isAllowedProxyPath(
        "v1beta/files/generated-video:download?alt=media",
      ),
    ).toBe(true);

    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/gemini-arbitrary-expensive:generateContent",
      ),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/gemini-3.5-flash:predictLongRunning",
      ),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath(
        "vertex/v1/projects/example/locations/us-central1/publishers/google/models/veo-3.1-generate-001:predictLongRunning",
      ),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath("v1beta/files/../../metadata:download"),
    ).toBe(false);
  });

  it("separates generation POSTs from polling and download GETs", () => {
    const operationPath = "v1beta/operations/video-job_123";
    const scopedOperationPath =
      "v1beta/models/veo-3.1-generate-preview/operations/video-job_123";
    const filePath = "v1beta/files/generated-video:download";

    expect(policies.isAllowedProxyRequest(textPath, "POST")).toBe(true);
    expect(policies.isAllowedProxyRequest(textPath, "GET")).toBe(false);
    expect(policies.isAllowedProxyRequest(veoPath, "POST")).toBe(true);
    expect(policies.isAllowedProxyRequest(veoPath, "GET")).toBe(false);
    expect(policies.isAllowedProxyRequest(operationPath, "GET")).toBe(true);
    expect(policies.isAllowedProxyRequest(scopedOperationPath, "GET")).toBe(
      true,
    );
    expect(policies.isAllowedProxyRequest(filePath, "GET")).toBe(true);
    expect(policies.isAllowedProxyRequest(operationPath, "POST")).toBe(false);
    expect(policies.isAllowedProxyRequest(filePath, "POST")).toBe(false);
    expect(policies.isAllowedProxyRequest(filePath, "DELETE")).toBe(false);
  });

  it("accepts only the app's bounded Gemini text request shapes", () => {
    const request600 = {
      contents: [
        { parts: [inlineImage, { text: "Write a concise dealer caption" }] },
      ],
      generationConfig: { maxOutputTokens: 600 },
    };
    const request800 = {
      contents: [{ parts: [{ text: "Distill this into a Veo prompt" }] }],
      generationConfig: { maxOutputTokens: 800 },
    };

    expect(policies.buildGeminiProxyRequest(textPath, request600)).toEqual(
      request600,
    );
    expect(policies.buildGeminiProxyRequest(textPath, request800)).toEqual(
      request800,
    );

    const invalidRequests = [
      { ...request600, tools: [{ googleSearch: {} }] },
      {
        ...request600,
        generationConfig: { maxOutputTokens: 600, temperature: 2 },
      },
      { ...request600, generationConfig: { maxOutputTokens: 601 } },
      {
        ...request600,
        contents: [{ parts: [{ text: "x".repeat(20001) }] }],
      },
      {
        ...request600,
        contents: [
          {
            parts: [inlineImage, inlineImage, { text: "Too many images" }],
          },
        ],
      },
      {
        ...request600,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: "not base64",
                },
              },
              { text: "Malformed image" },
            ],
          },
        ],
      },
    ];
    for (const request of invalidRequests) {
      expect(policies.buildGeminiProxyRequest(textPath, request)).toBeNull();
    }
  });

  it("pins Gemini image resolution and response configuration by model", () => {
    expect(
      policies.buildGeminiProxyRequest(proImagePath, imageRequest("2K")),
    ).toEqual(imageRequest("2K"));
    expect(
      policies.buildGeminiProxyRequest(flashImagePath, imageRequest("2K")),
    ).toEqual(imageRequest("2K"));
    expect(
      policies.buildGeminiProxyRequest(liteImagePath, imageRequest("1K")),
    ).toEqual(imageRequest("1K"));

    // Legacy responseFormat.image.imageSize must be rewritten to imageConfig
    // before it hits Gemini (which rejects bare "2K" as an ImageSize enum).
    const legacy = {
      contents: imageRequest("2K").contents,
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: { image: { imageSize: "2K" } },
        maxOutputTokens: 4096,
      },
    };
    expect(policies.buildGeminiProxyRequest(proImagePath, legacy)).toEqual(
      imageRequest("2K"),
    );

    const twoImageRequest = imageRequest("2K");
    twoImageRequest.contents[0].parts.push(inlineImage as never);
    expect(
      policies.buildGeminiProxyRequest(proImagePath, twoImageRequest),
    ).toEqual(twoImageRequest);

    expect(
      policies.buildGeminiProxyRequest(proImagePath, imageRequest("4K")),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(liteImagePath, imageRequest("2K")),
    ).toBeNull();

    const wrongModalities = imageRequest("2K");
    wrongModalities.generationConfig.responseModalities = ["IMAGE", "TEXT"];
    expect(
      policies.buildGeminiProxyRequest(proImagePath, wrongModalities),
    ).toBeNull();

    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        generationConfig: {
          ...imageRequest("2K").generationConfig,
          temperature: 1,
        },
      }),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        tools: [{ codeExecution: {} }],
      }),
    ).toBeNull();
  });

  it("accepts only the app's bounded Veo request shapes", () => {
    for (const [duration, resolution] of [
      [4, "720p"],
      [6, "720p"],
      [8, "720p"],
      [8, "1080p"],
    ] as const) {
      const request = veoRequest(duration, resolution);
      expect(policies.buildGeminiProxyRequest(veoPath, request)).toEqual(
        request,
      );
    }

    const fastPath =
      "v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning";
    expect(
      policies.buildGeminiProxyRequest(fastPath, veoRequest(6, "720p")),
    ).toEqual(veoRequest(6, "720p"));

    const invalidRequests = [
      veoRequest(10, "720p"),
      veoRequest(6, "1080p"),
      veoRequest(8, "4K"),
      {
        ...veoRequest(),
        instances: [veoRequest().instances[0], veoRequest().instances[0]],
      },
      {
        ...veoRequest(),
        instances: [{ prompt: "No source image" }],
      },
      {
        ...veoRequest(),
        instances: [
          {
            ...veoRequest().instances[0],
            prompt: "x".repeat(20001),
          },
        ],
      },
      {
        ...veoRequest(),
        parameters: { ...veoRequest().parameters, numberOfVideos: 8 },
      },
    ];
    for (const request of invalidRequests) {
      expect(policies.buildGeminiProxyRequest(veoPath, request)).toBeNull();
    }
  });

  it("does not construct POST bodies for polling or file paths", () => {
    expect(
      policies.buildGeminiProxyRequest("v1beta/operations/job-123", {}),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(
        "v1beta/files/generated-video:download",
        {},
      ),
    ).toBeNull();
  });

  it("pins and bounds cross-provider fallback requests", () => {
    expect(
      policies.buildOpenAIImageRequest({
        model: "gpt-image-2",
        prompt: "A polished dealer delivery post",
        size: "1536x1024",
        quality: "high",
        n: 10,
      }),
    ).toEqual({
      model: "gpt-image-2",
      prompt: "A polished dealer delivery post",
      size: "1536x1024",
      quality: "high",
      n: 1,
      output_format: "png",
      moderation: "auto",
    });
    expect(
      policies.buildOpenAIImageRequest({
        model: "arbitrary-expensive-model",
        prompt: "test",
      }),
    ).toBeNull();
    expect(
      policies.buildOpenAIImageRequest({ prompt: "x".repeat(10001) }),
    ).toBeNull();

    const anthropic = policies.buildAnthropicMessageRequest({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      temperature: 0.8,
      messages: [
        { role: "user", content: [{ type: "text", text: "Caption this" }] },
      ],
    });
    expect(anthropic).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [
        { role: "user", content: [{ type: "text", text: "Caption this" }] },
      ],
    });
    expect(
      policies.buildAnthropicMessageRequest({
        model: "claude-opus-4-6",
        max_tokens: 100000,
        messages: [],
      }),
    ).toBeNull();
  });

  it("keeps the production hook wired to the tested policies", () => {
    const hookPath = resolve(process.cwd(), "pb_hooks/main.pb.js");
    const hook = readFileSync(hookPath, "utf8");

    expect(hook).toContain(
      "policies.buildGeminiProxyRequest(\n        path,\n        requestInfo.data,",
    );
    expect(hook).toContain(
      "policies.isAllowedProxyRequest(path, requestInfo.method)",
    );
    expect(hook).toContain("sanitizedProxyBody");
    expect(hook).toContain('body: isGet ? "" : sanitizedProxyBody');
    expect(hook).not.toContain("policies.serializeProxyBody(requestInfo)");
    // Validation must run before the upstream HTTP send.
    expect(
      hook.indexOf('error: "Invalid or unsupported generation request"'),
    ).toBeLessThan(hook.indexOf("$http.send({"));
    expect(hook).toContain('path = c.pathParam("path")');
    expect(hook.indexOf('path = c.pathParam("path")')).toBeLessThan(
      hook.indexOf("if (c.pathParams && c.pathParams.path)"),
    );
    expect(hook).toContain(
      "policies.buildOpenAIImageRequest(requestInfo.data)",
    );
    expect(hook).toContain("policies.buildAnthropicMessageRequest(");
    expect(hook).toContain("policies.initialApprovalStatus(dealer)");
    expect(hook).toContain("policies.isValidAdminDealerCode(");
    expect(hook).not.toContain("vertex_credentials_set");
    expect(hook).not.toContain("requestInfo.body");
    expect(hook).not.toContain("Math.random");
    expect(hook).not.toContain("codeAttempted");
    expect(hook).toContain('role !== "dealer_admin" && role !== "super_admin"');
    expect(hook).toContain('authHeader = { "x-goog-api-key": geminiApiKey }');
    expect(hook).not.toContain("queryParamsToAdd.push(`key=${geminiApiKey}`)");
  });
});

describe("PocketBase auth helper invariants", () => {
  it("fails closed when the PocketBase CSPRNG is unavailable", () => {
    const runtime: any = globalThis;
    const original = runtime.$security;
    try {
      runtime.$security = undefined;
      expect(() => helpers.mintSessionToken()).toThrow(
        "Cryptographically secure random generation is unavailable",
      );
    } finally {
      runtime.$security = original;
    }
  });

  it("accepts only correctly sized output from the PocketBase CSPRNG", () => {
    const runtime: any = globalThis;
    const original = runtime.$security;
    try {
      runtime.$security = {
        randomStringWithAlphabet: (length: number, alphabet: string) =>
          alphabet[0].repeat(length),
      };
      expect(helpers.mintSessionToken()).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      runtime.$security = original;
    }
  });

  it("omits the dealer login credential from session serialization", () => {
    const values: Record<string, string> = {
      name: "Example Dealer",
      code: "sensitive-login-code",
    };
    const serialized = helpers.serializeDealer({
      id: "dealer-record-id",
      getString: (field: string) => values[field] || "",
      getBool: () => false,
    });

    expect(serialized).not.toHaveProperty("code");
    expect(JSON.stringify(serialized)).not.toContain("sensitive-login-code");
  });

  it("stores only credential presence in auth audit events", () => {
    const runtime: any = globalThis;
    const originalApp = runtime.$app;
    const originalRecord = runtime.Record;
    let savedData: Record<string, unknown> | undefined;

    try {
      runtime.Record = class {
        constructor(_collection: unknown, data: Record<string, unknown>) {
          savedData = data;
        }
      };
      runtime.$app = {
        dao: () => ({
          findCollectionByNameOrId: () => ({ id: "auth-events" }),
          saveRecord: () => undefined,
        }),
      };

      helpers.logAuthEvent("login_fail", {
        credentialPresent: true,
        codeAttempted: "must-never-be-stored",
      });

      expect(savedData).toMatchObject({ credential_present: true });
      expect(savedData).not.toHaveProperty("code_attempted");
      expect(JSON.stringify(savedData)).not.toContain("must-never-be-stored");
    } finally {
      runtime.$app = originalApp;
      runtime.Record = originalRecord;
    }
  });
});
