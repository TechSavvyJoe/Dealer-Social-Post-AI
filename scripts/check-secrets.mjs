#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const placeholders =
  /^(?:|<[^>]+>|\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|process\.env\..*|your[-_].*|example.*|placeholder.*|redacted.*|hidden|fake.*|test.*|changeme|admin@example\.com)$/i;

// A printf conversion (`%s`, optionally trailed by an escape) is a format
// specifier, never a credential itself. Runbooks pipe secrets to `flyctl
// secrets import` as `printf 'NAME=%s\n' "$VALUE"` precisely so the value
// never appears in argv or shell history — the SAFE shape.
//
// But the conversion only moves the value one shell word to the right. An
// earlier version of this scanner allowlisted `%s` as a plain placeholder and
// stopped looking, so `printf 'NAME=%s\n' "9f3c2a77..."` — the literal an
// operator would slip into that exact runbook line — passed clean while the
// scanner on main caught it. The value is now read from the argument that
// follows the format string: a variable expansion is safe, a quoted literal
// is the leak.
const printfConversion = /^%[sd](?:\\[nrt])*$/;
const printfLiteralArgument = /(?:"[^"$][^"]{7,}"|'[^'$][^']{7,}')/;

const secretValuePatterns = [
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "JWT-like token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    label: "provider access token",
    pattern: /\b(?:sk-(?:proj-)?|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/,
  },
];

const assignment =
  /\b(?:GEMINI_API_KEY|VERTEX_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|PROXY_ACCESS_TOKEN|VITE_PROXY_ACCESS_TOKEN|PB_ADMIN_EMAIL|PB_ADMIN_PASSWORD|ADMIN_EMAIL|ADMIN_PASSWORD|ADMIN_PASS|ADMIN_DEALER_CODE|ADMIN_LOGIN_PASSWORD)\b\s*=\s*["']?([^\s"']+)["']?/i;
const objectCredential =
  /(?:^|[,{])\s*["']?(?:identity|password|client_secret|private_key|access_token|api_key)["']?\s*:\s*["']([^"'\n]+)["']/i;
const publicRuleMutation =
  /\b(?:listRule|viewRule|createRule|updateRule|deleteRule)\s*:\s*["']{2}/;

const findings = [];

for (const file of trackedFiles) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\u0000")) continue;

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const candidate of secretValuePatterns) {
      if (candidate.pattern.test(line)) {
        findings.push({ file, line: index + 1, label: candidate.label });
      }
    }

    const assigned = line.match(assignment);
    if (assigned) {
      const value = assigned[1];
      if (printfConversion.test(value)) {
        const afterFormat = line.slice((assigned.index ?? 0) + assigned[0].length);
        if (printfLiteralArgument.test(afterFormat)) {
          findings.push({ file, line: index + 1, label: "literal credential" });
        }
      } else if (!placeholders.test(value)) {
        findings.push({ file, line: index + 1, label: "literal credential" });
      }
    }

    const objectValue = line.match(objectCredential);
    if (objectValue && !placeholders.test(objectValue[1])) {
      findings.push({
        file,
        line: index + 1,
        label: "literal credential field",
      });
    }

    if (file.startsWith("scripts/") && publicRuleMutation.test(line)) {
      findings.push({
        file,
        line: index + 1,
        label: "public PocketBase rule mutation",
      });
    }
  });
}

if (findings.length > 0) {
  console.error("Secret/safety scan failed. Matched values are intentionally hidden:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.label})`);
  }
  process.exit(1);
}

console.log(`Secret/safety scan passed (${trackedFiles.length} repository files).`);
