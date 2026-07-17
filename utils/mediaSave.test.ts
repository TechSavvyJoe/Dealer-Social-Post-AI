import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isMobilePhotoDevice, saveResultToastMessage } from "./mediaSave";

describe("isMobilePhotoDevice", () => {
  const original = { ...navigator };

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("detects iPhone user agents", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
      configurable: true,
    });
    expect(isMobilePhotoDevice()).toBe(true);
  });

  it("detects Android user agents", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      },
      configurable: true,
    });
    expect(isMobilePhotoDevice()).toBe(true);
  });
});

describe("saveResultToastMessage", () => {
  it("guides users to Save Image / Save Video in the share sheet", () => {
    expect(
      saveResultToastMessage({ method: "photos-share", kind: "image" }),
    ).toMatch(/Save Image/i);
    expect(
      saveResultToastMessage({ method: "photos-share", kind: "video" }),
    ).toMatch(/Save Video/i);
  });
});
