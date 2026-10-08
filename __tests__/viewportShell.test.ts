import { afterEach, describe, expect, it, vi } from "vitest";
import { installViewportShell } from "../utils/viewportShell";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--app-viewport-height");
  delete document.documentElement.dataset.appDisplay;
});

function setup(installed = true) {
  const display = Object.assign(new EventTarget(), { matches: installed });
  const viewport = Object.assign(new EventTarget(), { height: 844, scale: 1 });
  vi.stubGlobal("matchMedia", () => display);
  vi.stubGlobal("visualViewport", viewport);
  dispose = installViewportShell();
  return { viewport, display };
}

const height = () =>
  document.documentElement.style.getPropertyValue("--app-viewport-height");

describe("installed viewport shell", () => {
  it("follows visible height through keyboard and rotation, then restores it", () => {
    const { viewport } = setup();
    expect(height()).toBe("844px");
    for (const next of [410, 390, 844]) {
      viewport.height = next;
      viewport.dispatchEvent(new Event("resize"));
      expect(height()).toBe(`${next}px`);
    }
  });

  it("preserves accessibility zoom instead of shrinking the app around it", () => {
    const { viewport } = setup();
    viewport.scale = 2;
    viewport.height = 422;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("844px");
  });

  it("leaves browser sizing alone and clears installed sizing on mode change", () => {
    const { display } = setup(false);
    expect(height()).toBe("");
    display.matches = true;
    display.dispatchEvent(new Event("change"));
    expect(height()).toBe("844px");
    display.matches = false;
    display.dispatchEvent(new Event("change"));
    expect(height()).toBe("");
    expect(document.documentElement.dataset.appDisplay).toBe("browser");
  });

  it("removes resize listeners on cleanup", () => {
    const { viewport } = setup();
    dispose?.();
    viewport.height = 410;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("844px");
  });
});
