import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WALKAROUND_LIMITS,
  createWalkaroundProject,
  completeYouTubeConnection,
  disconnectYouTubeConnection,
  getWalkaroundProject,
  isWalkaroundStudioEnabled,
  loadUploadProgress,
  matchExistingSourceAsset,
  requestWalkaroundReedit,
  uploadWalkaroundFile,
  validateWalkaroundClips,
  startYouTubeConnection,
} from "./walkarounds";
import type { DecodedVehicle } from "./vinDecoder";

const videoFile = (
  name = "walkaround.mp4",
  type = "video/mp4",
  size?: number,
): File => {
  const file = new File([new Uint8Array(16)], name, { type, lastModified: 123 });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

const projectResponse = () =>
  new Response(
    JSON.stringify({
      id: "project-1",
      audience: "inventory",
      captureMode: "one_take",
      productionState: "draft",
      publicationState: "not_requested",
      reviewRevision: 0,
      approvalRequired: false,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );

const decodedVehicle: DecodedVehicle = {
  vin: "1HGCM82633A004352",
  year: "2003",
  make: "Honda",
  model: "Accord",
  trim: "EX",
  bodyClass: "Coupe",
  engineDisplacementL: "3.0",
  doors: "2",
  plantCountry: "United States",
  summary: "2003 Honda Accord EX",
  empty: false,
};

describe("walkaround client contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it("enforces clip count, duration, total bytes, recording mode, and media type", () => {
    expect(isWalkaroundStudioEnabled("true")).toBe(true);
    expect(isWalkaroundStudioEnabled("false")).toBe(false);
    expect(isWalkaroundStudioEnabled(undefined)).toBe(false);
    const tooMany = Array.from({ length: 13 }, (_, index) => ({
      file: videoFile(`clip-${index}.mp4`),
      durationSeconds: 100,
    }));
    const result = validateWalkaroundClips(tooMany, "one_take");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("One-take mode accepts exactly one video.");
    expect(result.errors).toContain("Use no more than 12 clips.");
    expect(result.errors).toContain(
      "Keep the combined walkaround at 20 minutes or less.",
    );

    const oversized = validateWalkaroundClips(
      [
        {
          file: videoFile(
            "large.mov",
            "video/quicktime",
            WALKAROUND_LIMITS.maxBytes + 1,
          ),
          durationSeconds: 30,
        },
      ],
      "one_take",
    );
    expect(oversized.errors).toContain("Keep the combined upload at 10 GB or less.");

    const wrongType = validateWalkaroundClips(
      [
        {
          file: videoFile("renamed.mp4", "application/octet-stream"),
          durationSeconds: 30,
        },
      ],
      "one_take",
    );
    expect(wrongType.errors).toContain("Clip 1 must be MOV, MP4, or WebM.");

    const iosEmptyMime = validateWalkaroundClips(
      [{ file: videoFile("iphone.MOV", ""), durationSeconds: 30 }],
      "one_take",
    );
    expect(iosEmptyMime.valid).toBe(true);
  });

  it("fails closed on a malformed project response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "project-only" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      createWalkaroundProject({ audience: "inventory", captureMode: "one_take" }),
    ).rejects.toThrow("invalid project");
  });

  it("sends confirmed manufacturer facts only when the VIN still matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(projectResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createWalkaroundProject({
      audience: "inventory",
      captureMode: "one_take",
      vin: " 1hgcm82633a004352 ",
      decodedVehicle: { ...decodedVehicle, fuelType: "  " },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.vehicleSnapshot).toEqual({
      vinOrStock: "1hgcm82633a004352",
      year: "2003",
      make: "Honda",
      model: "Accord",
      trim: "EX",
      bodyClass: "Coupe",
      engineDisplacementL: "3.0",
      doors: "2",
      plantCountry: "United States",
    });
  });

  it("omits decoded facts when the user changes the VIN", async () => {
    const fetchMock = vi.fn().mockResolvedValue(projectResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createWalkaroundProject({
      audience: "inventory",
      captureMode: "one_take",
      vin: "2HGCM82633A004352",
      decodedVehicle,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.vehicleSnapshot).toEqual({ vinOrStock: "2HGCM82633A004352" });
  });

  it("omits unverified lookup facts even if the VIN still matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(projectResponse());
    vi.stubGlobal("fetch", fetchMock);
    await createWalkaroundProject({
      audience: "inventory",
      captureMode: "one_take",
      vin: decodedVehicle.vin,
      decodedVehicle: { ...decodedVehicle, empty: true },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.vehicleSnapshot).toEqual({ vinOrStock: decodedVehicle.vin });
  });

  it("keeps legacy stock-number input valid without decoded facts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(projectResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createWalkaroundProject({
      audience: "inventory",
      captureMode: "one_take",
      vin: "  STOCK-84 ",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.vehicleSnapshot).toEqual({ vinOrStock: "STOCK-84" });
  });

  it("normalizes worker metadata aliases for the review editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "project-1",
            audience: "inventory",
            captureMode: "multi_clip",
            productionState: "review_ready",
            publicationState: "not_requested",
            reviewRevision: 2,
            approvalRequired: false,
            captionsText: "Verified captions",
            metadata: {
              title: "Walkaround",
              description: "Details",
              tags: [],
              madeForKids: false,
              thumbnailCopy: "See it up close",
              chapters: [{ atSeconds: 42, title: "Interior" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const project = await getWalkaroundProject("project-1");
    expect(project.metadata).toMatchObject({
      thumbnailText: "See it up close",
      captionsText: "Verified captions",
      chapters: [{ seconds: 42, label: "Interior" }],
    });
  });

  it("matches a reselected failed clip without colliding with finalized sources", () => {
    const file = videoFile("rear.mp4", "video/mp4", 200);
    const assets = [
      {
        id: "front",
        kind: "source",
        order: 1,
        state: "verified",
        filename: "front.mp4",
        sizeBytes: 100,
      },
      {
        id: "rear",
        kind: "source",
        order: 2,
        state: "uploading",
        filename: "rear.mp4",
        sizeBytes: 200,
      },
    ];
    expect(matchExistingSourceAsset(assets, file, -1, new Set(), "rear")?.id).toBe(
      "rear",
    );
    expect(matchExistingSourceAsset(assets, file, 0)).toBeUndefined();
    expect(
      matchExistingSourceAsset(assets, file, -1, new Set(["rear"]), "rear"),
    ).toBeUndefined();
  });

  it("starts and completes manager YouTube authorization using only the state reference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorizationUrl: "https://accounts.google.com/o/oauth2/auth?state=opaque",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ connected: true, channelTitle: "Example Ford" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(startYouTubeConnection()).resolves.toMatchObject({
      authorizationUrl: expect.stringContaining("accounts.google.com"),
    });
    await expect(completeYouTubeConnection("opaque-state-reference")).resolves.toEqual({
      connected: true,
      channelTitle: "Example Ford",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      stateReference: "opaque-state-reference",
    });
    await expect(disconnectYouTubeConnection()).resolves.toEqual({ connected: false });
    expect(fetchMock.mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("queues a bounded re-edit separately from metadata review and refreshes status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "queued", reviewRevision: 3 }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "project-1",
            audience: "inventory",
            captureMode: "one_take",
            productionState: "queued",
            publicationState: "not_requested",
            reviewRevision: 3,
            approvalRequired: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const project = await requestWalkaroundReedit("project-1", {
      revision: 2,
      instructions: "Remove the opening false start.",
      captionsText: "Corrected captions",
    });
    expect(project.productionState).toBe("queued");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/app/walkarounds/project-1/re-edit");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      revision: 2,
      captionsText: "Corrected captions",
    });
  });

  it("persists the last acknowledged chunk when an upload is interrupted", async () => {
    const file = videoFile("resume.mp4", "video/mp4", WALKAROUND_LIMITS.chunkBytes + 4);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assetId: "asset-1",
            sessionUrl: "https://upload.example/session",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${WALKAROUND_LIMITS.chunkBytes / 2 - 1}` },
        }),
      )
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadWalkaroundFile("project-1", file, 0, 30)).rejects.toThrow(
      "Upload paused",
    );
    expect(loadUploadProgress("project-1", "asset-1")).toMatchObject({
      filename: "resume.mp4",
      nextByte: WALKAROUND_LIMITS.chunkBytes / 2,
      size: WALKAROUND_LIMITS.chunkBytes + 4,
    });
    expect(loadUploadProgress("project-1", "asset-1")).not.toHaveProperty("sessionUrl");
  });
});
