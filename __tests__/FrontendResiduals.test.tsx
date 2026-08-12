import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "../components/Header";
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

describe("final frontend residuals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vi.fn(),
    });
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

  it("uses truthful neutral studio chrome and the signed-in posting identity", () => {
    render(
      <Header
        dealer={{ id: "dealer-b", name: "Northstar Motors" }}
        person={{
          id: "person-b",
          dealer: "dealer-b",
          name: "Jamie Rivera",
          role: "salesperson",
          active: true,
        }}
        onLogout={vi.fn()}
        onShowSettings={vi.fn()}
        studioMode
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Publish studio" }),
    ).toBeVisible();
    expect(screen.queryByText("Ready to publish")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Posting as Jamie Rivera")).toBeVisible();
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
