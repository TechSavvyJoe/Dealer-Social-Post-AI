#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The dependency audit gate. Every advisory at any severity fails CI — which
 * blocks every release — unless config/npm-audit-exceptions.json records it
 * with a reason and an expiry date. An exception is for an advisory that has
 * no patched release and cannot be reached in this app; it is never a way to
 * defer a fix that exists. When it expires the gate fails again, so the
 * exception has to be re-justified on purpose rather than forgotten.
 */
export const evaluateAudit = (report, exceptions, today) => {
  if (!report || typeof report !== "object" || report.error) {
    return {
      ok: false,
      failures: [
        `npm audit did not return a report${
          report?.error?.summary ? `: ${report.error.summary}` : ""
        }`,
      ],
      excepted: [],
      stale: [],
    };
  }

  const advisories = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities || {})) {
    for (const via of entry.via || []) {
      // String entries only name the dependency that carries the advisory;
      // the advisory itself is reported on that dependency's own entry.
      if (!via || typeof via !== "object") continue;
      const id = (String(via.url || "").match(/GHSA(?:-[a-z0-9]{4}){3}/i) || [])[0];
      const key = `${id || via.source}:${name}`;
      advisories.set(key, {
        id: id || `source-${via.source}`,
        packageName: via.name || name,
        severity: via.severity || entry.severity,
        title: via.title || "",
        url: via.url || "",
      });
    }
  }

  const failures = [];
  const excepted = [];
  const usedExceptions = new Set();
  for (const advisory of advisories.values()) {
    const exception = exceptions.find(
      (candidate) =>
        candidate.advisory === advisory.id &&
        candidate.package === advisory.packageName,
    );
    const label = `${advisory.id} ${advisory.packageName} (${advisory.severity}): ${advisory.title}`;
    if (!exception) {
      failures.push(`${label} ${advisory.url}`.trim());
      continue;
    }
    usedExceptions.add(exception);
    if (!(exception.expires >= today)) {
      failures.push(
        `${label} — its exception expired on ${exception.expires}; re-check for a fix and re-justify or remove it`,
      );
      continue;
    }
    excepted.push(
      `${label} — excepted until ${exception.expires}: ${exception.reason}`,
    );
  }

  const stale = exceptions
    .filter((exception) => !usedExceptions.has(exception))
    .map(
      (exception) =>
        `${exception.advisory} ${exception.package} no longer appears in the audit; remove its exception`,
    );

  return { ok: failures.length === 0, failures, excepted, stale };
};

export const validateExceptions = (exceptions) => {
  if (!Array.isArray(exceptions)) return ["npm-audit-exceptions.json must be an array"];
  const problems = [];
  exceptions.forEach((exception, index) => {
    const where = `exception ${index + 1}`;
    if (!/^GHSA(?:-[a-z0-9]{4}){3}$/i.test(exception?.advisory || "")) {
      problems.push(`${where}: advisory must be a GHSA id`);
    }
    if (!exception?.package) problems.push(`${where}: package is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception?.expires || "")) {
      problems.push(`${where}: expires must be a YYYY-MM-DD date`);
    }
    if (!exception?.reason || exception.reason.trim().length < 40) {
      problems.push(`${where}: reason must explain why the advisory cannot be reached`);
    }
  });
  return problems;
};

const runAudit = () => {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the JSON report is
    // still on stdout. No stdout means the audit itself failed — fail closed.
    if (error && typeof error.stdout === "string" && error.stdout.trim()) {
      return error.stdout;
    }
    throw error;
  }
};

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const exceptions = JSON.parse(
    readFileSync(resolve(root, "config/npm-audit-exceptions.json"), "utf8"),
  );
  const problems = validateExceptions(exceptions);
  if (problems.length) {
    for (const problem of problems)
      console.error(`Invalid audit exception: ${problem}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(runAudit());
  } catch (error) {
    console.error(
      `npm audit failed to run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = evaluateAudit(report, exceptions, today);
  for (const line of result.excepted) console.warn(`EXCEPTED: ${line}`);
  for (const line of result.stale) console.warn(`STALE EXCEPTION: ${line}`);
  if (!result.ok) {
    for (const line of result.failures) console.error(`VULNERABLE: ${line}`);
    process.exit(1);
  }
  console.log(
    result.excepted.length
      ? `npm audit clean apart from ${result.excepted.length} documented exception(s).`
      : "npm audit clean.",
  );
}
