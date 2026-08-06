import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowFiles = [
  "vehicle_walkaround_producer/workflow.ts",
  "youtube_walkaround_publisher/workflow.ts",
];

const automationRoot =
  basename(process.cwd()) === "automation"
    ? process.cwd()
    : resolve(process.cwd(), "automation");

describe("Output workflow determinism", () => {
  for (const file of workflowFiles) {
    it(`keeps direct I/O and nondeterminism out of ${file.split("/").at(-2)}`, () => {
      const source = readFileSync(
        resolve(automationRoot, "src/workflows", file),
        "utf8",
      );
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\bDate\s*\.|new\s+Date\s*\(/);
      expect(source).not.toMatch(/Math\.random|randomUUID|process\.env/);
      expect(source).not.toMatch(
        /node:fs|node:crypto|@outputai\/http|@outputai\/credentials/,
      );
    });
  }
});
