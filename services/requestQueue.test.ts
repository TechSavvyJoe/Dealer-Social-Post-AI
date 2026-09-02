import { afterEach, describe, expect, it, vi } from "vitest";
import { clearQueue, enqueueTask } from "./requestQueue";

afterEach(() => {
  clearQueue();
  vi.useRealTimers();
});

describe("request queue cancellation", () => {
  it("forwards caller cancellation into the active task", async () => {
    const externalController = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    const task = enqueueTask(
      async (signal) => {
        receivedSignal = signal;
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      {
        maxRetries: 0,
        timeoutMs: 10_000,
        signal: externalController.signal,
      },
    );

    await Promise.resolve();
    externalController.abort();

    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect((receivedSignal as unknown as AbortSignal).aborted).toBe(true);
  });

  it("rejects on timeout but preserves serialization until the task settles", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    let receivedSignal: AbortSignal | null = null;
    let secondStarted = false;

    const first = enqueueTask(
      (signal) => {
        receivedSignal = signal;
        return new Promise<void>((resolve) => {
          // Deliberately ignore cancellation to verify the queue still cannot
          // overlap a future task with a misbehaving consumer.
          releaseFirst = resolve;
        });
      },
      { maxRetries: 0, timeoutMs: 25 },
    );
    const firstRejection = expect(first).rejects.toMatchObject({
      name: "TimeoutError",
    });
    const second = enqueueTask(async () => {
      secondStarted = true;
      return "second";
    });

    await vi.advanceTimersByTimeAsync(25);
    await firstRejection;
    expect((receivedSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(secondStarted).toBe(false);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toBe("second");
    expect(secondStarted).toBe(true);
  });
});
