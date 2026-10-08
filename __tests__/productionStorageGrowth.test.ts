import { describe, expect, it } from "vitest";
import {
  selectDataVolume,
  validateGrowthRequest,
} from "../scripts/grow-fly-storage.mjs";

const sha = "a".repeat(40);
const writer = {
  id: "148e417ad05728",
  state: "started",
  image_ref: { labels: { GH_SHA: sha } },
  config: { mounts: [{ path: "/pb/pb_data", volume: "vol_1234567890abcde" }] },
};
const volume = {
  id: "vol_1234567890abcde",
  name: "pb_data",
  size_gb: 1,
  state: "created",
  attached_machine_id: writer.id,
};
const health = {
  ok: true,
  releaseSha: sha,
  backup: {
    status: "verified",
    verifiedReleaseSha: sha,
    lastVerifiedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
};

describe("the approved production storage plan", () => {
  it("selects only the existing data volume attached to the exact live writer", () => {
    expect(selectDataVolume([writer], [volume], sha)).toEqual({
      machineId: writer.id,
      volumeId: volume.id,
      allocatedGB: 1,
    });
    expect(
      selectDataVolume([writer], [{ ...volume, size_gb: 60 }], sha).allocatedGB,
    ).toBe(60);
  });

  it.each([
    [[], [volume]],
    [[writer, writer], [volume]],
    [[{ ...writer, config: {} }], [volume]],
    [[{ ...writer, config: { mounts: [{ path: "/", volume: volume.id }] } }], [volume]],
    [
      [
        {
          ...writer,
          config: { mounts: [...writer.config.mounts, ...writer.config.mounts] },
        },
      ],
      [volume],
    ],
    [[writer], [volume, volume]],
    [[writer], [{ ...volume, name: "other_data" }]],
    [[writer], [{ ...volume, attached_machine_id: "anothermachine" }]],
    [[writer], [{ ...volume, state: "pending_destroy" }]],
    [[writer], [{ ...volume, size_gb: 0 }]],
    [[writer], [{ ...volume, size_gb: 61 }]],
    [[writer], [{ ...volume, size_gb: 1.5 }]],
  ])(
    "refuses unknown, ambiguous or unreviewed storage targets",
    (machines, volumes) => {
      expect(() => selectDataVolume(machines, volumes, sha)).toThrow();
    },
  );

  it("allows a read-only plan without a charge approval", () => {
    expect(() => validateGrowthRequest("inspect-plan", "", sha, health)).not.toThrow();
  });

  it("requires explicit approval for the one fixed 60 GB extension", () => {
    expect(() =>
      validateGrowthRequest(
        "extend-to-60gb",
        "approve-60gb-monthly-volume",
        sha,
        health,
      ),
    ).not.toThrow();
    expect(() => validateGrowthRequest("extend-to-60gb", "", sha, health)).toThrow(
      "Explicit approval",
    );
    expect(() =>
      validateGrowthRequest(
        "extend-to-600gb",
        "approve-60gb-monthly-volume",
        sha,
        health,
      ),
    ).toThrow("Explicit approval");
  });

  it.each([
    { ...health, ok: false },
    { ...health, releaseSha: "b".repeat(40) },
    { ...health, backup: { status: "unverified", verifiedReleaseSha: sha } },
    { ...health, backup: { status: "verified", verifiedReleaseSha: "b".repeat(40) } },
    { ...health, backup: null },
    {
      ...health,
      backup: {
        ...health.backup,
        lastVerifiedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      },
    },
    {
      ...health,
      backup: {
        ...health.backup,
        lastVerifiedAt: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
      },
    },
  ])("refuses growth without release-bound recovery proof", (invalidHealth) => {
    expect(() =>
      validateGrowthRequest(
        "extend-to-60gb",
        "approve-60gb-monthly-volume",
        sha,
        invalidHealth,
      ),
    ).toThrow("recovery-verified");
  });
});
