import { describe, it, expect } from "vitest";
import { toUiMessage } from "../utils/errorMessages";

const FALLBACK = "Could not finish this step.";

describe("toUiMessage", () => {
  describe("curated error passthrough (NormalizedError / ApiError)", () => {
    it("passes a NormalizedError's curated message through untouched", () => {
      const err = Object.assign(new Error("We lost connection to the server."), {
        kind: "network",
        retryable: true,
      });

      expect(toUiMessage(err, FALLBACK)).toBe("We lost connection to the server.");
    });

    it("passes a coded ApiError's server copy through untouched", () => {
      const err = Object.assign(new Error("This website draft was already sent."), {
        name: "ApiError",
        code: "WEBSITE_DRAFT_ALREADY_SENT",
        status: 409,
      });

      expect(toUiMessage(err, FALLBACK)).toBe("This website draft was already sent.");
    });

    it("still maps a coded ApiError whose message is statusText boilerplate", () => {
      const err = Object.assign(new Error("Internal Server Error"), {
        name: "ApiError",
        code: "UNAVAILABLE",
        status: 500,
      });

      expect(toUiMessage(err, FALLBACK)).toBe(
        "An unexpected error occurred. Please try again.",
      );
    });
  });

  describe("transport-signature mapping", () => {
    it("maps the browser's offline TypeError to the connection copy", () => {
      expect(toUiMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(
        "Unable to connect to the server. Please check your internet connection.",
      );
    });

    it("maps iOS Safari's 'Load failed' to the connection copy", () => {
      expect(toUiMessage(new TypeError("Load failed"), FALLBACK)).toBe(
        "Unable to connect to the server. Please check your internet connection.",
      );
    });

    it("maps timeout text to the timeout copy", () => {
      expect(toUiMessage(new Error("Request timeout after 10000ms"), FALLBACK)).toBe(
        "The server is taking too long to respond. This might be due to high traffic.",
      );
    });

    it("maps 401 text to the session-expired copy", () => {
      expect(toUiMessage(new Error("HTTP 401"), FALLBACK)).toBe(
        "Your session has expired. Please sign in again to continue.",
      );
    });

    it("maps 429 text to the rate-limit copy", () => {
      expect(toUiMessage(new Error("HTTP 429"), FALLBACK)).toBe(
        "You've made too many requests. Please wait a moment before trying again.",
      );
    });

    it("maps generic HTTP fallbacks and PocketBase's stock message", () => {
      expect(toUiMessage(new Error("Request failed"), FALLBACK)).toBe(
        "An unexpected error occurred. Please try again.",
      );
      expect(
        toUiMessage(
          new Error("Something went wrong while processing your request."),
          FALLBACK,
        ),
      ).toBe("An unexpected error occurred. Please try again.");
    });
  });

  describe("curated app copy passthrough", () => {
    it("passes internal curated throws through verbatim", () => {
      expect(
        toUiMessage(
          new Error("The exact Instagram file could not be prepared."),
          FALLBACK,
        ),
      ).toBe("The exact Instagram file could not be prepared.");
    });

    it("uses the fallback for an Error with a blank message", () => {
      expect(toUiMessage(new Error("   "), FALLBACK)).toBe(FALLBACK);
    });
  });

  describe("non-Error fallback", () => {
    it("returns the caller's fallback for thrown strings", () => {
      expect(toUiMessage("boom", FALLBACK)).toBe(FALLBACK);
    });

    it("returns the caller's fallback for undefined and objects", () => {
      expect(toUiMessage(undefined, FALLBACK)).toBe(FALLBACK);
      expect(toUiMessage({ status: 500 }, FALLBACK)).toBe(FALLBACK);
    });
  });
});
