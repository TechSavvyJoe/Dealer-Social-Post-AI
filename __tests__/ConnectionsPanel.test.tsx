import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPanel } from "../components/admin/ConnectionsPanel";
import { useAppStore } from "../stores/appStore";
import type { ConnectionsResponse, ManagedConnection } from "../services/connections";

vi.mock("../components/SystemHealthPanel", () => ({
  SystemHealthPanel: () => <div>Runtime health</div>,
}));

const connection = (
  service: ManagedConnection["service"],
  state: ManagedConnection["state"],
  overrides: Partial<ManagedConnection> = {},
): ManagedConnection => ({
  service,
  scope: service === "website" ? "dealer" : "global",
  ...(service === "website" ? { dealerId: "dealer-1" } : {}),
  configured: state !== "needs_setup",
  enabled: state !== "off",
  revision: 2,
  state,
  capabilities: [],
  nextAction:
    state === "ready" ? "No action needed." : "Save settings, then run a test.",
  settings: {},
  credentialConfigured: {},
  ...overrides,
});

const makeFixture = (): ConnectionsResponse => ({
  scope: "guided_setup",
  secureStorageAvailable: true,
  dealers: [
    { id: "dealer-1", name: "Northside Motors" },
    { id: "dealer-2", name: "Southside Motors" },
  ],
  services: [
    connection("gemini", "needs_test", {
      credentialConfigured: { apiKey: true },
      capabilities: [
        { id: "text", label: "Caption access", state: "not_tested" },
        { id: "images", label: "Image generation", state: "not_tested" },
        { id: "video", label: "AI video generation", state: "not_tested" },
      ],
    }),
    connection("anthropic", "off", { configured: false, enabled: false }),
    connection("openai", "needs_test"),
    connection("website", "needs_setup", { configured: false, enabled: false }),
    connection("website", "needs_test", {
      dealerId: "dealer-2",
      settings: { origin: "https://south.example", destinationId: "south" },
      capabilities: [
        { id: "website", label: "Private website draft", state: "not_tested" },
      ],
    }),
    connection("walkaround", "needs_test"),
  ],
  apiContractVersion: "guided-setup-v1",
  modelPolicyVersion: "5",
  capabilities: { veo: true },
});

const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConnectionsPanel />
    </QueryClientProvider>,
  );

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const getCall = () =>
  vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/app/connections" && (!init || init.method === "GET"),
    );

describe("guided system connections", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    useAppStore.setState({ role: "super_admin", authEpoch: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(makeFixture())));
  });

  it("renders only for system admins and uses the guided setup endpoint", async () => {
    const fixture = makeFixture();
    fixture.services[0] = connection("gemini", "ready", {
      credentialConfigured: { apiKey: true },
    });
    vi.mocked(fetch).mockResolvedValue(jsonResponse(fixture));
    useAppStore.setState({ role: "dealer_admin" });
    mount();
    expect(
      screen.queryByRole("heading", { name: "Connections" }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    act(() => useAppStore.setState({ role: "super_admin" }));
    expect(await screen.findByRole("heading", { name: "Connections" })).toBeVisible();
    expect(getCall()).toBeTruthy();
    expect(await screen.findByText("1 / 3 checks verified")).toBeVisible();
  });

  it("keeps optional-off neutral and selects the matching dealership website config", async () => {
    mount();
    await screen.findByRole("heading", { name: "Connections" });
    fireEvent.click(await screen.findByText("Optional AI backups"));
    const fallback = await screen.findByRole("article", { name: /Anthropic fallback/ });
    expect(within(fallback).getByText("Off")).toBeVisible();
    expect(within(fallback).getByText("Optional")).toBeVisible();

    const website = screen.getByRole("article", { name: /Customer website drafts/ });
    fireEvent.click(within(website).getByRole("button", { name: "Set up" }));
    expect(within(website).getByLabelText("Dealership")).toHaveValue("dealer-1");
    await userEvent
      .setup()
      .selectOptions(within(website).getByLabelText("Dealership"), "dealer-2");
    await waitFor(() =>
      expect(within(website).getByLabelText("Approved website address")).toHaveValue(
        "https://south.example",
      ),
    );
  });

  it("saves credentials through PATCH but remains test-required until the server verifies it", async () => {
    const user = userEvent.setup();
    const initial = makeFixture();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/app/connections" && init?.method === "PATCH") {
        return jsonResponse(connection("gemini", "needs_test", { revision: 3 }));
      }
      return jsonResponse(initial);
    });
    mount();
    const gemini = await screen.findByRole("article", { name: /Google Gemini/ });
    await user.click(within(gemini).getByRole("button", { name: "Set up" }));
    const key = within(gemini).getByLabelText("Gemini API key");
    await user.type(key, "transient-api-key");
    await user.click(within(gemini).getByRole("button", { name: "Save connection" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/connections/gemini",
        expect.objectContaining({ method: "PATCH", credentials: "include" }),
      ),
    );
    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "PATCH");
    const body = JSON.parse(String(patchCall?.[1]?.body));
    expect(body).toMatchObject({
      confirmApply: true,
      expectedRevision: 2,
      enabled: true,
      credentials: { apiKey: "transient-api-key" },
    });
    expect(await within(gemini).findByText("Test required")).toBeVisible();
    expect(within(gemini).getByLabelText("Gemini API key")).toHaveValue("");
    expect(within(gemini).queryByText("Ready")).toBeNull();
  });

  it("shows Ready only after a successful test is reflected by a fresh server read", async () => {
    const fixture = makeFixture();
    let getCount = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/app/connections" && init?.method === "POST")
        return jsonResponse({});
      if (String(input) === "/api/app/connections/gemini/test")
        return jsonResponse(connection("gemini", "testing"));
      if (String(input).startsWith("/api/app/connections/proofs?"))
        return jsonResponse({
          items: [
            { id: "proof-1", label: "Released caption proof", state: "verified" },
          ],
        });
      if (String(input) === "/api/app/connections") {
        getCount += 1;
        const current = structuredClone(fixture);
        if (getCount > 1)
          current.services[0] = connection("gemini", "ready", {
            capabilities: [
              { id: "text", label: "Caption access", state: "verified" },
              { id: "images", label: "Image generation", state: "not_tested" },
              { id: "video", label: "AI video generation", state: "not_tested" },
            ],
            lastVerifiedAt: "2026-10-09T12:00:00Z",
          });
        return jsonResponse(current);
      }
      return jsonResponse({});
    });
    mount();
    const gemini = await screen.findByRole("article", { name: /Google Gemini/ });
    fireEvent.click(within(gemini).getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/connections/gemini/test",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await within(gemini).findByText("Caption access verified")).toBeVisible();
    expect(within(gemini).getByText("Caption access: Verified")).toBeVisible();
  });

  it("loads named website proofs and only enables tests after a proof is selected", async () => {
    const user = userEvent.setup();
    const fixture = makeFixture();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/app/connections/proofs?"))
        return jsonResponse({
          items: [
            {
              id: "release-1",
              label: "Approved release from today",
              state: "verified",
            },
          ],
        });
      if (String(input) === "/api/app/connections") return jsonResponse(fixture);
      return jsonResponse(connection("website", "testing"));
    });
    mount();
    const website = await screen.findByRole("article", {
      name: /Customer website drafts/,
    });
    await user.click(within(website).getByRole("button", { name: "Set up" }));
    expect(
      await within(website).findByRole("option", {
        name: "Approved release from today",
      }),
    ).toBeVisible();
    await user.selectOptions(
      within(website).getByLabelText("Released post ID for private test"),
      "release-1",
    );
    await user.click(within(website).getByRole("button", { name: "Test connection" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/connections/website/test",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const testCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url) === "/api/app/connections/website/test");
    expect(JSON.parse(String(testCall?.[1]?.body))).toMatchObject({
      dealerId: "dealer-1",
      proofId: "release-1",
    });
  });

  it("explains the encrypted-vault prerequisite and disables credential saving", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ...makeFixture(), secureStorageAvailable: false }),
    );
    mount();
    const gemini = await screen.findByRole("article", { name: /Google Gemini/ });
    fireEvent.click(within(gemini).getByRole("button", { name: "Set up" }));
    expect(within(gemini).getByRole("alert")).toHaveTextContent(
      "encrypted connection vault",
    );
    expect(within(gemini).getByLabelText("Gemini API key")).toBeDisabled();
    expect(
      within(gemini).getByRole("button", { name: "Save connection" }),
    ).toBeDisabled();
  });

  it("saves canonical website origin fields and clears secrets when switching dealerships", async () => {
    const user = userEvent.setup();
    const requestBodies: Record<string, unknown>[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (
        String(input) === "/api/app/connections/website" &&
        init?.method === "PATCH"
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requestBodies.push(body);
        if ("siteUrl" in (body.settings as Record<string, unknown>))
          return jsonResponse({ error: "Unsupported setting" }, 400);
        return jsonResponse(
          connection("website", "needs_test", {
            dealerId: "dealer-2",
            revision: 3,
            settings: body.settings as ManagedConnection["settings"],
            credentialConfigured: { sharedSecret: false },
          }),
        );
      }
      return jsonResponse(makeFixture());
    });
    mount();
    const website = await screen.findByRole("article", {
      name: /Customer website drafts/,
    });
    await user.click(within(website).getByRole("button", { name: "Set up" }));
    await user.type(
      within(website).getByLabelText("Website connection key"),
      "north-secret",
    );
    await user.selectOptions(within(website).getByLabelText("Dealership"), "dealer-2");
    expect(within(website).getByLabelText("Website connection key")).toHaveValue("");
    await user.clear(within(website).getByLabelText("Approved website address"));
    await user.type(
      within(website).getByLabelText("Approved website address"),
      "https://new-south.example",
    );
    await user.click(within(website).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0]).toMatchObject({
      dealerId: "dealer-2",
      settings: { origin: "https://new-south.example", destinationId: "south" },
      credentials: {},
    });
    expect(requestBodies[0]).not.toHaveProperty("settings.siteUrl");
  });

  it("preserves an enabled optional provider and omits blank credentials on save", async () => {
    const user = userEvent.setup();
    const fixture = makeFixture();
    fixture.services.find((item) => item.service === "openai")!.credentialConfigured = {
      apiKey: true,
    };
    let savedBody: Record<string, unknown> | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/app/connections/openai" && init?.method === "PATCH") {
        savedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(connection("openai", "needs_test"));
      }
      return jsonResponse(fixture);
    });
    mount();
    await screen.findByRole("heading", { name: "Connections" });
    fireEvent.click(await screen.findByText("Optional AI backups"));
    const openai = await screen.findByRole("article", { name: /OpenAI fallback/ });
    await user.click(within(openai).getByRole("button", { name: "Set up" }));
    await user.click(within(openai).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(savedBody).toBeDefined());
    expect(savedBody).toMatchObject({ enabled: true, credentials: {} });
  });

  it("clears a typed secret when setup is closed", async () => {
    const user = userEvent.setup();
    mount();
    const gemini = await screen.findByRole("article", { name: /Google Gemini/ });
    await user.click(within(gemini).getByRole("button", { name: "Set up" }));
    await user.type(within(gemini).getByLabelText("Gemini API key"), "do-not-retain");
    await user.click(within(gemini).getByRole("button", { name: "Close" }));
    await user.click(within(gemini).getByRole("button", { name: "Set up" }));
    expect(within(gemini).getByLabelText("Gemini API key")).toHaveValue("");
  });

  it("provides a recoverable initial load error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(makeFixture()));
    mount();
    expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Connections" })).toBeVisible();
  });
});
