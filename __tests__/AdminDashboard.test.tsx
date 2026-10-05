import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../types";

const mocks = vi.hoisted(() => ({
  getDealers: vi.fn(),
  updateDealerWithFile: vi.fn(),
  deleteDealer: vi.fn(),
  listPeoplePage: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  getDealers: mocks.getDealers,
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
  scope: "configuration_only",
  providers: {
    gemini: { configured: true, enabled: true, verification: "not_tested" },
    anthropic: { configured: false, enabled: false, verification: "not_tested" },
    openai: { configured: false, enabled: false, verification: "not_tested" },
  },
  automation: {
    customer_hub: { configured: true, enabled: true, verification: "not_tested" },
    walkaround: { configured: true, enabled: true, verification: "not_tested" },
  },
  apiContractVersion: "2026-test",
  modelPolicyVersion: "5",
  capabilities: {},
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
  gbp_url: "https://g.page/northside",
  brand_voice: "Plain and friendly.",
  signature_look: "showroom",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  creative_system_v2: false,
};

const lakeside: Dealer = {
  id: "dealer-2",
  name: "Lakeside Kia",
  creative_system_v2: false,
  employee_disclosure_disabled: false,
};

const connectionCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/api/app/connections")).length;

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealers.mockResolvedValue([northside, lakeside]);
  mocks.updateDealerWithFile.mockResolvedValue({ id: "dealer-1" });
  mocks.deleteDealer.mockResolvedValue(undefined);
  mocks.listPeoplePage.mockResolvedValue({ items: [], total: 0 });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => connections }),
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
  it("keeps one quiet Refresh in the title row and text-only tabs", async () => {
    mount();
    const heading = screen.getByRole("heading", { name: "System admin" });
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(heading.closest("header")).toContainElement(refresh);
    for (const name of ["Dealers", "Admins", "Users", "Connections"]) {
      const tab = screen.getByRole("tab", { name });
      expect(tab.querySelector("svg")).toBeNull();
    }
    expect(screen.getByRole("tab", { name: "Dealers" })).toHaveClass(
      "border-brand-fill",
    );
    expect(await screen.findByRole("button", { name: "Add dealer" })).toBeVisible();
    expect(screen.getByLabelText("Store", { selector: "select" })).toBeVisible();
    expect(screen.getByText("Store", { selector: "label" })).not.toHaveClass(
      "uppercase",
    );
  });

  it("refetches the connection status when Refresh is pressed on the Connections tab", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    expect(
      await screen.findByText(
        "3 of 3 required services configured and enabled. 0 of 2 optional fallbacks on.",
      ),
    ).toBeVisible();
    expect(connectionCalls()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(connectionCalls()).toBe(2));
  });

  it("shows each store's setup at a glance and the full list behind Setup", async () => {
    mount();
    const northsideCard = (
      await screen.findByRole("heading", { name: /Northside Motors/ })
    ).closest("li") as HTMLElement;
    expect(within(northsideCard).getByText("7 of 7 set up")).toBeVisible();
    const lakesideCard = screen
      .getByRole("heading", { name: /Lakeside Kia/ })
      .closest("li") as HTMLElement;
    expect(within(lakesideCard).getByText("0 of 7 set up")).toBeVisible();
    expect(
      within(lakesideCard).getByText(
        "Missing: Store profile, Brand, Facebook, Instagram, Google Business Profile, Brand voice and Signature look",
      ),
    ).toBeVisible();

    fireEvent.click(
      within(northsideCard).getByRole("button", { name: "Setup for Northside Motors" }),
    );
    expect(
      within(northsideCard).getByRole("switch", {
        name: "Streamlined creative system",
      }),
    ).toHaveAttribute("aria-checked", "false");
    expect(within(northsideCard).getByText("No approval required")).toBeVisible();
  });

  it("saves the creative-system switch for that store and refreshes the list", async () => {
    mount();
    const card = (
      await screen.findByRole("heading", { name: /Northside Motors/ })
    ).closest("li") as HTMLElement;
    fireEvent.click(
      within(card).getByRole("button", { name: "Setup for Northside Motors" }),
    );
    mocks.getDealers.mockResolvedValue([
      { ...northside, creative_system_v2: true },
      lakeside,
    ]);
    fireEvent.click(
      within(card).getByRole("switch", { name: "Streamlined creative system" }),
    );

    await waitFor(() => expect(mocks.getDealers).toHaveBeenCalledTimes(2));
    const [dealerId, formData] = mocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe("dealer-1");
    expect(formData.get("creative_system_v2")).toBe("true");
    expect(formData.get("name")).toBe("Northside Motors");
    await waitFor(() =>
      expect(
        within(card).getByRole("switch", { name: "Streamlined creative system" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("edits a store in place and keeps delete behind the edit form", async () => {
    mount();
    const card = (await screen.findByRole("heading", { name: /Lakeside Kia/ })).closest(
      "li",
    ) as HTMLElement;
    expect(
      within(card).queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Edit Lakeside Kia" }));

    const form = screen
      .getByRole("heading", { name: "Edit Lakeside Kia" })
      .closest("li");
    expect(form).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add dealer" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(form as HTMLElement).getByRole("button", { name: "Delete dealer" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteDealer).toHaveBeenCalled());
    expect(mocks.deleteDealer.mock.calls[0][0]).toBe("dealer-2");
    expect(screen.queryByRole("heading", { name: "Edit Lakeside Kia" })).toBeNull();
  });
});
