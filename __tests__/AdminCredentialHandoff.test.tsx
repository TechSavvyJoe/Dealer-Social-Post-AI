import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../services/salespeople";

const mocks = vi.hoisted(() => ({
  getDealers: vi.fn(),
  listPeoplePage: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  getDealers: mocks.getDealers,
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  listPeoplePage: mocks.listPeoplePage,
}));

vi.mock("../components/SystemHealthPanel", () => ({
  SystemHealthPanel: () => <div>System health ready</div>,
}));

vi.mock("../components/PersonEditModal", () => ({
  PersonEditModal: ({
    isOpen,
    person,
    onClose,
    onCommitted,
    onCredentialIssued,
  }: {
    isOpen: boolean;
    person: Person | null;
    onClose: () => void;
    onCommitted?: (person: Person) => void;
    onCredentialIssued?: (credential: { person: Person; pin: string }) => void;
  }) => {
    if (!isOpen || !person) return null;
    return (
      <div role="dialog" aria-label="Mock account settings">
        <span>
          Manager login state:{" "}
          {person.hasManagerLogin ? person.managerUsername : "not set"}
        </span>
        <button
          type="button"
          onClick={() => {
            const updated = { ...person, pinNeedsDistribution: true };
            onCommitted?.(updated);
            onCredentialIssued?.({ person: updated, pin: "4826" });
            onClose();
          }}
        >
          Simulate code rotation
        </button>
        <button
          type="button"
          onClick={() => {
            onCommitted?.({ ...person, pinNeedsDistribution: false });
            onClose();
          }}
        >
          Simulate distribution acknowledgement
        </button>
        {person.role === "manager" ? (
          <button
            type="button"
            onClick={() => {
              onCommitted?.({
                ...person,
                hasManagerLogin: true,
                managerUsername: "taylor.manager",
              });
              onClose();
            }}
          >
            Simulate manager login setup
          </button>
        ) : null}
      </div>
    );
  },
}));

import { AdminDashboard } from "../components/AdminDashboard";
import { ToastProvider } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";

const person: Person = {
  id: "person-1",
  dealer: "dealer-1",
  dealerName: "Northside Motors",
  name: "Taylor Morgan",
  role: "salesperson",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
  hasManagerLogin: false,
};

const manager: Person = {
  ...person,
  id: "manager-1",
  name: "Morgan Taylor",
  role: "manager",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealers.mockResolvedValue([{ id: "dealer-1", name: "Northside Motors" }]);
  mocks.listPeoplePage.mockResolvedValue({ items: [person], total: 1 });
  useAppStore.setState({
    currentDealer: { id: "system-dealer", name: "SYSTEM ADMIN" },
    role: "super_admin",
  });
});

afterEach(() => {
  useAppStore.setState({ currentDealer: null, role: "salesperson" });
});

describe("super-admin credential handoff", () => {
  it("provides arrow-key navigation and linked panels for the admin hub tabs", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AdminDashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    const dealersTab = screen.getByRole("tab", { name: "Dealers" });
    dealersTab.focus();
    fireEvent.keyDown(dealersTab, { key: "ArrowRight" });

    const adminsTab = screen.getByRole("tab", { name: "Admins" });
    await waitFor(() => expect(adminsTab).toHaveFocus());
    expect(adminsTab).toHaveAttribute("aria-selected", "true");
    expect(adminsTab).toHaveAttribute("aria-controls", "admin-panel-admins");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "admin-tab-admins",
    );

    fireEvent.keyDown(adminsTab, { key: "End" });
    const usersTab = screen.getByRole("tab", { name: "Users" });
    await waitFor(() => expect(usersTab).toHaveFocus());
    expect(usersTab).toHaveAttribute("tabindex", "0");
    queryClient.clear();
  });

  it("shows the authoritative all-store total instead of only the loaded page", async () => {
    mocks.listPeoplePage.mockResolvedValue({ items: [person], total: 237 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AdminDashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Users" }));
    expect(await screen.findByText("1–1 of 237")).toBeInTheDocument();
    queryClient.clear();
  });

  it("updates the cached roster immediately and preserves a rotated code outside the modal", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AdminDashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Users" }));
    expect(await screen.findByText("Taylor Morgan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate code rotation" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Mock account settings" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("4826")).toBeInTheDocument();
    expect(screen.getByText("Code to share")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulate distribution acknowledgement",
      }),
    );

    await waitFor(() => expect(screen.queryByText("4826")).not.toBeInTheDocument());
    expect(screen.getByText("Code set")).toBeInTheDocument();
    queryClient.clear();
  });

  it("preserves the one-time PIN while refreshing its manager-login handoff state", async () => {
    mocks.listPeoplePage.mockResolvedValue({ items: [manager], total: 1 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AdminDashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Admins" }));
    expect(await screen.findByText("Morgan Taylor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate code rotation" }));

    expect(await screen.findByText("4826")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up manager login" }));
    expect(screen.getByText("Manager login state: not set")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate manager login setup" }),
    );

    expect(screen.getByText("4826")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up manager login" }));
    expect(screen.getByText("Manager login state: taylor.manager")).toBeInTheDocument();
    queryClient.clear();
  });
});
