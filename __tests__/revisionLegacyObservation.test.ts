import { describe, expect, it } from "vitest";
import { summarizeObservation } from "../scripts/revision-legacy-observation.mjs";

const health = { ok: true, releaseSha: "a".repeat(40) };
describe("daily revision compatibility observation", () => {
  it("saves a count without retaining private log text", () => {
    const result = summarizeObservation(
      "2026-10-08T12:00:00Z app [revision-legacy-client] private-post-id\n2026-10-08T12:01:00Z app healthy",
      health,
      "2026-10-08T12:02:00Z",
    );
    expect(result).toMatchObject({
      legacyClientEntries: 1,
      retrievedLogEntries: 2,
      status: "legacy-clients-present",
      coverage: "recent-buffer-snapshot",
    });
    expect(JSON.stringify(result)).not.toContain("private-post-id");
  });
  it("requires actual log entries before reporting a clear snapshot", () => {
    expect(() => summarizeObservation("", health)).toThrow();
    expect(() => summarizeObservation("Waiting for logs...", health)).toThrow();
    expect(
      summarizeObservation("2026-10-08T12:00:00Z app healthy", health).status,
    ).toBe("clear");
  });
  it("rejects unhealthy or unidentified production", () => {
    expect(() =>
      summarizeObservation("2026-10-08T12:00:00Z app healthy", {
        ...health,
        ok: false,
      }),
    ).toThrow();
    expect(() =>
      summarizeObservation("2026-10-08T12:00:00Z app healthy", {
        ...health,
        releaseSha: "unknown",
      }),
    ).toThrow();
  });
});
