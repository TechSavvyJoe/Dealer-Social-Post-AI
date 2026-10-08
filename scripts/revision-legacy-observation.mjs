import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Store counts only: production logs can contain private record identifiers. */
export function summarizeObservation(
  logs,
  health,
  observedAt = new Date().toISOString(),
) {
  if (!health?.ok || !/^[a-f0-9]{40}$/.test(health.releaseSha || "")) {
    throw new Error("Production health must identify a healthy release.");
  }
  const lines = logs
    .split(/\r?\n/)
    .filter((line) => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line));
  if (!lines.length)
    throw new Error(
      "No timestamped Fly log entries were retrieved; this is not a zero-client observation.",
    );
  const legacyClientEntries = lines.filter((line) =>
    line.includes("[revision-legacy-client]"),
  ).length;
  return {
    schemaVersion: 1,
    observedAt,
    releaseSha: health.releaseSha,
    coverage: "recent-buffer-snapshot",
    retrievedLogEntries: lines.length,
    legacyClientEntries,
    status: legacyClientEntries === 0 ? "clear" : "legacy-clients-present",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [logsPath, healthPath, outputPath] = process.argv.slice(2);
    if (!logsPath || !healthPath || !outputPath)
      throw new Error("Expected logs, health and output file paths.");
    const result = summarizeObservation(
      await readFile(logsPath, "utf8"),
      JSON.parse(await readFile(healthPath, "utf8")),
    );
    await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      `Revision compatibility: ${result.status}; ${result.legacyClientEntries} legacy entries in ${result.retrievedLogEntries} recent log entries.`,
    );
    if (result.legacyClientEntries) process.exitCode = 1;
  } catch {
    // Never echo the input or parsing errors, which may include raw logs.
    console.error("Revision observation failed. No clear observation was recorded.");
    process.exitCode = 1;
  }
}
