import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { circuitBreaker, withCircuitBreaker } from "./circuitBreaker";

const SERVICE = "test-service";

const fail = async () => {
  await expect(
    withCircuitBreaker(SERVICE, async () => {
      throw new Error("upstream 503");
    }),
  ).rejects.toThrow();
};

const succeed = () => withCircuitBreaker(SERVICE, async () => "ok");

describe("circuit breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    circuitBreaker.reset(SERVICE);
  });

  afterEach(() => {
    vi.useRealTimers();
    circuitBreaker.reset(SERVICE);
  });

  it("opens after the failure threshold is reached inside the window", async () => {
    for (let i = 0; i < 5; i += 1) await fail();
    expect(circuitBreaker.getState(SERVICE)).toBe("OPEN");
    await expect(succeed()).rejects.toThrow(/currently unavailable/);
  });

  it("keeps serving when sparse failures fall outside the rolling window", async () => {
    // Five failures spread over ~3.5 minutes, each 50s apart. Every individual
    // gap is under the 60s window, but no 60s window ever contains more than
    // two failures, so this is a healthy service with occasional blips — not a
    // degraded one. Tripping here fails image generation closed and silently
    // ships the untouched original photo.
    for (let i = 0; i < 5; i += 1) {
      await fail();
      vi.advanceTimersByTime(50_000);
    }
    expect(circuitBreaker.getState(SERVICE)).toBe("CLOSED");
  });

  it("recovers through HALF_OPEN after the cooldown", async () => {
    for (let i = 0; i < 5; i += 1) await fail();
    expect(circuitBreaker.getState(SERVICE)).toBe("OPEN");

    vi.advanceTimersByTime(31_000);
    await expect(succeed()).resolves.toBe("ok");
    await expect(succeed()).resolves.toBe("ok");
    expect(circuitBreaker.getState(SERVICE)).toBe("CLOSED");
  });

  it("reopens immediately when the half-open probe fails", async () => {
    for (let i = 0; i < 5; i += 1) await fail();
    vi.advanceTimersByTime(31_000);
    await fail();
    expect(circuitBreaker.getState(SERVICE)).toBe("OPEN");
  });
});
