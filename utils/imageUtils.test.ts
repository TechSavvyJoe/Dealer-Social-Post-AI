import { describe, expect, it } from "vitest";
import {
  imageFileExtension,
  resolveVeoAspect,
} from "./imageUtils";

describe("imageFileExtension", () => {
  it("matches data URL image formats", () => {
    expect(imageFileExtension("data:image/png;base64,abc")).toBe("png");
    expect(imageFileExtension("data:image/jpeg;base64,abc")).toBe("jpg");
    expect(imageFileExtension("data:image/webp;base64,abc")).toBe("webp");
  });

  it("matches supported URL suffixes without trusting query strings", () => {
    expect(imageFileExtension("https://example.com/creative.avif?v=2")).toBe(
      "avif",
    );
    expect(imageFileExtension("https://example.com/creative.jpeg")).toBe("jpg");
  });

  it("uses an interoperable default for unknown sources", () => {
    expect(imageFileExtension("blob:generated-image")).toBe("jpg");
  });
});

describe("resolveVeoAspect", () => {
  it("maps portrait to 9:16 and landscape to 16:9 in auto mode", () => {
    expect(resolveVeoAspect(1080, 1920, "auto")).toBe("9:16");
    expect(resolveVeoAspect(1920, 1080, "auto")).toBe("16:9");
  });

  it("prefers 9:16 for square social posts", () => {
    expect(resolveVeoAspect(1080, 1080, "auto")).toBe("9:16");
  });

  it("honors explicit preference", () => {
    expect(resolveVeoAspect(1080, 1080, "16:9")).toBe("16:9");
    expect(resolveVeoAspect(1920, 1080, "9:16")).toBe("9:16");
    expect(resolveVeoAspect(1080, 1080, "1:1")).toBe("16:9");
  });
});
