import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFromProxy, outdatedClientErrorFromResponse } from "./geminiProxy";
import { MODEL_POLICY_VERSION } from "./modelConfig";
import { circuitBreaker } from "../utils/circuitBreaker";

const textPath = "v1beta/models/gemini-3.6-flash:generateContent";

/** fetchFromProxy reads only status/ok/text() from the Response. */
const fakeResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  text: async () => JSON.stringify(body),
});

const stubFetch = (status: number, body: unknown) => {
  // Declare the fetch signature so `mock.calls[n][1]` (the RequestInit that
  // carries our headers) is typed instead of an empty tuple.
  const fetchMock = vi.fn(
    async (_input: unknown, _init?: { headers?: Record<string, string> }) =>
      fakeResponse(status, body),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("fetchFromProxy", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    circuitBreaker.reset("gemini-api");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the usage-ledger purpose alongside the task headers", async () => {
    const fetchMock = stubFetch(200, { candidates: [] });

    await fetchFromProxy(
      "POST",
      textPath,
      { contents: [] },
      "caption_regenerate",
      "attempt_0123456789abcdef",
      undefined,
      undefined,
      "vision_review",
    );

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers).toMatchObject({
      "X-Generation-Task": "caption_regenerate",
      "X-Model-Policy-Version": MODEL_POLICY_VERSION,
      "X-Generation-Attempt-ID": "attempt_0123456789abcdef",
      "X-Generation-Purpose": "vision_review",
    });
  });

  it("omits the purpose header when the caller relies on the server default", async () => {
    const fetchMock = stubFetch(200, { candidates: [] });

    await fetchFromProxy("POST", textPath, { contents: [] }, "caption");

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers["X-Generation-Task"]).toBe("caption");
    expect(init.headers).not.toHaveProperty("X-Generation-Purpose");
  });

  /** Proxy trace lines only; other modules log through the same spy. */
  const proxyTraceLines = () =>
    (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith("[GeminiProxy]"));

  it("keeps per-request tracing out of production consoles but still reports failures", async () => {
    vi.stubEnv("DEV", false);
    stubFetch(200, { candidates: [] });

    await fetchFromProxy("POST", textPath, { contents: [] }, "caption");

    // Two lines per generation (request + response) drowned the one line a
    // support session needs, on a device where the console is the only tool.
    expect(proxyTraceLines()).toEqual([]);

    stubFetch(400, { error: { message: "bad request" } });
    await expect(
      fetchFromProxy("POST", textPath, { contents: [] }, "caption"),
    ).rejects.toMatchObject({ kind: "validation" });
    // A genuine failure still reaches the console in production.
    expect(console.error).toHaveBeenCalled();
    expect(proxyTraceLines()).toEqual([]);

    vi.unstubAllEnvs();
  });

  it("traces every request in development", async () => {
    vi.stubEnv("DEV", true);
    stubFetch(200, { candidates: [] });

    await fetchFromProxy("POST", textPath, { contents: [] }, "caption");

    expect(proxyTraceLines()).toHaveLength(2);
    vi.unstubAllEnvs();
  });

  it("maps 409 POLICY_VERSION_MISMATCH to a terminal outdated error without retrying or tripping the breaker", async () => {
    const fetchMock = stubFetch(409, {
      error: "POLICY_VERSION_MISMATCH",
      code: "POLICY_VERSION_MISMATCH",
      currentVersion: "99",
    });

    await expect(
      fetchFromProxy("POST", textPath, { contents: [] }, "caption"),
    ).rejects.toMatchObject({
      kind: "outdated",
      retryable: false,
      message: "This version of the app is out of date.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(circuitBreaker.getState("gemini-api")).toBe("CLOSED");

    // A stale client keeps hitting 409 on every call; that must never open
    // the circuit (which would fail image generation closed for everyone).
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        fetchFromProxy("POST", textPath, { contents: [] }, "caption"),
      ).rejects.toMatchObject({ kind: "outdated" });
    }
    expect(circuitBreaker.getState("gemini-api")).toBe("CLOSED");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("leaves other 409 bodies and other statuses on the generic path", () => {
    expect(
      outdatedClientErrorFromResponse(409, JSON.stringify({ error: "conflict" })),
    ).toBeNull();
    expect(
      outdatedClientErrorFromResponse(
        400,
        JSON.stringify({ code: "POLICY_VERSION_MISMATCH" }),
      ),
    ).toBeNull();
    expect(outdatedClientErrorFromResponse(409, "not json")).toBeNull();

    const outdated = outdatedClientErrorFromResponse(
      409,
      JSON.stringify({ code: "POLICY_VERSION_MISMATCH", currentVersion: 7 }),
    );
    expect(outdated?.kind).toBe("outdated");
    expect(String((outdated?.original as Error).message)).toContain(
      `client ${MODEL_POLICY_VERSION}, server 7`,
    );
  });
});
