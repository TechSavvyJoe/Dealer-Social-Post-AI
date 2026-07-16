import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTelemetrySnapshot,
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
    expect(sanitized.nested.message).toBe(
      "Decoded [REDACTED_VIN] successfully",
    );
    expect(sanitized.nested.fileName).toBe(
      "vehicle_[REDACTED_VIN]_uploaded.jpg",
    );
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
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logEvent(`vehicle.${TEST_VIN}.decoded`, {
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
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/telemetry",
      expect.any(String),
    );
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
          timestamp: 1,
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

  it("keeps raw VINs out of call-site telemetry and redacts the server log route", () => {
    const vinScanner = readFileSync(
      resolve(process.cwd(), "components/VinScanner.tsx"),
      "utf8",
    );
    const photoRelease = readFileSync(
      resolve(process.cwd(), "components/PhotoReleaseModal.tsx"),
      "utf8",
    );
    const backend = readFileSync(
      resolve(process.cwd(), "pb_hooks/main.pb.js"),
      "utf8",
    );
    const sanitizerSource = backend.slice(
      backend.indexOf("function redactTelemetryVinStrings"),
      backend.indexOf('routerAdd("POST", "/api/telemetry"'),
    );
    const backendSanitizer = new Function(
      `${sanitizerSource}; return { redactTelemetryVinStrings, redactTelemetryValue };`,
    )() as {
      redactTelemetryVinStrings(value: string): string;
      redactTelemetryValue(value: unknown, key: string, depth: number): unknown;
    };
    const telemetryRoute = backend.slice(
      backend.indexOf('routerAdd("POST", "/api/telemetry"'),
      backend.indexOf("// Session Endpoints"),
    );
    const serverResult = backendSanitizer.redactTelemetryVinStrings(
      JSON.stringify(
        backendSanitizer.redactTelemetryValue(
          {
            vin: TEST_VIN,
            nested: {
              apiKey: "provider-secret",
              message: `vehicle_${TEST_VIN}_uploaded`,
            },
          },
          "",
          0,
        ),
      ),
    );

    expect(vinScanner).toContain("vinPresent: true");
    expect(vinScanner).not.toContain("{ vin: cleaned }");
    expect(photoRelease).toContain("{ vinPresent: Boolean(vin) }");
    expect(photoRelease).not.toContain(
      'logEvent("photo_release.captured", { vin })',
    );
    expect(backend).toContain("function redactTelemetryValue");
    expect(telemetryRoute.indexOf("redactTelemetryValue(rawBody")).toBeLessThan(
      telemetryRoute.indexOf(".slice(0, 2000)"),
    );
    expect(telemetryRoute).not.toContain(
      "const serialized = JSON.stringify(rawBody)",
    );
    expect(serverResult).not.toContain(TEST_VIN);
    expect(serverResult).not.toContain("provider-secret");
    expect(serverResult).toContain("[REDACTED_VIN]");
    expect(serverResult).toContain("[REDACTED]");
  });
});
