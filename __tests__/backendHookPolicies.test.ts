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
  geminiModelPolicySnapshot: () => Record<string, unknown>;
};

type Helpers = {
  secureRandomString: (length: number, alphabet: string) => string;
  mintSessionToken: () => string;
  serializeDealer: (record: unknown) => Record<string, unknown>;
  serializePerson: (record: unknown) => Record<string, unknown>;
  serializePersonSummary: (record: unknown) => Record<string, unknown>;
  configuredAdminSecret: () => string;
  adminSecretFingerprint: (secret: string) => string;
  verifyTurnstileToken: (
    token: string,
    remoteIp: string,
  ) => { ok: boolean; unavailable: boolean };
  loginFailureState: (
    ip: string,
    threshold: number,
    windowSeconds: number,
  ) => {
    count: number;
    locked: boolean;
    retryAfterSeconds: number;
    unavailable: boolean;
  };
  logAuthEvent: (kind: string, options: Record<string, unknown>) => boolean;
  resolvePostScenarioPolicy: (
    scenarioId: string,
    customScenariosJson: string,
    customerName?: string,
  ) => { ok: boolean; releaseRequired: boolean };
  parsePostPlatformCaptions: (
    rawValue: string,
    allowedPlatformIds: string[],
    selectedPlatformIds: string[],
  ) => {
    ok: boolean;
    error?: string;
    value?: Record<string, string>;
    serialized?: string;
  };
};

function loadPocketBaseCommonJs<T>(relativePath: string): T {
  const file = resolve(process.cwd(), relativePath);
  const source = readFileSync(file, "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const policies = loadPocketBaseCommonJs<Policies>("pb_hooks/requestPolicies.js");
const helpers = loadPocketBaseCommonJs<Helpers>("pb_hooks/helpers.js");
const canonicalModelPolicy = JSON.parse(
  readFileSync(resolve(process.cwd(), "config/gemini-model-policy.json"), "utf8"),
);
const withServerSafety = <T extends Record<string, unknown>>(request: T) => ({
  ...request,
  safetySettings: canonicalModelPolicy.safetySettings,
});

const textPath = "v1beta/models/gemini-3.6-flash:generateContent";
const proImagePath = "v1beta/models/gemini-3-pro-image:generateContent";
const flashImagePath = "v1beta/models/gemini-3.1-flash-image:generateContent";
const liteImagePath = "v1beta/models/gemini-3.1-flash-lite-image:generateContent";
const veoPath = "v1beta/models/veo-3.1-generate-preview:predictLongRunning";
const inlineImage = {
  inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" },
};

function imageRequest(
  imageSize: "1K" | "2K" | "4K" = "2K",
  aspectRatio?: "1:1" | "9:16" | "16:9" | "4:3",
) {
  return {
    contents: [
      {
        parts: [inlineImage, { text: "Create a premium delivery post" }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        imageSize,
        ...(aspectRatio ? { aspectRatio } : {}),
      },
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
  it("derives photo-release requirements from only known server scenarios", () => {
    expect(helpers.resolvePostScenarioPolicy("customer_delivery", "[]", "")).toEqual({
      ok: true,
      releaseRequired: true,
    });
    expect(helpers.resolvePostScenarioPolicy("new_arrival", "[]", "")).toEqual({
      ok: true,
      releaseRequired: false,
    });
    expect(helpers.resolvePostScenarioPolicy("new_arrival", "[]", "Mia")).toEqual({
      ok: true,
      releaseRequired: true,
    });
    expect(
      helpers.resolvePostScenarioPolicy(
        "custom_customer",
        JSON.stringify([
          { id: "custom_customer", requiresCustomer: true },
          { id: "custom_inventory", requiresCustomer: false },
        ]),
        "",
      ),
    ).toEqual({ ok: true, releaseRequired: true });
    expect(
      helpers.resolvePostScenarioPolicy(
        "custom_inventory",
        JSON.stringify([{ id: "custom_inventory", requiresCustomer: false }]),
        "",
      ),
    ).toEqual({ ok: true, releaseRequired: false });
    expect(
      helpers.resolvePostScenarioPolicy(
        "custom_inventory",
        JSON.stringify([{ id: "custom_inventory", requiresCustomer: false }]),
        "Mia",
      ),
    ).toEqual({ ok: true, releaseRequired: true });
    expect(
      helpers.resolvePostScenarioPolicy("invented_client_scenario", "[]", ""),
    ).toEqual({ ok: false, releaseRequired: true });
    expect(helpers.resolvePostScenarioPolicy("", "[]", "Mia")).toEqual({
      ok: true,
      releaseRequired: true,
    });
  });

  it("bounds platform captions to the selected, server-allowlisted destinations", () => {
    const allowed = ["instagram_feed", "instagram_story", "tiktok"];
    expect(
      helpers.parsePostPlatformCaptions(
        JSON.stringify({
          instagram_story: "  Story copy  ",
          tiktok: "TikTok copy",
        }),
        allowed,
        ["instagram_story", "tiktok"],
      ),
    ).toEqual({
      ok: true,
      value: {
        instagram_story: "Story copy",
        tiktok: "TikTok copy",
      },
      serialized: JSON.stringify({
        instagram_story: "Story copy",
        tiktok: "TikTok copy",
      }),
    });
    expect(
      helpers.parsePostPlatformCaptions(
        JSON.stringify({ instagram_feed: "Not selected" }),
        allowed,
        ["instagram_story"],
      ),
    ).toMatchObject({ ok: false });
    expect(
      helpers.parsePostPlatformCaptions(
        JSON.stringify({ attacker_target: "No" }),
        allowed,
        ["instagram_story"],
      ),
    ).toMatchObject({ ok: false });
    expect(
      helpers.parsePostPlatformCaptions(
        JSON.stringify({ instagram_story: "x".repeat(12001) }),
        allowed,
        ["instagram_story"],
      ),
    ).toMatchObject({ ok: false });
  });

  it("binds temporary photo releases to one session and expires every legacy orphan", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1750800200_harden_photo_release_ownership.js",
      ),
      "utf8",
    );

    expect(hook).toContain("owner_session_hash: ownerSessionHash");
    expect(hook).toContain("expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)");
    expect(hook).toContain(
      'helpers.normalizeReleaseIdentity(release.getString("customer_name"))',
    );
    expect(hook).toContain('helpers.normalizeReleaseVin(release.getString("vin"))');
    expect(hook).toContain(
      "A verified customer photo release is required before approval",
    );
    expect(hook).toContain('cronAdd("prune-unlinked-photo-releases"');
    expect(migration).toContain("UPDATE photo_releases");
    expect(migration).toContain("WHERE post_id = '' OR post_id IS NULL");
    expect(migration).not.toContain("10000");
  });

  it("matches the canonical Gemini task, model, and safety contract", () => {
    expect(policies.geminiModelPolicySnapshot()).toEqual(canonicalModelPolicy);
  });

  it("accepts every canonical task/model request combination", () => {
    for (const [taskName, taskValue] of Object.entries(canonicalModelPolicy.tasks)) {
      const task = taskValue as {
        kind: "text" | "image" | "video";
        models: string[];
        maxOutputTokens?: number;
        imageSizes?: Record<string, "1K" | "2K" | "4K">;
        resolution?: "720p" | "1080p";
      };

      for (const model of task.models) {
        const path =
          task.kind === "video"
            ? `v1beta/models/${model}:predictLongRunning`
            : `v1beta/models/${model}:generateContent`;
        const request =
          task.kind === "text"
            ? {
                contents: [
                  {
                    parts: [inlineImage, { text: `Contract request for ${taskName}` }],
                  },
                ],
                generationConfig: {
                  maxOutputTokens: task.maxOutputTokens,
                },
              }
            : task.kind === "image"
              ? imageRequest(task.imageSizes?.[model] ?? "2K")
              : veoRequest(task.resolution === "1080p" ? 8 : 6, task.resolution);

        const sanitized = policies.buildGeminiProxyRequest(path, request);
        expect(sanitized, `${taskName} should allow ${model}`).not.toBeNull();
        if (task.kind !== "video") {
          expect(sanitized?.safetySettings).toEqual(
            canonicalModelPolicy.safetySettings,
          );
        }
      }
    }
  });

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
    expect(policies.isValidAdminDealerCode("CiAdmin7xQ2Z")).toBe(true);
    expect(policies.isValidAdminDealerCode("999999")).toBe(false);
    expect(policies.isValidAdminDealerCode("DealerA7")).toBe(false);
    expect(policies.isValidAdminDealerCode(" CiAdmin7xQ2Z")).toBe(false);
    expect(policies.isValidAdminDealerCode("CiAdmin7xQ2Z ")).toBe(false);
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
      policies.proxyCostPolicy("v1beta/models/gemini-3.1-flash-image:generateContent"),
    ).toMatchObject({ bucket: "image-start", maxRequests: 10 });
    expect(policies.proxyCostPolicy("v1beta/operations/job-123")).toBeNull();
    expect(
      policies.proxyCostPolicy("v1beta/models/gemini-3.6-flash:generateContent"),
    ).toBeNull();
  });

  it("allows only the configured Gemini model and method pairs", () => {
    expect(
      policies.isAllowedProxyPath("v1beta/models/gemini-3.6-flash:generateContent"),
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
    expect(policies.isAllowedProxyPath("v1beta/operations/video-job_123")).toBe(true);
    expect(policies.isAllowedProxyPath("v1beta/files/generated-video:download")).toBe(
      true,
    );
    expect(
      policies.isAllowedProxyPath("v1beta/files/generated-video:download?alt=media"),
    ).toBe(true);

    expect(
      policies.isAllowedProxyPath(
        "v1beta/models/gemini-arbitrary-expensive:generateContent",
      ),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath("v1beta/models/gemini-2.5-flash:generateContent"),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath("v1beta/models/gemini-3.6-flash:predictLongRunning"),
    ).toBe(false);
    expect(
      policies.isAllowedProxyPath(
        "vertex/v1/projects/example/locations/us-central1/publishers/google/models/veo-3.1-generate-001:predictLongRunning",
      ),
    ).toBe(false);
    expect(policies.isAllowedProxyPath("v1beta/files/../../metadata:download")).toBe(
      false,
    );
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
    expect(policies.isAllowedProxyRequest(scopedOperationPath, "GET")).toBe(true);
    expect(policies.isAllowedProxyRequest(filePath, "GET")).toBe(true);
    expect(policies.isAllowedProxyRequest(operationPath, "POST")).toBe(false);
    expect(policies.isAllowedProxyRequest(filePath, "POST")).toBe(false);
    expect(policies.isAllowedProxyRequest(filePath, "DELETE")).toBe(false);
  });

  it("accepts only the app's bounded Gemini text request shapes", () => {
    const request2048 = {
      contents: [{ parts: [inlineImage, { text: "Write a concise dealer caption" }] }],
      generationConfig: { maxOutputTokens: 2048 },
    };

    expect(policies.buildGeminiProxyRequest(textPath, request2048)).toEqual(
      withServerSafety(request2048),
    );

    const invalidRequests = [
      { ...request2048, tools: [{ googleSearch: {} }] },
      {
        ...request2048,
        generationConfig: { maxOutputTokens: 2048, temperature: 2 },
      },
      { ...request2048, generationConfig: { maxOutputTokens: 800 } },
      {
        ...request2048,
        contents: [{ parts: [{ text: "x".repeat(20001) }] }],
      },
      {
        ...request2048,
        contents: [
          {
            parts: [inlineImage, inlineImage, { text: "Too many images" }],
          },
        ],
      },
      {
        ...request2048,
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
      {
        ...request2048,
        safetySettings: [
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "OFF",
          },
        ],
      },
    ];
    for (const request of invalidRequests) {
      expect(policies.buildGeminiProxyRequest(textPath, request)).toBeNull();
    }
  });

  it("pins Gemini image resolution and response configuration by model", () => {
    expect(policies.buildGeminiProxyRequest(proImagePath, imageRequest("2K"))).toEqual(
      withServerSafety(imageRequest("2K")),
    );
    expect(
      policies.buildGeminiProxyRequest(flashImagePath, imageRequest("2K")),
    ).toEqual(withServerSafety(imageRequest("2K")));
    expect(policies.buildGeminiProxyRequest(liteImagePath, imageRequest("1K"))).toEqual(
      withServerSafety(imageRequest("1K")),
    );

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
      withServerSafety(imageRequest("2K")),
    );

    const twoImageRequest = imageRequest("2K");
    twoImageRequest.contents[0].parts.push(inlineImage as never);
    expect(policies.buildGeminiProxyRequest(proImagePath, twoImageRequest)).toEqual(
      withServerSafety(twoImageRequest),
    );

    expect(
      policies.buildGeminiProxyRequest(proImagePath, imageRequest("4K")),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(liteImagePath, imageRequest("2K")),
    ).toBeNull();

    const wrongModalities = imageRequest("2K");
    wrongModalities.generationConfig.responseModalities = ["IMAGE", "TEXT"];
    expect(policies.buildGeminiProxyRequest(proImagePath, wrongModalities)).toBeNull();

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

  it("allows only the app's canonical image aspect ratios", () => {
    for (const aspectRatio of ["1:1", "9:16", "16:9", "4:3"] as const) {
      const request = imageRequest("2K", aspectRatio);
      expect(policies.buildGeminiProxyRequest(proImagePath, request)).toEqual(
        withServerSafety(request),
      );
    }

    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        generationConfig: {
          ...imageRequest("2K").generationConfig,
          imageConfig: { imageSize: "2K", aspectRatio: "3:7" },
        },
      }),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        generationConfig: {
          ...imageRequest("2K").generationConfig,
          imageConfig: {
            imageSize: "2K",
            aspectRatio: "9:16",
            cropMode: "cover",
          },
        },
      }),
    ).toBeNull();
  });

  it("accepts only the app's bounded Veo request shapes", () => {
    const fastPath = "v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning";
    for (const duration of [4, 6, 8] as const) {
      expect(
        policies.buildGeminiProxyRequest(fastPath, veoRequest(duration, "720p")),
      ).toEqual(veoRequest(duration, "720p"));
    }
    expect(policies.buildGeminiProxyRequest(veoPath, veoRequest(8, "1080p"))).toEqual(
      veoRequest(8, "1080p"),
    );

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
    expect(
      policies.buildGeminiProxyRequest(fastPath, veoRequest(8, "1080p")),
    ).toBeNull();
    expect(policies.buildGeminiProxyRequest(veoPath, veoRequest(8, "720p"))).toBeNull();
  });

  it("does not construct POST bodies for polling or file paths", () => {
    expect(
      policies.buildGeminiProxyRequest("v1beta/operations/job-123", {}),
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest("v1beta/files/generated-video:download", {}),
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
    expect(policies.buildOpenAIImageRequest({ prompt: "x".repeat(10001) })).toBeNull();

    const anthropic = policies.buildAnthropicMessageRequest({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      temperature: 0.8,
      messages: [{ role: "user", content: [{ type: "text", text: "Caption this" }] }],
    });
    expect(anthropic).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: [{ type: "text", text: "Caption this" }] }],
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

    expect(hook).toContain("policies.buildGeminiProxyRequest(path, requestInfo.data)");
    expect(hook).toContain("policies.isAllowedProxyRequest(path, requestInfo.method)");
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
    expect(hook).toContain("policies.buildOpenAIImageRequest(requestInfo.data)");
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

  it("redacts personal access codes from every ordinary person DTO", () => {
    const values: Record<string, string> = {
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      pin: "4821",
      created_at: "2026-07-17T12:00:00.000Z",
    };
    const serialized = helpers.serializePerson({
      id: "person-record-id",
      getString: (field: string) => values[field] || "",
      getBool: (field: string) =>
        field === "active" || field === "pin_needs_distribution",
    });

    expect(serialized).toMatchObject({
      id: "person-record-id",
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      active: true,
      hasPin: true,
      pinNeedsDistribution: true,
    });
    expect(serialized).not.toHaveProperty("pin");
    expect(JSON.stringify(serialized)).not.toContain("4821");
  });

  it("keeps session identity payloads limited to the public PersonSummary contract", () => {
    const values: Record<string, string> = {
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      pin: "4821",
      created_at: "2026-07-17T12:00:00.000Z",
    };
    const summary = helpers.serializePersonSummary({
      id: "person-record-id",
      getString: (field: string) => values[field] || "",
      getBool: (field: string) =>
        field === "active" || field === "pin_needs_distribution",
    });

    expect(summary).toEqual({
      id: "person-record-id",
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      active: true,
    });
    expect(summary).not.toHaveProperty("pin");
    expect(summary).not.toHaveProperty("hasPin");
    expect(summary).not.toHaveProperty("pinNeedsDistribution");
    expect(summary).not.toHaveProperty("created_at");
  });

  it("preserves admin-secret case and fingerprints rotations differently", () => {
    const runtime: any = globalThis;
    const originalOs = runtime.$os;
    const originalSecurity = runtime.$security;
    try {
      let configured = "MixedCaseA7Z";
      runtime.$os = { getenv: () => configured };
      runtime.$security = {
        sha256: (value: string) =>
          value.endsWith("MixedCaseA7Z") ? "a".repeat(64) : "b".repeat(64),
      };

      expect(helpers.configuredAdminSecret()).toBe("MixedCaseA7Z");
      expect(helpers.adminSecretFingerprint("MixedCaseA7Z")).not.toBe(
        helpers.adminSecretFingerprint("mixedcasea7z"),
      );
      configured = " MixedCaseA7Z";
      expect(helpers.configuredAdminSecret()).toBe("");
    } finally {
      runtime.$os = originalOs;
      runtime.$security = originalSecurity;
    }
  });

  it("verifies Turnstile server-side with the canonical action and no token logging", () => {
    const runtime: any = globalThis;
    const originalOs = runtime.$os;
    const originalHttp = runtime.$http;
    let request: Record<string, unknown> | undefined;
    try {
      runtime.$os = {
        getenv: (name: string) =>
          name === "TURNSTILE_SECRET" ? "1x0000000000000000000000000000000AA" : "",
      };
      runtime.$http = {
        send: (input: Record<string, unknown>) => {
          request = input;
          return {
            statusCode: 200,
            json: {
              success: true,
              hostname: "dummy-key-pass",
              action: "turnstile-spin-v2",
            },
          };
        },
      };

      expect(helpers.verifyTurnstileToken("test-response-token", "127.0.0.1")).toEqual({
        ok: true,
        unavailable: false,
      });
      expect(request).toMatchObject({
        url: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10,
      });
      expect(String(request?.body)).toContain("response=test-response-token");
      expect(String(request?.body)).toContain("remoteip=127.0.0.1");

      runtime.$http.send = () => ({
        statusCode: 200,
        json: { success: false, "error-codes": ["invalid-input-secret"] },
      });
      expect(helpers.verifyTurnstileToken("test-response-token", "127.0.0.1")).toEqual({
        ok: false,
        unavailable: true,
      });
    } finally {
      runtime.$os = originalOs;
      runtime.$http = originalHttp;
    }
  });

  it("uses PocketBase date formatting and returns a rolling lock countdown", () => {
    const runtime: any = globalThis;
    const originalApp = runtime.$app;
    let since = "";
    const created = new Date(Date.now() - 1000).toISOString().replace("T", " ");
    try {
      runtime.$app = {
        dao: () => ({
          findRecordsByFilter: (
            _collection: string,
            _filter: string,
            _sort: string,
            _limit: number,
            _offset: number,
            params: { s: string },
          ) => {
            since = params.s;
            return [1, 2, 3].map(() => ({ getString: () => created }));
          },
        }),
      };

      const state = helpers.loginFailureState("203.0.113.20", 3, 900);
      expect(since).toContain(" ");
      expect(since).not.toContain("T");
      expect(state).toMatchObject({ count: 3, locked: true });
      expect(state.retryAfterSeconds).toBeGreaterThanOrEqual(898);
      expect(state.retryAfterSeconds).toBeLessThanOrEqual(900);
    } finally {
      runtime.$app = originalApp;
    }
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

      expect(
        helpers.logAuthEvent("login_fail", {
          credentialPresent: true,
          codeAttempted: "must-never-be-stored",
        }),
      ).toBe(true);

      expect(savedData).toMatchObject({ credential_present: true });
      expect(savedData).not.toHaveProperty("code_attempted");
      expect(JSON.stringify(savedData)).not.toContain("must-never-be-stored");
    } finally {
      runtime.$app = originalApp;
      runtime.Record = originalRecord;
    }
  });

  it("returns an explicit failure when an auth event cannot be stored", () => {
    const runtime: any = globalThis;
    const originalApp = runtime.$app;
    try {
      runtime.$app = {
        dao: () => ({
          findCollectionByNameOrId: () => ({ id: "auth-events" }),
          saveRecord: () => {
            throw new Error("database unavailable");
          },
        }),
      };

      expect(helpers.logAuthEvent("login_fail", { credentialPresent: true })).toBe(
        false,
      );
    } finally {
      runtime.$app = originalApp;
    }
  });
});

describe("PocketBase authentication and people migration wiring", () => {
  it("repairs dirty PIN data before installing the unique constraint", () => {
    const peopleMigration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750400000_people_roles_impersonation.js"),
      "utf8",
    );
    const integrityMigration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750500000_auth_people_integrity.js"),
      "utf8",
    );

    expect(peopleMigration).not.toContain("CREATE UNIQUE INDEX `idx_salespeople_pin`");
    expect(peopleMigration).not.toContain("Math.random");
    expect(integrityMigration).toContain("pin_needs_distribution");
    expect(integrityMigration.indexOf("needsRepair.push")).toBeLessThan(
      integrityMigration.indexOf("CREATE UNIQUE INDEX `idx_salespeople_pin`"),
    );
    expect(integrityMigration).toContain(
      "The four-digit access-code space is exhausted",
    );
  });

  it("binds admin and impersonation sessions to current authority", () => {
    const helpersSource = readFileSync(
      resolve(process.cwd(), "pb_hooks/helpers.js"),
      "utf8",
    );
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

    expect(helpersSource).toContain("admin_secret_fingerprint");
    expect(helpersSource).toContain("validateSuperAdminSession(source)");
    expect(helpersSource).toContain(
      'personRoleToSessionRole(person.getString("role"))',
    );
    expect(hook).toContain('error: "CHALLENGE_REQUIRED"');
    expect(hook).toContain('error: "LOCKED"');
    expect(hook).toContain('error: "UNAVAILABLE"');
    expect(hook).toContain("helpers.verifyTurnstileToken(turnstileToken, ip)");
  });

  it("derives post attribution from the validated session and supports all-store cursors", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

    expect(hook).toContain(
      'const salespersonId = context.person ? context.person.id : ""',
    );
    expect(hook).not.toContain("body.salesperson_id");
    expect(hook).not.toContain("body.salesperson_name");
    expect(hook).toContain("attribution_authoritative: !!context.person");
    expect(hook).toContain("isAuthoritativePostPerson(context, record)");
    expect(hook).toContain("filterParts.push(`attribution_authoritative = true`)");
    expect(hook).toContain("pin_needs_distribution = true");
    expect(hook).toContain("payload.nextCursor");
    expect(hook).toContain("dealerName");
  });

  it("keeps scheduling owner-scoped even for managers viewing teammate history", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const scheduleRoute = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/schedule"'),
      hook.indexOf('routerAdd("GET", "/api/app/posts/:id/status"'),
    );

    expect(scheduleRoute).toContain("isAuthoritativePostPerson(context, record)");
    expect(scheduleRoute).toContain("if (!isOwner && !isSamePerson)");
    expect(scheduleRoute).not.toContain("isManager");
  });
});
