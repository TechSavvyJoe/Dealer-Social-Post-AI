import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemHealthPanel } from "../components/SystemHealthPanel";

const healthyPayload = {
  ok: true,
  ts: "2026-07-17T22:00:00.000Z",
  version: "2.0",
  releaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  apiContractVersion: "2026-07-31.v4",
  modelPolicyVersion: "1",
  checks: {
    pocketbase: true,
    gemini_key_set: true,
    proxy_token_set: false,
    anthropic_key_set: false,
    openai_key_set: false,
    claude_fallback_enabled: false,
    openai_fallback_enabled: false,
    admin_login_configured: true,
    pin_pepper_configured: true,
    turnstile_enforcement_enabled: true,
    turnstile_secret_set: true,
    turnstile_site_key_set: true,
    turnstile_hostnames_configured: true,
    trusted_proxy_configured: true,
    legacy_client_compatibility_enabled: false,
    off_box_backup_configured: true,
    off_box_restore_ready: true,
    website_integration_configured: true,
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
  usage: {
    windowDays: 7,
    since: "2026-07-10T22:00:00.000Z",
    truncated: false,
    dealers: [
      {
        dealer: "dlr_alpha",
        name: "Alpha Motors",
        events: 1240,
        succeeded: 1200,
        tokens: {
          prompt: 900000,
          candidate: 240000,
          thoughts: 60000,
          cached: 4000,
          total: 1204000,
        },
        images: { "1K": 40, "2K": 12 },
        videoSeconds: 96,
        latencyMs: { p50: 820, p95: 4300, samples: 1180 },
      },
    ],
  },
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

    // The strip headline is truthful: criticals win.
    expect(
      await screen.findByText("1 critical issue needs attention"),
    ).toBeInTheDocument();
    // Critical failures surface themselves without opening Details.
    expect(screen.getByText("Release restore evidence")).toBeInTheDocument();
    // Full diagnostics (backup verdict) live behind the Details disclosure.
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(
      screen.getByText("Restore evidence is for another release"),
    ).toBeInTheDocument();
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
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh system health" }));
    expect(await screen.findByText("Gateway busy (503)")).toBeInTheDocument();
    expect(screen.getByText("All systems operational")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh system health" }));
    expect(await screen.findByText("Network disconnected")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("All systems operational")).toBeNull(),
    );
  });

  it("renders the seven-day usage ledger behind Details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(healthyPayload)));

    render(<SystemHealthPanel />);
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));

    expect(screen.getByText("Generation usage · last 7 days")).toBeInTheDocument();
    // Totals: events, tokens, image renders, video seconds. Six-figure token
    // counts are grouped — an ungrouped 1204000 is unreadable in a tile.
    // Each figure appears twice: once in the totals tile, once in the single
    // dealership's row.
    expect(screen.getAllByText("1,240")).toHaveLength(2);
    expect(screen.getAllByText("1,204,000")).toHaveLength(2);
    expect(screen.getByText("52")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    // Image counts stay broken out by billable size.
    expect(screen.getByText("1K")).toBeInTheDocument();
    expect(screen.getByText("2K")).toBeInTheDocument();
    // Latency percentiles are per dealership and read as durations.
    expect(screen.getByText("Alpha Motors")).toBeInTheDocument();
    expect(screen.getByText("p50 820ms")).toBeInTheDocument();
    expect(screen.getByText("p95 4.3s")).toBeInTheDocument();
  });

  it("keeps the rest of the panel working when an older server omits usage", async () => {
    const { usage: _usage, ...withoutUsage } = healthyPayload;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(withoutUsage)));

    render(<SystemHealthPanel />);
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));

    expect(
      screen.getByText(
        "Generation usage accounting is unavailable from this health endpoint.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Generation usage · last/)).toBeNull();
    // The neighbouring sections still render.
    expect(screen.getByText("Generation · last 24 hours")).toBeInTheDocument();
  });

  it("survives a partially populated usage payload from a mid-upgrade server", async () => {
    const partial = {
      ...healthyPayload,
      usage: {
        dealers: [
          { dealer: "dlr_beta", events: 3 },
          { name: "no id — dropped", events: 99 },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(partial)));

    render(<SystemHealthPanel />);
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));

    // Missing windowDays falls back to the server's own 7-day window, missing
    // token/latency objects read as zero, and a row with no dealer id is
    // dropped rather than counted under an empty key.
    expect(screen.getByText("Generation usage · last 7 days")).toBeInTheDocument();
    expect(screen.getByText("dlr_beta")).toBeInTheDocument();
    expect(screen.queryByText("no id — dropped")).toBeNull();
    expect(screen.getAllByText("p50 —").length).toBe(1);
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
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh system health" }));

    expect(
      await screen.findByText("Health response was not valid JSON (502)."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("All systems operational")).toBeNull(),
    );
  });
});
