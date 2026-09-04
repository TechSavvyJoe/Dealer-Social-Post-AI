import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLISH_TARGETS, adapterFor } from "../services/publishTargets";

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

  // The former `publishTo()` one-shot share flow was deleted: it awaited media
  // preparation before calling navigator.share(), which spends WebKit's
  // transient user activation and makes the share sheet silently refuse to
  // open. Production goes through preparePublishShare() + sharePrepared(),
  // which shares from inside the click handler; publishTargets.test.ts and
  // ShareDialogReliability.test.tsx cover that path. Do not reintroduce a
  // prepare-then-share helper here.
});
