import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSession, saveSession, clearSession } from "../utils/persistence";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get store() {
      return store;
    },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("Persistence Utils", () => {
  const STORAGE_KEY = "dealer-social-post-ai.session";
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("loadSession", () => {
    it("returns null when no session exists", () => {
      const result = loadSession();
      expect(result).toBeNull();
    });

    it("returns session data when valid session exists", () => {
      const sessionData = {
        dealerId: "dealer123",
        step: 2,
        loginTimestamp: Date.now(),
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(sessionData));

      const result = loadSession();
      expect(result).toEqual(sessionData);
    });

    it("returns null and clears session when session has expired (7+ days)", () => {
      const eightDaysAgo = Date.now() - (SEVEN_DAYS_MS + 1000);
      const sessionData = {
        dealerId: "dealer123",
        step: 2,
        loginTimestamp: eightDaysAgo,
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(sessionData));

      const result = loadSession();

      expect(result).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it("returns session when not yet expired (within 7 days)", () => {
      const sixDaysAgo = Date.now() - (SEVEN_DAYS_MS - 24 * 60 * 60 * 1000);
      const sessionData = {
        dealerId: "dealer123",
        step: 2,
        loginTimestamp: sixDaysAgo,
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(sessionData));

      const result = loadSession();

      expect(result).toEqual(sessionData);
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it("returns null when localStorage contains invalid JSON", () => {
      localStorageMock.setItem(STORAGE_KEY, "not valid json {{{");

      const result = loadSession();
      expect(result).toBeNull();
    });

    it("returns session without expiry check when no loginTimestamp", () => {
      const sessionData = {
        dealerId: "dealer123",
        step: 2,
        // No loginTimestamp
      };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(sessionData));

      const result = loadSession();
      expect(result).toEqual(sessionData);
    });
  });

  describe("saveSession", () => {
    it("saves session data to localStorage", () => {
      const sessionData = {
        dealerId: "dealer123",
        step: 2,
      };

      saveSession(sessionData);

      expect(localStorageMock.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.dealerId).toBe("dealer123");
      expect(savedData.step).toBe(2);
    });

    it("preserves existing loginTimestamp when not provided", () => {
      const existingTimestamp = Date.now() - 1000;
      localStorageMock.setItem(
        STORAGE_KEY,
        JSON.stringify({ loginTimestamp: existingTimestamp, dealerId: "old" })
      );

      saveSession({ dealerId: "new123" });

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.loginTimestamp).toBe(existingTimestamp);
      expect(savedData.dealerId).toBe("new123");
    });

    it("prunes large images to prevent localStorage quota errors", () => {
      const largeImage = "x".repeat(600_000); // 600KB, over the 500KB limit
      const sessionData = {
        dealerId: "dealer123",
        selectedImage: largeImage,
        generatedPost: {
          image: largeImage,
          text: "Test caption",
        },
      };

      saveSession(sessionData);

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.selectedImage).toBeUndefined();
      expect(savedData.generatedPost.image).toBeUndefined();
      expect(savedData.generatedPost.text).toBe("Test caption");
    });

    it("keeps small images that are under the size limit", () => {
      const smallImage = "x".repeat(100_000); // 100KB, under the 500KB limit
      const sessionData = {
        dealerId: "dealer123",
        selectedImage: smallImage,
      };

      saveSession(sessionData);

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.selectedImage).toBe(smallImage);
    });

    it("merges with existing session data", () => {
      localStorageMock.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dealerId: "dealer123",
          step: 1,
          compactMode: true,
        })
      );

      saveSession({ step: 3 });

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.dealerId).toBe("dealer123");
      expect(savedData.step).toBe(3);
      expect(savedData.compactMode).toBe(true);
    });
  });

  describe("clearSession", () => {
    it("removes session from localStorage", () => {
      localStorageMock.setItem(
        STORAGE_KEY,
        JSON.stringify({ dealerId: "test" })
      );

      clearSession();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
  });
});
