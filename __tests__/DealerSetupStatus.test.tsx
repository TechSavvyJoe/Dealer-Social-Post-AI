import React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../types";

const mocks = vi.hoisted(() => ({
  getDealers: vi.fn(),
  updateDealerWithFile: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  getDealers: mocks.getDealers,
  updateDealerWithFile: mocks.updateDealerWithFile,
}));

import { DealerSetupStatus } from "../components/admin/DealerSetupStatus";
import { ToastProvider } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";

const dealer: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  logo: "/api/files/dealers/dealer-1/logo.png",
  brand_color: "#1d4ed8",
  website: "https://northsidemotors.com",
  phone: "(517) 555-0100",
  address: "12 Main St, Howell, MI",
  facebook_url: "https://facebook.com/northside",
  facebook_page_tag: "northside",
  instagram_handle: "",
  gbp_url: "https://g.page/northside",
  brand_voice: "Plain and friendly.",
  signature_look: "",
  requires_approval: true,
  approval_policy: { mode: "first_n", firstN: 3 },
  employee_disclosure_disabled: false,
  creative_system_v2: false,
};

/** Renders the section the way the Dealers tab does: from the cached list. */
const Harness: React.FC = () => {
  const { data } = useQuery({ queryKey: ["dealers"], queryFn: mocks.getDealers });
  const current = data?.[0];
  return current ? <DealerSetupStatus dealer={current} /> : null;
};

const mount = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
};

const openSetup = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: "Setup for Northside Motors" }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealers.mockResolvedValue([dealer]);
  mocks.updateDealerWithFile.mockResolvedValue({ id: dealer.id });
  useAppStore.setState({ role: "super_admin" });
});

afterEach(() => {
  useAppStore.setState({ role: "salesperson" });
});

describe("per-store setup status", () => {
  it("shows the count and what is missing before anything is expanded", async () => {
    mount();
    expect(await screen.findByText("5 of 7 set up")).toBeVisible();
    expect(screen.getByText("Missing: Instagram and Signature look")).toBeVisible();
    const toggle = screen.getByRole("button", { name: "Setup for Northside Motors" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("lists every area with its saved value and where to fix a missing one", async () => {
    mount();
    await openSetup();
    const list = document.getElementById("dealer-setup-dealer-1") as HTMLElement;
    expect(within(list).getByText("northsidemotors.com")).toBeVisible();
    expect(within(list).getByText("Tags @northside")).toBeVisible();
    expect(
      within(list).getByText("Until each person has 3 approved posts"),
    ).toBeVisible();
    expect(within(list).getByText("Standard wording")).toBeVisible();
    expect(
      within(list).getByText(
        "Add the Instagram handle: open as the manager, then Settings > Channels.",
      ),
    ).toBeVisible();
    expect(
      within(list).getByText(
        "Choose a signature look: open as the manager, then Settings > Creative.",
      ),
    ).toBeVisible();
    // TikTok, X and LinkedIn are listed as optional, never as missing.
    const tiktok = within(list).getByText("TikTok").closest("li") as HTMLElement;
    expect(within(tiktok).getByText("Optional")).toBeVisible();
  });

  it("turns the streamlined creative system on with the admin-only dealer PATCH", async () => {
    let resolveSave: (value: { id: string }) => void = () => {};
    mocks.updateDealerWithFile.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    mount();
    await openSetup();
    const toggle = screen.getByRole("switch", { name: "Streamlined creative system" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(
      "Uses the store's signature Look and playful style for every post instead of the classic style list.",
    );

    // The live region is mounted before the save, so the change is announced.
    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();
    fireEvent.click(toggle);
    await waitFor(() => expect(live).toHaveTextContent("Saving…"));
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(mocks.updateDealerWithFile).toHaveBeenCalledTimes(1);
    const [dealerId, formData] = mocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe("dealer-1");
    expect(formData.get("name")).toBe("Northside Motors");
    expect(formData.get("creative_system_v2")).toBe("true");
    expect([...formData.keys()].sort()).toEqual(["creative_system_v2", "name"]);

    // The refetch after the save never resolves here: the switch must hold
    // the saved value instead of flipping back to the stale list row.
    mocks.getDealers.mockReturnValue(new Promise(() => {}));
    resolveSave({ id: "dealer-1" });
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
    expect(
      screen.getByRole("switch", { name: "Streamlined creative system" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(mocks.getDealers).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(
        "Streamlined creative system turned on for Northside Motors.",
      ),
    ).toBeInTheDocument();
    // No Look yet: the admin is told what posts will use.
    expect(
      screen.getByText(
        "No signature look is chosen yet, so posts use Showroom until the manager picks one.",
      ),
    ).toBeVisible();
  });

  it("shows the error and keeps the saved value when the save fails", async () => {
    mocks.updateDealerWithFile.mockRejectedValue(
      new Error("Only the system administrator can change this."),
    );
    mount();
    await openSetup();
    fireEvent.click(
      screen.getByRole("switch", { name: "Streamlined creative system" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the system administrator can change this.",
    );
    expect(
      screen.getByRole("switch", { name: "Streamlined creative system" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(mocks.getDealers).toHaveBeenCalledTimes(1);
  });

  it("does not offer the switch when the server did not report the setting", async () => {
    const legacy: Dealer = { ...dealer };
    delete legacy.creative_system_v2;
    mocks.getDealers.mockResolvedValue([legacy]);
    mount();
    await openSetup();
    const toggle = screen.getByRole("switch", { name: "Streamlined creative system" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(toggle);
    expect(mocks.updateDealerWithFile).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "This server's dealer list doesn't report this setting yet, so it can't be changed here.",
      ),
    ).toBeVisible();
  });

  it("never renders the switch for any role but the system administrator", async () => {
    useAppStore.setState({ role: "dealer_admin" });
    mount();
    await openSetup();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
