import { beforeEach, describe, expect, it, vi } from "vitest";

import { backend } from "../shared/clients/backend.js";
import {
  recordProductionArtifact,
  recordReviewReadyPackage,
} from "./vehicle_walkaround_producer/steps.js";
import { recordPublicationState } from "./youtube_walkaround_publisher/steps.js";

describe("PocketBase worker event wire contracts", () => {
  beforeEach(() => {
    vi.spyOn(backend, "productionEvent").mockResolvedValue({ revision: 7 });
    vi.spyOn(backend, "publicationEvent").mockResolvedValue({ revision: 7 });
  });

  it("emits one top-level artifact descriptor in backend field names", async () => {
    await recordProductionArtifact({
      projectId: "project-1",
      workflowId: "producer-1",
      expectedRevision: 7,
      eventId: "producer-1:artifact:master:hash",
      artifact: {
        kind: "master",
        storageKey: "walkarounds/dealer/project/master.mp4",
        storageGeneration: "123",
        sha256: "a".repeat(64),
        mimeType: "video/mp4",
        sizeBytes: 1000,
        durationMs: 60000,
        width: 1920,
        height: 1080,
      },
    });
    expect(backend.productionEvent).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        productionState: "quality_check",
        artifact: expect.objectContaining({
          kind: "master",
          mime: "video/mp4",
          sizeBytes: 1000,
          durationMs: 60000,
        }),
      }),
      "producer-1:artifact:master:hash",
    );
  });

  it("emits metadata and QC as top-level review-ready fields", async () => {
    await recordReviewReadyPackage({
      projectId: "project-1",
      workflowId: "producer-1",
      expectedRevision: 7,
      eventId: "producer-1:review-ready",
      metadata: {
        title: "2022 Mustang GT Walkaround",
        description: "A grounded walkaround.",
        tags: ["Mustang"],
        chapters: [],
        thumbnailCopy: "Mustang GT",
        claimEvidence: [],
      },
      evaluation: {
        groundingPassed: true,
        privacyPassed: true,
        continuityPassed: true,
        audioPassed: true,
        visualPassed: true,
        youtubeReady: true,
        reasons: [],
        reshootRequired: false,
      },
    });
    expect(backend.productionEvent).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        productionState: "review_ready",
        metadata: expect.objectContaining({ madeForKids: false }),
        qc: expect.objectContaining({ passed: true }),
      }),
      "producer-1:review-ready",
    );
  });

  it("flattens publication evidence into backend event fields", async () => {
    await recordPublicationState({
      projectId: "project-1",
      workflowId: "publisher-1",
      expectedRevision: 7,
      eventId: "publisher-1:published",
      publicationState: "published_unlisted",
      publicationJson: JSON.stringify({
        videoId: "video_123",
        actualVisibility: "unlisted",
        playbackVerified: true,
      }),
    });
    expect(backend.publicationEvent).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        publicationState: "published_unlisted",
        videoId: "video_123",
        actualVisibility: "unlisted",
        playbackVerified: true,
      }),
      "publisher-1:published",
    );
  });
});
