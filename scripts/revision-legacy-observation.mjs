import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The backend observes every legacy draft and share request in durable storage.
// Public health exposes only time bounds, never record IDs, captions or logs.
export function summarizeObservation(health, observedAt = new Date().toISOString()) {
  if (!health?.ok || !/^[a-f0-9]{40}$/.test(health.releaseSha || "")) {
    throw new Error("Production health must identify a healthy release.");
  }
  const state = health.revisionCompatibility;
  const now = Date.parse(observedAt);
  const started = Date.parse(state?.observedSince);
  const clear = Date.parse(state?.clearSince);
  const eligible = Date.parse(state?.eligibleAfter);
  if (
    state?.coverage !== "durable-deployment-window" ||
    ![now, started, clear, eligible].every(Number.isFinite) ||
    started > clear ||
    clear > now ||
    eligible !== clear + 7 * 24 * 60 * 60 * 1000 ||
    typeof state.ready !== "boolean" ||
    (state.ready && now < eligible)
  ) {
    throw new Error("Continuous revision observation is unavailable or invalid.");
  }
  return {
    schemaVersion: 2,
    observedAt,
    releaseSha: health.releaseSha,
    coverage: state.coverage,
    observedSince: new Date(started).toISOString(),
    clearSince: new Date(clear).toISOString(),
    eligibleAfter: new Date(eligible).toISOString(),
    status: state.ready && now >= eligible ? "ready-for-stage-c-review" : "observing",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [healthPath, outputPath] = process.argv.slice(2);
    if (!healthPath || !outputPath)
      throw new Error("Expected health and output file paths.");
    const result = summarizeObservation(JSON.parse(await readFile(healthPath, "utf8")));
    await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      `Revision compatibility: ${result.status}; earliest stage C review ${result.eligibleAfter}.`,
    );
  } catch {
    console.error("Revision observation failed. No clear observation was recorded.");
    process.exitCode = 1;
  }
}
