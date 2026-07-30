import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The release resolver is an executable Node module rather than app code.
import {
  bindHealthToFlyIdentity,
  resolveFlyMachineIdentity,
} from "../scripts/resolve-fly-backup-source.mjs";
import {
  planToolOwnedPocketBaseBackupCleanup,
  planToolOwnedR2BackupCleanup,
  uploadAndVerifyR2BackupPair,
} from "../scripts/pocketbase-r2-backup.mjs";

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
      expect(workflow).toContain("bash scripts/prepare-fly-backup-volume.sh");
      expect(workflow).toContain("set -o pipefail");
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

  it("repairs only Fly volume metadata before PocketBase walks a full backup", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/prepare-fly-backup-volume.sh"),
      "utf8",
    );

    expect(source).toContain("--user root");
    expect(source).toContain("--user pbuser");
    expect(source.match(/\[ -L \/pb\/pb_data\/lost\+found \]/g)).toHaveLength(2);
    expect(source).toContain("[ ! -L /pb/pb_data/lost+found ]");
    expect(source).toContain('stat -c %u /pb/pb_data/lost+found)\\" = 0');
    expect(source).toContain("chgrp pbuser /pb/pb_data/lost+found");
    expect(source).toContain("chmod 0750 /pb/pb_data/lost+found");
    expect(source).toContain("[ -r /pb/pb_data/lost+found ]");
    expect(source).toContain("[ -x /pb/pb_data/lost+found ]");
    expect(source).not.toContain("chown -R");
    expect(source).not.toContain("chmod -R");
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
    expect(canary).toContain("migrate up");
    expect(canary.indexOf("migrate up")).toBeLessThan(
      canary.indexOf('admin create "$admin_email"'),
    );
    expect(canary.match(/--dir=\/pb\/pb_data/g)).toHaveLength(2);
    expect(canary.match(/--migrationsDir=\/pb\/pb_migrations/g)).toHaveLength(2);
    expect(canary.match(/--hooksDir=\/pb\/pb_hooks/g)).toHaveLength(2);
    expect(canary).toContain('payload.logo || ""}\\n`);');
    expect(verifier).toContain("RESTORE_EXPECTED_FILE_COLLECTION");
    expect(verifier).toContain("RESTORE_EXPECTED_FILE_SHA256");
    expect(verifier).toContain("/api/files/${expected_file_collection}");
    expect(verifier).toContain("photo_releases.signature_png");
    expect(verifier).toContain("posts.creative_image");
    expect(verifier).toContain("json_each(normalized.values_json)");
    expect(verifier).toContain('media_status="none-referenced"');
  });

  it("bounds Docker port discovery across every disposable release drill", () => {
    const resolver = readFileSync(
      resolve(process.cwd(), "scripts/lib/docker-port.sh"),
      "utf8",
    );
    expect(resolver).toContain("resolve_docker_published_port()");
    expect(resolver).toContain('docker port "$container_id" "$container_port"');
    expect(resolver).toContain("attempt <= max_attempts");
    expect(resolver).toContain('state" = "dead"');
    expect(resolver).toContain("describe_docker_container_state()");
    expect(resolver).not.toContain(".Config");
    expect(resolver).not.toContain(".Mounts");
    expect(resolver).not.toContain(".State.Error");

    for (const path of [
      "scripts/backup-restore-canary.sh",
      "scripts/verify-pocketbase-restore.sh",
      "scripts/dirty-upgrade-smoke.sh",
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source).toContain('source "$script_dir/lib/docker-port.sh"');
      expect(source).toContain("resolve_docker_published_port");
      expect(source).toContain("describe_docker_container_state");
      expect(source).not.toContain('port="$(docker port');
      expect(source).not.toContain('docker inspect "$');
    }
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

  it("retains only the newest complete tool-owned R2 pairs without touching manual names", () => {
    const prefix = "dealer-social-post-ai/pocketbase";
    const toolOwned = Array.from({ length: 32 }, (_, index) => {
      const key = `${prefix}/dspai_tool_20260717t${String(index).padStart(
        9,
        "0",
      )}z_abcdef123456.zip`;
      return [{ key }, { key: `${key}.manifest.json` }];
    }).flat();
    const newestOrphan = `${prefix}/dspai_tool_20260718t999999999z_abcdef123456.zip`;
    const orphanManifest = `${prefix}/dspai_tool_20260718t888888888z_abcdef123456.zip.manifest.json`;
    const inventory = [
      ...toolOwned,
      { key: newestOrphan },
      { key: orphanManifest },
      { key: `${prefix}/manual-dashboard-backup.zip` },
      { key: `${prefix}/dspai_20260713t123456789z_legacy.zip` },
      { key: `another-prefix/dspai_tool_20260717t999999999z_abcdef123456.zip` },
    ];

    const orderedToolKeys = planToolOwnedR2BackupCleanup(inventory, prefix);
    expect(orderedToolKeys).toHaveLength(32);
    expect(orderedToolKeys.slice(30)).toEqual([
      `${prefix}/dspai_tool_20260717t000000001z_abcdef123456.zip`,
      `${prefix}/dspai_tool_20260717t000000000z_abcdef123456.zip`,
    ]);
    expect(orderedToolKeys).not.toContain(`${prefix}/manual-dashboard-backup.zip`);
    expect(orderedToolKeys).not.toContain(
      `${prefix}/dspai_20260713t123456789z_legacy.zip`,
    );
    expect(orderedToolKeys).not.toContain(newestOrphan);
    expect(orderedToolKeys).not.toContain(
      orphanManifest.replace(/\.manifest\.json$/, ""),
    );
  });

  it("removes both current-run R2 objects when manifest upload fails", async () => {
    const key =
      "dealer-social-post-ai/pocketbase/dspai_tool_20260717t123456789z_abcdef123456.zip";
    const deleted: string[] = [];
    const originalError = new Error("manifest upload unavailable");
    const client = {
      putFile: vi.fn().mockResolvedValue({ sha256: "digest", size: 123 }),
      putJson: vi.fn().mockRejectedValue(originalError),
      getJson: vi.fn(),
      delete: vi.fn(async (objectKey: string) => {
        deleted.push(objectKey);
      }),
    };

    await expect(
      uploadAndVerifyR2BackupPair(client, {
        prefix: "dealer-social-post-ai/pocketbase",
        key,
        outputPath: "/tmp/backup.zip",
        metadata: { source: "test" },
        createManifest: ({ sha256, size }: { sha256: string; size: number }) => ({
          key,
          sha256,
          size,
        }),
      }),
    ).rejects.toBe(originalError);
    expect(deleted).toEqual([`${key}.manifest.json`, key]);
    expect(client.getJson).not.toHaveBeenCalled();
  });

  it("cleans an archive persisted by an ambiguously rejected R2 put", async () => {
    const key =
      "dealer-social-post-ai/pocketbase/dspai_tool_20260717t123456789z_abcdef123456.zip";
    const persistedObjects = new Set<string>();
    const deleted: string[] = [];
    const originalError = new Error("upload response unavailable");
    const client = {
      putFile: vi.fn(async (objectKey: string) => {
        persistedObjects.add(objectKey);
        throw originalError;
      }),
      putJson: vi.fn(),
      getJson: vi.fn(),
      delete: vi.fn(async (objectKey: string) => {
        deleted.push(objectKey);
        if (objectKey.endsWith(".manifest.json")) {
          throw new Error("manifest cleanup response unavailable");
        }
        persistedObjects.delete(objectKey);
      }),
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await expect(
        uploadAndVerifyR2BackupPair(client, {
          prefix: "dealer-social-post-ai/pocketbase",
          key,
          outputPath: "/tmp/backup.zip",
          metadata: { source: "test" },
          createManifest: vi.fn(),
        }),
      ).rejects.toBe(originalError);
      expect(deleted).toEqual([`${key}.manifest.json`, key]);
      expect(persistedObjects).toEqual(new Set());
      expect(client.putJson).not.toHaveBeenCalled();
      expect(client.getJson).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(
          "R2 partial-upload cleanup could not remove every current-run object",
        ),
      );
    } finally {
      stderr.mockRestore();
    }
  });

  it("fails closed on manifest mismatch and still attempts both cleanup deletes", async () => {
    const key =
      "dealer-social-post-ai/pocketbase/dspai_tool_20260717t123456789z_abcdef123456.zip";
    const deleted: string[] = [];
    const client = {
      putFile: vi.fn().mockResolvedValue({ sha256: "expected", size: 123 }),
      putJson: vi.fn().mockResolvedValue(undefined),
      getJson: vi.fn().mockResolvedValue({ key, sha256: "unexpected", size: 123 }),
      delete: vi.fn(async (objectKey: string) => {
        deleted.push(objectKey);
        if (objectKey.endsWith(".manifest.json")) {
          throw new Error("manifest delete unavailable");
        }
      }),
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await expect(
        uploadAndVerifyR2BackupPair(client, {
          prefix: "dealer-social-post-ai/pocketbase",
          key,
          outputPath: "/tmp/backup.zip",
          metadata: { source: "test" },
          createManifest: ({ sha256, size }: { sha256: string; size: number }) => ({
            key,
            sha256,
            size,
          }),
        }),
      ).rejects.toThrow("failed read-back validation");
      expect(deleted).toEqual([`${key}.manifest.json`, key]);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(
          "R2 partial-upload cleanup could not remove every current-run object",
        ),
      );
    } finally {
      stderr.mockRestore();
    }
  });

  it("keeps a verified current-run pair and returns its exact manifest", async () => {
    const key =
      "dealer-social-post-ai/pocketbase/dspai_tool_20260717t123456789z_abcdef123456.zip";
    const manifest = { key, sha256: "expected", size: 123 };
    const client = {
      putFile: vi.fn().mockResolvedValue({ sha256: "expected", size: 123 }),
      putJson: vi.fn().mockResolvedValue(undefined),
      getJson: vi.fn().mockResolvedValue({ ...manifest }),
      delete: vi.fn(),
    };

    await expect(
      uploadAndVerifyR2BackupPair(client, {
        prefix: "dealer-social-post-ai/pocketbase",
        key,
        outputPath: "/tmp/backup.zip",
        metadata: { source: "test" },
        createManifest: () => manifest,
      }),
    ).resolves.toEqual({
      uploaded: { sha256: "expected", size: 123 },
      manifest,
    });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("never uploads or deletes a current-run object outside the tool-owned prefix", async () => {
    const client = {
      putFile: vi.fn(),
      putJson: vi.fn(),
      getJson: vi.fn(),
      delete: vi.fn(),
    };

    await expect(
      uploadAndVerifyR2BackupPair(client, {
        prefix: "dealer-social-post-ai/pocketbase",
        key: "manual-archives/production.zip",
        outputPath: "/tmp/backup.zip",
        metadata: { source: "test" },
        createManifest: vi.fn(),
      }),
    ).rejects.toThrow("outside the tool-owned prefix");
    expect(client.putFile).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
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
