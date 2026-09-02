import { afterEach, describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry";

afterEach(() => {
  vi.useRealTimers();
});

describe("retry cancellation", () => {
  it("interrupts an in-progress backoff without starting another attempt", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;

    const operation = retryWithBackoff(
      async () => {
        attempts += 1;
        throw new Error("Network unavailable");
      },
      {
        maxAttempts: 3,
        initialDelay: 10_000,
        signal: controller.signal,
      },
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: "AbortError",
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await rejection;
    expect(attempts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
