import { describe, expect, it } from "vitest";

import type {
  EditPlan,
  PreparedMedia,
  ProductionContext,
  YoutubeMetadata,
} from "../schemas/walkaround.js";
import {
  MAX_CLIPS,
  validateEditPlan,
  validateMetadata,
  validateProductionContext,
} from "./validation.js";

function context(): ProductionContext {
  return {
    projectId: "project-1",
    revision: 1,
    dealerId: "dealer-1",
    ownerId: "user-1",
    mode: "inventory",
    productionState: "uploaded",
    vehicleSnapshot: { vin: "1FA6P8CF0N5100000", year: "2022", model: "Mustang GT" },
    branding: {},
    bannedPhrases: ["best price"],
    music: { enabled: false },
    consent: {
      version: "v1",
      video: true,
      voice: true,
      cloudProcessing: true,
      youtube: true,
      identifiableNonEmployee: false,
    },
    approvalRequired: true,
    assets: [
      {
        id: "asset-1",
        order: 0,
        gcsUri: "gs://private/asset-1.mov",
        mimeType: "video/quicktime",
        sizeBytes: 1024,
        durationSeconds: 60,
        sha256: "a".repeat(64),
        finalized: true,
      },
    ],
    providerJobs: [],
  };
}

const media: PreparedMedia = {
  normalizedAssets: [
    {
      sourceAssetId: "asset-1",
      gcsUri: "gs://private/normalized.mp4",
      renderUrl: "https://storage.example.test/signed",
      durationSeconds: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      sha256: "b".repeat(64),
    },
  ],
  transcript: [],
  measurements: {},
  warnings: [],
};

const editPlan: EditPlan = {
  clips: [
    {
      sourceAssetId: "asset-1",
      sourceStartSeconds: 0,
      sourceEndSeconds: 20,
      reason: "Opening walkaround",
    },
  ],
  omissions: [],
  overlays: [],
  chapters: [],
  teaserClipIndexes: [0],
  warnings: [],
};

describe("walkaround production boundaries", () => {
  it("accepts a valid finalized source set", () => {
    expect(() => validateProductionContext(context())).not.toThrow();
  });

  it("rejects more than twelve clips before paid work", () => {
    const value = context();
    value.assets = Array.from({ length: MAX_CLIPS + 1 }, (_, order) => ({
      ...value.assets[0],
      id: `asset-${order}`,
      order,
      gcsUri: `gs://private/asset-${order}.mov`,
    }));
    expect(() => validateProductionContext(value)).toThrow(/1-12/);
  });

  it("requires cloud-processing consent", () => {
    const value = context();
    value.consent.cloudProcessing = false;
    expect(() => validateProductionContext(value)).toThrow(/consent/);
  });

  it("rejects out-of-bounds edit decisions", () => {
    const value = structuredClone(editPlan);
    value.clips[0].sourceEndSeconds = 61;
    expect(() => validateEditPlan(value, media, [])).toThrow(/invalid source interval/);
  });

  it("rejects banned overlays and metadata claims", () => {
    const value = structuredClone(editPlan);
    value.overlays.push({
      text: "Best price today",
      evidence: "none",
      atSeconds: 1,
      durationSeconds: 2,
    });
    expect(() => validateEditPlan(value, media, ["best price"])).toThrow(/banned/);

    const metadata: YoutubeMetadata = {
      title: "2022 Mustang GT",
      description: "Guaranteed clean Carfax",
      tags: [],
      chapters: [],
      thumbnailCopy: "Mustang GT",
      claimEvidence: [],
    };
    expect(() => validateMetadata(metadata, [])).toThrow(/prohibited/);
  });

  it("rejects teasers longer than thirty seconds", () => {
    const value = structuredClone(editPlan);
    value.clips[0].sourceEndSeconds = 31;
    expect(() => validateEditPlan(value, media, [])).toThrow(/30 seconds/);
  });
});
