import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPanel } from "../components/admin/ConnectionsPanel";
import { useAppStore } from "../stores/appStore";
import type { Dealer } from "../types";
vi.mock("../components/SystemHealthPanel", () => ({
  SystemHealthPanel: () => <div>Runtime health</div>,
}));
vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
const status = { configured: true, enabled: true, verification: "not_tested" };
const fixture = {
  scope: "configuration_only",
  providers: {
    gemini: status,
    anthropic: { ...status, configured: false, enabled: false },
    openai: { ...status, enabled: false },
  },
  automation: {
    customer_hub: status,
    walkaround: { ...status, configured: false, enabled: false },
  },
  apiContractVersion: "2026-test",
  modelPolicyVersion: "5",
  capabilities: { veoNegativePrompt: true },
};
const mount = (dealers?: Dealer[]) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConnectionsPanel dealers={dealers} />
    </QueryClientProvider>,
  );
const card = (title: string) =>
  screen.getByRole("region", { name: title }) as HTMLElement;
const respondWith = (body: unknown) =>
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => body } as Response);

describe("system-only connection diagnostics", () => {
  beforeEach(() => {
    useAppStore.setState({ role: "super_admin", authEpoch: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }),
    );
  });
  it("does not request or render provider configuration for dealership managers", async () => {
    useAppStore.setState({ role: "dealer_admin" });
    mount();
    expect(screen.queryByText("Google Gemini")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports configuration without claiming live verification", async () => {
    mount();
    expect(
      await screen.findByText(
        "2 of 3 required services configured and enabled. 0 of 2 optional fallbacks on.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Configuration checks do not verify/)).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "AI providers & automation" }),
    ).toBeVisible();
    expect(within(card("Google Gemini")).getByText("Configured")).toBeVisible();
    expect(
      within(card("Walkaround video pipeline")).getByText("Needs setup"),
    ).toBeVisible();
    // No eyebrows: the provider name is the card title.
    expect(screen.queryByText(/^AI provider$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Dealer service$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Platform control$/i)).not.toBeInTheDocument();
  });
  it("never reads an optional fallback that is off as a problem", async () => {
    mount();
    expect(
      await within(card("Anthropic fallback")).findByText("Optional, not set up"),
    ).toBeVisible();
    expect(
      within(card("OpenAI fallback")).getByText("Optional, turned off"),
    ).toBeVisible();
    expect(within(card("Anthropic fallback")).queryByText("Needs setup")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Needs setup" }));
    expect(screen.getByRole("button", { name: "Needs setup" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Walkaround video pipeline")).toBeVisible();
    expect(screen.queryByText("Google Gemini")).not.toBeInTheDocument();
    expect(screen.queryByText("Anthropic fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI fallback")).not.toBeInTheDocument();
  });
  it("reports a healthy platform as done even with both fallbacks off", async () => {
    respondWith({
      ...fixture,
      automation: { customer_hub: status, walkaround: status },
    });
    mount();
    expect(
      await screen.findByText(
        "3 of 3 required services configured and enabled. 0 of 2 optional fallbacks on.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Needs setup" }));
    expect(
      screen.getByText("Every required service has its configuration in place."),
    ).toBeVisible();
  });
  it("shows setup steps as a plain ordered list under a Setup title", async () => {
    mount();
    await screen.findByText("Google Gemini");
    fireEvent.click(screen.getAllByRole("button", { name: "Setup instructions" })[0]);
    const setup = document.getElementById("connection-setup-gemini") as HTMLElement;
    expect(within(setup).getByRole("heading", { name: "Setup" })).toBeVisible();
    const steps = setup.querySelector("ol") as HTMLElement;
    expect(steps).not.toBeNull();
    // A plain list on the card, not a second card nested inside it.
    expect(steps.parentElement).toBe(setup);
    expect(
      within(steps).getByText("Set the Gemini key on the backend host."),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Setup instructions" })[0],
    ).toHaveAttribute("aria-expanded", "true");
  });
  it("names the dealership the customer website is mapped to when the backend reports it", async () => {
    respondWith({
      ...fixture,
      automation: {
        ...fixture.automation,
        customer_hub: { ...status, dealerId: "dealer-1" },
      },
    });
    mount([{ id: "dealer-1", name: "Northside Motors" }]);
    expect(
      await within(card("Customer website")).findByText(
        "Sends drafts for Northside Motors.",
      ),
    ).toBeVisible();
  });
  it("says mapped, not sends, while the customer website is not set up", async () => {
    respondWith({
      ...fixture,
      automation: {
        ...fixture.automation,
        customer_hub: {
          configured: false,
          enabled: false,
          verification: "not_tested",
          dealerId: "dealer-1",
        },
      },
    });
    mount([{ id: "dealer-1", name: "Northside Motors" }]);
    const website = card("Customer website");
    expect(
      await within(website).findByText("Mapped to Northside Motors."),
    ).toBeVisible();
    expect(within(website).getByText("Needs setup")).toBeVisible();
    expect(within(website).queryByText(/Sends drafts/)).toBeNull();
  });
  it("calls a mapped store missing only once the dealer list has loaded", async () => {
    respondWith({
      ...fixture,
      automation: {
        ...fixture.automation,
        customer_hub: { ...status, dealerId: "dealer-9" },
      },
    });
    const missing = "Mapped to dealership dealer-9, which is not in the dealer list.";
    const view = mount();
    await screen.findByText(/required services configured/);
    expect(screen.queryByText(missing)).toBeNull();
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ConnectionsPanel dealers={[{ id: "dealer-1", name: "Northside Motors" }]} />
      </QueryClientProvider>,
    );
    expect(await within(card("Customer website")).findByText(missing)).toBeVisible();
  });
  it("shows a recoverable error and allows a fresh status request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Deploy the backend first",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(
      screen.getByText(
        "2 of 3 required services configured and enabled. 0 of 2 optional fallbacks on.",
      ),
    ).toBeVisible();
  });
});
