import { afterEach, describe, expect, it } from "vitest";
import { proxyCapabilities, setProxyCapabilities } from "./proxyCapabilities";
import { isProxyValidationRejection } from "./geminiProxy";

describe("proxyCapabilities", () => {
  afterEach(() => setProxyCapabilities(undefined));

  it("advertises nothing until a session payload says otherwise", () => {
    expect(proxyCapabilities()).toEqual({});
  });

  it("keeps only known flags with the literal value true", () => {
    setProxyCapabilities({ veoNegativePrompt: true, somethingElse: true });
    expect(proxyCapabilities()).toEqual({ veoNegativePrompt: true });
    setProxyCapabilities({ veoNegativePrompt: "true" });
    expect(proxyCapabilities()).toEqual({});
  });

  it("replaces rather than merges, so a rollback session clears earlier flags", () => {
    setProxyCapabilities({ veoNegativePrompt: true });
    setProxyCapabilities(undefined);
    expect(proxyCapabilities().veoNegativePrompt).toBeUndefined();
    setProxyCapabilities({ veoNegativePrompt: true });
    setProxyCapabilities({});
    expect(proxyCapabilities()).toEqual({});
  });
});

describe("isProxyValidationRejection", () => {
  it("matches only the proxy's own pre-upstream validation body", () => {
    expect(
      isProxyValidationRejection(
        400,
        JSON.stringify({ error: "Invalid or unsupported generation request" }),
      ),
    ).toBe(true);
    // A relayed Google 400 has an object error and may already be billed.
    expect(
      isProxyValidationRejection(
        400,
        JSON.stringify({ error: { code: 400, message: "Invalid argument" } }),
      ),
    ).toBe(false);
    expect(
      isProxyValidationRejection(
        500,
        JSON.stringify({ error: "Invalid or unsupported generation request" }),
      ),
    ).toBe(false);
    expect(isProxyValidationRejection(400, "not json")).toBe(false);
    expect(isProxyValidationRejection(400, "")).toBe(false);
  });
});
