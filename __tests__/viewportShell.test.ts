import { afterEach, describe, expect, it, vi } from "vitest";
import { installViewportShell } from "../utils/viewportShell";

let dispose: (() => void) | undefined;
let editor: HTMLInputElement | undefined;
afterEach(() => {
  dispose?.();
  editor?.remove();
  editor = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--app-viewport-height");
  delete document.documentElement.dataset.appDisplay;
  delete document.documentElement.dataset.appleStandalone;
});

function setup(installed = true, apple = false) {
  const display = Object.assign(new EventTarget(), { matches: installed });
  const viewport = Object.assign(new EventTarget(), { height: 844, scale: 1 });
  vi.stubGlobal("matchMedia", () => display);
  vi.stubGlobal("visualViewport", viewport);
  if (apple) {
    vi.stubGlobal("navigator", { standalone: true });
    vi.stubGlobal("screen", { width: 390, height: 844, orientation: { angle: 0 } });
    vi.stubGlobal("innerWidth", 390);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  }
  dispose = installViewportShell();
  return { viewport, display };
}

const height = () =>
  document.documentElement.style.getPropertyValue("--app-viewport-height");

describe("installed viewport shell", () => {
  it("fills the iPhone canvas when cold launch and resume report a short viewport", () => {
    const { viewport } = setup(true, true);
    viewport.height = 751;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("844px");
    expect(document.documentElement.dataset.appleStandalone).toBe("true");
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(height()).toBe("844px");
  });

  it("uses the keyboard viewport only while editing and restores full height after blur", () => {
    const { viewport } = setup(true, true);
    editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();
    viewport.height = 410;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("410px");
    editor.blur();
    // WebKit may still report the keyboard height after it was dismissed.
    expect(height()).toBe("844px");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("recovers landscape and portrait without treating the keyboard as rotation", () => {
    const { viewport } = setup(true, true);
    vi.stubGlobal("innerWidth", 844);
    viewport.height = 325;
    window.dispatchEvent(new Event("orientationchange"));
    expect(height()).toBe("390px");
    vi.stubGlobal("innerWidth", 390);
    viewport.height = 410;
    window.dispatchEvent(new Event("orientationchange"));
    expect(height()).toBe("844px");
  });

  it("follows visible height through keyboard and rotation, then restores it", () => {
    const { viewport } = setup();
    expect(height()).toBe("844px");
    expect(document.documentElement.dataset.appleStandalone).toBe("false");
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
    expect(document.documentElement.dataset.appleStandalone).toBe("false");
  });

  it("removes resize listeners on cleanup", () => {
    const { viewport } = setup();
    dispose?.();
    viewport.height = 410;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("844px");
  });
});
