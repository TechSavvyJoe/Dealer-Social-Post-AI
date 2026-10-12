import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGemini } from "./useGemini";
import { VIDEO_TASK_TIMEOUT_MS } from "../services/generationTimeouts";

vi.mock("../utils/telemetry", () => ({ logEvent: vi.fn(), logError: vi.fn() }));

afterEach(() => vi.useRealTimers());

describe("AI task deadlines", () => {
  it.each([
    ["ai.generate.video", VIDEO_TASK_TIMEOUT_MS],
    ["ai.generate.caption", 300_000],
  ])("bounds a stuck %s task without replaying it", async (name, deadline) => {
    vi.useFakeTimers();
    const task = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const hook = renderHook(() => useGemini());
    const result = hook.result.current.runGeminiTask(name, task);
    const failure = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(deadline);
    await failure;
    expect(task).toHaveBeenCalledTimes(1);
    expect(task.mock.calls[0][0].aborted).toBe(true);
    hook.unmount();
  });
});
