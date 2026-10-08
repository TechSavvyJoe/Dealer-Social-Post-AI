import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCapacityHarness } from "../test/providerCapacityHarness";

let capacity: ReturnType<typeof createCapacityHarness>;
beforeEach(() => {
  capacity = createCapacityHarness();
});
afterEach(() => {
  capacity.close();
  vi.useRealTimers();
});

describe("durable provider capacity", () => {
  it("refuses paid work if the lease table is missing", () => {
    capacity.database.exec("DROP TABLE _provider_capacity");
    expect(capacity.acquire("provider:global", 12).ok).toBe(false);
  });
  it("does not interpolate caller keys into SQL", () => {
    const key = "scope'); DROP TABLE _provider_capacity; --";
    expect(capacity.acquire(key, 1).ok).toBe(true);
    expect(capacity.acquire(key, 1).ok).toBe(false);
    expect(capacity.acquire("different-store", 1).ok).toBe(true);
  });
  it("cannot release a replacement after an expired lease", () => {
    vi.useFakeTimers();
    const first = capacity.acquire("provider:global", 1);
    vi.advanceTimersByTime(361_000);
    const replacement = capacity.acquire("provider:global", 1);
    expect(replacement.ok).toBe(true);
    first.release?.();
    expect(capacity.acquire("provider:global", 1).ok).toBe(false);
    replacement.release?.();
    expect(capacity.acquire("provider:global", 1).ok).toBe(true);
  });
  it("bounds the scope table and recovers after expired callers", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 512; i++)
      expect(capacity.acquire(`store:${i}`, 1).ok).toBe(true);
    expect(capacity.acquire("new-store", 1).ok).toBe(false);
    vi.advanceTimersByTime(361_000);
    expect(capacity.acquire("new-store", 1).ok).toBe(true);
  });
});
