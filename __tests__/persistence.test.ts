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
        JSON.stringify({ loginTimestamp: existingTimestamp, dealerId: "old" }),
      );

      saveSession({ dealerId: "new123" });

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.loginTimestamp).toBe(existingTimestamp);
      expect(savedData.dealerId).toBe("new123");
    });

    it("keeps all image bytes out of localStorage", () => {
      const largeImage = "x".repeat(600_000); // 600KB, over the 500KB limit
      const sessionData = {
        dealerId: "dealer123",
        selectedImage: largeImage,
        generatedPost: {
          image: largeImage,
          text: "Test caption",
          postId: "post-123",
          approvalStatus: "pending" as const,
          releaseStatus: "saved" as const,
        },
      };

      saveSession(sessionData);

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.selectedImage).toBeUndefined();
      expect(savedData.generatedPost.image).toBeUndefined();
      expect(savedData.generatedPost.text).toBe("Test caption");
      expect(savedData.generatedPost.postId).toBe("post-123");
      expect(savedData.generatedPost.approvalStatus).toBe("pending");
      expect(savedData.generatedPost.releaseStatus).toBe("saved");
    });

    it("keeps even small images in the private IndexedDB archive only", () => {
      const smallImage = "x".repeat(100_000); // 100KB, under the 500KB limit
      const sessionData = {
        dealerId: "dealer123",
        selectedImage: smallImage,
      };

      saveSession(sessionData);

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.selectedImage).toBeUndefined();
    });

    it("scrubs legacy image bytes while loading session metadata", () => {
      localStorageMock.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dealerId: "dealer123",
          selectedImage: "data:image/jpeg;base64,legacy-original",
          generatedPost: {
            image: "data:image/jpeg;base64,legacy-result",
            text: "Retained caption",
          },
        }),
      );

      const loaded = loadSession();
      const stored = JSON.parse(localStorageMock.store[STORAGE_KEY]);

      expect(loaded?.selectedImage).toBeUndefined();
      expect(loaded?.generatedPost?.image).toBeUndefined();
      expect(loaded?.generatedPost?.text).toBe("Retained caption");
      expect(stored.selectedImage).toBeUndefined();
      expect(stored.generatedPost.image).toBeUndefined();
    });

    it("merges with existing session data", () => {
      localStorageMock.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dealerId: "dealer123",
          step: 1,
          compactMode: true,
        }),
      );

      saveSession({ step: 3 });

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.dealerId).toBe("dealer123");
      expect(savedData.step).toBe(3);
      expect(savedData.compactMode).toBe(true);
    });

    it("can explicitly remove workflow fields while retaining the dealer session", () => {
      saveSession({
        dealerId: "dealer123",
        step: 4,
        selectedImage: "data:image/png;base64,old",
        generatedPost: {
          image: "data:image/png;base64,old-result",
          text: "Old result",
        },
        generationParams: {
          style: "Modern & Bold",
          tone: "Excited",
          customerName: "Alex",
        },
      });

      saveSession({
        dealerId: "dealer123",
        step: 1,
        selectedImage: undefined,
        generatedPost: undefined,
        generationParams: undefined,
      });

      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.dealerId).toBe("dealer123");
      expect(savedData.step).toBe(1);
      expect(savedData.selectedImage).toBeUndefined();
      expect(savedData.generatedPost).toBeUndefined();
      expect(savedData.generationParams).toBeUndefined();
    });

    it("retries without workflow fields when the storage quota is exceeded", () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

      saveSession({
        dealerId: "dealer123",
        step: 3,
        theme: "midnight",
        preferredStyle: "Modern & Bold",
        preferredTone: "Excited",
        generatedPost: {
          text: "Huge caption",
        },
        generationParams: {
          style: "Modern & Bold",
          tone: "Excited",
          customerName: "Alex",
        },
      });

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
      const savedData = JSON.parse(localStorageMock.store[STORAGE_KEY]);
      expect(savedData.dealerId).toBe("dealer123");
      expect(savedData.step).toBe(3);
      expect(savedData.theme).toBe("midnight");
      expect(savedData.preferredStyle).toBe("Modern & Bold");
      expect(savedData.preferredTone).toBe("Excited");
      expect(savedData.generatedPost).toBeUndefined();
      expect(savedData.generationParams).toBeUndefined();
    });
  });

  describe("the in-memory Details draft (release signature, personal line)", () => {
    const SIGNATURE = "data:image/png;base64,ZHJhd24tc2lnbmF0dXJlLXN0cm9rZXM=";
    const draftParams = () => ({
      style: "Modern & Bold",
      tone: "Excited",
      customerName: "Alex",
      scenarioId: "customer_delivery",
      capturedRelease: {
        customerName: "Alex Johnson",
        signaturePngDataUrl: SIGNATURE,
        releaseId: "release-123",
      },
      personalLine: "Stop by and say hi on the lot.",
    });

    it("never writes the captured release or the personal line to localStorage", () => {
      saveSession({ dealerId: "dealer123", step: 2, generationParams: draftParams() });

      const raw = localStorageMock.store[STORAGE_KEY];
      expect(raw).not.toContain(SIGNATURE);
      expect(raw).not.toContain("release-123");
      expect(raw).not.toContain("Stop by and say hi on the lot.");
      const savedData = JSON.parse(raw);
      expect(savedData.generationParams).not.toHaveProperty("capturedRelease");
      expect(savedData.generationParams).not.toHaveProperty("personalLine");
      // The storable choices are kept as before.
      expect(savedData.generationParams).toMatchObject({
        customerName: "Alex",
        scenarioId: "customer_delivery",
      });
    });

    it("keeps the signature out on the quota-retry path too", () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

      saveSession({ dealerId: "dealer123", step: 2, generationParams: draftParams() });

      for (const [, written] of localStorageMock.setItem.mock.calls) {
        expect(written).not.toContain(SIGNATURE);
        expect(written).not.toContain("capturedRelease");
        expect(written).not.toContain("personalLine");
      }
      expect(localStorageMock.store[STORAGE_KEY]).not.toContain(SIGNATURE);
    });

    it("does not carry a stored copy forward when another field is saved", () => {
      localStorageMock.store[STORAGE_KEY] = JSON.stringify({
        dealerId: "dealer123",
        step: 2,
        generationParams: draftParams(),
      });

      saveSession({ step: 3 });

      const raw = localStorageMock.store[STORAGE_KEY];
      expect(raw).not.toContain(SIGNATURE);
      const savedData = JSON.parse(raw);
      expect(savedData.step).toBe(3);
      expect(savedData.generationParams).not.toHaveProperty("capturedRelease");
      expect(savedData.generationParams).not.toHaveProperty("personalLine");
      expect(savedData.generationParams.customerName).toBe("Alex");
    });

    it("loads a stored copy without either field and rewrites storage scrubbed", () => {
      localStorageMock.store[STORAGE_KEY] = JSON.stringify({
        dealerId: "dealer123",
        step: 2,
        loginTimestamp: Date.now(),
        generationParams: draftParams(),
      });

      const loaded = loadSession();

      expect(loaded?.generationParams).not.toHaveProperty("capturedRelease");
      expect(loaded?.generationParams).not.toHaveProperty("personalLine");
      expect(loaded?.generationParams).toMatchObject({
        customerName: "Alex",
        scenarioId: "customer_delivery",
      });
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
      const raw = localStorageMock.store[STORAGE_KEY];
      expect(raw).not.toContain(SIGNATURE);
      expect(JSON.parse(raw).generationParams).not.toHaveProperty("capturedRelease");
      expect(JSON.parse(raw).generationParams).not.toHaveProperty("personalLine");
    });
  });

  describe("clearSession", () => {
    it("removes session from localStorage", () => {
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ dealerId: "test" }));

      clearSession();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
  });
});
