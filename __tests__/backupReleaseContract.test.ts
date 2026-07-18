import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The release resolver is an executable Node module rather than app code.
import {
  bindHealthToFlyIdentity,
  resolveFlyMachineIdentity,
} from "../scripts/resolve-fly-backup-source.mjs";
import { planToolOwnedPocketBaseBackupCleanup } from "../scripts/pocketbase-r2-backup.mjs";

const releaseSha = "7".repeat(40);
const imageDigest = `sha256:${"a".repeat(64)}`;
const repository = "TechSavvyJoe/Dealer-Social-Post-AI";

const machine = (overrides: Record<string, unknown> = {}) => ({
  state: "started",
  // Fly exposes this as a string. Reading labels from config.image would make
  // the first source-identity bootstrap fail against the real API shape.
  config: { image: "registry.fly.io/app:deployment-example" },
  image_ref: {
    digest: imageDigest,
    labels: { GH_REPO: repository, GH_SHA: releaseSha },
  },
  ...overrides,
});

describe("Fly backup source identity", () => {
  it("binds the first-release bootstrap to the real image_ref labels and digest", () => {
    expect(resolveFlyMachineIdentity([machine()], repository)).toEqual({
      releaseSha,
      sourceIdentity: "fly_image_label",
      sourceImageDigest: imageDigest,
      bootstrapIdentityVerified: true,
    });
  });

  it("rejects mixed running images instead of blessing an ambiguous backup source", () => {
    expect(() =>
      resolveFlyMachineIdentity(
        [
          machine(),
          machine({
            image_ref: {
              digest: `sha256:${"b".repeat(64)}`,
              labels: { GH_REPO: repository, GH_SHA: releaseSha },
            },
          }),
        ],
        repository,
      ),
    ).toThrow("do not agree on one source release identity");
  });

  it("rejects images that are not labeled for the expected repository", () => {
    expect(() =>
      resolveFlyMachineIdentity([machine()], "another-owner/another-repo"),
    ).toThrow("lacks a trusted repository");
  });

  it("cross-checks health against the running image and retains its digest", () => {
    const flyIdentity = resolveFlyMachineIdentity([machine()], repository);
    expect(bindHealthToFlyIdentity(releaseSha, flyIdentity)).toEqual({
      releaseSha,
      sourceIdentity: "health",
      sourceImageDigest: imageDigest,
      bootstrapIdentityVerified: false,
    });
    expect(() => bindHealthToFlyIdentity("8".repeat(40), flyIdentity)).toThrow(
      "do not identify the same release",
    );
  });

  it("keeps both production gates on an immutable, release-bound archive", () => {
    const files = [
      ".github/workflows/fly-deploy.yml",
      ".github/workflows/pocketbase-backup.yml",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
    for (const workflow of files) {
      expect(workflow).toContain(
        "POCKETBASE_EXPECTED_ORIGIN: https://dealer-social-post-ai-production.fly.dev",
      );
      expect(workflow).toContain("POCKETBASE_EXPECTED_RELEASE_SHA:");
      expect(workflow).toContain("POCKETBASE_TARGET_RELEASE_SHA:");
      expect(workflow).toContain("POCKETBASE_SOURCE_IDENTITY:");
      expect(workflow).toContain('--key "${{ steps.backup.outputs.key }}"');
    }

    const tooling = readFileSync(
      resolve(process.cwd(), "scripts/pocketbase-r2-backup.mjs"),
      "utf8",
    );
    expect(tooling).toContain("formatVersion: 2");
    expect(tooling).toContain("sourceReleaseSha:");
    expect(tooling).toContain("targetReleaseSha,");
    expect(tooling).toContain("sourceImageDigest:");
    expect(tooling).toContain(
      "Backup manifest does not match the expected production origin",
    );

    const flyDeploy = files[0];
    expect(flyDeploy).toContain(
      "flyctl secrets set --stage --app dealer-social-post-ai-production",
    );
    expect(flyDeploy).toContain(
      'POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$RELEASE_SHA"',
    );
    expect(flyDeploy).not.toContain(
      '--env POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$RELEASE_SHA"',
    );
    expect(flyDeploy).toContain(
      'image_ref="registry.fly.io/dealer-social-post-ai-production@${image_digest}"',
    );
    expect(flyDeploy).toContain(
      'bash scripts/verify-pocketbase-restore.sh /tmp/pre-release-pocketbase.zip "$image_ref"',
    );
    expect(flyDeploy).toContain("Reconfirm the production source after backup");
    expect(flyDeploy).toContain(
      "source.sourceImageDigest !== process.env.EXPECTED_SOURCE_DIGEST",
    );
    expect(flyDeploy).toContain(
      'docker push "$image_tag" 2>&1 | tee /tmp/candidate-image-push.txt',
    );
    expect(flyDeploy).toContain('--image "$CANDIDATE_IMAGE_REF"');
    expect(flyDeploy).not.toContain("flyctl deploy --remote-only");
    expect(flyDeploy.match(/Refuse a superseded main release/g)).toHaveLength(2);
    expect(flyDeploy).toContain(
      "machine?.image_ref?.digest !== process.env.EXPECTED_IMAGE_DIGEST",
    );
  });

  it("lets the protected environment load before checking nightly enablement", () => {
    const nightly = readFileSync(
      resolve(process.cwd(), ".github/workflows/pocketbase-backup.yml"),
      "utf8",
    );
    expect(nightly).not.toContain(
      "if: github.event_name == 'workflow_dispatch' || vars.POCKETBASE_R2_BACKUPS_ENABLED == 'true'",
    );
    expect(nightly).toContain("Require the explicit backup enablement flag");
    expect(nightly).toContain('if [ "$BACKUPS_ENABLED" != "true" ]');
  });

  it("uses Fly-secret precedence for every release-bound mutable value", () => {
    const flyDeploy = readFileSync(
      resolve(process.cwd(), ".github/workflows/fly-deploy.yml"),
      "utf8",
    );
    const staged = flyDeploy.slice(
      flyDeploy.indexOf("flyctl secrets set --stage"),
      flyDeploy.indexOf("flyctl deploy --app"),
    );
    for (const name of [
      "RELEASE_SHA",
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_ALLOWED_HOSTNAMES",
      "TURNSTILE_ENFORCEMENT_ENABLED",
      "LEGACY_CLIENT_COMPATIBILITY_ENABLED",
      "POCKETBASE_BACKUP_LAST_VERIFIED_AT",
      "POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA",
    ]) {
      expect(staged).toContain(`${name}=`);
    }
  });

  it("proves uploaded media survives the backup and restore boundary", () => {
    const canary = readFileSync(
      resolve(process.cwd(), "scripts/backup-restore-canary.sh"),
      "utf8",
    );
    const verifier = readFileSync(
      resolve(process.cwd(), "scripts/verify-pocketbase-restore.sh"),
      "utf8",
    );

    expect(canary).toContain("logo=@public/icon-192.png;type=image/png");
    expect(canary).toContain("RESTORE_EXPECTED_FILE_SHA256");
    expect(verifier).toContain("RESTORE_EXPECTED_FILE_COLLECTION");
    expect(verifier).toContain("RESTORE_EXPECTED_FILE_SHA256");
    expect(verifier).toContain("/api/files/${expected_file_collection}");
    expect(verifier).toContain("photo_releases.signature_png");
    expect(verifier).toContain("posts.creative_image");
    expect(verifier).toContain("json_each(normalized.values_json)");
    expect(verifier).toContain('media_status="none-referenced"');
  });

  it("bounds only tool-owned PocketBase emergency archives", () => {
    const current = "dspai_tool_20260717t123456789z_abcdef123456.zip";
    const older = "dspai_tool_20260716t123456789z_abcdef123455.zip";
    const oldest = "dspai_tool_20260715t123456789z_manual.zip";
    const inventory = [
      { key: current },
      { key: older },
      { key: oldest },
      { key: "pb_backup_20260714162514.zip" },
      { key: "dspai_20260713t123456789z_legacy.zip" },
      { key: "dspai_tool_manual-dashboard-backup.zip" },
    ];

    expect(planToolOwnedPocketBaseBackupCleanup(inventory, current)).toEqual([
      oldest,
      older,
    ]);
    expect(planToolOwnedPocketBaseBackupCleanup(inventory)).toEqual([
      oldest,
      older,
      current,
    ]);
    expect(planToolOwnedPocketBaseBackupCleanup(inventory, current)).not.toContain(
      "pb_backup_20260714162514.zip",
    );
    expect(planToolOwnedPocketBaseBackupCleanup(inventory, current)).not.toContain(
      "dspai_20260713t123456789z_legacy.zip",
    );

    const source = readFileSync(
      resolve(process.cwd(), "scripts/pocketbase-r2-backup.mjs"),
      "utf8",
    );
    const createFlow = source.slice(
      source.indexOf("async function createAndDownloadPocketBaseBackup"),
      source.indexOf("async function pruneOldBackups"),
    );
    expect(
      createFlow.indexOf("await pruneToolOwnedPocketBaseBackups(token);"),
    ).toBeLessThan(createFlow.indexOf('method: "POST"'));
    expect(source).toContain("await retainOnlyCurrentEmergencyBackup(token, name)");
  });

  it("keeps pre-v2 revocation schema-safe and rollback above the auth security floor", () => {
    const runbook = readFileSync(
      resolve(process.cwd(), "docs/production-backups-and-release.md"),
      "utf8",
    );
    const temporaryRotation = runbook.slice(
      runbook.indexOf("## Two-phase administrator credential"),
      runbook.indexOf("## Required gates"),
    );
    expect(temporaryRotation).toContain(
      "DELETE FROM sessions WHERE role = '\\''super_admin'\\'' OR is_impersonation = 1;",
    );
    expect(temporaryRotation).not.toContain("admin_secret_fingerprint");

    const rollback = runbook.slice(runbook.indexOf("## Monitoring and rollback"));
    expect(rollback).toContain("authentication-hardening release or later");
    expect(rollback).toContain("never attach a raw pre-release archive");
    expect(rollback).toContain("UPDATE dealers SET code = '', admin_code = '';");
    expect(rollback).toContain("DELETE FROM sessions;");
    expect(rollback).toContain("PRAGMA quick_check");
  });
});
