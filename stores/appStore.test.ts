import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStep, type Dealer } from "../types";

const mocks = vi.hoisted(() => ({
  impersonatePerson: vi.fn(),
  exitImpersonation: vi.fn(),
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  impersonatePerson: mocks.impersonatePerson,
  exitImpersonation: mocks.exitImpersonation,
}));

vi.mock("../utils/creativeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/creativeStorage")>()),
  clearAllCreatives: vi.fn().mockResolvedValue(true),
  clearDealerCreatives: vi.fn().mockResolvedValue(true),
}));

import { useAppStore } from "./appStore";

const store: Dealer = { id: "dealer-7", name: "Lakeside Kia" };
const systemDealer: Dealer = { id: "system-dealer", name: "SYSTEM ADMIN" };

const managerSession = {
  role: "dealer_admin",
  dealer: store,
  person: { id: "person-1", name: "Dana Reyes", role: "manager" },
  is_impersonation: true,
};

/** Every byte the app could have written to browser storage. */
const storedText = (): string => {
  const dump = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return `${key}=${storage.getItem(key) ?? ""}`;
    }).join("\n");
  return `${dump(localStorage)}\n${dump(sessionStorage)}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useAppStore.setState({
    currentDealer: systemDealer,
    role: "super_admin",
    step: AppStep.ADMIN,
    isImpersonating: false,
    managerEntry: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({
    currentDealer: null,
    role: "salesperson",
    step: AppStep.LOGIN,
    isImpersonating: false,
    managerEntry: null,
  });
});

describe("manager deep link (setManagerEntry)", () => {
  it("starts empty, stores a copy of the entry and clears on null", () => {
    expect(useAppStore.getState().managerEntry).toBeNull();
    const entry = { section: "channels" as const };
    useAppStore.getState().setManagerEntry(entry);
    expect(useAppStore.getState().managerEntry).toEqual({ section: "channels" });
    expect(useAppStore.getState().managerEntry).not.toBe(entry);
    useAppStore.getState().setManagerEntry(null);
    expect(useAppStore.getState().managerEntry).toBeNull();
  });

  it("drops a section that does not exist", () => {
    useAppStore
      .getState()
      .setManagerEntry({ section: "billing" as unknown as "channels" });
    expect(useAppStore.getState().managerEntry).toBeNull();
  });

  it("survives the session swap into the store's manager", async () => {
    mocks.impersonatePerson.mockResolvedValue(managerSession);
    useAppStore.getState().setManagerEntry({ section: "voice" });
    await useAppStore.getState().impersonatePerson("person-1");

    const state = useAppStore.getState();
    expect(mocks.impersonatePerson).toHaveBeenCalledWith("person-1");
    // The swap really happened...
    expect(state.role).toBe("dealer_admin");
    expect(state.currentDealer).toEqual(store);
    expect(state.isImpersonating).toBe(true);
    expect(state.step).toBe(AppStep.DEALER_ADMIN);
    // ...and the entry crossed it for the manager dashboard to read.
    expect(state.managerEntry).toEqual({ section: "voice" });
  });

  it("is never written to browser storage", async () => {
    mocks.impersonatePerson.mockResolvedValue(managerSession);
    useAppStore.getState().setManagerEntry({ section: "workflow" });
    await useAppStore.getState().impersonatePerson("person-1");
    // The swap did persist the session snapshot, so storage is not empty.
    expect(storedText()).toContain("dealer-7");
    expect(storedText()).not.toMatch(/managerEntry|workflow/);
  });

  it("is dropped when the swap lands on a salesperson, who has no settings", async () => {
    mocks.impersonatePerson.mockResolvedValue({
      ...managerSession,
      role: "salesperson",
    });
    useAppStore.getState().setManagerEntry({ section: "creative" });
    await useAppStore.getState().impersonatePerson("person-2");
    expect(useAppStore.getState().role).toBe("salesperson");
    expect(useAppStore.getState().managerEntry).toBeNull();
  });

  it("is dropped when opening the store fails, so it cannot steer a later visit", async () => {
    mocks.impersonatePerson.mockRejectedValue(new Error("No active manager."));
    useAppStore.getState().setManagerEntry({ section: "channels" });
    await expect(useAppStore.getState().impersonatePerson("person-1")).rejects.toThrow(
      "No active manager.",
    );
    expect(useAppStore.getState().role).toBe("super_admin");
    expect(useAppStore.getState().managerEntry).toBeNull();
  });

  it("is cleared by exiting impersonation", async () => {
    mocks.impersonatePerson.mockResolvedValue(managerSession);
    mocks.exitImpersonation.mockResolvedValue({
      role: "super_admin",
      dealer: systemDealer,
      person: null,
      is_impersonation: false,
    });
    useAppStore.getState().setManagerEntry({ section: "profile" });
    await useAppStore.getState().impersonatePerson("person-1");
    expect(useAppStore.getState().managerEntry).toEqual({ section: "profile" });
    await useAppStore.getState().exitImpersonation();
    expect(useAppStore.getState().role).toBe("super_admin");
    expect(useAppStore.getState().managerEntry).toBeNull();
  });

  it("is cleared by logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    mocks.impersonatePerson.mockResolvedValue(managerSession);
    useAppStore.getState().setManagerEntry({ section: "channels" });
    await useAppStore.getState().impersonatePerson("person-1");
    await useAppStore.getState().logout();
    expect(useAppStore.getState().step).toBe(AppStep.LOGIN);
    expect(useAppStore.getState().managerEntry).toBeNull();
  });
});
