import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeVin } from "./vinDecoder";
const VIN = "1HGCM82633A004352";
const row = { VIN, ErrorCode: "0", ModelYear: "2003", Make: "HONDA", Model: "Accord" };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const respond = (value: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Results: [value] }) }),
  );
describe("verified VIN lookup", () => {
  it("keeps unknown facts unknown and preserves known partial facts", async () => {
    respond({
      ...row,
      Trim: "Not Applicable",
      Doors: "0",
      FuelTypePrimary: "Unknown",
      DisplacementL: "-",
    });
    const vehicle = await decodeVin(VIN);
    expect(vehicle).toMatchObject({
      vin: VIN,
      make: "HONDA",
      model: "Accord",
      empty: false,
    });
    expect(vehicle.trim).toBeUndefined();
    expect(vehicle.doors).toBeUndefined();
    expect(vehicle.fuelType).toBeUndefined();
    expect(vehicle.engineDisplacementL).toBeUndefined();
  });
  it.each([
    { ErrorCode: "1" },
    { ErrorCode: "0,1" },
    { ErrorCode: "5" },
    { ErrorCode: undefined },
    { VIN: "1HGCM82633A004353" },
    { SuggestedVIN: "1HGCM82633A004353" },
  ])(
    "rejects check-digit, corrected, uncertain, or mismatched records %j",
    async (changes) => {
      respond({ ...row, ...changes });
      const vehicle = await decodeVin(VIN);
      expect(vehicle.empty).toBe(true);
      expect(vehicle.make).toBeUndefined();
      expect(vehicle.summary).toContain("could not be verified");
    },
  );
  it("rejects an ambiguous multi-record response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ Results: [row, row] }) }),
    );
    expect((await decodeVin(VIN)).empty).toBe(true);
  });
  it("does not fetch malformed VINs", async () => {
    respond(row);
    expect((await decodeVin("short")).empty).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts the transport and body when caller cancels", async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        transportSignal = init.signal;
        return new Promise((_resolve, reject) =>
          transportSignal!.addEventListener("abort", () =>
            reject(transportSignal!.reason),
          ),
        );
      }),
    );
    const pending = decodeVin(VIN, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(transportSignal?.aborted).toBe(true);
  });
  it("does not accept a late body that ignored cancellation", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const controller = new AbortController();
    const pending = decodeVin(VIN, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    finish({ Results: [row] });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("bounds a stalled lookup without leaking provider text", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason)),
          ),
      ),
    );
    const pending = decodeVin(VIN);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({
      empty: true,
      summary: expect.stringContaining("Check your connection"),
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
