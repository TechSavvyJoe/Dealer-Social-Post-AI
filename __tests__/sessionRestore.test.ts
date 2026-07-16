import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSession,
  resolveRestoredStep,
  useAppStore,
} from "../stores/appStore";
import { AppStep } from "../types";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } satisfies Storage;
})();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useAppStore.setState({
    currentDealer: null,
    selectedImage: null,
    generatedPost: null,
    generationParams: null,
    step: AppStep.LOGIN,
  });
});

describe("session restore navigation", () => {
  it("never restores a result step without a complete generated post", () => {
    expect(
      resolveRestoredStep("salesperson", AppStep.RESULT, false, false),
    ).toBe(AppStep.CAPTURE);
    expect(
      resolveRestoredStep("salesperson", AppStep.RESULT, true, false),
    ).toBe(AppStep.CUSTOMIZE);
  });

  it("recovers interrupted generation to the retained customization", () => {
    expect(
      resolveRestoredStep("salesperson", AppStep.GENERATING, true, false),
    ).toBe(AppStep.CUSTOMIZE);
  });

  it("restores a complete result and clamps admin steps to server roles", () => {
    expect(resolveRestoredStep("salesperson", AppStep.RESULT, true, true)).toBe(
      AppStep.RESULT,
    );
    expect(
      resolveRestoredStep("salesperson", AppStep.ADMIN, false, false),
    ).toBe(AppStep.CAPTURE);
    expect(
      resolveRestoredStep("dealer_admin", AppStep.RESULT, true, true),
    ).toBe(AppStep.DEALER_ADMIN);
    expect(
      resolveRestoredStep("super_admin", AppStep.CAPTURE, false, false),
    ).toBe(AppStep.ADMIN);
  });

  it("aborts a session request that exceeds its startup budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          });
        });
      }),
    );

    await expect(fetchSession({ method: "GET" }, 5)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("starts a clean workflow when a different dealer signs in", async () => {
    localStorage.setItem(
      "dealer-social-post-ai.session",
      JSON.stringify({
        dealerId: "dealer-a",
        step: AppStep.RESULT,
        generatedPost: {
          image: "data:image/png;base64,tenant-a",
          text: "Dealer A customer",
        },
      }),
    );
    useAppStore.setState({
      currentDealer: { id: "dealer-a", name: "Dealer A" },
      selectedImage: "data:image/png;base64,tenant-a-photo",
      generatedPost: {
        image: "data:image/png;base64,tenant-a",
        text: "Dealer A customer",
      },
      step: AppStep.RESULT,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            role: "salesperson",
            dealer: { id: "dealer-b", name: "Dealer B" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(useAppStore.getState().login("222222")).resolves.toBe(true);

    const state = useAppStore.getState();
    expect(state.currentDealer?.id).toBe("dealer-b");
    expect(state.selectedImage).toBeNull();
    expect(state.generatedPost).toBeNull();
    expect(state.generationParams).toBeNull();
    expect(state.step).toBe(AppStep.CAPTURE);

    const persisted = JSON.parse(
      localStorage.getItem("dealer-social-post-ai.session") || "{}",
    );
    expect(persisted.dealerId).toBe("dealer-b");
    expect(persisted.selectedImage).toBeUndefined();
    expect(persisted.generatedPost).toBeUndefined();
    expect(persisted.generationParams).toBeUndefined();
  });
});
