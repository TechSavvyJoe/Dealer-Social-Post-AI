import { describe, expect, it } from "vitest";
import {
  releaseAuthorizesPublicLabel,
  toPublicCustomerLabel,
} from "./customerIdentity";

describe("public customer identity", () => {
  it("keeps full legal release names out of public marketing labels", () => {
    expect(toPublicCustomerLabel("Lisa Marie Sample")).toBe("Lisa");
    expect(toPublicCustomerLabel("Dr. Alex Morgan")).toBe("Alex");
    expect(toPublicCustomerLabel("The Robbins Family")).toBe("The Robbins Family");
    expect(toPublicCustomerLabel("Mr. & Mrs. Smith")).toBe("our customers");
  });

  it("binds a protected release only to its derived public label", () => {
    expect(releaseAuthorizesPublicLabel("Lisa Marie Sample", "Lisa")).toBe(true);
    expect(releaseAuthorizesPublicLabel("Lisa Marie Sample", "Jordan")).toBe(false);
    expect(releaseAuthorizesPublicLabel("Lisa Marie Sample", "Lisa Jordan")).toBe(
      false,
    );
    expect(releaseAuthorizesPublicLabel("Dr. Lisa Sample", "Dr. Lisa")).toBe(false);
  });
});
