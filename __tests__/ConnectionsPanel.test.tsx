import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPanel } from "../components/admin/ConnectionsPanel";
import { useAppStore } from "../stores/appStore";
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
const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConnectionsPanel />
    </QueryClientProvider>,
  );
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
  it("reports configuration without claiming live verification and filters setup work", async () => {
    mount();
    expect(
      await screen.findByText("2 of 5 services configured and enabled"),
    ).toBeVisible();
    expect(screen.getByText(/Configuration checks do not verify/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Needs setup" }));
    expect(screen.queryByText("Google Gemini")).not.toBeInTheDocument();
    expect(screen.getByText("OpenAI fallback")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Setup instructions" })[0]);
    expect(
      screen.getByText("Set the Anthropic key on the backend host."),
    ).toBeVisible();
  });
  it("shows a recoverable error and allows a fresh status request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Deploy the backend first",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("2 of 5 services configured and enabled")).toBeVisible();
  });
});
