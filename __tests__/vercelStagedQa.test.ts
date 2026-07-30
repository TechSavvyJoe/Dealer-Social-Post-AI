import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOSTED_QA_PROJECTS,
  acquireReleaseLock,
  validateDeploymentInspection,
  validateProviderCanaryEvidence,
  validateQaEvidence,
  validateStageEvidence,
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
        authentication: { passed: true, role: "salesperson" },
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
