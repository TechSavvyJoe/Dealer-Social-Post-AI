import { describe, it, expect } from "vitest";
import {
  createBlockedContentError,
  createOutdatedClientError,
  isBlockedContentError,
  isOutdatedClientError,
  normalizeError,
  recoveryHint,
  formatErrorForToast,
  NormalizedError,
} from "../utils/errorHandler";
import { RetryError } from "../utils/retry";

describe("Error Handler Utils", () => {
  describe("normalizeError", () => {
    it("normalizes network errors", () => {
      const error = new Error("Network request failed");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("network");
      expect(normalized.retryable).toBe(true);
      expect(normalized.message).toContain("lost connection");
    });

    it("normalizes 'failed to fetch' as network error", () => {
      const error = new Error("Failed to fetch resource");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("network");
      expect(normalized.retryable).toBe(true);
    });

    it("normalizes offline errors", () => {
      const error = new Error("Browser is offline");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("network");
    });

    it("normalizes timeout errors", () => {
      const error = new Error("Request timeout after 30s");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("timeout");
      expect(normalized.retryable).toBe(true);
      expect(normalized.message).toContain("took too long");
    });

    it("normalizes timed out errors", () => {
      const error = new Error("Operation timed out");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("timeout");
    });

    it("normalizes abort errors as timeout", () => {
      const error = new Error("Request was aborted");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("timeout");
    });

    it("normalizes quota/429 errors as non-retryable", () => {
      const error = new Error("Rate limit exceeded (429)");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("quota");
      expect(normalized.retryable).toBe(false);
    });

    it("normalizes unauthorized/401 errors", () => {
      const error = new Error("Unauthorized access (401)");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("unauthorized");
      expect(normalized.retryable).toBe(false);
    });

    it("normalizes forbidden/403 errors", () => {
      const error = new Error("Access forbidden (403)");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("unauthorized");
      expect(normalized.retryable).toBe(false);
    });

    it("normalizes 404/not found as model_unavailable", () => {
      const error = new Error("Model not found (404)");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("model_unavailable");
      expect(normalized.retryable).toBe(false);
    });

    it("normalizes unavailable/overloaded errors", () => {
      const error = new Error("Service temporarily unavailable");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("model_unavailable");
      expect(normalized.retryable).toBe(true);
    });

    it("normalizes busy errors", () => {
      const error = new Error("Server is busy, try again later");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("model_unavailable");
    });

    it("normalizes validation/400 errors as non-retryable", () => {
      const error = new Error("Bad request (400): invalid parameters");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("validation");
      expect(normalized.retryable).toBe(false);
    });

    it("normalizes invalid input errors", () => {
      const error = new Error("Invalid image format");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("validation");
    });

    it("defaults to unknown for unrecognized errors", () => {
      const error = new Error("Something completely unexpected happened");
      const normalized = normalizeError(error);

      expect(normalized.kind).toBe("unknown");
      expect(normalized.retryable).toBe(true);
    });

    it("handles string errors", () => {
      const normalized = normalizeError("Network failure");

      expect(normalized.kind).toBe("network");
      expect(normalized.message).toContain("lost connection");
      // Raw technical text is kept off the user-facing message …
      expect(normalized.message).not.toContain("Network failure");
      // … but preserved for telemetry/diagnostics.
      expect(normalized.original).toBe("Network failure");
    });

    it("handles non-Error objects", () => {
      const normalized = normalizeError({ code: 500 });

      expect(normalized.kind).toBe("unknown");
      expect(normalized.message).toContain("Something went wrong");
    });

    it("preserves original error reference", () => {
      const originalError = new Error("Original");
      const normalized = normalizeError(originalError);

      expect(normalized.original).toBe(originalError);
    });

    it("passes through already-normalized errors", () => {
      const alreadyNormalized = new Error("Already normalized") as NormalizedError;
      alreadyNormalized.kind = "quota";
      alreadyNormalized.retryable = false;

      const result = normalizeError(alreadyNormalized);

      expect(result.kind).toBe("quota");
      expect(result.retryable).toBe(false);
    });

    it("classifies the terminal failure inside an exhausted retry", () => {
      const terminal = new Error("The service is temporarily unavailable");
      const exhausted = new RetryError(
        "Operation failed after 3 attempts",
        terminal,
        3,
      );

      const result = normalizeError(exhausted);

      expect(result.kind).toBe("model_unavailable");
      expect(result.retryable).toBe(true);
      expect(result.message).toBe("The AI model is temporarily unavailable.");
      expect(result.original).toBe(exhausted);
    });
  });

  describe("blocked content", () => {
    it("creates a terminal blocked error with curated copy and the technical reason", () => {
      const blocked = createBlockedContentError("finishReason=SAFETY");

      expect(blocked.kind).toBe("blocked");
      expect(blocked.retryable).toBe(false);
      expect(blocked.message).toBe(
        "This photo or wording can't be used for an AI post.",
      );
      expect(blocked.message).not.toContain("SAFETY");
      expect(String((blocked.original as Error).message)).toContain(
        "finishReason=SAFETY",
      );
      expect(isBlockedContentError(blocked)).toBe(true);
    });

    it("passes a blocked error through normalizeError unchanged", () => {
      const normalized = normalizeError(
        createBlockedContentError("finishReason=SAFETY"),
      );

      expect(normalized.kind).toBe("blocked");
      expect(normalized.retryable).toBe(false);
      expect(normalized.message).toBe(
        "This photo or wording can't be used for an AI post.",
      );
    });

    it("keeps the blocked classification through plain wrappers that carry it as cause", () => {
      const blocked = createBlockedContentError("finishReason=PROHIBITED_CONTENT");
      const ladderFailure = new Error(blocked.message);
      Object.defineProperty(ladderFailure, "cause", {
        value: blocked,
        enumerable: false,
      });
      const wrapped = new Error(`Failed to generate text content: ${blocked.message}`, {
        cause: ladderFailure,
      });

      const normalized = normalizeError(wrapped);

      expect(normalized.kind).toBe("blocked");
      expect(normalized.retryable).toBe(false);
      expect(normalized.message).toBe(
        "This photo or wording can't be used for an AI post.",
      );
      expect(normalized.original).toBe(wrapped);
      expect(isBlockedContentError(wrapped)).toBe(true);
    });

    it("adopts any typed cause, not only blocked ones", () => {
      const quota = new Error(
        "Too many requests — try again in a minute.",
      ) as NormalizedError;
      quota.kind = "quota";
      quota.retryable = false;
      const wrapped = new Error(quota.message, { cause: quota });

      const normalized = normalizeError(wrapped);

      expect(normalized.kind).toBe("quota");
      expect(normalized.retryable).toBe(false);
    });

    it("does not treat a quality-gate 'blocked' message as a content block", () => {
      const normalized = normalizeError(
        new Error("AI caption blocked by quality gate"),
      );

      expect(normalized.kind).toBe("unknown");
      expect(normalized.retryable).toBe(true);
      expect(isBlockedContentError(normalized)).toBe(false);
    });

    it("provides the blocked recovery hint and toast copy", () => {
      const blocked = normalizeError(
        createBlockedContentError("finishReason=IMAGE_SAFETY"),
      );

      expect(recoveryHint(blocked)).toBe(
        "Try a different photo or adjust the details.",
      );
      expect(formatErrorForToast(blocked)).toBe(
        "This photo or wording can't be used for an AI post. Try a different photo or adjust the details.",
      );
    });
  });

  describe("outdated client", () => {
    it("creates a terminal outdated error with curated copy and the version pair on original", () => {
      const outdated = createOutdatedClientError("5", "6");

      expect(outdated.kind).toBe("outdated");
      expect(outdated.retryable).toBe(false);
      expect(outdated.message).toBe("This version of the app is out of date.");
      expect(outdated.message).not.toContain("409");
      expect(String((outdated.original as Error).message)).toContain(
        "client 5, server 6",
      );
      expect(isOutdatedClientError(outdated)).toBe(true);
      expect(isBlockedContentError(outdated)).toBe(false);
    });

    it("survives normalizeError and plain wrappers that carry it as cause", () => {
      const outdated = createOutdatedClientError("5", "6");
      expect(normalizeError(outdated)).toMatchObject({
        kind: "outdated",
        retryable: false,
        message: "This version of the app is out of date.",
      });

      const ladderFailure = new Error(outdated.message);
      Object.defineProperty(ladderFailure, "cause", {
        value: outdated,
        enumerable: false,
      });
      const wrapped = new Error(
        `Failed to generate text content: ${outdated.message}`,
        {
          cause: ladderFailure,
        },
      );
      expect(normalizeError(wrapped).kind).toBe("outdated");
      expect(isOutdatedClientError(wrapped)).toBe(true);
    });

    it("never classifies by substring, so copy that mentions versions stays retryable", () => {
      for (const message of [
        "This version of the app is out of date.",
        "POLICY_VERSION_MISMATCH",
        "outdated model policy",
      ]) {
        const normalized = normalizeError(new Error(message));
        expect(normalized.kind).toBe("unknown");
        expect(normalized.retryable).toBe(true);
      }
    });

    it("provides the update hint and toast copy", () => {
      const outdated = normalizeError(createOutdatedClientError("5", "6"));

      expect(recoveryHint(outdated)).toBe(
        "Update the app from your Home Screen, then try again.",
      );
      expect(formatErrorForToast(outdated)).toBe(
        "This version of the app is out of date. Update the app from your Home Screen, then try again.",
      );
    });
  });

  describe("recoveryHint", () => {
    it("provides network recovery hint", () => {
      const error = normalizeError(new Error("Network error"));
      const hint = recoveryHint(error);

      expect(hint).toContain("internet connection");
    });

    it("provides timeout recovery hint", () => {
      const error = normalizeError(new Error("Request timeout"));
      const hint = recoveryHint(error);

      expect(hint).toContain("AI took too long");
    });

    it("provides quota recovery hint", () => {
      const error = normalizeError(new Error("Quota exceeded (429)"));
      const hint = recoveryHint(error);

      expect(hint).toContain("busy");
    });

    it("provides unauthorized recovery hint", () => {
      const error = normalizeError(new Error("Unauthorized (401)"));
      const hint = recoveryHint(error);

      expect(hint).toContain("sign in");
    });

    it("provides model_unavailable recovery hint", () => {
      const error = normalizeError(new Error("Model unavailable"));
      const hint = recoveryHint(error);

      expect(hint).toContain("Retrying");
    });

    it("provides validation recovery hint", () => {
      const error = normalizeError(new Error("Invalid request (400)"));
      const hint = recoveryHint(error);

      expect(hint).toContain("photo");
    });

    it("provides generic recovery hint for unknown errors", () => {
      const error = normalizeError(new Error("Something weird"));
      const hint = recoveryHint(error);

      expect(hint).toContain("try again");
    });
  });

  describe("formatErrorForToast", () => {
    it("combines error message with recovery hint", () => {
      const error = normalizeError(new Error("Network failed"));
      const formatted = formatErrorForToast(error);

      expect(formatted).toContain("lost connection");
      expect(formatted).toContain("internet connection");
    });

    it("returns trimmed result", () => {
      const error = normalizeError(new Error("Test error"));
      const formatted = formatErrorForToast(error);

      expect(formatted).toBe(formatted.trim());
    });
  });
});
