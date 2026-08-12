import { afterEach, describe, expect, it, vi } from "vitest";
import { readApiError } from "../services/apiErrors";
import { rotatePersonPin, type CredentialResult } from "../services/salespeople";
import {
  AUTH_SESSION_REJECTED_EVENT,
  assertAuthEpoch,
  captureAuthEpoch,
  setActiveAuthEpoch,
} from "../utils/authBoundary";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime authentication boundary", () => {
  it("signals the active tab when an authenticated API returns 401", async () => {
    setActiveAuthEpoch(7);
    const requestAuthEpoch = captureAuthEpoch();
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_REJECTED_EVENT, listener, { once: true });

    await readApiError(
      new Response(JSON.stringify({ error: "No active session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      { requestAuthEpoch },
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate an existing workspace for an ordinary login rejection", async () => {
    setActiveAuthEpoch(8);
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_REJECTED_EVENT, listener, { once: true });

    await readApiError(
      new Response(JSON.stringify({ code: "INVALID_CODE" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      { notifyAuth: false },
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not treat a role-based 403 as an expired session", async () => {
    setActiveAuthEpoch(9);
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_REJECTED_EVENT, listener, { once: true });

    await readApiError(
      new Response(JSON.stringify({ error: "Manager role required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores a delayed 401 captured by an older authenticated workspace", async () => {
    setActiveAuthEpoch(10);
    const staleRequestAuthEpoch = captureAuthEpoch();
    setActiveAuthEpoch(11);
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_REJECTED_EVENT, listener, { once: true });

    await readApiError(
      new Response(JSON.stringify({ error: "No active session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      { requestAuthEpoch: staleRequestAuthEpoch },
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it("aborts a request before fetch when its originating workspace is stale", () => {
    setActiveAuthEpoch(12);
    const requestAuthEpoch = captureAuthEpoch();
    setActiveAuthEpoch(13);

    expect(() => assertAuthEpoch(requestAuthEpoch)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  it.each([["rotated", rotatePersonPin, "/rotate-pin"]] as const)(
    "discards a delayed %s PIN response from an older authenticated workspace",
    async (_operation, requestCredential, expectedPath) => {
      setActiveAuthEpoch(20);
      let releaseResponse:
        ((body: { person: Record<string, unknown>; pin: string }) => void) | undefined;
      const delayedBody = new Promise<{
        person: Record<string, unknown>;
        pin: string;
      }>((resolve) => {
        releaseResponse = resolve;
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => delayedBody,
      });
      vi.stubGlobal("fetch", fetchMock);
      const surfacedCredential = vi.fn<(credential: CredentialResult) => void>();

      const pending = requestCredential("person-1").then(surfacedCredential);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0]?.[0]).toContain(expectedPath);

      setActiveAuthEpoch(21);
      releaseResponse?.({
        person: {
          id: "person-1",
          dealer: "dealer-1",
          name: "Taylor Morgan",
          role: "salesperson",
          active: true,
          hasPin: true,
          pinNeedsDistribution: true,
        },
        pin: "4826",
      });

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(surfacedCredential).not.toHaveBeenCalled();
    },
  );
});
