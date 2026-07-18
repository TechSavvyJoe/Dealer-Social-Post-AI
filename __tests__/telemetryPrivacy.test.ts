import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTelemetrySnapshot,
  logError,
  logEvent,
  sanitizeTelemetryPayload,
} from "../utils/telemetry";

const STORAGE_KEY = "dealer-social-post-ai.telemetry";
const TEST_VIN = "1HGCM82633A004352";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

describe("telemetry privacy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("recursively redacts sensitive keys and VIN-like strings without mutating input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const payload = {
      vin: TEST_VIN,
      vinPresent: true,
      dealerCode: "654321",
      nested: {
        sessionToken: "session-secret",
        authorizationHeader: "Bearer raw-secret",
        message: `Decoded ${TEST_VIN} successfully`,
        fileName: `vehicle_${TEST_VIN}_uploaded.jpg`,
      },
      values: [TEST_VIN, { signaturePngDataUrl: "data:image/png;base64,raw" }],
      circular,
      [TEST_VIN]: "VIN used as a property name",
    };

    const sanitized = sanitizeTelemetryPayload(payload) as Record<string, any>;

    expect(sanitized.vin).toBe("[REDACTED]");
    expect(sanitized.vinPresent).toBe(true);
    expect(sanitized.dealerCode).toBe("[REDACTED]");
    expect(sanitized.nested.sessionToken).toBe("[REDACTED]");
    expect(sanitized.nested.authorizationHeader).toBe("[REDACTED]");
    expect(sanitized.nested.message).toBe("Decoded [REDACTED_VIN] successfully");
    expect(sanitized.nested.fileName).toBe("vehicle_[REDACTED_VIN]_uploaded.jpg");
    expect(sanitized.values).toEqual([
      "[REDACTED_VIN]",
      { signaturePngDataUrl: "[REDACTED]" },
    ]);
    expect(sanitized.circular.self).toBe("[CIRCULAR]");
    expect(sanitized["[REDACTED_VIN]"]).toBe("VIN used as a property name");

    expect(payload.vin).toBe(TEST_VIN);
    expect(payload.nested.sessionToken).toBe("session-secret");
  });

  it("uses only sanitized data for storage, beacon delivery, and console output", () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logError(`vehicle.${TEST_VIN}.decoded`, {
      dealerCode: "654321",
      note: `Decoded ${TEST_VIN}`,
      vinPresent: true,
    });

    const stored = localStorage.getItem(STORAGE_KEY) || "";
    const beaconBody = String(sendBeacon.mock.calls[0]?.[1] || "");
    const consoleOutput = consoleSpy.mock.calls.flat().join(" ");

    for (const output of [stored, beaconBody, consoleOutput]) {
      expect(output).not.toContain(TEST_VIN);
      expect(output).not.toContain("654321");
      expect(output).toContain("[REDACTED_VIN]");
      expect(output).toContain("[REDACTED]");
    }
    expect(sendBeacon).toHaveBeenCalledWith("/api/telemetry", expect.any(String));
  });

  it("scrubs legacy buffered events when they are read", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "evt_legacy",
          level: "info",
          name: "legacy.event",
          payload: { vin: TEST_VIN, note: `VIN ${TEST_VIN}` },
          timestamp: Date.now() - 1_000,
        },
      ]),
    );

    const snapshot = getTelemetrySnapshot();
    const stored = localStorage.getItem(STORAGE_KEY) || "";

    expect(snapshot[0]?.payload).toEqual({
      vin: "[REDACTED]",
      note: "VIN [REDACTED_VIN]",
    });
    expect(stored).not.toContain(TEST_VIN);
    expect(stored).toContain("[REDACTED_VIN]");
  });

  it("keeps raw VINs out of call sites and persists only server-allowlisted diagnostics", () => {
    const vinScanner = readFileSync(
      resolve(process.cwd(), "components/VinScanner.tsx"),
      "utf8",
    );
    const photoRelease = readFileSync(
      resolve(process.cwd(), "components/PhotoReleaseModal.tsx"),
      "utf8",
    );
    const backend = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const helperSource = readFileSync(
      resolve(process.cwd(), "pb_hooks/helpers.js"),
      "utf8",
    );
    const helperModule = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", helperSource)(helperModule, helperModule.exports);
    const backendSanitizer = helperModule.exports as {
      buildSafeTelemetryEnvelope(value: Record<string, unknown>): {
        name: string;
        payload: string;
        releaseSha: string;
        apiContractVersion: string;
      };
    };
    const telemetryRoute = backend.slice(
      backend.indexOf('routerAdd("POST", "/api/telemetry"'),
      backend.indexOf("// Session Endpoints"),
    );
    const serverResult = JSON.stringify(
      backendSanitizer.buildSafeTelemetryEnvelope({
        name: `provider.${TEST_VIN}${TEST_VIN}.failure`,
        message: `Discard ${TEST_VIN}`,
        payload: {
          task: "caption",
          errorCode: `PROVIDER_${TEST_VIN}`,
          dealerCode: "provider-secret",
          token: "provider-token",
          nested: { apiKey: "provider-secret" },
        },
      }),
    );

    expect(vinScanner).toContain("vinPresent: true");
    expect(vinScanner).not.toContain("{ vin: cleaned }");
    expect(photoRelease).toContain("{ vinPresent: Boolean(vin) }");
    expect(photoRelease).not.toContain('logEvent("photo_release.captured", { vin })');
    expect(helperSource).toContain("function buildSafeTelemetryEnvelope");
    expect(telemetryRoute).toContain("Persist an allowlisted diagnostic envelope");
    expect(helperSource).toContain('"fallbackCount"');
    expect(telemetryRoute).toContain('record.set("payload", safeEnvelope.payload)');
    expect(telemetryRoute).not.toContain(
      "JSON.stringify(payloadObject).slice(0, 2000)",
    );
    expect(telemetryRoute).not.toContain('record.set("payload", rawSerialized)');
    expect(serverResult).not.toContain(TEST_VIN);
    expect(serverResult).not.toContain("provider-secret");
    expect(serverResult).toContain("[REDACTED_VIN]");
    expect(serverResult).toContain("[REDACTED_VIN][REDACTED_VIN]");
  });

  it("routes render crashes through the shared redacted error envelope", () => {
    const errorBoundary = readFileSync(
      resolve(process.cwd(), "components/ErrorBoundary.tsx"),
      "utf8",
    );

    expect(errorBoundary).toContain('import { logError } from "../utils/telemetry"');
    expect(errorBoundary).toContain('logError("app.render.crash"');
    expect(errorBoundary).toContain('kind: "render_error"');
    expect(errorBoundary).not.toContain('fetch("/api/telemetry"');
    const telemetryCall = errorBoundary.match(
      /logError\("app\.render\.crash",\s*\{[\s\S]*?\}\);/,
    )?.[0];
    expect(telemetryCall).toBeTruthy();
    expect(telemetryCall).not.toContain("error.stack");
    expect(telemetryCall).not.toContain("errorInfo.componentStack");
    expect(telemetryCall).not.toContain("window.location.href");
    expect(telemetryCall).not.toContain("navigator.userAgent");
  });

  it("installs private diagnostics storage, 14-day pruning, and health aggregates", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750600000_diagnostics_telemetry.js"),
      "utf8",
    );
    const backend = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");

    for (const field of [
      "caption_source",
      "generation_tier",
      "generation_model",
      "generation_fallback_count",
      "generation_last_success_at",
      "model_policy_version",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('name: "client_error_events"');
    expect(migration).toContain('name: "generation_events"');
    expect(migration).toContain("listRule: null");
    expect(backend).toContain('cronAdd("prune-client-error-events"');
    expect(backend).toContain(
      "DELETE FROM generation_events WHERE occurred_at < {:cutoff}",
    );
    expect(backend).toContain("14 * 24 * 60 * 60 * 1000");
    expect(backend).toContain("result.generation");
    expect(backend).toContain("result.recentErrors");
    expect(backend).toContain("off_box_backup_configured");
    expect(backend).toContain("off_box_restore_ready");
    expect(backend).toContain("POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA");
    expect(backend).toContain('backupStatus = "release_mismatch"');
    expect(backend).toContain('backupStatus = "stale"');
    expect(backend).toContain("backupVerificationMaxAgeHours = 7 * 24");
    expect(backend).toContain("!checks.off_box_restore_ready");
    expect(helpers).toContain("databaseTimestamp,");
    expect(backend).toContain("const since = helpers.databaseTimestamp(");
    expect(backend).toContain("const cutoff = helpers.databaseTimestamp(");
  });

  it("derives persisted AI provenance from private proxy events, not client fields", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750600000_diagnostics_telemetry.js"),
      "utf8",
    );
    const backend = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const postRoute = backend.slice(
      backend.indexOf('routerAdd("POST", "/api/app/posts"'),
      backend.indexOf('routerAdd("GET", "/api/app/posts"'),
    );

    expect(migration).toContain('name: "owner_session_hash"');
    expect(migration).toContain('name: "model_policy_version"');
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    expect(helpers).toContain("function recordProxyGenerationEvent");
    expect(helpers).toContain('findCollectionByNameOrId("generation_events")');
    expect(helpers).toContain('"x-generation-attempt-id"');
    expect(migration).toContain('name: "attempt_id"');
    expect(migration).toContain('name: "consumed_post"');
    expect(postRoute).toContain(
      'findRecordsByFilter(\n            "generation_events"',
    );
    expect(postRoute).toMatch(/latestCaptionSuccess\s*\?\s*"ai"/);
    expect(postRoute).toContain("latestImageSuccess.getString");
    expect(postRoute).toContain("latestAnySuccess.getString");
    expect(postRoute).not.toContain("body.generation_model");
    expect(postRoute).not.toContain("body.generation_tier");
    expect(postRoute).not.toContain("body.generation_fallback_count");
    expect(postRoute).not.toContain("body.generation_last_success_at");
    expect(postRoute).not.toContain("body.model_policy_version");
  });
});
