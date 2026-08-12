import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLISH_TARGETS, adapterFor, publishTo } from "../services/publishTargets";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publish adapter seam", () => {
  it("resolves every registry target to a handoff adapter today", () => {
    for (const target of PUBLISH_TARGETS) {
      const adapter = adapterFor(target.id);
      expect(adapter).not.toBeNull();
      expect(adapter?.kind).toBe("handoff");
      expect(adapter?.target.id).toBe(target.id);
      // No target may claim a wired API until its adapter goes direct.
      expect(target.directApiConnected).toBe(false);
    }
  });

  it("returns null for unknown targets instead of guessing", () => {
    expect(adapterFor("myspace")).toBeNull();
  });

  it("fails a share honestly while offline, before any handoff side effects", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const status = await publishTo("instagram_feed", {
      text: "caption",
      imageDataUrl: "data:image/png;base64,AAAA",
    } as never);
    expect(status.kind).toBe("error");
    expect("message" in status && status.message).toMatch(/offline/i);
    expect("message" in status && status.message).toMatch(/saved on this device/i);
  });
});
