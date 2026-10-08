import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSpinFrames, saveVehicleSpin, type VehicleSpin } from "./vehicleSpins";
import { setActiveAuthEpoch } from "../utils/authBoundary";

const spin: VehicleSpin = {
  id: "private-spin",
  vehicle: {
    title: "Vehicle",
    vin: "",
    stock: "",
    mileage: "",
    highlights: [],
    caption: "",
  },
  frameCount: 24,
  dealerName: "Dealer",
  background: "original",
  state: "uploading",
  canDeliver: false,
  uploadedAngles: [],
};
const reply = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => setActiveAuthEpoch(50));
afterEach(() => {
  vi.unstubAllGlobals();
  setActiveAuthEpoch(0);
});

describe("spin session boundaries", () => {
  it("does not upload frames after a create response crosses accounts", async () => {
    const fetch = vi.fn(async () => {
      setActiveAuthEpoch(51);
      return reply(spin);
    });
    vi.stubGlobal("fetch", fetch);
    const onCreated = vi.fn();
    await expect(
      saveVehicleSpin(
        {
          vehicle: spin.vehicle,
          background: "original",
          frames: Array.from({ length: 24 }, () => new Blob(["test"])),
        },
        { signal: new AbortController().signal, onCreated, onProgress: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });
  it("resumes only missing angles and finalizes after every upload", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.endsWith("/private-spin"))
        return reply({
          ...spin,
          uploadedAngles: Array.from({ length: 23 }, (_, i) => i),
        });
      if (path.endsWith("/finish")) return reply({ ...spin, state: "pending" });
      return reply({ saved: true });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await saveVehicleSpin(
      {
        vehicle: spin.vehicle,
        background: "original",
        frames: Array.from({ length: 24 }, () => new Blob(["test"])),
        existing: spin,
      },
      { signal: new AbortController().signal, onCreated: vi.fn(), onProgress: vi.fn() },
    );
    expect(calls).toEqual([
      "/api/app/vehicle-spins/private-spin",
      "/api/app/vehicle-spins/private-spin/frames/23",
      "/api/app/vehicle-spins/private-spin/finish",
    ]);
    expect(result.state).toBe("pending");
  });
  it("does not complete a private frame load after the session changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        setActiveAuthEpoch(51);
        return new Response("jpeg", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      }),
    );
    await expect(
      loadSpinFrames(spin, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("sends public capability in a header without cookies or token-bearing paths", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("jpeg", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await loadSpinFrames(
      { ...spin, frameCount: 1 },
      { signal: new AbortController().signal, publicToken: "a".repeat(48) },
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/public/vehicle-spin/frames/0",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        headers: { "X-Vehicle-Spin": "a".repeat(48) },
      }),
    );
  });
});
