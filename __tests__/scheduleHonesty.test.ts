import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app stores `scheduled_for` on a post and shows it back, but nothing ever
 * publishes it: POST /api/app/posts/:id/schedule only writes the field, and no
 * cron reads it. Until a real scheduler exists, the UI must not tell a
 * salesperson their post will go out on its own — they would walk away and the
 * post would never be published, with no error to explain it.
 */
describe("schedule feature tells the truth about what it does", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("has no cron consuming scheduled_for, which is why the copy must stay honest", () => {
    const hook = read("pb_hooks/main.pb.js");
    const cronNames = [...hook.matchAll(/cronAdd\(\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(cronNames.length).toBeGreaterThan(0);

    // Every cron body must be free of scheduled_for. If someone adds a real
    // scheduler, this test fails and the copy below should be revisited.
    for (const name of cronNames) {
      const start = hook.indexOf(`cronAdd("${name}"`);
      const body = hook.slice(start, start + 4000);
      expect(body).not.toContain("scheduled_for");
    }
  });

  it("never promises automatic publishing anywhere in the UI", () => {
    for (const file of [
      "components/ScheduleDialog.tsx",
      "components/PostResult.tsx",
      "components/PostHistory.tsx",
      "components/ApprovalQueue.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/automatically publish/i);
      expect(source).not.toMatch(/auto-?publish/i);
    }
  });

  it("frames the dialog as saving a time, not as publishing", () => {
    const dialog = read("components/ScheduleDialog.tsx");
    expect(dialog).toContain('title="Plan a share time"');
    expect(dialog).toContain("Nothing posts on its own.");
    expect(dialog).toContain("Save time");
    expect(dialog).not.toContain("Schedule Post");
  });

  it("does not report success when no post exists to attach the time to", () => {
    const result = read("components/PostResult.tsx");
    // The old code toasted success on a branch that issued no request at all.
    expect(result).not.toContain('toast.success("Scheduled for "');
    expect(result).toContain("Save this post first, then plan a share time.");
    expect(result).toContain('"Share time saved for "');
  });
});
