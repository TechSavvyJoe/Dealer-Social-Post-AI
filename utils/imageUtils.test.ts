import { describe, expect, it } from "vitest";
import { imageFileExtension } from "./imageUtils";

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
