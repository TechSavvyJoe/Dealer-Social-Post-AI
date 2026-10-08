import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestDeadline } from "./requestDeadline";
afterEach(() => vi.useRealTimers());
const stalled = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
describe("media request deadlines", () => {
  it("ends a stalled response body with a timeout", async () => {
    vi.useFakeTimers();
    const response = withRequestDeadline(undefined, stalled, 100);
    const check = expect(response).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves user cancellation and never starts an already cancelled task", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(stalled);
    await expect(withRequestDeadline(controller.signal, task)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(task).not.toHaveBeenCalled();
  });
  it("removes the deadline when a request succeeds", async () => {
    vi.useFakeTimers();
    await expect(withRequestDeadline(undefined, async () => "saved")).resolves.toBe(
      "saved",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
