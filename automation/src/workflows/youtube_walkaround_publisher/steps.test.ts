import { describe, expect, it } from "vitest";

import type { PublicationContext } from "./types.js";
import { validatePublicationContext } from "./steps.js";

function publicationContext(): PublicationContext {
  return {
    projectId: "project-1",
    revision: 12,
    dealerId: "dealer-1",
    ownerId: "user-1",
    mode: "customer",
    productionState: "review_ready",
    publicationState: "not_requested",
    consent: { version: "v1", youtube: true },
    approvalRequired: true,
    approval: {
      approved: true,
      masterSha256: "a".repeat(64),
      metadataRevision: 3,
      approverId: "manager-1",
    },
    master: {
      assetId: "master-1",
      gcsUri: "gs://private/master.mp4",
      sha256: "a".repeat(64),
      sizeBytes: 1_000_000,
    },
    metadataRevision: 3,
    metadata: {
      title: "Walkaround",
      description: "Private customer walkaround",
      tags: [],
      chapters: [],
      thumbnailCopy: "Walkaround",
      claimEvidence: [],
    },
    madeForKids: false,
    requestedVisibility: "unlisted",
    channel: { connected: true, channelId: "channel-1", title: "Dealer" },
  };
}

describe("YouTube publication gate", () => {
  it("accepts an exactly approved unlisted customer video", () => {
    expect(() => validatePublicationContext(publicationContext())).not.toThrow();
  });

  it("invalidates approval when the master changes", () => {
    const value = publicationContext();
    value.master.sha256 = "b".repeat(64);
    expect(() => validatePublicationContext(value)).toThrow(/does not match/);
  });

  it("never allows customer videos to become public", () => {
    const value = publicationContext();
    value.requestedVisibility = "public";
    expect(() => validatePublicationContext(value)).toThrow(/unlisted/);
  });

  it("requires availability attestation for public inventory", () => {
    const value = publicationContext();
    value.mode = "inventory";
    value.requestedVisibility = "public";
    expect(() => validatePublicationContext(value)).toThrow(/availability attestation/);
    value.availabilityAttestationId = "attestation-1";
    expect(() => validatePublicationContext(value)).not.toThrow();
  });
});
