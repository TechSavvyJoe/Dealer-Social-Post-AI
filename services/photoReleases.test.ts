import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  linkReleaseToPost,
  runWithPersistedPhotoRelease,
  type CapturedRelease,
} from "./photoReleases";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const signatureDataUrl = "data:image/png;base64,AQID";

describe("photo release consent gate", () => {
  it("wraps both Gemini module loading and execution behind the consent gate", () => {
    const hook = readFileSync(resolve(process.cwd(), "hooks/useGeneration.ts"), "utf8");
    const mutation = hook.slice(
      hook.indexOf("const generateMutation"),
      hook.indexOf("onMutate:", hook.indexOf("const generateMutation")),
    );

    expect(mutation.indexOf("runWithPersistedPhotoRelease(")).toBeGreaterThan(-1);
    expect(mutation.indexOf("runWithPersistedPhotoRelease(")).toBeLessThan(
      mutation.indexOf("await loadGeminiService()"),
    );
    expect(mutation.indexOf("await loadGeminiService()")).toBeLessThan(
      mutation.indexOf('runGeminiTask("ai.generate"'),
    );
  });

  it("durably saves consent before starting the provider task", async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).startsWith("data:image/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      order.push("release-saved");
      return new Response(
        JSON.stringify({
          id: "release-1",
          customer_name: "Alex",
          signed_at: "2026-07-15T12:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured: CapturedRelease = {
      customerName: "Alex",
      signaturePngDataUrl: signatureDataUrl,
    };
    const providerTask = vi.fn(async () => {
      order.push("provider-started");
      return "generated";
    });

    await expect(
      runWithPersistedPhotoRelease(captured, "Example Motors", providerTask),
    ).resolves.toEqual({ result: "generated", releaseId: "release-1" });
    expect(order).toEqual(["release-saved", "provider-started"]);
    expect(captured.releaseId).toBe("release-1");
  });

  it("does not start the provider when consent persistence fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("data:image/")) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        return new Response(JSON.stringify({ error: "storage unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const providerTask = vi.fn(async () => "must-not-run");

    await expect(
      runWithPersistedPhotoRelease(
        {
          customerName: "Alex",
          signaturePngDataUrl: signatureDataUrl,
        },
        "Example Motors",
        providerTask,
      ),
    ).rejects.toThrow("Photo release failed: storage unavailable");
    expect(providerTask).not.toHaveBeenCalled();
  });

  it("reuses the persisted release id after a provider failure", async () => {
    let releaseCreates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("data:image/")) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        releaseCreates += 1;
        return new Response(
          JSON.stringify({
            id: "release-retry",
            customer_name: "Alex",
            signed_at: "2026-07-15T12:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const captured: CapturedRelease = {
      customerName: "Alex",
      signaturePngDataUrl: signatureDataUrl,
    };

    await expect(
      runWithPersistedPhotoRelease(captured, "Example Motors", async () => {
        throw new Error("provider unavailable");
      }),
    ).rejects.toThrow("provider unavailable");

    await expect(
      runWithPersistedPhotoRelease(captured, "Example Motors", async () => "retried"),
    ).resolves.toEqual({ result: "retried", releaseId: "release-retry" });
    expect(releaseCreates).toBe(1);
  });

  it("links an existing release id without sending signature data", async () => {
    const fetchMock = vi.fn(
      async (_input?: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "release-1",
            post_id: "post-1",
            has_release: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkReleaseToPost("release-1", "post-1")).resolves.toEqual({
      id: "release-1",
      post_id: "post-1",
      has_release: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/photo_releases/release-1/link-post",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ post_id: "post-1" }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).not.toContain("signature");
  });
});
