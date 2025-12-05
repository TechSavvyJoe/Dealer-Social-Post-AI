import { describe, it, expect } from "vitest";
import {
  normalizeError,
  recoveryHint,
  formatErrorForToast,
  NormalizedError,
} from "../utils/errorHandler";

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
      expect(normalized.message).toContain("Network failure");
    });

    it("handles non-Error objects", () => {
      const normalized = normalizeError({ code: 500 });

      expect(normalized.kind).toBe("unknown");
      expect(normalized.message).toContain("Unknown error");
    });

    it("preserves original error reference", () => {
      const originalError = new Error("Original");
      const normalized = normalizeError(originalError);

      expect(normalized.original).toBe(originalError);
    });

    it("passes through already-normalized errors", () => {
      const alreadyNormalized = new Error(
        "Already normalized"
      ) as NormalizedError;
      alreadyNormalized.kind = "quota";
      alreadyNormalized.retryable = false;

      const result = normalizeError(alreadyNormalized);

      expect(result.kind).toBe("quota");
      expect(result.retryable).toBe(false);
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

      expect(hint).toContain("later");
    });

    it("provides unauthorized recovery hint", () => {
      const error = normalizeError(new Error("Unauthorized (401)"));
      const hint = recoveryHint(error);

      expect(hint).toContain("credentials");
    });

    it("provides model_unavailable recovery hint", () => {
      const error = normalizeError(new Error("Model unavailable"));
      const hint = recoveryHint(error);

      expect(hint).toContain("Retrying");
    });

    it("provides validation recovery hint", () => {
      const error = normalizeError(new Error("Invalid request (400)"));
      const hint = recoveryHint(error);

      expect(hint).toContain("parameters");
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
