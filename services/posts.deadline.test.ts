import { afterEach, describe, expect, it, vi } from "vitest";
import { updatePostDraft } from "./posts";

const input = {
  caption: "A fresh arrival is ready for a closer look.",
  expectedPostRevision: "rev-0",
};
const stalled = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saved draft request deadline", () => {
  it.each(["request", "body"])(
    "ends a stalled %s without automatically retrying the write",
    async (stage) => {
      vi.useFakeTimers();
      const fetchMock = vi.fn((_url: string, init: RequestInit) =>
        stage === "request"
          ? stalled(init.signal as AbortSignal)
          : Promise.resolve({
              ok: true,
              json: () => stalled(init.signal as AbortSignal),
            }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const saving = updatePostDraft("deadline-test-post", input);
      const rejected = expect(saving).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("clears the deadline after a validated success", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "deadline-test-post",
          updated: true,
          post_revision: "rev-1",
        }),
      })),
    );
    await expect(updatePostDraft("deadline-test-post", input)).resolves.toMatchObject({
      post_revision: "rev-1",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
