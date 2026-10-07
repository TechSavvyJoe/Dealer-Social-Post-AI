import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A React.lazy component starts its dynamic import when it first RENDERS, not
 * when it becomes visible. App.tsx used to render the Settings modal
 * unconditionally with isOpen={false}, so the unauthenticated login screen
 * fetched the SettingsModal chunk and its icons. Measured against the dev
 * server on 2026-09-10: gating the element behind a first-open latch kept the
 * chunk off the login screen until the panel is opened.
 *
 * Salespeople open the app on lot LTE, so this is real time before first paint.
 */

/**
 * The latch has to guard the element itself. Finding `settingsEverOpened &&`
 * somewhere in the file is not enough: the modal can move out from under it
 * while the latch still guards something else. Between the latch and the
 * element only whitespace and one opening parenthesis are allowed.
 *
 * The name must also be the latch itself, not a longer identifier ending in
 * it (`app.settingsEverOpened`, `notSettingsEverOpened`) and not its negation:
 * `{!settingsEverOpened && (` renders the modal on the login screen, which is
 * the exact regression this guards against.
 */
const LATCH_DIRECTLY_ABOVE = /(?<![\w$.]|!\s*)settingsEverOpened &&\s*\(?\s*$/;

/**
 * The checks read code, not comments: a `// settingsEverOpened && (` line left
 * above the element spells the latch without being one. Same idiom as
 * backendCompliancePolicy.test.ts: `://` survives so a URL is not cut short.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const settingsModalSitsUnderLatch = (source: string): boolean => {
  const code = withoutComments(source);
  const sites = [...code.matchAll(/<LazySettingsModal\b/g)];
  return (
    sites.length > 0 &&
    sites.every((site) =>
      LATCH_DIRECTLY_ABOVE.test(code.slice(Math.max(0, site.index - 200), site.index)),
    )
  );
};

/**
 * The latch is only as good as what feeds it. `useMountedOnce(true)`, or any
 * input that is true on the first render, keeps the name and the shape but
 * mounts the modal (and fetches its chunk) on every boot. It has to follow the
 * open state of the Settings panel.
 */
const latchFollowsSettingsOpen = (source: string): boolean =>
  /const settingsEverOpened = useMountedOnce\(\s*app\.isSettingsOpen\s*\)/.test(
    withoutComments(source),
  );

describe("heavy panels stay off the login boot path", () => {
  const app = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");
  const main = readFileSync(
    resolve(process.cwd(), "components/MainContent.tsx"),
    "utf8",
  );
  it("defers Settings until first use and keeps it mounted afterward", () => {
    expect(
      settingsModalSitsUnderLatch(app),
      "<LazySettingsModal is not directly under `settingsEverOpened && (`",
    ).toBe(true);
    // The latch must never go back to false; a plain `isOpen &&` would unmount
    // mid-exit and make closing feel broken.
    expect(
      latchFollowsSettingsOpen(app),
      "settingsEverOpened is not `useMountedOnce(app.isSettingsOpen)`",
    ).toBe(true);
    const appCode = withoutComments(app);
    expect(appCode).toContain("if (open) setMounted(true);");
    expect(appCode).toContain("return mounted || open;");
  });
  it("the latch guard fails when the modal moves out from under it (planted mutant)", () => {
    // Moved out: the latch still appears, but now guards nothing, and the
    // modal renders (and fetches its chunk) on the login screen.
    const latched = app.match(/\{settingsEverOpened &&\s*\(\s*<LazySettingsModal\b/);
    expect(latched, "App.tsx no longer has the latched shape").not.toBeNull();
    const movedOut = app.replace(
      latched![0],
      "{settingsEverOpened && null}\n          {(\n            <LazySettingsModal",
    );
    expect(movedOut).not.toBe(app);
    expect(movedOut).toContain("settingsEverOpened &&");
    expect(settingsModalSitsUnderLatch(movedOut)).toBe(false);
    // Another condition between the latch and the element is a different gate.
    const extraGate = app.replace(
      latched![0],
      "{settingsEverOpened && app.isSettingsOpen && (\n            <LazySettingsModal",
    );
    expect(extraGate).not.toBe(app);
    expect(settingsModalSitsUnderLatch(extraGate)).toBe(false);
    // Moved out, with the latch left behind as a comment directly above the
    // element. Inside `{( ... )}` the `//` line is a real comment, not text.
    const commentedLatch = app.replace(
      latched![0],
      "{settingsEverOpened && null}\n          {(\n            // settingsEverOpened && (\n            <LazySettingsModal",
    );
    expect(commentedLatch).not.toBe(app);
    expect(settingsModalSitsUnderLatch(commentedLatch)).toBe(false);
    // Inverted: the shape is intact, but the modal now renders exactly when
    // the panel has never been opened, i.e. on the login screen.
    for (const inverted of [
      "{!settingsEverOpened && (",
      "{! settingsEverOpened && (",
    ]) {
      const invertedLatch = app.replace(
        latched![0],
        `${inverted}\n            <LazySettingsModal`,
      );
      expect(invertedLatch).not.toBe(app);
      expect(settingsModalSitsUnderLatch(invertedLatch), inverted).toBe(false);
    }
  });
  it("the latch guard fails when the latch stops following the panel (planted mutant)", () => {
    const fed = "useMountedOnce(app.isSettingsOpen)";
    expect(app, `App.tsx no longer contains ${fed}`).toContain(fed);
    // Always true: same name, same shape, chunk fetched on every boot.
    const alwaysOn = app.replace(fed, "useMountedOnce(true)");
    expect(alwaysOn).not.toBe(app);
    // Only the feed changed, so only the feed check may catch it.
    expect(
      settingsModalSitsUnderLatch(alwaysOn),
      "App.tsx no longer has the latched shape",
    ).toBe(true);
    expect(latchFollowsSettingsOpen(alwaysOn)).toBe(false);
    // The old line left behind as a comment above its replacement.
    const commentedFeed = app.replace(
      `const settingsEverOpened = ${fed};`,
      `// const settingsEverOpened = ${fed};\n  const settingsEverOpened = useMountedOnce(true);`,
    );
    expect(commentedFeed).not.toBe(app);
    expect(latchFollowsSettingsOpen(commentedFeed)).toBe(false);
  });
  it("warms Details only after sign-in", () => {
    const at = app.indexOf('import("./components/PostDetails")');
    expect(at).toBeGreaterThan(0);
    expect(app.slice(at - 200, at)).toContain("if (!isSignedIn) return;");
    expect(main).toContain('import("./PostDetails")');
  });
  it("shows the selected photo and status while Details loads", () => {
    expect(main).toContain("Opening details…");
    expect(main).toContain('alt="Your selected photo"');
    expect(main).toContain('role="status"');
    expect(app).not.toContain("LazyImageCropModal");
    expect(main).not.toContain('import("./PostCustomizer")');
  });
});
