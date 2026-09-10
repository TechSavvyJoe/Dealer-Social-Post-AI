import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PocketBase persists datetimes as `YYYY-MM-DD HH:MM:SS.mmmZ` (a space, not
 * "T") and SQLite compares them as text. At index 10 a space (0x20) sorts
 * before "T" (0x54), so a raw `toISOString()` filter parameter sorts after
 * every stored value from the same UTC day.
 *
 * The website outbox filtered `next_attempt_at <= {:now}` with an unconverted
 * parameter, so a delivery scheduled hours ahead was still claimed as due. The
 * one-minute cron then retried a failing delivery every minute instead of
 * following the 1min -> 24h backoff, exhausting all 8 attempts in about eight
 * minutes and parking the draft as failed.
 */
const STORED = (iso: string) => iso.replace("T", " "); // what PocketBase writes
const textLte = (a: string, b: string) => a <= b; // what SQLite does

describe("website outbox retry backoff", () => {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/websitePublications.js"),
    "utf8",
  );

  it("reproduces the comparison that made future retries look due", () => {
    const scheduledLater = STORED("2026-09-10T23:00:00.000Z");
    const nowRaw = "2026-09-10T00:30:00.000Z";

    // The bug: 23:00 is 22.5 hours in the future yet compares as already due.
    expect(textLte(scheduledLater, nowRaw)).toBe(true);

    // The fix: compare in the stored format and the ordering is correct again.
    expect(textLte(scheduledLater, STORED(nowRaw))).toBe(false);
  });

  it("still treats a genuinely due row as due", () => {
    const scheduledEarlier = STORED("2026-09-10T00:00:00.000Z");
    const now = STORED("2026-09-10T00:30:00.000Z");
    expect(textLte(scheduledEarlier, now)).toBe(true);
  });

  it("normalizes every timestamp used in a filter or raw SQL", () => {
    // Each comparison parameter must come from a dbTimestamp() call.
    const declarations = [...source.matchAll(/const (now|cutoff) = ([^;]+);/g)];
    const usedInComparison = declarations.filter(([, , expr]) =>
      expr.includes("dbTimestamp"),
    );
    expect(usedInComparison.length).toBeGreaterThanOrEqual(3);

    // And no raw-SQL bind may pass an unconverted ISO string, because raw SQL
    // bypasses the normalisation record.set()/saveRecord would apply.
    // Raw SQL is the hazard: .bind() writes and compares the string verbatim,
    // while values passed to savePublicationState go through record.set() and
    // PocketBase normalises them on save. So check the bind blocks only, line
    // by line: nested parens make a strip-the-wrapper regex unreliable.
    const bindBlocks = [...source.matchAll(/\.bind\(\{[\s\S]*?\}\)/g)].map(
      ([block]) => block,
    );
    expect(bindBlocks.length).toBeGreaterThan(0);
    for (const block of bindBlocks) {
      for (const line of block.split("\n")) {
        if (!line.includes("toISOString()")) continue;
        expect(
          line,
          `raw SQL bind passes an unconverted ISO string: ${line.trim()}`,
        ).toContain("dbTimestamp(");
      }
    }
  });

  it("documents why, so the next reader does not 'simplify' it back", () => {
    expect(source).toContain("const dbTimestamp =");
    expect(source).toMatch(/space, not "T"/);
  });
});
