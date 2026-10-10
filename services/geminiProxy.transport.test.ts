import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFromProxy } from "./geminiProxy";

describe("Gemini proxy transport retries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a paid POST once when the connection fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFromProxy("POST", "v1beta/models/test:generateContent", { prompt: "test" }),
    ).rejects.toMatchObject({ kind: "network", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies Safari's generic Load failed transport error as terminal", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFromProxy("POST", "v1beta/models/test:generateContent", { prompt: "test" }),
    ).rejects.toMatchObject({ kind: "network", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a paid POST once when the proxy returns 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream error", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFromProxy("POST", "v1beta/models/test:generateContent", { prompt: "test" }),
    ).rejects.toMatchObject({ kind: "network", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying safe GET polls after a transient 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ done: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFromProxy("GET", "v1beta/operations/op-1", undefined),
    ).resolves.toEqual({
      done: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies a generic response-body read failure without retaining its message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("upstream payload secret was interrupted");
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const rejection = await fetchFromProxy(
      "POST",
      "v1beta/models/test:generateContent",
      {},
    ).then(
      () => null,
      (error: unknown) =>
        error as Error & { kind?: string; retryable?: boolean; original?: unknown },
    );
    expect(rejection).not.toBeNull();
    expect(rejection).toMatchObject({ kind: "network", retryable: false });
    expect(JSON.stringify(rejection?.original)).not.toContain(
      "upstream payload secret",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves external cancellation when Safari rejects fetch with Load failed", async () => {
    const external = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new TypeError("Load failed")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchFromProxy(
      "POST",
      "v1beta/models/test:generateContent",
      {},
      undefined,
      undefined,
      undefined,
      external.signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    external.abort(new DOMException("User cancelled", "AbortError"));
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a received 401 if its response body cannot be read", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => {
        throw new TypeError("Load failed");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFromProxy("POST", "v1beta/models/test:generateContent", {}),
    ).rejects.toMatchObject({ kind: "unauthorized", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['{"candidates":[', "", "null", "[]", '"plain text"', "7"])(
    "treats a malformed or non-object HTTP 200 body as an unknown paid outcome (%s)",
    async (body) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        fetchFromProxy("POST", "v1beta/models/test:generateContent", {}),
      ).rejects.toMatchObject({ kind: "network", retryable: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("marks a transport timeout as terminal unknown outcome", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchFromProxy("POST", "v1beta/models/test:generateContent", {
      prompt: "test",
    });
    const rejection = expect(pending).rejects.toMatchObject({
      kind: "timeout",
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(110_000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves user cancellation as AbortError", async () => {
    const external = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchFromProxy(
      "POST",
      "v1beta/models/test:generateContent",
      { prompt: "test" },
      undefined,
      undefined,
      undefined,
      external.signal,
    );
    external.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
