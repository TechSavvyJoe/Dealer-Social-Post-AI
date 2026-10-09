import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../types";

const mocks = vi.hoisted(() => ({
  getDealers: vi.fn(),
  addDealerWithFile: vi.fn(),
  updateDealerWithFile: vi.fn(),
  deleteDealer: vi.fn(),
  listPeoplePage: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  getDealers: mocks.getDealers,
  addDealerWithFile: mocks.addDealerWithFile,
  updateDealerWithFile: mocks.updateDealerWithFile,
  deleteDealer: mocks.deleteDealer,
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  listPeoplePage: mocks.listPeoplePage,
}));

vi.mock("../components/SystemHealthPanel", () => ({
  SystemHealthPanel: () => <div>System health ready</div>,
}));

import { AdminDashboard } from "../components/AdminDashboard";
import { ToastProvider } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";

const connections = {
  scope: "guided_setup" as const,
  secureStorageAvailable: true,
  dealers: [{ id: "dealer-1", name: "Northside Motors" }],
  services: [
    {
      service: "gemini" as const,
      scope: "global" as const,
      configured: true,
      enabled: true,
      revision: 2,
      state: "needs_test" as const,
      capabilities: [{ id: "text", label: "Caption access", state: "not_tested" }],
      nextAction: "Run a text test.",
      settings: {},
      credentialConfigured: { apiKey: true },
    },
    ...(["anthropic", "openai", "walkaround"] as const).map((service) => ({
      service,
      scope: "global" as const,
      configured: false,
      enabled: false,
      revision: 0,
      state: "off" as const,
      capabilities: [],
      nextAction: "Optional service is off.",
      settings: {},
      credentialConfigured: {},
    })),
    {
      service: "website" as const,
      scope: "dealer" as const,
      dealerId: "dealer-1",
      configured: false,
      enabled: false,
      revision: 0,
      state: "off" as const,
      capabilities: [],
      nextAction: "Optional service is off.",
      settings: {},
      credentialConfigured: {},
    },
  ],
  modelPolicyVersion: "5",
};
const verifiedConnections = {
  ...connections,
  services: connections.services.map((service) =>
    service.service === "gemini"
      ? {
          ...service,
          state: "ready" as const,
          capabilities: [{ id: "text", label: "Caption access", state: "verified" }],
          nextAction: "No action needed.",
        }
      : service,
  ),
};

const northside: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  website: "https://northsidemotors.com",
  phone: "(517) 555-0100",
  address: "12 Main St, Howell, MI",
  logo: "/api/files/dealers/dealer-1/logo.png",
  brand_color: "#1d4ed8",
  facebook_url: "https://facebook.com/northside",
  facebook_page_tag: "northside",
  instagram_handle: "northside",
  brand_voice: "Plain and friendly.",
  signature_look: "showroom",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  creative_system_v2: false,
  setup_notes: "",
};

const lakeside: Dealer = {
  id: "dealer-2",
  name: "Lakeside Kia",
  creative_system_v2: false,
  employee_disclosure_disabled: false,
  setup_notes: "",
};

const connectionCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/api/app/connections")).length;

let connectionFetchCount = 0;

const mount = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdminDashboard />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
};

const rowFor = async (name: string) =>
  (await screen.findByRole("rowheader", { name: new RegExp(name) })).closest(
    "tr",
  ) as HTMLElement;

const openRow = async (name: string) => {
  const row = await rowFor(name);
  fireEvent.click(within(row).getByRole("button", { name: new RegExp(name) }));
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  connectionFetchCount = 0;
  mocks.getDealers.mockResolvedValue([northside, lakeside]);
  mocks.addDealerWithFile.mockResolvedValue({ id: "dealer-9" });
  mocks.updateDealerWithFile.mockResolvedValue({ id: "dealer-1" });
  mocks.deleteDealer.mockResolvedValue(undefined);
  mocks.listPeoplePage.mockResolvedValue({ items: [], total: 0 });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).endsWith("/api/app/connections")) {
        connectionFetchCount += 1;
        return {
          ok: true,
          json: async () =>
            connectionFetchCount > 1 ? verifiedConnections : connections,
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
  useAppStore.setState({
    currentDealer: { id: "system-dealer", name: "SYSTEM ADMIN" },
    role: "super_admin",
    authEpoch: 1,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({ currentDealer: null, role: "salesperson" });
});

describe("system admin hub", () => {
  it("puts the title and four text tabs on one row, with no subtitle", async () => {
    mount();
    const heading = screen.getByRole("heading", { level: 1, name: "System admin" });
    const tablist = screen.getByRole("tablist", { name: "System admin sections" });
    expect(heading.parentElement).toBe(tablist.parentElement);
    expect(heading.parentElement).toHaveClass("border-b", "border-hairline");
    // The tablist scrolls sideways, which clips on both axes: it carries 4 px
    // of padding for the 2 px focus ring at 2 px offset, cancelled by margins
    // (1 px more at the bottom so the tabs sit on the hairline).
    expect(tablist).toHaveClass(
      "overflow-x-auto",
      "p-1",
      "-mx-1",
      "-mt-1",
      "-mb-[5px]",
    );
    for (const name of ["Dealers", "Admins", "Users", "Connections"]) {
      const tab = screen.getByRole("tab", { name });
      expect(tab.querySelector("svg")).toBeNull();
    }
    expect(screen.getByRole("tab", { name: "Dealers" })).toHaveClass(
      "border-brand-fill",
      "text-ink",
    );
    expect(screen.getByRole("tab", { name: "Admins" })).toHaveClass(
      "border-transparent",
      "text-ink-2",
    );
    expect(screen.queryByText(/Manage your dealerships/)).not.toBeInTheDocument();
    // Refresh lives in the tab's toolbar, not the title row.
    expect(
      within(heading.parentElement as HTMLElement).queryByRole("button"),
    ).toBeNull();
    expect(await screen.findByRole("button", { name: "Add dealer" })).toBeVisible();
  });

  it("keeps Refresh on every tab and the Store filter only on Admins and Users", async () => {
    mount();
    await rowFor("Northside Motors");
    const dealersPanel = screen.getByRole("tabpanel");
    expect(within(dealersPanel).getByRole("button", { name: "Refresh" })).toBeVisible();
    expect(screen.queryByLabelText("Store", { selector: "select" })).toBeNull();
    fireEvent.click(within(dealersPanel).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mocks.getDealers).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("tab", { name: "Admins" }));
    const adminsPanel = screen.getByRole("tabpanel");
    expect(adminsPanel).toHaveAttribute("id", "admin-panel-admins");
    expect(
      within(adminsPanel).getByLabelText("Store", { selector: "select" }),
    ).toBeVisible();
    expect(screen.getByText("Store", { selector: "label" })).not.toHaveClass(
      "uppercase",
    );
    expect(within(adminsPanel).getByRole("button", { name: "Refresh" })).toBeVisible();
  });

  it("refreshes guided connection verification and shows the server result", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    expect(await screen.findByText("0 of 1 required services verified.")).toBeVisible();
    expect(connectionCalls()).toBe(1);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(connectionCalls()).toBe(2));
    expect(await screen.findByText("1 of 1 required services verified.")).toBeVisible();
    expect(screen.getByRole("article", { name: "Google Gemini" })).toHaveTextContent(
      "Caption access verified",
    );
  });

  it("opens a board row's Admins and Users on that store", async () => {
    mount();
    const row = await openRow("Lakeside Kia");
    const detail = document.getElementById(
      within(row)
        .getByRole("button", { name: /Lakeside Kia/ })
        .getAttribute("aria-controls") as string,
    ) as HTMLElement;
    const users = within(detail).getByRole("button", { name: "Users" });
    users.focus();
    fireEvent.click(users);
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The clicked button is now in a hidden panel; focus follows to the tab.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Users" })).toHaveFocus(),
    );
    expect(screen.getByLabelText("Store", { selector: "select" })).toHaveValue(
      "dealer-2",
    );
    await waitFor(() =>
      expect(mocks.listPeoplePage).toHaveBeenCalledWith(
        expect.objectContaining({ role: "salesperson", dealerId: "dealer-2" }),
      ),
    );
    // Under the h1, the people tabs' headings run h2 then h3.
    expect(
      screen.getByRole("heading", { level: 2, name: "Salespeople at Lakeside Kia" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Add a salesperson to Lakeside Kia",
      }),
    ).toBeVisible();
  });

  it("creates a store in the New dealership dialog", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add dealer" }));
    const dialog = screen.getByRole("dialog", { name: "New dealership" });
    expect(
      within(dialog).getByText(
        "Access codes are assigned under Admins and Users, not on the store record.",
      ),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText("Dealer name *"), {
      target: { value: "Hillcrest Ford" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create dealer" }));
    await waitFor(() => expect(mocks.addDealerWithFile).toHaveBeenCalledTimes(1));
    const formData = mocks.addDealerWithFile.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe("Hillcrest Ford");
    expect(formData.get("hours")).toEqual(expect.any(String));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New dealership" })).toBeNull(),
    );
  });

  it("edits a store's name in the Edit dialog opened from its row", async () => {
    mount();
    const row = await openRow("Lakeside Kia");
    const detail = document.getElementById(
      within(row)
        .getByRole("button", { name: /Lakeside Kia/ })
        .getAttribute("aria-controls") as string,
    ) as HTMLElement;
    fireEvent.click(within(detail).getByRole("button", { name: "Edit name and logo" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Lakeside Kia" });
    const name = within(dialog).getByLabelText("Dealer name *");
    expect(name).toHaveValue("Lakeside Kia");
    fireEvent.change(name, { target: { value: "Lakeside Kia of Howell" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update dealer" }));
    await waitFor(() => expect(mocks.updateDealerWithFile).toHaveBeenCalledTimes(1));
    const [dealerId, formData] = mocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe("dealer-2");
    expect(formData.get("name")).toBe("Lakeside Kia of Howell");
  });

  it("deletes a store from its row only after the confirmation", async () => {
    mount();
    const row = await openRow("Lakeside Kia");
    const detail = document.getElementById(
      within(row)
        .getByRole("button", { name: /Lakeside Kia/ })
        .getAttribute("aria-controls") as string,
    ) as HTMLElement;
    fireEvent.click(within(detail).getByRole("button", { name: "Delete dealership" }));
    expect(mocks.deleteDealer).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: 'Delete "Lakeside Kia"?' });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteDealer).toHaveBeenCalledTimes(1));
    expect(mocks.deleteDealer.mock.calls[0][0]).toBe("dealer-2");
  });

  it("keeps Delete dealer inside the edit dialog, behind the same confirmation", async () => {
    mount();
    const row = await openRow("Lakeside Kia");
    const detail = document.getElementById(
      within(row)
        .getByRole("button", { name: /Lakeside Kia/ })
        .getAttribute("aria-controls") as string,
    ) as HTMLElement;
    fireEvent.click(within(detail).getByRole("button", { name: "Edit name and logo" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Lakeside Kia" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete dealer" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit Lakeside Kia" })).toBeNull(),
    );
    const confirm = screen.getByRole("dialog", { name: 'Delete "Lakeside Kia"?' });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteDealer).toHaveBeenCalledTimes(1));
    expect(mocks.deleteDealer.mock.calls[0][0]).toBe("dealer-2");
  });
});
