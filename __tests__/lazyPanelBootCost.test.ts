import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A React.lazy component starts its dynamic import when it first RENDERS, not
 * when it becomes visible. App.tsx rendered the Settings and Photo-review
 * modals unconditionally with isOpen={false}, so the unauthenticated login
 * screen pulled SettingsModal, ImageCropModal, mediaSave, imageUtils and their
 * icon chunks. Measured against the dev server on 2026-09-10:
 *
 *   before: SettingsModal, ImageCropModal, mediaSave, imageUtils all fetched
 *   after:  none of them fetched until the panel is opened
 *
 * Salespeople open the app on lot LTE, so this is real time before first paint.
 */
describe("lazy panels stay off the boot path", () => {
  const source = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");

  it("gates every lazy panel behind a first-open latch", () => {
    for (const [component, latch] of [
      ["LazySettingsModal", "settingsEverOpened"],
      ["LazyImageCropModal", "cropEverOpened"],
      ["LazyPostHistory", "historyEverOpened"],
    ] as const) {
      const at = source.indexOf(`<${component}`);
      expect(at, `${component} not found in App.tsx`).toBeGreaterThan(-1);

      // The latch guard must appear immediately before the element, not merely
      // somewhere in the file.
      const preceding = source.slice(Math.max(0, at - 200), at);
      expect(preceding, `${component} is not gated by ${latch}`).toContain(
        `${latch} && (`,
      );
    }
  });

  it("keeps the panel mounted after its first open, so the close animation runs", () => {
    // The latch must never go back to false; a plain `isOpen &&` would unmount
    // mid-exit and make closing feel broken.
    expect(source).toContain("const useMountedOnce = (open: boolean): boolean =>");
    expect(source).toContain("if (open) setMounted(true);");
    expect(source).toContain("return mounted || open;");
  });

  it("warms the mandatory photo-review chunk after sign-in, not at boot", () => {
    // Gating alone removed a warm-up the old always-mounted modal provided as
    // a side effect: the crop chunk used to be fetched and service-worker
    // cached at boot. The crop step is not optional (every image selection
    // opens it), so a cold-cache first-timer got a tap that showed nothing.
    // The prefetch must be keyed on being signed in — never on the login
    // screen, which is the whole point of deferring — and must use the same
    // import specifier as the lazy component so Vite emits one chunk.
    const prefetch = source.indexOf('void import("./components/ImageCropModal")');
    expect(prefetch, "no post-login prefetch of ImageCropModal").toBeGreaterThan(-1);
    const effect = source.slice(Math.max(0, prefetch - 600), prefetch);
    expect(effect).toContain("if (!isSignedIn) return;");
    expect(effect).toContain("const isSignedIn = Boolean(currentDealer);");
    // And the lazy component still uses the identical specifier.
    expect(source).toContain(
      'const LazyImageCropModal = React.lazy(() =>\n  import("./components/ImageCropModal")',
    );
  });

  it("shows something while the photo-review chunk loads, instead of nothing", () => {
    // `fallback={null}` on a Suspense that guards a mandatory step is a dead
    // tap on a slow network. The fallback is scoped to cropModalOpen so it
    // never flashes for the other panels sharing this pattern.
    const at = source.indexOf('panelName="Photo review"');
    expect(at).toBeGreaterThan(-1);
    const boundary = source.slice(at, at + 1200);
    expect(boundary).not.toContain("fallback={null}");
    expect(boundary).toContain("cropModalOpen ? (");
    expect(boundary).toContain('role="status"');
    expect(boundary).toContain("Opening photo review");
  });
});
