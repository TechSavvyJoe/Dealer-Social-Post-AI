import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticDrafts,
  canonicalHubOrigin,
  canonicalProductionOrigin,
  extractHubDraftId,
  injectSyntheticJpegMetadata,
  jpegApplicationMarkers,
  nextMinuteBoundaryWaitMs,
  validateReadyPublication,
  validateRevisionContractSource,
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
    const id = "12345678-1234-4abc-8def-1234567890ab";
    expect(extractHubDraftId(`https://joegallant.me/studio/updates#draft-${id}`)).toBe(
      id,
    );
    expect(() =>
      extractHubDraftId(`https://evil.example/studio/updates#draft-${id}`),
    ).toThrow(/outside the expected private draft route/);
    expect(() =>
      extractHubDraftId(`https://joegallant.me/updates#draft-${id}`),
    ).toThrow(/outside the expected private draft route/);
    expect(() => canonicalHubOrigin("https://evil.example")).toThrow(
      expect.objectContaining({ code: "CONFIG_UNTRUSTED_HUB_ORIGIN" }),
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

  it("never references attached customer photos or stores secrets in evidence", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).not.toContain("codex-remote-attachments");
    expect(source).not.toMatch(/Photo [123]\.jpg/);

    const evidenceStart = source.indexOf("const evidence = {");
    const evidenceEnd = source.indexOf("\n  };", evidenceStart) + "\n  };".length;
    const evidenceShape = source.slice(evidenceStart, evidenceEnd);
    for (const sensitiveField of [
      "personPin",
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
});
