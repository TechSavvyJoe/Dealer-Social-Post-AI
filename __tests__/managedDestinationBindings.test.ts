import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const row = (id: string, values: Record<string, unknown>) => ({
  id,
  getString: (key: string) => String(values[key] ?? ""),
  get: (key: string) => values[key],
  getBool: (key: string) => !!values[key],
  getInt: (key: string) => Number(values[key] || 0),
});
function harness(
  file: string,
  snapshot: Record<string, unknown>,
  dao: unknown = {},
  receipt: unknown = {},
) {
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  const send = vi.fn(() => ({ statusCode: 200, json: receipt }));
  const resolver = {
    runtimeSnapshot: vi.fn(() => snapshot),
    runtimeValue: (key: string) =>
      (snapshot.values as Record<string, string>)[key] || "",
  };
  new Function(
    "module",
    "exports",
    "__hooks",
    "require",
    "$app",
    "$security",
    "$http",
    "$os",
    readFileSync(resolve(process.cwd(), file), "utf8"),
  )(
    module,
    module.exports,
    "/hooks",
    (name: string) => (name.endsWith("/connectionConfig.js") ? resolver : { send }),
    { dao: () => dao },
    { sha256: sha },
    { send },
    {
      getenv: () => {
        throw new Error("must use resolver");
      },
    },
  );
  return { api: module.exports, send, resolver };
}
const websiteSnapshot = (dealer = "dealer-a") => ({
  source: "managed",
  enabled: true,
  configured: true,
  revision: 3,
  identity: sha("target-a"),
  values: {
    CUSTOMER_HUB_URL: "https://approved.example",
    CUSTOMER_HUB_SECRET: "synthetic-test-secret".repeat(3),
    CUSTOMER_HUB_DESTINATION_ID: "dealer-site",
    CUSTOMER_HUB_DEALER_ID: dealer,
  },
});
const infrastructure = () => ({
  source: "managed",
  enabled: true,
  configured: true,
  revision: 4,
  identity: sha("private-infrastructure"),
  values: {
    WALKAROUND_STUDIO_ENABLED: "true",
    WALKAROUND_GCS_BUCKET: "private-media-test",
    WALKAROUND_UPLOAD_BROKER_URL: "https://upload.example",
    WALKAROUND_UPLOAD_BROKER_TOKEN: "synthetic-upload-token".repeat(3),
    WALKAROUND_YOUTUBE_BROKER_URL: "https://youtube-broker.example",
    WALKAROUND_YOUTUBE_BROKER_TOKEN: "synthetic-youtube-token".repeat(3),
  },
});
function projectHarness(
  options: {
    missing?: string;
    wrongTenant?: boolean;
    revision?: number;
    youtube?: boolean;
    receipt?: unknown;
  } = {},
) {
  const snapshot = infrastructure();
  const masterSha = sha("master");
  const connection = row("channel-record", {
    dealer: "dealer-a",
    channel_id: "channel-test",
    credential_reference: "synthetic-reference",
  });
  const project = row("project-a", {
    dealer: options.wrongTenant ? "dealer-b" : "dealer-a",
    config_revision: options.revision ?? 4,
    destination_identity: snapshot.identity,
    production_state: "review_ready",
    metadata_revision: 2,
    metadata_validated_revision: 2,
    qc_passed: true,
    master_sha256: masterSha,
    audience_mode: "inventory",
    approved_master_sha256: masterSha,
    approved_metadata_revision: 2,
    youtube_identity: options.youtube
      ? sha("channel-record\nchannel-test\nsynthetic-reference")
      : "",
    metadata_json: JSON.stringify({
      title: "Verified vehicle",
      description: "Synthetic vehicle details",
      tags: [],
      madeForKids: false,
    }),
  });
  const assets = [
    "transcript",
    "edit_plan",
    "master",
    "teaser",
    "captions",
    "thumbnail",
  ]
    .filter((kind) => kind !== options.missing)
    .map((kind) =>
      row(kind, {
        project: "project-a",
        dealer: "dealer-a",
        kind,
        state: "ready",
        metadata_revision: 2,
        sha256: kind === "master" ? masterSha : sha(kind),
        size_bytes: 120,
        storage_key: "walkarounds/dealer-a/project-a/" + kind,
      }),
    );
  const publication = row("publication-a", {
    dealer: "dealer-a",
    project: "project-a",
    video_id: "privateVideoTest",
    channel_id: "channel-test",
    master_sha256: masterSha,
    metadata_revision: 2,
    actual_visibility: "private",
    playback_verified_at: "worker-asserted-value",
  });
  const dao = {
    findRecordById: (collection: string) =>
      collection === "dealers" ? row("dealer-a", {}) : project,
    findRecordsByFilter: () => assets,
    findFirstRecordByFilter: (collection: string) =>
      collection === "walkaround_youtube_connections" ? connection : publication,
  };
  return {
    ...harness("pb_hooks/walkarounds.js", snapshot, dao, options.receipt),
    project,
    snapshot,
    connection,
  };
}

describe("managed destination binding and authoritative readiness", () => {
  it("uses scoped managed website mapping and exposes no shared secret", () => {
    const { api } = harness("pb_hooks/websitePublications.js", websiteSnapshot());
    expect(api.destinationConfiguration("dealer-a").enabled).toBe(true);
    expect(api.destinationConfiguration("dealer-b").enabled).toBe(false);
    expect(
      JSON.stringify(api.publicDestinationConfiguration("dealer-a")),
    ).not.toContain("synthetic-test-secret");
    expect(api.destinationConfiguration("dealer-a").endpointUrl).toBe(
      "https://approved.example/api/integrations/dealer-social/content",
    );
  });
  it("holds website rows after identity or revision changes, including unbound old rows", () => {
    const snapshot = websiteSnapshot();
    const { api } = harness("pb_hooks/websitePublications.js", snapshot);
    const config = api.destinationConfiguration("dealer-a");
    const values = {
      dealer: "dealer-a",
      destination_id: "dealer-site",
      config_revision: 3,
      destination_identity: snapshot.identity,
    };
    expect(
      api.publicationDestinationMatches(row("outbox", values), config, "dealer-a"),
    ).toBe(true);
    expect(
      api.publicationDestinationMatches(
        row("outbox", values),
        { ...config, identity: sha("rotated") },
        "dealer-a",
      ),
    ).toBe(false);
    expect(
      api.publicationDestinationMatches(
        row("outbox", values),
        { ...config, revision: 4 },
        "dealer-a",
      ),
    ).toBe(false);
    expect(
      api.publicationDestinationMatches(
        row("outbox", { ...values, destination_identity: "" }),
        config,
        "dealer-a",
      ),
    ).toBe(false);
    expect(
      api.publicationDestinationMatches(row("outbox", values), config, "dealer-b"),
    ).toBe(false);
  });
  it("rejects cross-dealer project proof before contacting a broker", () => {
    const { api, send } = projectHarness({ wrongTenant: true });
    expect(() => api.verifyCompletedProject("dealer-a", "project-a", 4)).toThrow(
      "WALKAROUND_DEALER_CONFLICT",
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("holds existing project work on a changed bucket/broker identity or revision", () => {
    const { api, project, snapshot, connection } = projectHarness();
    expect(api.projectConfigurationMatches(project, snapshot, connection)).toBe(true);
    expect(
      api.projectConfigurationMatches(
        project,
        { ...snapshot, identity: sha("new-bucket") },
        connection,
      ),
    ).toBe(false);
    expect(
      api.projectConfigurationMatches(
        project,
        { ...snapshot, revision: 5 },
        connection,
      ),
    ).toBe(false);
  });
  it("requires every output and exact metadata revision for readiness", () => {
    for (const missing of [
      "master",
      "teaser",
      "captions",
      "thumbnail",
      "transcript",
      "edit_plan",
    ]) {
      const { api } = projectHarness({ missing });
      expect(api.verifyCompletedProject("dealer-a", "project-a", 4).ready).toBe(false);
    }
    const { api } = projectHarness({ revision: 3 });
    expect(() => api.verifyCompletedProject("dealer-a", "project-a", 4)).toThrow(
      "WALKAROUND_CONFIG_CHANGED",
    );
  });
  it("proves complete processing without exposing media paths or credentials", () => {
    const { api } = projectHarness();
    const proof = api.verifyCompletedProject("dealer-a", "project-a", 4);
    expect(proof.ready).toBe(true);
    expect(proof.capabilities).toEqual(["processing"]);
    expect(JSON.stringify(proof)).not.toMatch(
      /synthetic-reference|synthetic-upload-token|synthetic-youtube-token|storage_key|private-media-test/,
    );
  });
  it("trusts private authoritative playback receipt, never a worker playback flag", () => {
    const unverified = projectHarness({
      youtube: true,
      receipt: { playbackVerified: false, privacyStatus: "private" },
    });
    expect(
      unverified.api.verifyCompletedProject("dealer-a", "project-a", 4).capabilities,
    ).toEqual(["processing"]);
    const verified = projectHarness({
      youtube: true,
      receipt: {
        playbackVerified: true,
        privacyStatus: "private",
        uploadStatus: "processed",
        processingStatus: "succeeded",
      },
    });
    expect(
      verified.api.verifyCompletedProject("dealer-a", "project-a", 4).capabilities,
    ).toEqual(["processing", "youtube"]);
    const publicReceipt = projectHarness({
      youtube: true,
      receipt: {
        playbackVerified: true,
        privacyStatus: "public",
        uploadStatus: "processed",
        processingStatus: "succeeded",
      },
    });
    expect(
      publicReceipt.api.verifyCompletedProject("dealer-a", "project-a", 4).youtubeReady,
    ).toBe(false);
  });
});
