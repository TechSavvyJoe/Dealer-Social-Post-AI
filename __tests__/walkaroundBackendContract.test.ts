import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WalkaroundModule = {
  MAX_CLIPS: number;
  MAX_TOTAL_BYTES: number;
  MAX_TOTAL_DURATION_MS: number;
  RELEASE_VERSION: string;
  cleanString: (value: unknown, max: number, required?: boolean) => string | null;
  integer: (value: unknown, min: number, max: number) => number | null;
  jsonObject: (value: unknown, max: number) => { serialized: string } | null;
  normalizeMetadata: (value: unknown) => string | null;
};

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const loadModule = (): WalkaroundModule => {
  const module = { exports: {} as WalkaroundModule };
  new Function("module", "exports", read("pb_hooks/walkarounds.js"))(
    module,
    module.exports,
  );
  return module.exports;
};

describe("Vehicle Walkaround PocketBase boundary", () => {
  it("enforces the v1 media and consent limits", () => {
    const walkarounds = loadModule();
    expect(walkarounds.MAX_CLIPS).toBe(12);
    expect(walkarounds.MAX_TOTAL_BYTES).toBe(10 * 1024 * 1024 * 1024);
    expect(walkarounds.MAX_TOTAL_DURATION_MS).toBe(20 * 60 * 1000);
    expect(walkarounds.RELEASE_VERSION).toBe("walkaround-v1");
    expect(walkarounds.integer(12, 1, 12)).toBe(12);
    expect(walkarounds.integer(13, 1, 12)).toBeNull();
    expect(walkarounds.cleanString("safe\u0000text", 100)).toBeNull();
  });

  it("accepts bounded editable metadata and requires made-for-kids selection", () => {
    const walkarounds = loadModule();
    expect(
      JSON.parse(
        walkarounds.normalizeMetadata({
          title: "2026 Ford Explorer walkaround",
          description: "A detailed look at the verified vehicle.",
          tags: ["Ford", "Explorer", "Ford"],
          madeForKids: false,
        })!,
      ),
    ).toEqual({
      title: "2026 Ford Explorer walkaround",
      description: "A detailed look at the verified vehicle.",
      tags: ["Ford", "Explorer"],
      madeForKids: false,
      thumbnailCopy: "",
      claimEvidence: [],
      captionsText: "",
      chapters: [],
    });
    expect(
      walkarounds.normalizeMetadata({
        title: "Vehicle",
        description: "Details",
        tags: [],
      }),
    ).toBeNull();
    expect(
      walkarounds.normalizeMetadata({
        title: "Vehicle",
        description: "Details",
        tags: [],
        madeForKids: true,
      }),
    ).not.toBeNull();
  });

  it("creates only locked tenant-bound collections", () => {
    const migration = read("pb_migrations/1751100000_vehicle_walkaround_studio.js");
    for (const collection of [
      "walkaround_projects",
      "walkaround_assets",
      "walkaround_releases",
      "walkaround_provider_jobs",
      "walkaround_publications",
      "walkaround_youtube_connections",
      "walkaround_worker_tasks",
      "walkaround_worker_events",
      "walkaround_audit_events",
    ]) {
      expect(migration).toContain(`name: "${collection}"`);
    }
    expect(migration).toContain("listRule: null");
    expect(migration).toContain('name: "signature_png"');
    expect(migration).toContain("protected: true");
    expect(migration).toContain("idx_walkaround_provider_request");
    expect(migration).toContain("idx_walkaround_task_idempotency");
    expect(migration).toContain('values: ["one_take", "multi_clip"]');
  });

  it("wires every app and signed worker route", () => {
    const main = read("pb_hooks/main.pb.js");
    for (const route of [
      "/api/app/walkarounds",
      "/api/app/walkarounds/:id/uploads",
      "/api/app/walkarounds/:id/uploads/:assetId/finalize",
      "/api/app/walkarounds/:id/process",
      "/api/app/walkarounds/:id/review",
      "/api/app/walkarounds/:id/re-edit",
      "/api/app/walkarounds/:id/approve",
      "/api/app/walkarounds/:id/publish",
      "/api/app/walkarounds/youtube/status",
      "/api/app/walkarounds/youtube/connect",
      "/api/app/walkarounds/youtube/disconnect",
      "/api/app/walkarounds/youtube/complete",
      "/api/internal/walkarounds/:id/production-context",
      "/api/internal/walkarounds/:id/production-events",
      "/api/internal/walkarounds/:id/publication-context",
      "/api/internal/walkarounds/:id/publication-events",
      "/api/internal/walkarounds/:id/assets/:assetId/signed-read",
      "/api/internal/walkarounds/:id/youtube/upload-session",
      "/api/internal/walkarounds/:id/youtube/upload-next",
      "/api/internal/walkaround-tasks/claim",
      "/api/internal/walkaround-tasks/:taskId/ack",
      "/api/internal/walkaround-tasks/:taskId/renew",
      "/api/internal/walkaround-tasks/:taskId/nack",
    ]) {
      expect(main).toContain(`"${route}"`);
    }
  });

  it("keeps private-key material and shell execution out of the hooks", () => {
    // The deleted legacy Vertex path minted service-account JWTs by writing
    // the private key to disk and piping it through openssl. Nothing in
    // pb_hooks may reintroduce shell execution or on-disk key material.
    for (const file of [
      "pb_hooks/main.pb.js",
      "pb_hooks/helpers.js",
      "pb_hooks/walkarounds.js",
      "pb_hooks/websitePublications.js",
      "pb_hooks/requestPolicies.js",
    ]) {
      const source = read(file);
      expect(source).not.toContain("openssl");
      expect(source).not.toContain("$os.cmd(");
      expect(source).not.toContain("VERTEX_SERVICE_ACCOUNT_JSON");
    }
  });

  it("binds worker signatures to method, path, idempotency key, and a nonce", () => {
    const hooks = read("pb_hooks/walkarounds.js");

    // v2 message layout — must stay byte-identical to the automation signer
    // (automation/src/shared/clients/backend.ts signWalkaroundRequest, covered
    // by automation/src/shared/clients/backend.test.ts).
    const v2Pieces = [
      '"v2." +',
      "timestamp +",
      "nonce +",
      "method +",
      "path +",
      "idempotency +",
      "bodyHash,",
    ];
    for (const piece of v2Pieces) {
      expect(hooks).toContain(piece);
    }
    expect(hooks).toContain('c.request().header.get("X-Walkaround-Nonce")');
    expect(hooks).toContain('c.request().header.get("X-Walkaround-Signature-Version")');
    expect(hooks).toContain("c.request().method");
    expect(hooks).toContain("c.request().url.path");

    // Verified nonces are single-use inside the freshness window, and only
    // verified nonces enter the cache.
    expect(hooks).toContain("_seenWalkaroundNonces");
    expect(hooks).toContain('return deny("replayed nonce")');
    const markIndex = hooks.indexOf("_seenWalkaroundNonces[nonce] = Date.now()");
    const verifyIndex = hooks.indexOf('return deny("signature mismatch")');
    expect(markIndex).toBeGreaterThan(verifyIndex);

    // Legacy v1 stays behind a kill switch scheduled for removal.
    expect(hooks).toContain("WALKAROUND_SIGNATURE_V1_ALLOWED");

    // Rejections are audited and both surfaces are rate limited.
    expect(hooks).toContain('"walkaround_internal_unauthorized"');
    expect(hooks).toContain('"walkaround-internal:" + helpers.clientIP(c)');
    expect(hooks).toContain('"walkaround-app:" + helpers.clientIP(c)');
    expect(hooks).toContain('dealerActionAllowed(c, helpers, context, "creation"');
  });

  it("requires a signed release for every customer-audience capture", () => {
    const hook = read("pb_hooks/walkarounds.js");
    const gate = hook.slice(
      hook.indexOf("function validRelease("),
      hook.indexOf("function enqueueTask("),
    );
    // The self-attested flag may only ADD a release requirement. Keying the
    // gate on it alone let a client omit the field and skip consent entirely.
    expect(gate).toContain('project.getString("audience_mode") === "customer"');
    expect(gate).not.toMatch(
      /^\s*if \(!bool\(project, "contains_identifiable_non_employee"\)\) return true;/m,
    );
  });

  it("gates publishing behind the same manager authority as approval", () => {
    const hook = read("pb_hooks/walkarounds.js");
    const publish = hook.slice(
      hook.indexOf("function publishProject("),
      hook.indexOf("function deleteProject("),
    );
    // publishProject can self-mint an approval when the dealer does not
    // require one, so it must not be reachable by a plain salesperson.
    expect(publish).toContain("projectForContext(c, helpers, { manager: true })");
  });

  it("keeps bearer URLs and OAuth tokens out of PocketBase persistence", () => {
    const hook = read("pb_hooks/walkarounds.js");
    const migration = read("pb_migrations/1751100000_vehicle_walkaround_studio.js");
    expect(migration).not.toContain('name: "upload_session_url"');
    expect(migration).not.toContain('name: "upload_session_headers"');
    expect(migration).not.toMatch(/oauth[_-]?token/i);
    expect(hook).toContain('timestamp + "." + rawBody');
    expect(hook).toContain("Idempotency-Key");
    expect(hook).toContain("WALKAROUND_WORKER_SIGNING_SECRET");
    expect(hook).toContain("YOUTUBE_CONFIG_HOLD");
    expect(hook).toContain("WALKAROUND_STUDIO_ENABLED");
    expect(hook).toContain("stateReference");
  });
});
