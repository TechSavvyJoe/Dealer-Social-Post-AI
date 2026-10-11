import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLAUDE_MODELS } from "../services/modelConfig";

type Policies = {
  serializeProxyBody: (requestInfo: unknown) => string;
  initialApprovalStatus: (
    dealer: unknown,
    context?: {
      category?: string;
      involvesCustomer?: boolean;
      countApprovedPosts?: () => number;
    },
  ) => "pending" | "n_a";

  isAllowedProxyPath: (path: string) => boolean;
  isAllowedProxyRequest: (path: string, method: string) => boolean;
  buildGeminiProxyRequest: (
    path: string,
    input: unknown,
    requestedTaskName?: string,
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
  geminiResponseSchemaIds: () => string[];
  geminiResponseSchema: (schemaId: unknown) => Record<string, unknown> | null;
  postImageReviewRequired: (record: unknown, currentPolicy: unknown) => boolean;
};

type Helpers = {
  secureRandomString: (length: number, alphabet: string) => string;
  proxyGenerationIdentity: (
    path: string,
    requestInfo: unknown,
    policies: Policies,
    provider: string,
    modelOverride: string,
  ) => Record<string, unknown> | null;
  proxyGenerationPurpose: (requestInfo: unknown, kind: string) => string;
  proxyGenerationUsage: (
    identity: unknown,
    requestInfo: unknown,
    responsePayload: unknown,
    usage: unknown,
  ) => Record<string, unknown>;
  proxyPolicyVersionMismatch: (
    requestInfo: unknown,
    policies: Policies,
  ) => { mismatch: boolean; currentVersion: string };
  generationUsageSummary: (windowDays: number) => {
    windowDays: number;
    since: string;
    dealers: Array<Record<string, unknown>>;
    truncated: boolean;
  };
  GENERATION_PURPOSES: string[];
  mintSessionToken: () => string;
  dealerMutationData: (
    body: Record<string, unknown>,
    allowCode: boolean,
    allowAdminCode: boolean,
  ) => Record<string, unknown>;
  serializeDealer: (record: unknown) => Record<string, unknown>;
  serializePerson: (record: unknown) => Record<string, unknown>;
  serializePersonSummary: (record: unknown) => Record<string, unknown>;
  personProfileMutationData: (
    body: Record<string, unknown>,
    actorRole: string,
  ) => Record<string, unknown>;
  personProfileErrorPayload: (err: unknown) => {
    status: number;
    body: Record<string, unknown>;
  };
  safeDealerMutationError: (err: unknown) => string;

  adminAuthFingerprint: (account: unknown) => string;
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
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9" | "4:3",
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
        "custom_delivery",
        JSON.stringify([
          {
            id: "custom_delivery",
            category: "delivery",
            requiresCustomer: false,
          },
        ]),
        "",
      ),
    ).toEqual({ ok: true, releaseRequired: true });
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

  it("quarantines stored creatives without current server image-review provenance", () => {
    const post = (fields: Record<string, string>) => ({
      getString: (name: string) => fields[name] || "",
    });

    expect(
      policies.postImageReviewRequired(
        post({ creative_image: "creative.jpg", model_policy_version: "4" }),
        canonicalModelPolicy,
      ),
    ).toBe(true);
    expect(
      policies.postImageReviewRequired(
        post({
          creative_image: "creative.jpg",
          model_policy_version: String(canonicalModelPolicy.version),
        }),
        canonicalModelPolicy,
      ),
    ).toBe(false);
    expect(
      policies.postImageReviewRequired(
        post({ model_policy_version: "4" }),
        canonicalModelPolicy,
      ),
    ).toBe(false);
  });

  it("accepts every canonical task/model request combination", () => {
    for (const [taskName, taskValue] of Object.entries(canonicalModelPolicy.tasks)) {
      const task = taskValue as {
        kind: "text" | "image" | "video";
        models: string[];
        maxOutputTokens?: number;
        thinkingLevel?: string;
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
                  ...(task.thinkingLevel
                    ? { thinkingConfig: { thinkingLevel: task.thinkingLevel } }
                    : {}),
                },
              }
            : task.kind === "image"
              ? imageRequest(task.imageSizes?.[model] ?? "2K")
              : veoRequest(task.resolution === "1080p" ? 8 : 6, task.resolution);

        const sanitized = policies.buildGeminiProxyRequest(path, request, taskName);
        expect(sanitized, `${taskName} should allow ${model}`).not.toBeNull();
        if (task.kind === "text") {
          expect(sanitized?.generationConfig).toEqual({
            maxOutputTokens: task.maxOutputTokens,
            thinkingConfig: { thinkingLevel: task.thinkingLevel },
          });
        }
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

  describe("approval policy", () => {
    const store = (requiresApproval: boolean, policy: unknown) => ({
      getBool: (field: string) => field === "requires_approval" && requiresApproval,
      getString: (field: string) =>
        field === "approval_policy"
          ? typeof policy === "string"
            ? policy
            : JSON.stringify(policy)
          : "",
    });
    const never = () => {
      throw new Error("the approved-post count must not be read for this policy");
    };

    it("never turns review on for a store that has it off", () => {
      for (const policy of [
        { mode: "always" },
        { mode: "per_category", categories: ["deliveries"] },
        { mode: "first_n", firstN: 3 },
      ]) {
        expect(
          policies.initialApprovalStatus(store(false, policy), {
            category: "deliveries",
            involvesCustomer: true,
            countApprovedPosts: () => 0,
          }),
        ).toBe("n_a");
      }
    });

    it("reviews every post without a policy, or with one it cannot read", () => {
      for (const policy of [
        null,
        "",
        "not json",
        "[]",
        { mode: "always" },
        { mode: "none" },
        { mode: "something_new" },
        {},
      ]) {
        expect(
          policies.initialApprovalStatus(store(true, policy), {
            category: "service",
            involvesCustomer: false,
            countApprovedPosts: never,
          }),
        ).toBe("pending");
      }
    });

    it("reviews only the selected categories, and anything it cannot classify", () => {
      const dealer = store(true, {
        mode: "per_category",
        categories: ["promotions", "community"],
      });
      const status = (category?: string) =>
        policies.initialApprovalStatus(dealer, {
          category,
          involvesCustomer: false,
          countApprovedPosts: never,
        });
      expect(status("promotions")).toBe("pending");
      expect(status("community")).toBe("pending");
      expect(status("service")).toBe("n_a");
      expect(status("team")).toBe("n_a");
      expect(status("")).toBe("pending");
      expect(status(undefined)).toBe("pending");
      expect(policies.initialApprovalStatus(dealer)).toBe("pending");
      // An empty or malformed list narrows nothing.
      for (const categories of [[], undefined, "deliveries"]) {
        expect(
          policies.initialApprovalStatus(
            store(true, { mode: "per_category", categories }),
            { category: "service", involvesCustomer: false },
          ),
        ).toBe("pending");
      }
    });

    it("reviews a customer post with deliveries, whatever type the author picked", () => {
      const dealer = store(true, { mode: "per_category", categories: ["deliveries"] });
      const status = (category: string, involvesCustomer?: boolean) =>
        policies.initialApprovalStatus(dealer, { category, involvesCustomer });
      // A sold-by post maps to "team" and a recall to "service", but both carry
      // a customer; so does any post filed under another type with a name.
      expect(status("team", true)).toBe("pending");
      expect(status("service", true)).toBe("pending");
      expect(status("inventory", true)).toBe("pending");
      // Unknown is treated as involving a customer.
      expect(status("inventory", undefined)).toBe("pending");
      expect(status("inventory", false)).toBe("n_a");
      // Deliveries not selected: the customer signal adds nothing.
      expect(
        policies.initialApprovalStatus(
          store(true, { mode: "per_category", categories: ["promotions"] }),
          { category: "team", involvesCustomer: true },
        ),
      ).toBe("n_a");
    });

    it("reviews a person until enough of their posts were approved", () => {
      const dealer = store(true, { mode: "first_n", firstN: 3 });
      const status = (countApprovedPosts?: () => number) =>
        policies.initialApprovalStatus(dealer, {
          category: "service",
          involvesCustomer: false,
          countApprovedPosts,
        });
      expect(status(() => 0)).toBe("pending");
      expect(status(() => 2)).toBe("pending");
      expect(status(() => 3)).toBe("n_a");
      expect(status(() => 40)).toBe("n_a");
      expect(status(() => NaN)).toBe("pending");
      expect(status(() => -1)).toBe("pending");
      expect(status(() => 2.5)).toBe("pending");
      expect(
        status(() => {
          throw new Error("database is locked");
        }),
      ).toBe("pending");
      expect(status(undefined)).toBe("pending");
      for (const firstN of [0, -2, 1.5, "abc", undefined]) {
        expect(
          policies.initialApprovalStatus(store(true, { mode: "first_n", firstN }), {
            countApprovedPosts: () => 99,
          }),
        ).toBe("pending");
      }
    });
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
    const threeImageVisionReview = {
      ...request2048,
      contents: [
        {
          parts: [
            {
              text: `IMAGE 1: REFERENCE SOURCE IMAGE
IMAGE 2: GENERATED OUTPUT IMAGE
IMAGE 3: APPROVED DEALERSHIP LOGO

You are a strict visual quality-control inspector for an automotive dealership image.`,
            },
            inlineImage,
            inlineImage,
            inlineImage,
          ],
        },
      ],
    };
    expect(
      policies.buildGeminiProxyRequest(
        textPath,
        threeImageVisionReview,
        "caption_regenerate",
      ),
    ).toEqual(withServerSafety(threeImageVisionReview));
    const splitLabelVisionReview = {
      ...threeImageVisionReview,
      contents: [
        {
          parts: [
            { text: "REFERENCE SOURCE IMAGE" },
            inlineImage,
            { text: "GENERATED OUTPUT IMAGE" },
            inlineImage,
            { text: "Review these images" },
          ],
        },
      ],
    };
    expect(
      policies.buildGeminiProxyRequest(
        textPath,
        splitLabelVisionReview,
        "caption_regenerate",
      ),
    ).toBeNull();

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
            parts: [
              inlineImage,
              inlineImage,
              inlineImage,
              inlineImage,
              { text: "Too many images" },
            ],
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
      policies.buildGeminiProxyRequest(
        proImagePath,
        imageRequest("4K"),
        "image_studio",
      ),
    ).toEqual(withServerSafety(imageRequest("4K")));
    expect(
      policies.buildGeminiProxyRequest(
        proImagePath,
        imageRequest("2K"),
        "image_studio",
      ),
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
    for (const aspectRatio of ["1:1", "4:5", "9:16", "16:9", "4:3"] as const) {
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

  it("forwards a bounded Veo negativePrompt and rejects a malformed one", () => {
    const fastPath = "v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning";
    const withNegativePrompt = (negativePrompt: unknown) => {
      const request = veoRequest(6, "720p");
      return {
        ...request,
        parameters: { ...request.parameters, negativePrompt },
      };
    };

    const accepted = policies.buildGeminiProxyRequest(
      fastPath,
      withNegativePrompt("second car, vehicle morphing, warped badges"),
    );
    expect(accepted).toEqual(
      withNegativePrompt("second car, vehicle morphing, warped badges"),
    );

    // Optional: a client that predates the parameter stays valid, and the
    // sanitized body must not invent the key.
    const withoutNegativePrompt = policies.buildGeminiProxyRequest(
      fastPath,
      veoRequest(6, "720p"),
    );
    expect(withoutNegativePrompt).toEqual(veoRequest(6, "720p"));
    expect(
      Object.prototype.hasOwnProperty.call(
        (withoutNegativePrompt as { parameters: Record<string, unknown> }).parameters,
        "negativePrompt",
      ),
    ).toBe(false);

    // Present but malformed is a rejection, never a silently dropped field.
    const maxNegativePromptChars =
      canonicalModelPolicy.requestLimits.maxNegativePromptChars;
    expect(typeof maxNegativePromptChars).toBe("number");
    for (const invalid of [
      "",
      "   ",
      123,
      null,
      ["second car"],
      { text: "second car" },
      "x".repeat(maxNegativePromptChars + 1),
    ]) {
      expect(
        policies.buildGeminiProxyRequest(fastPath, withNegativePrompt(invalid)),
      ).toBeNull();
    }

    // `generateAudio` is a Vertex/GEAP-only parameter. It must stay off the
    // allowlist so it can never reach generativelanguage.googleapis.com.
    expect(canonicalModelPolicy.allowedRequestFields.veo.parameters).not.toContain(
      "generateAudio",
    );
    const request = veoRequest(6, "720p");
    expect(
      policies.buildGeminiProxyRequest(fastPath, {
        ...request,
        parameters: { ...request.parameters, generateAudio: false },
      }),
    ).toBeNull();
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

  it("admits only an enum-bound thinkingLevel on Gemini text requests", () => {
    const litePath = "v1beta/models/gemini-3.5-flash-lite:generateContent";
    const withThinking = (thinkingConfig: unknown) => ({
      contents: [{ parts: [inlineImage, { text: "Write a concise dealer caption" }] }],
      generationConfig: { maxOutputTokens: 2048, thinkingConfig },
    });

    for (const thinkingLevel of ["minimal", "low", "medium", "high"]) {
      for (const path of [textPath, litePath]) {
        const request = withThinking({ thinkingLevel });
        expect(
          policies.buildGeminiProxyRequest(path, request),
          `${path} should accept thinkingLevel ${thinkingLevel}`,
        ).toEqual(withServerSafety(request));
      }
    }
    // Requests without a thinkingConfig stay valid for older installed clients.
    const legacyRequest = {
      contents: withThinking(undefined).contents,
      generationConfig: { maxOutputTokens: 2048 },
    };
    expect(policies.buildGeminiProxyRequest(textPath, legacyRequest)).toEqual(
      withServerSafety(legacyRequest),
    );

    const rejectedThinkingConfigs = [
      { thinkingLevel: "ultra" },
      { thinkingLevel: "LOW" },
      { thinkingLevel: "" },
      { thinkingLevel: 1 },
      { thinkingLevel: null },
      {},
      null,
      "low",
      ["low"],
      { thinkingBudget: 1024 },
      { thinkingLevel: "low", thinkingBudget: 1024 },
      { includeThoughts: true },
      { thinkingLevel: "low", includeThoughts: true },
      { thinking_level: "low" },
    ];
    for (const thinkingConfig of rejectedThinkingConfigs) {
      expect(
        policies.buildGeminiProxyRequest(textPath, withThinking(thinkingConfig)),
        `should reject thinkingConfig ${JSON.stringify(thinkingConfig)}`,
      ).toBeNull();
    }
    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        generationConfig: {
          ...imageRequest("2K").generationConfig,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      "image models never accept a thinkingConfig",
    ).toBeNull();
  });

  it("accepts a bounded systemInstruction on text requests only", () => {
    const withSystem = (systemInstruction: unknown) => ({
      contents: [{ parts: [{ text: "Write a concise dealer caption" }] }],
      generationConfig: { maxOutputTokens: 2048 },
      systemInstruction,
    });
    const rules = { parts: [{ text: "Hard rules:\n- Output ONLY the caption." }] };

    const sanitized = policies.buildGeminiProxyRequest(textPath, withSystem(rules));
    expect(sanitized?.systemInstruction).toEqual(rules);
    expect(sanitized?.safetySettings).toEqual(canonicalModelPolicy.safetySettings);

    // Absent stays valid: an installed client that predates the split sends
    // one text part and no system turn.
    const withoutSystem = {
      contents: withSystem(rules).contents,
      generationConfig: { maxOutputTokens: 2048 },
    };
    expect(policies.buildGeminiProxyRequest(textPath, withoutSystem)).toEqual(
      withServerSafety(withoutSystem),
    );
    expect(
      policies.buildGeminiProxyRequest(textPath, withoutSystem),
    ).not.toHaveProperty("systemInstruction");

    const maxChars = canonicalModelPolicy.requestLimits
      .maxSystemInstructionChars as number;
    expect(
      policies.buildGeminiProxyRequest(
        textPath,
        withSystem({ parts: [{ text: "r".repeat(maxChars) }] }),
      ),
      "a system instruction at the limit is accepted",
    ).not.toBeNull();
    expect(
      policies.buildGeminiProxyRequest(
        textPath,
        withSystem({ parts: [{ text: "r".repeat(maxChars + 1) }] }),
      ),
      "an oversized system instruction is rejected",
    ).toBeNull();
    expect(
      policies.buildGeminiProxyRequest(
        textPath,
        withSystem({
          parts: [{ text: "r".repeat(maxChars) }, { text: "r".repeat(maxChars) }],
        }),
      ),
      "the limit is the total across parts, not per part",
    ).toBeNull();

    const rejectedSystemInstructions = [
      null,
      "just a string",
      ["parts"],
      {},
      { parts: [] },
      { parts: [{ text: "" }] },
      { parts: [{ text: "   " }] },
      { parts: [{ text: 42 }] },
      { parts: [{ text: "ok", role: "system" }] },
      { parts: [inlineImage] },
      { parts: [{ text: "ok" }], role: "system" },
    ];
    for (const systemInstruction of rejectedSystemInstructions) {
      expect(
        policies.buildGeminiProxyRequest(textPath, withSystem(systemInstruction)),
        `should reject systemInstruction ${JSON.stringify(systemInstruction)}`,
      ).toBeNull();
    }

    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        systemInstruction: rules,
      }),
      "image models never accept a systemInstruction",
    ).toBeNull();
  });

  it("resolves structured output from a server-side schema registry only", () => {
    const withResponseFormat = (generationConfig: Record<string, unknown>) => ({
      contents: [{ parts: [{ text: "Return the review JSON" }] }],
      generationConfig: { maxOutputTokens: 2048, ...generationConfig },
    });

    // The registry the client codes against is the one the server implements.
    expect(policies.geminiResponseSchemaIds()).toEqual(
      canonicalModelPolicy.responseSchemaIds,
    );

    for (const schemaId of canonicalModelPolicy.responseSchemaIds as string[]) {
      const sanitized = policies.buildGeminiProxyRequest(
        textPath,
        withResponseFormat({ responseMimeType: "application/json", schemaId }),
      );
      const generationConfig = sanitized?.generationConfig as Record<string, unknown>;
      expect(generationConfig?.responseMimeType, schemaId).toBe("application/json");
      // The id is swapped for the server's own schema body and never forwarded.
      expect(generationConfig?.responseJsonSchema, schemaId).toEqual(
        policies.geminiResponseSchema(schemaId),
      );
      expect(generationConfig, schemaId).not.toHaveProperty("schemaId");
    }

    const rejectedGenerationConfigs: Array<Record<string, unknown>> = [
      // Unknown, misspelled, or prototype-shaped schema ids.
      { responseMimeType: "application/json", schemaId: "vision_review_v2" },
      { responseMimeType: "application/json", schemaId: "not_a_schema" },
      { responseMimeType: "application/json", schemaId: "" },
      { responseMimeType: "application/json", schemaId: 1 },
      { responseMimeType: "application/json", schemaId: null },
      { responseMimeType: "application/json", schemaId: "constructor" },
      { responseMimeType: "application/json", schemaId: "toString" },
      // Half a contract: an unbounded JSON ask, or a schema the model ignores.
      { responseMimeType: "application/json" },
      { schemaId: "vision_review_v1" },
      // Non-JSON mime types are not part of the contract.
      { responseMimeType: "text/plain", schemaId: "vision_review_v1" },
      {
        responseMimeType: "application/json; charset=utf-8",
        schemaId: "vision_review_v1",
      },
      // A schema BODY from the browser is never accepted, under either spelling.
      {
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" },
      },
      { responseMimeType: "application/json", responseSchema: { type: "object" } },
      {
        responseMimeType: "application/json",
        schemaId: "vision_review_v1",
        responseJsonSchema: { type: "object", additionalProperties: true },
      },
      {
        responseMimeType: "application/json",
        schemaId: "vision_review_v1",
        responseSchema: { type: "string" },
      },
      // Deprecated on Gemini 3.x (400 on the pinned models); still refused.
      { temperature: 0.8 },
      { topP: 0.9 },
      { topK: 32 },
      { candidateCount: 2 },
      {
        responseMimeType: "application/json",
        schemaId: "vision_review_v1",
        temperature: 0.8,
      },
    ];
    for (const generationConfig of rejectedGenerationConfigs) {
      expect(
        policies.buildGeminiProxyRequest(
          textPath,
          withResponseFormat(generationConfig),
        ),
        `should reject generationConfig ${JSON.stringify(generationConfig)}`,
      ).toBeNull();
    }

    expect(
      policies.buildGeminiProxyRequest(proImagePath, {
        ...imageRequest("2K"),
        generationConfig: {
          ...imageRequest("2K").generationConfig,
          responseMimeType: "application/json",
          schemaId: "vision_review_v1",
        },
      }),
      "image models never accept a response schema",
    ).toBeNull();

    expect(policies.geminiResponseSchema("vision_review_v1")).not.toBe(
      policies.geminiResponseSchema("vision_review_v1"),
    );
  });

  it("caps the Claude fallback at the text task's 2048-token contract", () => {
    const claudeRequest = (overrides: Record<string, unknown>) => ({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0.8,
      messages: [{ role: "user", content: [{ type: "text", text: "Caption this" }] }],
      ...overrides,
    });

    expect(policies.buildAnthropicMessageRequest(claudeRequest({}))).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
    });
    expect(
      policies.buildAnthropicMessageRequest(claudeRequest({ max_tokens: 2049 })),
    ).toBeNull();
    expect(
      policies.buildAnthropicMessageRequest(claudeRequest({ max_tokens: 0 })),
    ).toBeNull();
    // Every id the client advertises must be one the proxy accepts.
    for (const model of Object.values(CLAUDE_MODELS)) {
      expect(
        policies.buildAnthropicMessageRequest(claudeRequest({ model }))?.model,
      ).toBe(model);
    }
    expect(
      policies.buildAnthropicMessageRequest(
        claudeRequest({ model: "claude-sonnet-4-6" }),
      ),
    ).toBeNull();
  });

  it("admits exactly one bounded base64 photo on the Claude fallback", () => {
    const photo = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "ZmFrZS1waG90bw==" },
    };
    const text = { type: "text", text: "Caption this delivery" };
    const withContent = (content: unknown[]) => ({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0.8,
      system: "Dealer caption rules",
      messages: [{ role: "user", content }],
    });

    expect(policies.buildAnthropicMessageRequest(withContent([photo, text]))).toEqual({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0.8,
      system: "Dealer caption rules",
      messages: [{ role: "user", content: [photo, text] }],
    });
    for (const mediaType of ["image/png", "image/gif", "image/webp", "IMAGE/JPEG"]) {
      const block = { ...photo, source: { ...photo.source, media_type: mediaType } };
      expect(
        policies.buildAnthropicMessageRequest(withContent([block, text]))?.messages,
        `should accept ${mediaType}`,
      ).toEqual([
        {
          role: "user",
          content: [
            {
              ...photo,
              source: { ...photo.source, media_type: mediaType.toLowerCase() },
            },
            text,
          ],
        },
      ]);
    }

    const oversized = "A".repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4);
    const rejectedContents: unknown[][] = [
      [photo],
      [photo, photo, text],
      [{ ...photo, source: { ...photo.source, type: "url" } }, text],
      [{ ...photo, source: { ...photo.source, media_type: "image/heic" } }, text],
      [{ ...photo, source: { ...photo.source, data: "not base64!" } }, text],
      [{ ...photo, source: { ...photo.source, data: "abc" } }, text],
      [{ ...photo, source: { ...photo.source, data: oversized } }, text],
      [
        { ...photo, source: { ...photo.source, url: "https://example.com/a.jpg" } },
        text,
      ],
      [{ ...photo, cache_control: { type: "ephemeral" } }, text],
      [{ type: "document", source: photo.source }, text],
    ];
    for (const content of rejectedContents) {
      expect(
        policies.buildAnthropicMessageRequest(withContent(content)),
        `should reject ${JSON.stringify(content).slice(0, 120)}`,
      ).toBeNull();
    }
  });

  it("keeps the production hook wired to the tested policies", () => {
    const hookPath = resolve(process.cwd(), "pb_hooks/main.pb.js");
    const hook = readFileSync(hookPath, "utf8");

    expect(hook).toContain("policies.buildGeminiProxyRequest(");
    expect(hook).toContain("requestedGenerationTask");
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
    // The narrowing inputs are server-resolved: the scenario's own category,
    // the release/customer-story signal, and a count of posts a MANAGER
    // approved for the session's own person — never a field from the body,
    // and never a count the author can raise by posting.
    const approvalCall = hook.slice(
      hook.indexOf("policies.initialApprovalStatus(dealer, {"),
      hook.indexOf("let caption = helpers.assertString("),
    );
    expect(approvalCall).toContain(
      'category: approvalMapping ? approvalMapping.category : ""',
    );
    expect(approvalCall).toContain("releaseRequired ||");
    expect(approvalCall).toContain('approvalMapping.kind === "customer_story"');
    expect(approvalCall).toContain("{:dealer} AND salesperson_id = {:person} ");
    expect(approvalCall).toContain("AND approval_status = 'approved'");
    expect(approvalCall).toContain(
      "bind({ dealer: dealer.id, person: salespersonId })",
    );
    expect(approvalCall).not.toContain("body.");
    expect(hook).toContain("helpers.ensureAdminAccountProvisioned(");
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

  it("round-trips only the allowlisted dealership social-attribution fields", () => {
    const mutation = helpers.dealerMutationData(
      {
        facebook_page_tag: "Bob Maxey Ford of Howell",
        linkedin_company_tag: "bob-maxey-ford",
        attacker_field: "must not pass",
      },
      false,
      false,
    );
    // The Facebook Page tag is closed up so the mention can resolve; the
    // LinkedIn company name legitimately keeps its spacing.
    expect(mutation).toEqual({
      facebook_page_tag: "BobMaxeyFordofHowell",
      linkedin_company_tag: "bob-maxey-ford",
    });

    const serialized = helpers.serializeDealer({
      id: "dealer-record-id",
      getString: (field: string) =>
        ({
          name: "Example Dealer",
          facebook_page_tag: "Bob Maxey Ford of Howell",
          linkedin_company_tag: "bob-maxey-ford",
        })[field] || "",
      getBool: () => false,
    });
    expect(serialized).toMatchObject({
      facebook_page_tag: "Bob Maxey Ford of Howell",
      linkedin_company_tag: "bob-maxey-ford",
    });
    expect(() =>
      helpers.dealerMutationData({ facebook_page_tag: "x".repeat(101) }, false, false),
    ).toThrow("String exceeds maximum length of 100");
  });

  it("redacts personal access codes from every ordinary person DTO", () => {
    const values: Record<string, string> = {
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      pin: "4821",
      created_at: "2026-07-17T12:00:00.000Z",
    };
    values.signature_line = "Ask for Jamie";
    values.default_category = "deliveries";
    const serialized = helpers.serializePerson({
      id: "person-record-id",
      getString: (field: string) => values[field] || "",
      getBool: (field: string) =>
        field === "active" ||
        field === "pin_needs_distribution" ||
        field === "manager_scope",
    });

    expect(serialized).toMatchObject({
      id: "person-record-id",
      dealer: "dealer-record-id",
      name: "Jamie Rivera",
      role: "manager",
      active: true,
      hasPin: true,
      pinNeedsDistribution: true,
      managerScope: true,
      signatureLine: "Ask for Jamie",
      defaultCategory: "deliveries",
      playfulDefault: false,
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
      // Phase-1 profile settings ride along with the identity; they are
      // preferences and permissions, never credential material.
      managerScope: false,
      signatureLine: "",
      defaultCategory: "",
      playfulDefault: false,
    });
    expect(summary).not.toHaveProperty("pin");
    expect(summary).not.toHaveProperty("hasPin");
    expect(summary).not.toHaveProperty("pinNeedsDistribution");
    expect(summary).not.toHaveProperty("created_at");
  });

  it("fingerprints an admin account by its rotating credential token key", () => {
    const runtime: any = globalThis;
    const originalSecurity = runtime.$security;
    try {
      runtime.$security = {
        sha256: (value: string) =>
          value.endsWith("token-key-1") ? "a".repeat(64) : "b".repeat(64),
      };
      const account = (tokenKey: string) => ({
        id: "admin-account-1",
        getString: (field: string) => (field === "tokenKey" ? tokenKey : ""),
      });

      // A password change rotates the account token key, so the derived
      // fingerprint changes and previously bound sessions stop validating.
      expect(helpers.adminAuthFingerprint(account("token-key-1"))).not.toBe(
        helpers.adminAuthFingerprint(account("token-key-2")),
      );
      expect(helpers.adminAuthFingerprint(null)).toBe("");
    } finally {
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

  it("rechecks in-flight login bursts promptly without opening the hard limit", () => {
    const runtime = globalThis as any;
    const originalApp = runtime.$app;
    let age = 1000;
    let detail = "credential comparison reserved";
    try {
      runtime.$app = {
        dao: () => ({
          findRecordsByFilter: () =>
            Array.from({ length: 10 }, () => ({
              getString: (field: string) =>
                field === "created" ? new Date(Date.now() - age).toISOString() : detail,
            })),
        }),
      };
      expect(helpers.loginFailureState("203.0.113.20", 10, 900)).toMatchObject({
        count: 10,
        locked: true,
        retryAfterSeconds: 2,
      });
      age = 31_000;
      expect(
        helpers.loginFailureState("203.0.113.20", 10, 900).retryAfterSeconds,
      ).toBeGreaterThan(860);
      age = 1000;
      detail = "credential not recognized";
      expect(
        helpers.loginFailureState("203.0.113.20", 10, 900).retryAfterSeconds,
      ).toBeGreaterThan(890);
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
    expect(helpersSource).toContain("validateSuperAdminSession(source, dao)");
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

describe("brand-consistent creative foundations (phase 1)", () => {
  const dealerRecord = (values: Record<string, string>, bools: string[] = []) => ({
    id: "dealer-record-id",
    getString: (field: string) => values[field] || "",
    getBool: (field: string) => bools.includes(field),
  });

  it("accepts every new dealer field in its canonical shape", () => {
    const mutation = helpers.dealerMutationData(
      {
        signature_look: " showroom ",
        alternate_look: "",
        default_tone: "  Professional ",
        playful_style: "retro_comic",
        image_quality_tier: "studio",
        required_hashtags_locked: "true",
        requires_approval: false,
        brand_voice_do: ["  Warm,  local ", "", "Plain numbers"],
        brand_voice_dont: JSON.stringify(["No hype"]),
        motion_signature: { style: "Golden Radiance", aspects: ["9:16", "9:16"] },
        logo_placement: JSON.stringify({ corner: "bottom_right", scale: "0.1234" }),
        category_destinations: {
          deliveries: {
            platformIds: ["instagram_feed", "facebook_feed"],
            formatIds: ["feed_portrait", "story_vertical"],
            video: "true",
          },
          service: { platformIds: ["gbp"], formatIds: ["feed_portrait", "gbp"] },
        },
        approval_policy: { mode: "first_n", firstN: 3, categories: ["team"] },
        feature_permissions: {
          playful: { team: true, people: { abc123XYZ: false } },
          video: { team: false },
        },
        attacker_field: "must not pass",
      },
      false,
      false,
    );

    expect(mutation).toEqual({
      default_tone: "Professional",
      playful_style: "retro_comic",
      requires_approval: false,
      required_hashtags_locked: true,
      signature_look: "showroom",
      alternate_look: "",
      image_quality_tier: "studio",
      motion_signature: JSON.stringify({
        style: "Golden Radiance",
        aspects: ["9:16"],
        audio: "none",
      }),
      logo_placement: JSON.stringify({ corner: "bottom_right", scale: 0.123 }),
      brand_voice_do: JSON.stringify(["Warm, local", "Plain numbers"]),
      brand_voice_dont: JSON.stringify(["No hype"]),
      category_destinations: JSON.stringify({
        deliveries: {
          platformIds: ["instagram_feed", "facebook_feed"],
          formatIds: ["feed_portrait", "story_vertical"],
          video: true,
        },
        service: {
          platformIds: ["gbp"],
          formatIds: ["feed_portrait", "gbp"],
          video: false,
        },
      }),
      approval_policy: JSON.stringify({ mode: "first_n", firstN: 3 }),
      feature_permissions: JSON.stringify({
        playful: { team: true, people: { abc123XYZ: false } },
        video: { team: false, people: {} },
      }),
    });
    expect(mutation).not.toHaveProperty("attacker_field");

    // null / empty text clears a structured field instead of storing junk.
    expect(
      helpers.dealerMutationData(
        { motion_signature: null, logo_placement: " " },
        false,
        false,
      ),
    ).toEqual({ motion_signature: null, logo_placement: null });
  });

  it("rejects malformed brand-consistency values with safe field-prefixed messages", () => {
    const reject = (body: Record<string, unknown>, message: string) =>
      expect(() => helpers.dealerMutationData(body, false, false)).toThrow(message);

    reject(
      { signature_look: "neon" },
      "signature_look must be one of showroom, hometown, turbo",
    );
    reject(
      { image_quality_tier: "ultra" },
      "image_quality_tier must be one of standard, studio",
    );
    reject(
      { required_hashtags_locked: "maybe" },
      "required_hashtags_locked must be true or false",
    );
    reject({ default_tone: "x".repeat(41) }, "String exceeds maximum length of 40");
    reject({ playful_style: "x".repeat(81) }, "String exceeds maximum length of 80");
    reject(
      { brand_voice_do: ["a", "b", "c", "d"] },
      "brand_voice_do may list at most 3 phrases",
    );
    reject(
      { brand_voice_dont: ["x".repeat(61)] },
      "brand_voice_dont phrases must be 60 characters or fewer",
    );
    reject({ brand_voice_do: "not json" }, "brand_voice_do must be valid JSON");
    reject({ brand_voice_do: { a: 1 } }, "brand_voice_do must be a list of phrases");
    reject({ brand_voice_do: [42] }, "brand_voice_do must be a list of phrases");
    reject({ motion_signature: 7 }, "motion_signature must be valid JSON");
    reject({ motion_signature: [] }, "motion_signature has an invalid shape");
    reject(
      { motion_signature: { style: "" } },
      "motion_signature style must be 1-40 characters",
    );
    reject(
      { motion_signature: { style: "Spotlight", aspects: ["1:1"] } },
      "motion_signature aspects contains an unsupported value",
    );
    reject(
      { motion_signature: { style: "Spotlight", audio: "dubstep" } },
      "motion_signature audio must be one of none, celebration, cinematic, anthemic, funk",
    );
    reject(
      { logo_placement: { corner: "center", scale: 0.1 } },
      "logo_placement corner must be one of top_left, top_right, bottom_left, bottom_right",
    );
    reject(
      { logo_placement: { corner: "top_left", scale: 0.9 } },
      "logo_placement scale must be between 0.04 and 0.5",
    );
    reject(
      { category_destinations: { hot_cars: { platformIds: [] } } },
      "category_destinations contains an unknown category",
    );
    reject(
      { category_destinations: { team: { platformIds: ["myspace"] } } },
      "category_destinations platformIds contains an unsupported value",
    );
    reject(
      { category_destinations: { team: { formatIds: ["billboard"] } } },
      "category_destinations formatIds contains an unsupported value",
    );
    reject(
      { approval_policy: { mode: "sometimes" } },
      "approval_policy mode must be one of",
    );
    reject(
      { approval_policy: { mode: "first_n", firstN: 0 } },
      "approval_policy firstN must be a whole number from 1 to 100",
    );
    reject(
      { approval_policy: { mode: "per_category", categories: ["hot_cars"] } },
      "approval_policy categories contains an unsupported value",
    );
    reject(
      { feature_permissions: { surpriseMe: { team: true } } },
      "feature_permissions contains an unknown feature",
    );
    reject(
      { feature_permissions: { video: { team: "yes" } } },
      "feature_permissions team must be true or false",
    );
    reject(
      { feature_permissions: { video: { people: { "bad id!": true } } } },
      "feature_permissions has an invalid person id",
    );
    reject(
      { category_destinations: "{".repeat(9000) },
      "category_destinations is too large",
    );

    // The safe-error filter passes these validator messages through verbatim
    // and still hides anything it does not recognise.
    expect(
      helpers.safeDealerMutationError(
        new Error(
          "approval_policy mode must be one of none, first_n, always, per_category",
        ),
      ),
    ).toBe("approval_policy mode must be one of none, first_n, always, per_category");
    expect(helpers.safeDealerMutationError(new Error("sqlite: disk I/O error"))).toBe(
      "Failed to save dealer",
    );
  });

  it("serializes the brand-consistency fields into the session dealer payload", () => {
    const stored = helpers.serializeDealer(
      dealerRecord(
        {
          name: "Example Dealer",
          signature_look: "hometown",
          alternate_look: "turbo",
          default_tone: "Family",
          playful_style: "retro_comic",
          image_quality_tier: "standard",
          motion_signature: JSON.stringify({
            style: "Spotlight",
            aspects: ["9:16"],
            audio: "celebration",
          }),
          logo_placement: JSON.stringify({ corner: "bottom_right", scale: 0.12 }),
          brand_voice_do: JSON.stringify(["Warm", 7, "Local"]),
          brand_voice_dont: "null",
          category_destinations: JSON.stringify({
            team: {
              platformIds: ["linkedin"],
              formatIds: ["feed_square"],
              video: false,
            },
          }),
          approval_policy: "{not json",
          feature_permissions: "",
        },
        ["required_hashtags_locked"],
      ),
    );

    expect(stored).toMatchObject({
      signature_look: "hometown",
      alternate_look: "turbo",
      default_tone: "Family",
      playful_style: "retro_comic",
      image_quality_tier: "standard",
      required_hashtags_locked: true,
      motion_signature: { style: "Spotlight", aspects: ["9:16"], audio: "celebration" },
      logo_placement: { corner: "bottom_right", scale: 0.12 },
      brand_voice_do: ["Warm", "Local"],
      brand_voice_dont: [],
      category_destinations: {
        team: { platformIds: ["linkedin"], formatIds: ["feed_square"], video: false },
      },
      approval_policy: null,
      feature_permissions: null,
    });

    const unset = helpers.serializeDealer(dealerRecord({ name: "Fresh Dealer" }));
    expect(unset).toMatchObject({
      signature_look: "",
      alternate_look: "",
      default_tone: "",
      playful_style: "",
      image_quality_tier: "",
      required_hashtags_locked: false,
      motion_signature: null,
      logo_placement: null,
      brand_voice_do: [],
      brand_voice_dont: [],
      category_destinations: null,
      approval_policy: null,
      feature_permissions: null,
    });
  });

  it("gates manager_scope behind manager roles and validates person profile fields", () => {
    expect(
      helpers.personProfileMutationData(
        {
          signature_line: "  Ask for\nJamie  ",
          default_category: " deliveries ",
          playful_default: "true",
          manager_scope: true,
          pin: "1234",
          role: "manager",
        },
        "dealer_admin",
      ),
    ).toEqual({
      signature_line: "Ask for Jamie",
      default_category: "deliveries",
      playful_default: true,
      manager_scope: true,
    });
    expect(
      helpers.personProfileMutationData({ manager_scope: "false" }, "super_admin"),
    ).toEqual({ manager_scope: false });
    expect(helpers.personProfileMutationData({}, "salesperson")).toEqual({});
    expect(
      helpers.personProfileMutationData(
        { signature_line: "", default_category: null },
        "x",
      ),
    ).toEqual({ signature_line: "", default_category: "" });

    expect(() =>
      helpers.personProfileMutationData({ manager_scope: true }, "salesperson"),
    ).toThrow("MANAGER_SCOPE_FORBIDDEN");
    expect(() =>
      helpers.personProfileMutationData({ manager_scope: true }, ""),
    ).toThrow("MANAGER_SCOPE_FORBIDDEN");
    expect(() =>
      helpers.personProfileMutationData(
        { signature_line: "x".repeat(141) },
        "dealer_admin",
      ),
    ).toThrow("signature_line must be 140 characters or fewer");
    expect(() =>
      helpers.personProfileMutationData(
        { default_category: "x".repeat(41) },
        "dealer_admin",
      ),
    ).toThrow("default_category must be 40 characters or fewer");
    expect(() =>
      helpers.personProfileMutationData(
        { playful_default: "sometimes" },
        "dealer_admin",
      ),
    ).toThrow("playful_default must be true or false");

    expect(
      helpers.personProfileErrorPayload(new Error("MANAGER_SCOPE_FORBIDDEN")),
    ).toEqual({
      status: 403,
      body: {
        error: "MANAGER_SCOPE_FORBIDDEN",
        code: "MANAGER_SCOPE_FORBIDDEN",
        message: "Only a manager can change manager scope.",
      },
    });
    expect(
      helpers.personProfileErrorPayload(
        new Error("signature_line must be 140 characters or fewer"),
      ),
    ).toEqual({
      status: 400,
      body: {
        error: "PERSON_PROFILE_INVALID",
        code: "PERSON_PROFILE_INVALID",
        message: "signature_line must be 140 characters or fewer",
      },
    });
  });

  it("wires the person profile fields through the manager people routes", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const createRoute = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/salespeople"'),
      hook.indexOf('routerAdd("PATCH", "/api/app/salespeople/:id"'),
    );
    const patchRoute = hook.slice(
      hook.indexOf('routerAdd("PATCH", "/api/app/salespeople/:id"'),
      hook.indexOf('routerAdd("PUT", "/api/app/salespeople/:id/manager-login"'),
    );

    for (const route of [createRoute, patchRoute]) {
      expect(route).toContain(
        'context.role !== "dealer_admin" && context.role !== "super_admin"',
      );
      expect(route).toContain("helpers.personProfileMutationData(body, context.role)");
      expect(route).toContain("helpers.personProfileErrorPayload(profileErr)");
      expect(route).toContain("c.json(failure.status, failure.body)");
    }
    expect(createRoute).toContain(
      "record.set(profileFields[i], profile[profileFields[i]])",
    );
    // The PATCH write happens on the transactional row, after the ownership
    // check and before the audited save.
    expect(patchRoute.indexOf('throw new Error("PERSON_EDIT_FORBIDDEN")')).toBeLessThan(
      patchRoute.indexOf("txPerson.set(profileFields[i], profile[profileFields[i]])"),
    );
    expect(
      patchRoute.indexOf("txPerson.set(profileFields[i], profile[profileFields[i]])"),
    ).toBeLessThan(patchRoute.indexOf("txDao.saveRecord(txPerson)"));
    // Only main.pb.js people routes may write these; nothing bypasses the helper.
    expect(hook).not.toContain("body.manager_scope");
    expect(hook).not.toContain("body.signature_line");
  });
});

describe("generation usage accounting and stale-client rejection (Gemini P0-1, P0-6)", () => {
  const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
  const helpersSource = readFileSync(
    resolve(process.cwd(), "pb_hooks/helpers.js"),
    "utf8",
  );
  const currentVersion = String(canonicalModelPolicy.version);
  const requestInfo = (headers: Record<string, string>) => ({
    method: "POST",
    headers,
    data: {},
  });
  const proxyHandler = hook.slice(
    hook.indexOf("const proxyHandler = (c) => {"),
    hook.indexOf('routerAdd("POST", "/api/proxy/openai/v1/images/generations"'),
  );
  const textIdentity = {
    task: "caption",
    kind: "text",
    tier: "quality",
    provider: "gemini",
    model: "gemini-3.6-flash",
    modelPolicyVersion: currentVersion,
  };

  it("answers a stale X-Model-Policy-Version with a distinct 409 before body validation", () => {
    expect(
      helpers.proxyPolicyVersionMismatch(
        requestInfo({ "x-model-policy-version": "1" }),
        policies,
      ),
    ).toEqual({ mismatch: true, currentVersion });
    expect(
      helpers.proxyPolicyVersionMismatch(
        requestInfo({ "X-Model-Policy-Version": ` ${currentVersion} ` }),
        policies,
      ),
    ).toEqual({ mismatch: false, currentVersion });
    // Legacy clients without the header keep their existing handling.
    expect(helpers.proxyPolicyVersionMismatch(requestInfo({}), policies)).toEqual({
      mismatch: false,
      currentVersion,
    });

    const mismatchAt = proxyHandler.indexOf("helpers.proxyPolicyVersionMismatch(");
    const validationAt = proxyHandler.indexOf("policies.buildGeminiProxyRequest(");
    expect(mismatchAt).toBeGreaterThan(-1);
    expect(mismatchAt).toBeLessThan(validationAt);
    expect(proxyHandler).toContain("return c.json(409, {");
    expect(proxyHandler).toContain('error: "POLICY_VERSION_MISMATCH"');
    expect(proxyHandler).toContain('code: "POLICY_VERSION_MISMATCH"');
    expect(proxyHandler).toContain("currentVersion: policyVersionCheck.currentVersion");
  });

  it("labels usage by purpose with kind-scoped defaults and an allowlist", () => {
    const identity = helpers.proxyGenerationIdentity(
      textPath,
      requestInfo({
        "x-generation-task": "caption_regenerate",
        "x-model-policy-version": currentVersion,
      }),
      policies,
      "gemini",
      "",
    );
    expect(identity).toMatchObject({ task: "caption_regenerate", kind: "text" });

    const purpose = (headers: Record<string, string>, kind: string) =>
      helpers.proxyGenerationPurpose(requestInfo(headers), kind);
    expect(purpose({}, "text")).toBe("caption");
    expect(purpose({ "x-generation-purpose": "vision_review" }, "text")).toBe(
      "vision_review",
    );
    expect(purpose({ "X-Generation-Purpose": " Caption_Pack " }, "text")).toBe(
      "caption_pack",
    );
    expect(purpose({ "x-generation-purpose": "website_draft" }, "text")).toBe(
      "website_draft",
    );
    expect(purpose({}, "image")).toBe("image");
    expect(purpose({}, "video")).toBe("video");
    // Unknown values and cross-kind labels fall back to the kind default.
    expect(purpose({ "x-generation-purpose": "drop table" }, "text")).toBe("caption");
    expect(purpose({ "x-generation-purpose": "caption" }, "image")).toBe("image");
    expect(purpose({ "x-generation-purpose": "vision_review" }, "video")).toBe("video");
    expect(helpers.GENERATION_PURPOSES).toEqual([
      "caption",
      "vision_review",
      "caption_pack",
      "website_draft",
      "image",
      "video",
    ]);
  });

  it("extracts token counters, finishReason, latency, and billable request facts defensively", () => {
    const usage = helpers.proxyGenerationUsage(
      textIdentity,
      requestInfo({ "x-generation-purpose": "vision_review" }),
      {
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "Never stored" }] } },
        ],
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: "80",
          thoughtsTokenCount: 33.7,
          cachedContentTokenCount: 1024,
        },
      },
      { latencyMs: 812.4, imageSize: "2K", videoSeconds: 8 },
    );
    expect(usage).toEqual({
      prompt_tokens: 1200,
      candidate_tokens: 80,
      thoughts_tokens: 33,
      cached_tokens: 1024,
      finish_reason: "STOP",
      latency_ms: 812,
      purpose: "vision_review",
      image_size: "",
      video_seconds: 0,
    });
    expect(JSON.stringify(usage)).not.toContain("Never stored");

    const imageIdentity = {
      ...textIdentity,
      task: "image_studio",
      kind: "image",
      model: "gemini-3-pro-image",
    };
    expect(
      helpers.proxyGenerationUsage(
        imageIdentity,
        requestInfo({}),
        { candidates: [{ finishReason: "IMAGE_SAFETY" }] },
        { latencyMs: 4200, imageSize: "2K", videoSeconds: 8 },
      ),
    ).toMatchObject({
      finish_reason: "IMAGE_SAFETY",
      image_size: "2K",
      purpose: "image",
      video_seconds: 0,
      latency_ms: 4200,
    });
    const videoIdentity = {
      ...textIdentity,
      task: "video_standard",
      kind: "video",
      model: "veo-3.1-generate-preview",
    };
    expect(
      helpers.proxyGenerationUsage(
        videoIdentity,
        requestInfo({}),
        { name: "operations/abc" },
        { latencyMs: 950, imageSize: "2K", videoSeconds: 8 },
      ),
    ).toMatchObject({
      purpose: "video",
      video_seconds: 8,
      image_size: "",
      finish_reason: "",
    });

    // Malformed provider bodies and hostile values never throw; they coerce
    // to zero/empty so the base event is still recorded.
    const empty = {
      prompt_tokens: 0,
      candidate_tokens: 0,
      thoughts_tokens: 0,
      cached_tokens: 0,
      finish_reason: "",
      latency_ms: 0,
      purpose: "caption",
      image_size: "",
      video_seconds: 0,
    };
    for (const payload of [
      null,
      undefined,
      "not json",
      [],
      42,
      { usageMetadata: "x", candidates: "y" },
      {
        candidates: [null],
        usageMetadata: {
          promptTokenCount: -5,
          candidatesTokenCount: "NaN",
          thoughtsTokenCount: Infinity,
          cachedContentTokenCount: {},
        },
      },
    ]) {
      expect(
        helpers.proxyGenerationUsage(textIdentity, requestInfo({}), payload, null),
      ).toEqual(empty);
    }
    const hostile = helpers.proxyGenerationUsage(
      textIdentity,
      requestInfo({}),
      {
        candidates: [{ finishReason: "<script>STOP</script>".repeat(5) }],
        usageMetadata: { promptTokenCount: 1e12 },
      },
      { latencyMs: -1, imageSize: "../etc" },
    );
    expect(hostile.finish_reason).toHaveLength(40);
    expect(hostile.finish_reason).toMatch(/^[A-Za-z0-9_]+$/);
    expect(hostile).toMatchObject({ prompt_tokens: 100000000, latency_ms: 0 });
  });

  it("times the upstream call and threads request facts into every ledger write", () => {
    expect(proxyHandler).toContain("const upstreamStartedAt = Date.now();");
    expect(proxyHandler).toContain(
      "generationUsage.latencyMs = Math.max(0, Date.now() - upstreamStartedAt);",
    );
    expect(proxyHandler).toContain(
      "generationUsage.imageSize = String(imageConfig.imageSize);",
    );
    expect(proxyHandler).toContain(
      "generationUsage.videoSeconds = Number(videoParameters.durationSeconds) || 0;",
    );
    const ledgerWrites =
      proxyHandler.match(/helpers\.recordProxyGenerationEvent\([\s\S]*?\);/g) ?? [];
    expect(ledgerWrites.length).toBeGreaterThanOrEqual(5);
    for (const call of ledgerWrites) expect(call).toContain("generationUsage,");
    // Facts come from the sanitized upstream body, never the raw client body.
    expect(proxyHandler).not.toContain("requestInfo.data.generationConfig");
    expect(proxyHandler).not.toContain("requestInfo.data.parameters");
    expect(helpersSource).toContain("function proxyGenerationUsage(");
    expect(helpersSource).toContain("...(usageFields || {}),");
    expect(helpersSource).toContain(
      'proxyRequestHeader(requestInfo, "x-generation-purpose")',
    );
  });

  it("exposes bounded per-dealer 7-day usage in the admin health branch only", () => {
    const health = hook.slice(
      hook.indexOf('routerAdd("GET", "/api/app/health"'),
      hook.indexOf("// Env presence (booleans only"),
    );
    const firstAdminGate = health.indexOf("if (isAuthedAdmin) {");
    expect(firstAdminGate).toBeGreaterThan(-1);
    expect(health.indexOf("result.usage = {")).toBeGreaterThan(firstAdminGate);
    expect(
      health.indexOf("result.usage = helpers.generationUsageSummary(7);"),
    ).toBeGreaterThan(firstAdminGate);
    expect(helpersSource).toContain("function generationUsageSummary(");
    expect(helpersSource).toContain("GENERATION_USAGE_SUMMARY_MAX_DEALERS = 50");
    expect(helpersSource).toContain("GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS = 5000");
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );
    expect(pkg.scripts["format:check:backend"]).toContain('"pb_migrations/175160*.js"');
    expect(pkg.scripts["format:backend"]).toContain('"pb_migrations/175160*.js"');
  });

  it("aggregates per-dealer usage with nearest-rank latency percentiles", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const previous = { $app: g.$app, arrayOf: g.arrayOf, DynamicModel: g.DynamicModel };
    const queries: string[] = [];
    const rowsFor = (sql: string): Array<Record<string, unknown>> => {
      if (sql.includes("LEFT JOIN dealers")) {
        return [
          {
            dealer: "d1",
            name: "Bob Maxey Ford of Howell",
            events: 4,
            succeeded: 3,
            promptTokens: 1000,
            candidateTokens: 200,
            thoughtsTokens: 50,
            cachedTokens: 400,
            videoSeconds: 8,
          },
          {
            dealer: "d2",
            name: "",
            events: 1,
            succeeded: 1,
            promptTokens: 10,
            candidateTokens: 5,
            thoughtsTokens: 0,
            cachedTokens: 0,
            videoSeconds: 0,
          },
        ];
      }
      if (sql.includes("image_size AS size")) {
        return [
          { dealer: "d1", size: "2K", count: 2 },
          { dealer: "d1", size: "1K", count: 1 },
          { dealer: "ghost", size: "4K", count: 9 },
        ];
      }
      if (sql.includes("latency_ms AS latency")) {
        return [
          ...[100, 200, 300, 400, 5000].map((latency) => ({ dealer: "d1", latency })),
          { dealer: "d2", latency: 750 },
          { dealer: "ghost", latency: 1 },
        ];
      }
      throw new Error("unexpected query " + sql);
    };
    g.DynamicModel = function DynamicModel(shape: unknown) {
      return shape;
    };
    g.arrayOf = () => [] as unknown[];
    g.$app = {
      dao: () => ({
        db: () => ({
          newQuery: (sql: string) => {
            queries.push(sql);
            return {
              bind: (params: Record<string, unknown>) => {
                expect(typeof params.since).toBe("string");
                return {
                  all: (target: unknown[]) => {
                    target.push(...rowsFor(sql));
                  },
                };
              },
            };
          },
        }),
      }),
    };
    try {
      const summary = helpers.generationUsageSummary(7);
      expect(summary.windowDays).toBe(7);
      expect(summary.truncated).toBe(false);
      expect(summary.dealers).toEqual([
        {
          dealer: "d1",
          name: "Bob Maxey Ford of Howell",
          events: 4,
          succeeded: 3,
          tokens: {
            prompt: 1000,
            candidate: 200,
            thoughts: 50,
            cached: 400,
            total: 1650,
          },
          images: { "2K": 2, "1K": 1 },
          videoSeconds: 8,
          latencyMs: { p50: 300, p95: 5000, samples: 5 },
        },
        {
          dealer: "d2",
          name: "",
          events: 1,
          succeeded: 1,
          tokens: { prompt: 10, candidate: 5, thoughts: 0, cached: 0, total: 15 },
          images: {},
          videoSeconds: 0,
          latencyMs: { p50: 750, p95: 750, samples: 1 },
        },
      ]);
      expect(queries).toHaveLength(3);
      for (const sql of queries) expect(sql).toMatch(/LIMIT \d+$/);
      // No prompt, caption, or media column is ever selected.
      for (const sql of queries) expect(sql).not.toMatch(/prompt\b|caption|inline/i);
    } finally {
      g.$app = previous.$app;
      g.arrayOf = previous.arrayOf;
      g.DynamicModel = previous.DynamicModel;
    }
  });
});

describe("vision-QC review is its own generation task (Gemini P0-2)", () => {
  const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
  const migration = readFileSync(
    resolve(process.cwd(), "pb_migrations/1751700000_vision_review_task.js"),
    "utf8",
  );
  const currentVersion = String(canonicalModelPolicy.version);
  const textPath = "v1beta/models/gemini-3.6-flash:generateContent";
  const visionReview = canonicalModelPolicy.tasks.vision_review as {
    kind: string;
    tier: string;
    models: string[];
    maxOutputTokens: number;
    thinkingLevel: string;
  };

  it("is the only text task that pays for medium reasoning", () => {
    // Thinking tokens bill as output tokens, so this split is a cost
    // contract: the QC read decides whether a flawed render ships, every
    // caption does not.
    expect(visionReview).toMatchObject({
      kind: "text",
      maxOutputTokens: 2048,
      thinkingLevel: "medium",
    });
    const mediumTextTasks = Object.entries(canonicalModelPolicy.tasks)
      .filter(
        ([, task]) =>
          (task as { kind: string; thinkingLevel?: string }).kind === "text" &&
          (task as { thinkingLevel?: string }).thinkingLevel === "medium",
      )
      .map(([name]) => name);
    expect(mediumTextTasks).toEqual(["vision_review"]);
  });

  it("accepts a vision_review request and records it as a review, not a caption", () => {
    const request = {
      contents: [
        {
          parts: [
            { text: "IMAGE 1: GENERATED OUTPUT IMAGE\n\nReview this render." },
            inlineImage,
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: visionReview.maxOutputTokens,
        thinkingConfig: { thinkingLevel: visionReview.thinkingLevel },
      },
    };
    expect(
      policies.buildGeminiProxyRequest(textPath, request, "vision_review"),
    ).toMatchObject({
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "medium" },
      },
      safetySettings: canonicalModelPolicy.safetySettings,
    });

    // The proxy must attribute the event to vision_review rather than
    // silently falling back to `caption`, or the ledger keeps over-counting
    // captions exactly as it did before the split.
    expect(
      helpers.proxyGenerationIdentity(
        textPath,
        {
          method: "POST",
          headers: {
            "x-generation-task": "vision_review",
            "x-model-policy-version": currentVersion,
          },
          data: {},
        },
        policies,
        "gemini",
        "",
      ),
    ).toMatchObject({ task: "vision_review", kind: "text", tier: "quality" });
  });

  it("never lets a QC review stand in as the AI caption's provenance", () => {
    const captionTasks = hook.slice(
      hook.indexOf("const captionTasks = {"),
      hook.indexOf("const imageTasks = {"),
    );
    expect(captionTasks).toContain("caption: true");
    expect(captionTasks).toContain("caption_regenerate: true");
    expect(captionTasks).toContain("caption_edit: true");
    expect(captionTasks).toContain("vision_review: false");
  });

  it("extends the generation_events task enum idempotently, with a real rollback", () => {
    // `task` is a select field: without the schema value, every recorded
    // review would fail validation on write and vanish from the ledger.
    expect(migration).toContain('"vision_review"');
    expect(migration).toContain("generation_events");
    expect(migration).toContain("values.indexOf(NEW_TASK_VALUE) !== -1) return");
    // The rollback refuses to orphan rows that already use the value.
    expect(migration).toContain("stillInUse");
    expect(migration).toContain("values.splice(index, 1)");

    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain("pb_migrations/175170*.js");
  });

  it("advertises optional proxy capabilities on every session payload and on health", () => {
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    expect(helpers).toMatch(
      /const PROXY_CAPABILITIES = Object\.freeze\(\{[^}]*veoNegativePrompt: true,[^}]*\}\);/,
    );
    expect(helpers).toContain("\n  PROXY_CAPABILITIES,\n");
    // Session and health payloads stay in main; Connections has its own gated adapter.
    expect(hook.match(/capabilities: helpers\.PROXY_CAPABILITIES,/g)).toHaveLength(5);
    const connections = readFileSync(
      resolve(process.cwd(), "pb_hooks/connectionRoutes.js"),
      "utf8",
    );
    expect(connections).toContain("capabilities: helpers().PROXY_CAPABILITIES,");
    expect(hook).toContain(
      "apiContractVersion: helpers.API_CONTRACT_VERSION,\n    capabilities: helpers.PROXY_CAPABILITIES,",
    );
    // The client sends the optional Veo field only when advertised and re-issues
    // a start only for the proxy's own pre-upstream validation body.
    const service = readFileSync(
      resolve(process.cwd(), "services/geminiService.ts"),
      "utf8",
    );
    expect(service).toContain("proxyCapabilities().veoNegativePrompt === true");
    expect(service).toContain("...(includeNegativePrompt ? { negativePrompt } : {})");
    expect(service).toContain("isProxyValidationRejection(response.status, text)");
    const proxy = readFileSync(
      resolve(process.cwd(), "services/geminiProxy.ts"),
      "utf8",
    );
    expect(proxy).toContain(
      'PROXY_VALIDATION_REJECTION = "Invalid or unsupported generation request"',
    );
    expect(hook).toContain('error: "Invalid or unsupported generation request"');
  });
});
