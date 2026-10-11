import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOSTED_QA_PROJECTS,
  acquireReleaseLock,
  resolveVercelAliasPage,
  validateDeploymentInspection,
  validateProviderCanaryEvidence,
  validateQaEvidence,
  validateStageEvidence,
  validateWebsiteHandoffCanaryEvidence,
} from "../scripts/vercel-staged-qa.mjs";

const validEvidence = {
  schemaVersion: 3,
  attemptId: "b".repeat(32),
  status: "staged",
  releaseSha: "a".repeat(40),
  deploymentUrl: "https://dealer-social-post-example.vercel.app",
  deploymentId: "dpl_Example123",
  stagedAt: "2026-07-30T12:00:00.000Z",
  promotedAt: null,
};

describe("Vercel staged browser QA receipt", () => {
  it("resolves the exact production alias from paginated Vercel inventory", () => {
    const deploymentId = "dpl_Example123";
    expect(
      resolveVercelAliasPage(
        {
          aliases: [
            {
              alias: "dealer-social-post-ai.vercel.app",
              deploymentId,
              url: "dealer-social-post-example.vercel.app",
            },
          ],
          pagination: { next: null },
        },
        "dealer-social-post-ai.vercel.app",
      ),
    ).toEqual({ deploymentId, next: null });

    expect(
      resolveVercelAliasPage(
        { aliases: [], pagination: { next: 1785446110549 } },
        "dealer-social-post-ai.vercel.app",
      ),
    ).toEqual({ deploymentId: null, next: 1785446110549 });

    for (const invalid of [
      { aliases: null, pagination: { next: null } },
      {
        aliases: [
          {
            alias: "dealer-social-post-ai.vercel.app",
            deploymentId: "not-a-deployment",
          },
        ],
        pagination: { next: null },
      },
      {
        aliases: [
          {
            alias: "dealer-social-post-ai.vercel.app",
            deploymentId,
          },
          {
            alias: "dealer-social-post-ai.vercel.app",
            deploymentId,
          },
        ],
        pagination: { next: null },
      },
      { aliases: [], pagination: { next: "unsafe" } },
      { aliases: [], pagination: { next: 0 } },
      { aliases: [], pagination: { next: -0 } },
    ]) {
      expect(() =>
        resolveVercelAliasPage(invalid, "dealer-social-post-ai.vercel.app"),
      ).toThrow(/Vercel alias inventory/);
    }
  });

  it("requires the complete responsive Chromium and WebKit matrix", () => {
    expect(HOSTED_QA_PROJECTS).toHaveLength(16);
    expect(HOSTED_QA_PROJECTS).toEqual(
      expect.arrayContaining([
        "chromium-phone-fold-280",
        "chromium-phone-large-440",
        "chromium-phone-landscape-844",
        "chromium-desktop-1440",
        "webkit-phone-fold-280",
        "webkit-phone-390",
        "webkit-tablet-768",
        "webkit-desktop-1440",
      ]),
    );
  });

  it("accepts only an unpromoted receipt bound to an exact deployment", () => {
    expect(validateStageEvidence(validEvidence)).toEqual(validEvidence);

    for (const invalid of [
      { ...validEvidence, schemaVersion: 2 },
      { ...validEvidence, attemptId: "short" },
      { ...validEvidence, status: "staging" },
      { ...validEvidence, releaseSha: "short" },
      { ...validEvidence, deploymentUrl: "http://example.com" },
      { ...validEvidence, deploymentUrl: "https://vercel.app/path" },
      { ...validEvidence, deploymentId: "example" },
      { ...validEvidence, stagedAt: "not-a-date" },
      { ...validEvidence, promotedAt: "2026-07-30T12:05:00.000Z" },
    ]) {
      expect(() => validateStageEvidence(invalid)).toThrow(
        "staged release receipt does not match the current schema",
      );
    }
  });

  it("binds QA to the ready production artifact in the expected project", () => {
    const validInspection = {
      id: validEvidence.deploymentId,
      name: "dealer-social-post-ai",
      readyState: "READY",
      target: "production",
      url: new URL(validEvidence.deploymentUrl).hostname,
      aliases: [],
    };
    expect(validateDeploymentInspection(validInspection, validEvidence)).toEqual(
      validInspection,
    );

    for (const invalid of [
      { ...validInspection, id: "dpl_Other" },
      { ...validInspection, name: "another-project" },
      { ...validInspection, readyState: "BUILDING" },
      { ...validInspection, target: "preview" },
      { ...validInspection, url: "another-deployment.vercel.app" },
    ]) {
      expect(() => validateDeploymentInspection(invalid, validEvidence)).toThrow(
        "Vercel inspection does not match the recorded production artifact",
      );
    }
  });

  it("rejects a stale or mismatched browser QA approval", () => {
    const validQaEvidence = {
      schemaVersion: 2,
      attemptId: validEvidence.attemptId,
      releaseSha: validEvidence.releaseSha,
      deploymentUrl: validEvidence.deploymentUrl,
      deploymentId: validEvidence.deploymentId,
      spec: "e2e/staged-release.spec.ts",
      projects: [...HOSTED_QA_PROJECTS],
      outcome: "passed",
      passedAt: "2026-07-30T12:05:00.000Z",
    };
    expect(validateQaEvidence(validQaEvidence, validEvidence)).toEqual(validQaEvidence);

    for (const invalid of [
      { ...validQaEvidence, attemptId: "c".repeat(32) },
      { ...validQaEvidence, releaseSha: "d".repeat(40) },
      { ...validQaEvidence, deploymentId: "dpl_Other" },
      { ...validQaEvidence, outcome: "failed" },
      { ...validQaEvidence, passedAt: "2026-07-30T11:59:59.000Z" },
      { ...validQaEvidence, projects: HOSTED_QA_PROJECTS.slice(1) },
    ]) {
      expect(() => validateQaEvidence(invalid, validEvidence)).toThrow(
        "browser QA receipt does not match the staged release",
      );
    }
  });

  it("requires a complete provider canary for the exact restored Fly release", () => {
    const now = Date.now();
    const validCanary = {
      schemaVersion: 3,
      canary: "production-provider-proxy",
      syntheticAsset: "public/icon-512.png",
      targetOrigin: "https://dealer-social-post-ai-production.fly.dev",
      expectedReleaseSha: validEvidence.releaseSha,
      startedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      completedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      outcome: "passed",
      checks: {
        authentication: {
          passed: true,
          role: "salesperson",
          privateInvitationConfirmed: true,
        },
        health: {
          passed: true,
          releaseSha: validEvidence.releaseSha,
          backupStatus: "verified",
        },
        caption: { passed: true },
        standardImage: { passed: true },
        standardVideo: { passed: true },
        qualityVideo: { passed: true },
        sessionRevocation: { passed: true },
      },
    };
    expect(
      validateProviderCanaryEvidence(validCanary, validEvidence.releaseSha),
    ).toEqual(validCanary);

    for (const invalid of [
      { ...validCanary, schemaVersion: 2 },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          authentication: { passed: true, role: "salesperson" },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          authentication: {
            passed: true,
            role: "salesperson",
            privateInvitationConfirmed: false,
          },
        },
      },
      { ...validCanary, targetOrigin: "https://example.com" },
      { ...validCanary, expectedReleaseSha: "d".repeat(40) },
      { ...validCanary, outcome: "failed" },
      { ...validCanary, completedAt: null },
      {
        ...validCanary,
        startedAt: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          standardVideo: { passed: false },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          health: {
            ...validCanary.checks.health,
            backupStatus: "stale",
          },
        },
      },
    ]) {
      expect(() =>
        validateProviderCanaryEvidence(invalid, validEvidence.releaseSha),
      ).toThrow("provider canary receipt does not prove the exact Fly release");
    }
  });

  it("requires a cleaned-up private website handoff canary for the exact release", () => {
    const now = Date.now();
    const identity = {
      draftId: `dspc_${"a".repeat(32)}`,
      eventId: `wp_s_${"b".repeat(32)}_${"c".repeat(40)}`,
      payloadHash: "d".repeat(64),
      sourceDealerId: "dealer123456789",
      sourcePostId: "post12345678900",
      sourceRevision: 2,
    };
    const boundary = {
      passed: true,
      privateMediaStatus: 401,
      privateMediaCacheControl: "private, no-store",
      publicStatuses: {
        "/": 200,
        "/api/hub-data/deliveries": 200,
        "/api/hub-data/inventory": 200,
      },
      markerAbsent: true,
      identityAbsent: true,
      mediaAbsent: true,
      mediaHashChecked: true,
    };
    const verification = {
      ...identity,
      schemaVersion: 1,
      status: "purged",
      completedAt: new Date(now - 4.5 * 60 * 1000).toISOString(),
      contentAbsent: true,
      mediaAbsent: true,
      replayBlocked: true,
    };
    const validCanary = {
      schemaVersion: 3,
      canary: "production-website-private-draft",
      syntheticAsset: "docs/marketing/demo/synthetic-delivery-photo.jpg",
      syntheticSourceSha256:
        "828593892b475286726555359248bc2e47bd2a59239e8c750ca2cb885c6b1139",
      generatedOutputHandling: "unchanged-provider-bytes",
      syntheticMetadataCase:
        "offline-contract-only-exif-without-orientation-plus-photoshop-app13",
      modelPolicyVersion: "5",
      targetOrigin: "https://dealer-social-post-ai-production.fly.dev",
      customerHubOrigin: "https://joegallant.me",
      expectedReleaseSha: validEvidence.releaseSha,
      startedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      completedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      outcome: "passed",
      resources: {
        mediaHashes: [
          "f".repeat(64),
          "828593892b475286726555359248bc2e47bd2a59239e8c750ca2cb885c6b1139",
        ],
        canaryIdentity: identity,
        canaryMediaBase64Sha256: "e".repeat(64),
        syntheticMarker: `QA-${validEvidence.releaseSha.slice(0, 8)}-${validEvidence.releaseSha.slice(8, 12)}`,
        hubDraftId: identity.draftId,
        postId: identity.sourcePostId,
        sourceDealerId: identity.sourceDealerId,
        reviewUrl: `https://joegallant.me/backend/#inbox-${identity.draftId}`,
      },
      checks: {
        imageGeneration: {
          passed: true,
          status: "completed",
          attempts: 1,
          task: "image_standard",
          sameSession: true,
          imageAttemptId: "a".repeat(40),
          modelPolicyVersion: "5",
          model: "gemini-3-pro-image",
          mimeType: "image/png",
          byteCount: 2048,
          imageSize: "2K",
          aspectRatio: "4:5",
          width: 1856,
          height: 2304,
          outputSha256: "f".repeat(64),
          outputBase64Sha256: "b".repeat(64),
        },
        authentication: {
          passed: true,
          role: "salesperson",
          privateInvitationConfirmed: true,
        },
        health: {
          passed: true,
          releaseSha: validEvidence.releaseSha,
          backupStatus: "verified",
          modelPolicyVersion: "5",
        },
        destination: {
          passed: true,
          id: "joe_customer_hub",
          mode: "private_draft",
          namespace: "synthetic_canary",
          dealerId: identity.sourceDealerId,
        },
        initialPrivateDraft: {
          passed: true,
          websiteOnly: true,
          imageReviewCleared: true,
          imageAttemptId: "a".repeat(40),
          uploadedOutputSha256: "f".repeat(64),
          status: "not_requested",
        },
        noPrematureDelivery: { passed: true, imageReviewCleared: true },
        revisionGuard: {
          passed: true,
          missingBlocked: true,
          staleBlocked: true,
          exactReplayIdempotent: true,
          changedReplayBlocked: true,
        },
        privateDelivery: { passed: true, status: "draft_ready", attempts: 0 },
        publicBoundary: boundary,
        sessionRevocation: { passed: true },
      },
      cleanup: {
        required: false,
        status: "complete",
        verification,
        publicBoundary: boundary,
        completedAt: new Date(now - 4 * 60 * 1000).toISOString(),
      },
    };

    expect(
      validateWebsiteHandoffCanaryEvidence(validCanary, validEvidence.releaseSha),
    ).toEqual(validCanary);

    for (const invalid of [
      { ...validCanary, expectedReleaseSha: "d".repeat(40) },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          destination: { ...validCanary.checks.destination, namespace: "real_dealer" },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          destination: {
            ...validCanary.checks.destination,
            dealerId: "other1234567890",
          },
        },
      },
      { ...validCanary, schemaVersion: 1 },
      { ...validCanary, schemaVersion: 2 },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          initialPrivateDraft: {
            ...validCanary.checks.initialPrivateDraft,
            uploadedOutputSha256: "0".repeat(64),
          },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          initialPrivateDraft: {
            ...validCanary.checks.initialPrivateDraft,
            imageAttemptId: "0".repeat(40),
          },
        },
      },
      {
        ...validCanary,
        generatedOutputHandling: "converted-with-claimed-original-hash",
      },
      {
        ...validCanary,
        syntheticMetadataCase: "exif-without-orientation-plus-photoshop-app13",
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          imageGeneration: { ...validCanary.checks.imageGeneration, attempts: 2 },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          imageGeneration: {
            ...validCanary.checks.imageGeneration,
            status: "uncertain",
          },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          imageGeneration: {
            ...validCanary.checks.imageGeneration,
            sameSession: false,
          },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          imageGeneration: {
            ...validCanary.checks.imageGeneration,
            outputSha256: "0".repeat(64),
          },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          noPrematureDelivery: { passed: true, imageReviewCleared: false },
        },
      },
      {
        ...validCanary,
        resources: { ...validCanary.resources, hubDraftId: `dspc_${"0".repeat(32)}` },
      },
      {
        ...validCanary,
        resources: {
          ...validCanary.resources,
          reviewUrl: `https://joegallant.me/studio/updates#draft-${identity.draftId}`,
        },
      },
      { ...validCanary, cleanup: { ...validCanary.cleanup, verification: undefined } },
      {
        ...validCanary,
        cleanup: {
          ...validCanary.cleanup,
          verification: { ...verification, draftId: `dspc_${"0".repeat(32)}` },
        },
      },
      {
        ...validCanary,
        cleanup: {
          ...validCanary.cleanup,
          verification: { ...verification, replayBlocked: false },
        },
      },
      {
        ...validCanary,
        cleanup: {
          ...validCanary.cleanup,
          verification: { ...verification, capability: "f".repeat(64) },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          publicBoundary: {
            ...boundary,
            publicStatuses: {
              ...boundary.publicStatuses,
              "/api/hub-data/inventory": 404,
            },
          },
        },
      },
      {
        ...validCanary,
        cleanup: {
          ...validCanary.cleanup,
          publicBoundary: { ...boundary, mediaAbsent: false },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          authentication: { passed: true, role: "salesperson" },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          authentication: {
            passed: true,
            role: "salesperson",
            privateInvitationConfirmed: false,
          },
        },
      },
      { ...validCanary, outcome: "failed" },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          revisionGuard: {
            ...validCanary.checks.revisionGuard,
            staleBlocked: false,
          },
        },
      },
      {
        ...validCanary,
        checks: {
          ...validCanary.checks,
          publicBoundary: {
            ...validCanary.checks.publicBoundary,
            privateMediaStatus: 404,
          },
        },
      },
      {
        ...validCanary,
        cleanup: { required: true, status: "owner_action_required" },
      },
    ]) {
      expect(() =>
        validateWebsiteHandoffCanaryEvidence(invalid, validEvidence.releaseSha),
      ).toThrow(
        "website handoff canary receipt does not prove the exact private delivery and cleanup",
      );
    }
  });

  it("uses an atomic owner-bearing lock and never auto-reclaims an existing lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "dealer-social-release-lock-"));
    const lockPath = join(directory, "vercel-release.lock");
    try {
      const release = acquireReleaseLock(lockPath);
      expect(() => acquireReleaseLock(lockPath)).toThrow(
        "another staged release command owns the release lock",
      );
      release();

      const nextRelease = acquireReleaseLock(lockPath);
      nextRelease();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
