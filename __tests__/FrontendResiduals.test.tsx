import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "../components/Header";
import {
  SalespersonPicker,
  salespersonStorageKey,
} from "../components/SalespersonPicker";
import { Modal } from "../components/ui/Modal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

const { mockListSalespeople } = vi.hoisted(() => ({
  mockListSalespeople: vi.fn(),
}));

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

vi.mock("../services/salespeople", () => ({
  listSalespeople: mockListSalespeople,
}));

const dealerBRoster = [
  {
    id: "person-b",
    dealer: "dealer-b",
    name: "Bob B.",
    active: true,
  },
];

const PickerHarness: React.FC<{ dealerId: string }> = ({ dealerId }) => {
  const [value, setValue] = useState<{ id?: string; name: string }>({
    name: "",
  });
  return (
    <>
      <SalespersonPicker dealerId={dealerId} value={value} onChange={setValue} />
      <output data-testid="picker-value">{JSON.stringify(value)}</output>
    </>
  );
};

describe("final frontend residuals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("migrates a roster-validated legacy identity into dealer-scoped storage", async () => {
    localStorage.setItem("dsp.salespersonName", "bob b.");
    mockListSalespeople.mockResolvedValue(dealerBRoster);

    render(<PickerHarness dealerId="dealer-b" />);

    await waitFor(() =>
      expect(screen.getByTestId("picker-value")).toHaveTextContent(
        JSON.stringify({ id: "person-b", name: "Bob B." }),
      ),
    );
    expect(
      JSON.parse(localStorage.getItem(salespersonStorageKey("dealer-b")) || ""),
    ).toEqual({ id: "person-b", name: "Bob B." });
    expect(localStorage.getItem("dsp.salespersonName")).toBeNull();
  });

  it("does not restore a different dealer's persisted salesperson", async () => {
    localStorage.setItem(
      "dsp.salespersonPicker",
      JSON.stringify({ id: "person-a", name: "Alice A." }),
    );
    mockListSalespeople.mockResolvedValue(dealerBRoster);

    render(<PickerHarness dealerId="dealer-b" />);

    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /your name/i });
    expect(trigger).toHaveTextContent("Pick yourself");
    await user.click(trigger);
    await screen.findByRole("option", { name: /Bob B\./i });
    expect(screen.getByTestId("picker-value")).toHaveTextContent(
      JSON.stringify({ name: "" }),
    );
    expect(localStorage.getItem(salespersonStorageKey("dealer-b"))).toBeNull();
  });

  it("removes a stale scoped roster id and exposes valid listbox ownership", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      salespersonStorageKey("dealer-b"),
      JSON.stringify({ id: "inactive-person", name: "Former Teammate" }),
    );
    mockListSalespeople.mockResolvedValue(dealerBRoster);

    render(<PickerHarness dealerId="dealer-b" />);

    const trigger = await screen.findByRole("button", {
      name: /your name/i,
    });
    expect(trigger).toHaveTextContent("Pick yourself");
    await waitFor(() =>
      expect(localStorage.getItem(salespersonStorageKey("dealer-b"))).toBeNull(),
    );
    await user.click(trigger);
    const option = screen.getByRole("option", { name: /Bob B\./i });
    expect(option.closest("li")).toHaveAttribute("role", "none");
  });

  it("confirms before logging out with a generated result", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <Header
        dealer={{ id: "dealer-b", name: "Northstar Motors" }}
        onLogout={onLogout}
        onShowSettings={vi.fn()}
        confirmBeforeLogout
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", {
        name: "Log out and discard this post?",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Keep working" }));
    expect(onLogout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await user.click(await screen.findByRole("button", { name: "Log out anyway" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("defers every page-level shortcut while an aria-modal dialog is open", async () => {
    const handlers = {
      onPrimary: vi.fn(),
      onCancel: vi.fn(),
      onPalette: vi.fn(),
      onFocusSearch: vi.fn(),
    };
    const Harness = () => {
      const [open, setOpen] = useState(true);
      useKeyboardShortcuts(handlers);
      return (
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Release">
          <input aria-label="Customer name" />
        </Modal>
      );
    };

    render(<Harness />);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "/" });
    expect(handlers.onPrimary).not.toHaveBeenCalled();
    expect(handlers.onPalette).not.toHaveBeenCalled();
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Release" })).toBeNull(),
    );
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });
});
