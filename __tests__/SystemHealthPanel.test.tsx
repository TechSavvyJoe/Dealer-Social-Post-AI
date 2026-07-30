import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemHealthPanel } from "../components/SystemHealthPanel";

const healthyPayload = {
  ok: true,
  ts: "2026-07-17T22:00:00.000Z",
  version: "2.0",
  releaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  apiContractVersion: "2026-07-29.v3",
  modelPolicyVersion: "1",
  checks: {
    pocketbase: true,
    gemini_key_set: true,
    proxy_token_set: false,
    anthropic_key_set: false,
    openai_key_set: false,
    claude_fallback_enabled: false,
    openai_fallback_enabled: false,
    admin_dealer_code_set: true,
    turnstile_enforcement_enabled: true,
    turnstile_secret_set: true,
    turnstile_site_key_set: true,
    trusted_proxy_configured: true,
    legacy_client_compatibility_enabled: false,
    off_box_backup_configured: true,
    off_box_restore_ready: true,
  },
  counts: { dealers: 4, posts_24h: 12, photo_releases_24h: 3 },
  backup: {
    configured: true,
    lastVerifiedAt: "2026-07-17T21:00:00.000Z",
    verifiedReleaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    maxAgeHours: 168,
    status: "verified",
  },
  generation: {
    aiSuccesses24h: 10,
    basicFallbacks24h: 2,
    fallbackAttempts24h: 3,
    standardTier24h: 8,
    studioTier24h: 2,
    lastSuccessfulAt: "2026-07-17T21:30:00.000Z",
    providerAttempts24h: 13,
    providerFailures24h: 3,
    lastProviderAttemptAt: "2026-07-17T21:40:00.000Z",
  },
  recentErrors: { total24h: 1, topActions: [{ name: "generation.failed", count: 1 }] },
} as const;

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemHealthPanel readiness diagnostics", () => {
  it("renders a rich degraded payload returned with HTTP 503", async () => {
    const degraded = {
      ...healthyPayload,
      ok: false,
      checks: { ...healthyPayload.checks, off_box_restore_ready: false },
      backup: {
        ...healthyPayload.backup,
        verifiedReleaseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "release_mismatch",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(degraded, 503)));

    render(<SystemHealthPanel />);

    expect(await screen.findByText("degraded")).toBeInTheDocument();
    expect(
      screen.getByText("Restore evidence is for another release"),
    ).toBeInTheDocument();
    expect(screen.getByText("Critical:").parentElement).toHaveTextContent(
      "Release restore evidence",
    );
    expect(screen.queryByText(/\/api\/app\/health 503/)).toBeNull();
  });

  it("keeps the last rich snapshot for a JSON error envelope but clears it on transport failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthyPayload))
      .mockResolvedValueOnce(jsonResponse({ error: "Gateway busy" }, 503))
      .mockRejectedValueOnce(new Error("Network disconnected"));
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemHealthPanel />);
    expect(await screen.findByText("all green")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Gateway busy (503)")).toBeInTheDocument();
    expect(screen.getByText("all green")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Network disconnected")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("all green")).toBeNull());
  });

  it("clears stale diagnostics when the endpoint returns non-JSON", async () => {
    const invalidResponse = {
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(healthyPayload))
        .mockResolvedValueOnce(invalidResponse),
    );

    render(<SystemHealthPanel />);
    expect(await screen.findByText("all green")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      await screen.findByText("Health response was not valid JSON (502)."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("all green")).toBeNull());
  });
});
