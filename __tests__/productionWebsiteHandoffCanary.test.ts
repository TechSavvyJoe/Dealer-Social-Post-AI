import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCurrentImageProvenance,
  assertNoUncertainImageRequest,
  assertNotRequested,
  buildSyntheticDrafts,
  canonicalHubOrigin,
  canonicalProductionOrigin,
  createDraftForm,
  createPostForm,
  generateWebsiteCanaryImage,
  extractHubDraftId,
  injectSyntheticJpegMetadata,
  jpegApplicationMarkers,
  nextMinuteBoundaryWaitMs,
  preflightSyntheticCanaryDestination,
  validateReadyPublication,
  validateRevisionContractSource,
  verifyHubPrivacyBoundary,
  verifyOwnerPurgeReceipt,
} from "../scripts/production-website-handoff-canary.mjs";

const scriptPath = resolve(
  process.cwd(),
  "scripts/production-website-handoff-canary.mjs",
);
const backendPath = resolve(process.cwd(), "pb_hooks/main.pb.js");
const syntheticImagePath = resolve(
  process.cwd(),
  "docs/marketing/demo/synthetic-delivery-photo.jpg",
);

describe("production website handoff canary", () => {
  it("validates its local synthetic-media and revision-guard contract offline", () => {
    expect(
      execFileSync(process.execPath, [scriptPath, "--contract-check"], {
        encoding: "utf8",
      }),
    ).toContain("Website handoff canary contract is valid");
  });

  const policy = JSON.parse(
    readFileSync(resolve(process.cwd(), "config/gemini-model-policy.json"), "utf8"),
  );
  const imageConfirmation = "one-paid-image-from-reviewed-synthetic-source";
  const generatedPng = () => {
    const bytes = Buffer.alloc(2048);
    Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
    bytes.writeUInt32BE(1856, 16);
    bytes.writeUInt32BE(2304, 20);
    return bytes;
  };

  it("generates once from the reviewed source and saves unchanged output with its exact app attempt", async () => {
    const source = readFileSync(syntheticImagePath);
    const output = generatedPng();
    const imageAttemptId = "a".repeat(40);
    const requests: { path: string; options: RequestInit }[] = [];
    const client = {
      request: async (path: string, options: RequestInit) => {
        requests.push({ path, options });
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: output.toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        });
      },
    };
    const generated = await generateWebsiteCanaryImage(
      client,
      policy,
      source,
      imageAttemptId,
      imageConfirmation,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe(
      "/api/proxy/v1beta/models/gemini-3-pro-image:generateContent",
    );
    expect(requests[0].options.method).toBe("POST");
    expect(requests[0].options.headers).toMatchObject({
      "X-Generation-Task": "image_standard",
      "X-Generation-Attempt-ID": imageAttemptId,
      "X-Model-Policy-Version": "5",
    });
    const body = JSON.parse(requests[0].options.body as string);
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/jpeg",
      data: source.toString("base64"),
    });
    expect(body.generationConfig).toMatchObject({
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: "2K", aspectRatio: "4:5" },
      maxOutputTokens: 4096,
    });
    expect(generated.imageBytes).toEqual(output);
    expect(generated.evidence).toMatchObject({
      width: 1856,
      height: 2304,
      byteCount: 2048,
      outputSha256: createHash("sha256").update(output).digest("hex"),
      outputBase64Sha256: createHash("sha256")
        .update(output.toString("base64"))
        .digest("hex"),
    });
    const form = createPostForm(
      generated.imageBytes,
      buildSyntheticDrafts("QA-01234567-89ab").initial,
      generated.imageMimeType,
      generated.imageAttemptId,
    );
    const upload = form.get("creative_image") as File;
    expect(upload.type).toBe("image/png");
    const uploadedBytes = await new Promise<ArrayBuffer>((done, reject) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(upload);
    });
    expect(Buffer.from(uploadedBytes)).toEqual(output);
    expect(form.get("image_attempt_id")).toBe(imageAttemptId);
    expect(form.get("platform_ids")).toBe("[]");
    for (const untrustedField of [
      "model_policy_version",
      "generation_tier",
      "generation_model",
      "image_policy_verified",
    ])
      expect(form.has(untrustedField)).toBe(false);
  });

  it("requires the operator paid-image confirmation and original source hash before requesting", async () => {
    let count = 0;
    const client = {
      request: async () => {
        count += 1;
        return Response.json({});
      },
    };
    const source = readFileSync(syntheticImagePath);
    await expect(
      generateWebsiteCanaryImage(client, policy, source, "a".repeat(40), ""),
    ).rejects.toMatchObject({ code: "IMAGE_CONFIRMATION_REQUIRED" });
    await expect(
      generateWebsiteCanaryImage(
        client,
        policy,
        injectSyntheticJpegMetadata(source),
        "a".repeat(40),
        imageConfirmation,
      ),
    ).rejects.toMatchObject({ code: "SYNTHETIC_ASSET_CHANGED" });
    expect(count).toBe(0);
  });

  it("never retries an uncertain paid request and refuses a later run until it is resolved", async () => {
    for (const response of [
      new Error("connection lost"),
      Response.json({}, { status: 502 }),
      new Response("invalid json", { status: 200 }),
    ]) {
      let count = 0;
      const client = {
        request: async () => {
          count += 1;
          if (response instanceof Error) throw response;
          return response;
        },
      };
      await expect(
        generateWebsiteCanaryImage(
          client,
          policy,
          readFileSync(syntheticImagePath),
          "a".repeat(40),
          imageConfirmation,
        ),
      ).rejects.toMatchObject({ code: "IMAGE_REQUEST_UNCERTAIN" });
      expect(count).toBe(1);
    }
    for (const status of ["request_in_flight", "uncertain"])
      expect(() =>
        assertNoUncertainImageRequest({ checks: { imageGeneration: { status } } }),
      ).toThrow(expect.objectContaining({ code: "IMAGE_REQUEST_UNCERTAIN_BLOCKED" }));
    expect(() =>
      assertNoUncertainImageRequest({
        checks: { imageGeneration: { status: "completed" } },
      }),
    ).not.toThrow();
  });

  it("requires clear current server image and identity review gates before Send", () => {
    for (const value of [
      {},
      { image_review_required: false, identity_review_required: false, lastError: "" },
    ])
      expect(() => assertCurrentImageProvenance(value, "Save")).not.toThrow();
    for (const value of [
      { image_review_required: true },
      { image_review_required: "true" },
      { identity_review_required: true },
      { lastError: "image_review_required" },
    ])
      expect(() => assertCurrentImageProvenance(value, "Save")).toThrow(
        expect.objectContaining({ code: "IMAGE_PROVENANCE_NOT_READY" }),
      );
    const source = readFileSync(scriptPath, "utf8");
    const runStart = source.indexOf("async function runLockedCanary()");
    const runSource = source.slice(
      runStart,
      source.indexOf("\nexport async function verifyHubPrivacyBoundary(", runStart),
    );
    expect(
      runSource.indexOf("assertCurrentImageProvenance(presendStatus"),
    ).toBeLessThan(runSource.indexOf("const sendPath ="));
    expect(runSource).not.toContain("injectSyntheticJpegMetadata");
    expect(source.indexOf("const imageConfirmation = requireEnv")).toBeLessThan(
      source.indexOf("await writeEvidence(evidencePath, evidence)"),
    );
  });

  it("reproduces EXIF-without-Orientation and Photoshop metadata on synthetic JPEG only", () => {
    const source = readFileSync(syntheticImagePath);
    const wrapped = injectSyntheticJpegMetadata(source);

    expect(wrapped.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(wrapped.subarray(-32)).toEqual(source.subarray(-32));
    expect(wrapped.length).toBe(source.length + 42);
    expect(jpegApplicationMarkers(wrapped)).toEqual(
      expect.arrayContaining([0xe1, 0xed]),
    );
    // The injected TIFF IFD declares zero entries, so no Orientation tag is
    // present in the metadata edge case being exercised.
    expect(wrapped.readUInt16LE(20)).toBe(0);
  });

  it("uses bounded synthetic copy with no customer or public-publish request", () => {
    const drafts = buildSyntheticDrafts("QA-01234567-89ab");
    expect(drafts.initial).toMatchObject({
      enabled: true,
      kind: "site_update",
      category: "community",
      privacyFlags: ["faces_visible", "review_visual_privacy"],
    });
    expect(drafts.initial.body).toContain("must not reach Customer Hub");
    expect(drafts.final.body).toContain("Never publish");
    expect(JSON.stringify(drafts)).not.toMatch(
      /customer_name|customerDisplayName|vehicleDescription|https?:\/\//i,
    );
  });

  it("accepts only the canonical private Hub review URL", () => {
    const id = `dspc_${"a".repeat(32)}`;
    expect(extractHubDraftId(`https://joegallant.me/backend/#inbox-${id}`)).toBe(id);
    expect(() =>
      extractHubDraftId(`https://evil.example/backend/#inbox-${id}`),
    ).toThrow(/outside the expected private draft route/);
    expect(() =>
      extractHubDraftId(`https://joegallant.me/updates#inbox-${id}`),
    ).toThrow(/outside the expected private draft route/);
    for (const url of [
      `https://joegallant.me/backend/#inbox-dsp_${"a".repeat(32)}`,
      `https://joegallant.me/backend/#inbox-${id.toUpperCase()}`,
      `https://joegallant.me/backend/#inbox-${id}?extra`,
      `https://user@joegallant.me/backend/#inbox-${id}`,
      `https://joegallant.me/studio/updates#draft-12345678-1234-4abc-8def-1234567890ab`,
    ])
      expect(() => extractHubDraftId(url)).toThrow();
    expect(() => canonicalHubOrigin("https://evil.example")).toThrow(
      expect.objectContaining({ code: "CONFIG_UNTRUSTED_HUB_ORIGIN" }),
    );
  });

  it("rejects a real or wrong-dealer destination before any post create or send", async () => {
    const dealerId = "dealer123456789";
    const valid = {
      enabled: true,
      id: "joe_customer_hub",
      mode: "private_draft",
      siteUrl: "https://joegallant.me",
      namespace: "synthetic_canary",
      dealerId,
    };
    for (const destination of [
      { ...valid, namespace: undefined },
      { ...valid, namespace: "real_dealer" },
      { ...valid, dealerId: "other1234567890" },
      { ...valid, dealerId: undefined },
    ]) {
      const requests: { path: string; method: string }[] = [];
      const client = {
        request: async (path: string, options: RequestInit) => {
          requests.push({ path, method: options.method || "GET" });
          return Response.json({ items: [destination] });
        },
      };
      // Exercise the same awaited gate used before the live write sequence.
      const attempt = async () => {
        await preflightSyntheticCanaryDestination(client, dealerId);
        await client.request("/api/app/posts", { method: "POST" });
        await client.request("/api/app/posts/post12345678900/website-publication", {
          method: "POST",
        });
      };
      await expect(attempt()).rejects.toMatchObject({
        code: "DESTINATION_UNAVAILABLE",
      });
      expect(requests).toEqual([
        { path: "/api/app/website-destinations", method: "GET" },
      ]);
    }
    await expect(
      preflightSyntheticCanaryDestination(
        { request: async () => Response.json({ items: [valid] }) },
        dealerId,
      ),
    ).resolves.toEqual(valid);
    const source = readFileSync(scriptPath, "utf8");
    const runStart = source.indexOf("async function runLockedCanary()");
    const runSource = source.slice(runStart);
    expect(
      runSource.indexOf("await preflightSyntheticCanaryDestination("),
    ).toBeGreaterThan(0);
    expect(
      runSource.indexOf("await preflightSyntheticCanaryDestination("),
    ).toBeLessThan(runSource.indexOf('await client.request("/api/app/posts"'));
    expect(
      runSource.indexOf("await preflightSyntheticCanaryDestination("),
    ).toBeLessThan(
      runSource.indexOf('evidence.cleanup.status = "dealer_post_create_in_flight"'),
    );
  });

  it("never lets the production command target loopback", () => {
    const previous = process.env.RELEASE_CANARY_ALLOW_LOOPBACK;
    process.env.RELEASE_CANARY_ALLOW_LOOPBACK = "true";
    try {
      expect(() => canonicalProductionOrigin("http://127.0.0.1:8090")).toThrow(
        expect.objectContaining({
          code: "CONFIG_UNTRUSTED_PRODUCTION_ORIGIN",
        }),
      );
      expect(
        canonicalProductionOrigin("https://dealer-social-post-ai-production.fly.dev"),
      ).toBe("https://dealer-social-post-ai-production.fly.dev");
    } finally {
      if (previous === undefined) {
        delete process.env.RELEASE_CANARY_ALLOW_LOOPBACK;
      } else {
        process.env.RELEASE_CANARY_ALLOW_LOOPBACK = previous;
      }
    }
  });

  it("waits across the next worker minute with a grace period", () => {
    expect(nextMinuteBoundaryWaitMs(new Date("2026-08-05T12:34:00.000Z"))).toBe(68_000);
    expect(nextMinuteBoundaryWaitMs(new Date("2026-08-05T12:34:30.500Z"))).toBe(37_500);
  });

  it("recognizes documented review holds without mistaking them for delivery", () => {
    const undelivered = {
      status: "not_requested",
      attempts: 0,
      reviewUrl: "",
      lastError: "",
    };
    for (const publication of [
      undelivered,
      { ...undelivered, image_review_required: false, identity_review_required: false },
      { ...undelivered, identity_review_required: true },
      {
        ...undelivered,
        image_review_required: true,
        identity_review_required: false,
        lastError: "image_review_required",
      },
      {
        ...undelivered,
        image_review_required: true,
        identity_review_required: true,
        lastError: "image_review_required",
      },
    ])
      expect(() =>
        assertNotRequested(publication, "Pre-Send worker check"),
      ).not.toThrow();

    const reviewHold = {
      ...undelivered,
      image_review_required: true,
      lastError: "image_review_required",
    };
    for (const publication of [
      { ...reviewHold, status: "queued" },
      { ...reviewHold, status: "delivering" },
      { ...reviewHold, status: "draft_ready" },
      { ...reviewHold, status: "failed" },
      { ...reviewHold, attempts: 1 },
      { ...reviewHold, attempts: -1 },
      { ...reviewHold, attempts: undefined },
      { ...reviewHold, attempts: "0" },
      {
        ...reviewHold,
        reviewUrl: "https://joegallant.me/backend/#inbox-dspc_" + "a".repeat(32),
      },
      { ...reviewHold, reviewUrl: undefined },
      { ...reviewHold, lastError: "unexpected_error" },
      {
        ...reviewHold,
        lastError: "identity_review_required",
        identity_review_required: true,
      },
      { ...reviewHold, image_review_required: undefined },
      { ...reviewHold, image_review_required: false },
      { ...reviewHold, image_review_required: "true" },
      { ...reviewHold, identity_review_required: "true" },
      { ...undelivered, lastError: undefined },
    ])
      expect(() => assertNotRequested(publication, "Pre-Send worker check")).toThrow(
        expect.objectContaining({ code: "PREMATURE_WEBSITE_DELIVERY" }),
      );
  });

  it("accepts the backend's reset zero-attempt receipt for a ready draft", () => {
    expect(
      validateReadyPublication({
        status: "draft_ready",
        attempts: 0,
        lastError: "",
      }),
    ).toMatchObject({ status: "draft_ready", attempts: 0 });
    expect(() =>
      validateReadyPublication({
        status: "draft_ready",
        attempts: 1,
        lastError: "",
      }),
    ).toThrow(/clean delivery receipt/);
  });

  it("fails closed if final Send loses its revision fence or becomes implicit", () => {
    const source = readFileSync(backendPath, "utf8");
    expect(validateRevisionContractSource(source)).toBe(true);
    expect(() =>
      validateRevisionContractSource(
        source.replaceAll("expected_post_revision", "unchecked_revision"),
      ),
    ).toThrow(/post-revision guard is missing/);

    const createCall = 'routerAdd("POST", "/api/app/posts",';
    expect(() =>
      validateRevisionContractSource(
        source.replace(createCall, `${createCall}\nclaimPublicationForPost();`),
      ),
    ).toThrow(/Initial post creation must not enqueue/);
  });

  it("carries the exact current revision through every synthetic draft PATCH", () => {
    expect(
      Object.fromEntries(
        createDraftForm("Synthetic setup caption.", "revision-from-create").entries(),
      ),
    ).toEqual({
      expected_post_revision: "revision-from-create",
      caption: "Synthetic setup caption.",
      disclosures: "",
      platform_captions: "{}",
    });
    expect(() => createDraftForm("Synthetic setup caption.", "")).toThrow(
      /did not return a safe opaque post revision/,
    );

    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("created.updated");
    expect(source).toContain(
      '"Synthetic saved setup caption. Never publish.",\n          createdRevision,',
    );
    expect(source).toContain(
      '"Synthetic final caption. Never publish.",\n          initialRevision,',
    );
  });

  it("never references attached customer photos or stores secrets in evidence", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).not.toContain("codex-remote-attachments");
    expect(source).not.toMatch(/Photo [123]\.jpg/);

    const evidenceStart = source.indexOf("const evidence = {");
    const evidenceEnd = source.indexOf("\n  };", evidenceStart) + "\n  };".length;
    const evidenceShape = source.slice(evidenceStart, evidenceEnd);
    for (const sensitiveField of [
      "personPin",
      "invitationToken",
      "invitationCookie",
      "cookie",
      "caption",
      "body",
      "image",
      "customerName",
    ]) {
      expect(evidenceShape).not.toContain(sensitiveField);
    }

    expect(source.indexOf("const origin = canonicalProductionOrigin")).toBeLessThan(
      evidenceStart,
    );
    expect(source.indexOf("if (loginResponse.ok) client.captureCookie")).toBeLessThan(
      source.indexOf("const login = await jsonOrFail"),
    );
    expect(
      source.indexOf('evidence.cleanup.status = "dealer_post_create_in_flight"'),
    ).toBeLessThan(source.indexOf('await client.request("/api/app/posts"'));
  });

  it("requires explicit owner cleanup before its receipt can authorize release", () => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).toContain(
      'const CLEANUP_CONFIRMATION = "private-synthetic-draft-purged";',
    );
    expect(source).toContain('process.argv.includes("--confirm-cleanup")');
    expect(source).toContain('requireEnv("WEBSITE_HANDOFF_CANARY_CLEANUP_CONFIRM")');
    expect(source).toContain('evidence.cleanup?.status !== "owner_action_required"');
    expect(source).toContain("required: false");
    expect(source).toContain('status: "complete"');
    expect(
      source.indexOf("const releaseLockCleanup = acquireReleaseLock()"),
    ).toBeLessThan(source.indexOf('process.argv.includes("--confirm-cleanup")'));
  });
  const identity = {
    draftId: `dspc_${"a".repeat(32)}`,
    eventId: `wp_s_${"b".repeat(32)}_${"c".repeat(40)}`,
    payloadHash: "d".repeat(64),
    sourceDealerId: "dealer123456789",
    sourcePostId: "post12345678900",
    sourceRevision: 2,
  };
  const completedAt = new Date(Date.now() - 60_000).toISOString();
  const resources = {
    canaryIdentity: identity,
    hubDraftId: identity.draftId,
    postId: identity.sourcePostId,
    syntheticMarker: "QA-01234567-89ab",
    mediaHashes: ["e".repeat(64)],
    canaryMediaBase64Sha256: createHash("sha256")
      .update(Buffer.from("z".repeat(200)).toString("base64"))
      .digest("hex"),
  };
  const receipt = {
    ...identity,
    schemaVersion: 1,
    status: "purged",
    completedAt: new Date().toISOString(),
    capability: "f".repeat(64),
  };
  const { capability: _capability, ...publicReceipt } = receipt;
  const result = {
    ...publicReceipt,
    contentAbsent: true,
    mediaAbsent: true,
    replayBlocked: true,
  };

  it("checks real private-media authorization and all successful public feeds", async () => {
    const calls: string[] = [];
    const fetcher = async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return String(url).includes("draft-media")
        ? new Response('{"error":"unauthorized"}', {
            status: 401,
            headers: { "cache-control": "private, no-store" },
          })
        : new Response("clean", { status: 200 });
    };
    await expect(
      verifyHubPrivacyBoundary(
        "https://joegallant.me",
        resources,
        [Buffer.from("unique-image-bytes")],
        fetcher,
      ),
    ).resolves.toMatchObject({
      privateMediaStatus: 401,
      publicStatuses: {
        "/": 200,
        "/api/hub-data/deliveries": 200,
        "/api/hub-data/inventory": 200,
      },
    });
    expect(calls).toHaveLength(4);
    for (const leaked of [
      resources.syntheticMarker,
      identity.draftId,
      identity.sourcePostId,
      identity.payloadHash,
      resources.mediaHashes[0],
      "unique-image-bytes",
      "z".repeat(200),
      JSON.stringify({ image: Buffer.from("z".repeat(200)).toString("base64") }),
      Buffer.from("unique-image-bytes").toString("base64"),
      `/backend/draft-media?draftId=${identity.draftId}`,
    ]) {
      await expect(
        verifyHubPrivacyBoundary(
          "https://joegallant.me",
          resources,
          [Buffer.from("unique-image-bytes")],
          async (url: RequestInfo | URL) =>
            String(url).includes("draft-media") ? fetcher(url) : new Response(leaked),
        ),
      ).rejects.toMatchObject({ code: "HUB_PUBLIC_BOUNDARY_FAILED" });
    }
    for (const status of [401, 404, 500])
      await expect(
        verifyHubPrivacyBoundary(
          "https://joegallant.me",
          resources,
          [],
          async (url: RequestInfo | URL) =>
            String(url).includes("draft-media")
              ? fetcher(url)
              : new Response("clean", { status }),
        ),
      ).rejects.toThrow();
    for (const [status, cache] of [
      [404, "private, no-store"],
      [200, "private, no-store"],
      [401, "public"],
      [401, "private"],
    ] as const)
      await expect(
        verifyHubPrivacyBoundary(
          "https://joegallant.me",
          resources,
          [],
          async (url: RequestInfo | URL) =>
            String(url).includes("draft-media")
              ? new Response("denied", { status, headers: { "cache-control": cache } })
              : new Response("clean"),
        ),
      ).rejects.toThrow();
  });

  it("imports exact owner purge receipt and requires remote content/media/replay proof", async () => {
    let request: RequestInit | undefined;
    const evidence = { resources, completedAt };
    await expect(
      verifyOwnerPurgeReceipt(
        receipt,
        evidence,
        async (url: RequestInfo | URL, options?: RequestInit) => {
          expect(url).toBe(
            "https://joegallant.me/api/integrations/dealer-social/canary-cleanup/verify",
          );
          request = options;
          return Response.json(result, {
            headers: { "cache-control": "private, no-store" },
          });
        },
      ),
    ).resolves.toEqual(result);
    expect(request?.method).toBe("POST");
    expect(JSON.parse(request?.body as string)).toEqual(receipt);
    for (const invalid of [
      { status: "complete" },
      { draftId: `dspc_${"0".repeat(32)}` },
      { payloadHash: "0".repeat(64) },
      { eventId: `wp_s_${"0".repeat(32)}_${"c".repeat(40)}` },
      { sourceDealerId: "other1234567890" },
      { sourcePostId: "other1234567890" },
      { sourceRevision: 3 },
      { capability: "short" },
      { completedAt: "2000-01-01T00:00:00Z" },
    ]) {
      let called = false;
      await expect(
        verifyOwnerPurgeReceipt({ ...receipt, ...invalid }, evidence, async () => {
          called = true;
          return Response.json(result);
        }),
      ).rejects.toMatchObject({ code: "CLEANUP_RECEIPT_INVALID" });
      expect(called).toBe(false);
    }
    for (const invalid of [
      { contentAbsent: false },
      { mediaAbsent: false },
      { replayBlocked: false },
      { sourceRevision: 3 },
      { capability: receipt.capability },
      { completedAt },
    ])
      await expect(
        verifyOwnerPurgeReceipt(receipt, evidence, async () =>
          Response.json(
            { ...result, ...invalid },
            { headers: { "cache-control": "no-store" } },
          ),
        ),
      ).rejects.toMatchObject({ code: "CLEANUP_VERIFICATION_INVALID" });
    for (const status of [401, 404])
      await expect(
        verifyOwnerPurgeReceipt(receipt, evidence, async () =>
          Response.json({}, { status }),
        ),
      ).rejects.toMatchObject({ code: "CLEANUP_VERIFICATION_FAILED" });
  });
});
