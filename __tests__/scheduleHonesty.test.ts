import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app stores `scheduled_for` on a post and shows it back, but nothing ever
 * publishes it: POST /api/app/posts/:id/schedule only writes the field, and no
 * cron reads it. Until a real scheduler exists, the UI must not tell a
 * salesperson their post will go out on its own — they would walk away and the
 * post would never be published, with no error to explain it.
 *
 * The retired result screen and its schedule dialog are gone; the posting flow
 * (Home, Post, My work) offers no share time at all. These checks cover the
 * screens that are live now.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Every product source file under `dir`, at any depth. Tests are not product code. */
const filesUnder = (dir: string): string[] =>
  readdirSync(resolve(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );

/** Every screen a salesperson or manager sees a post on. */
const POSTING_SCREENS = (): string[] => [
  "components/Home.tsx",
  "components/PostScreen.tsx",
  "components/MyWork.tsx",
  ...filesUnder("components/post"),
  ...filesUnder("components/home"),
  ...filesUnder("components/work"),
  "components/PostHistory.tsx",
  "components/ApprovalQueue.tsx",
];

/**
 * Everything that could save a share time and drive "scheduled" UI: screens,
 * hooks, stores, utilities, the other services and the app shell. Only the
 * function's own definition in services/posts.ts is left out.
 */
const SCHEDULE_DEFINITION = "services/posts.ts";
const possibleScheduleCallers = (): string[] =>
  [
    ...filesUnder("components"),
    ...filesUnder("hooks"),
    ...filesUnder("stores"),
    ...filesUnder("utils"),
    ...filesUnder("services"),
    "App.tsx",
  ].filter((file) => file !== SCHEDULE_DEFINITION);

const AUTO_PUBLISH_PROMISE = [/automatically publish/i, /auto-?publish/i];

const promisesAutoPublish = (source: string): boolean =>
  AUTO_PUBLISH_PROMISE.some((pattern) => pattern.test(source));

describe("schedule feature tells the truth about what it does", () => {
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

  it("never promises automatic publishing on any posting screen", () => {
    const files = POSTING_SCREENS();
    // The folders must exist and hold files, or this loop proves nothing.
    expect(
      files.filter((f) => f.startsWith("components/post/")).length,
    ).toBeGreaterThan(0);
    for (const dir of ["components/home/", "components/work/"]) {
      expect(
        files.some((f) => f.startsWith(dir)),
        `${dir} has no scanned files`,
      ).toBe(true);
    }
    const offenders = files.filter((file) => promisesAutoPublish(read(file)));
    expect(
      offenders,
      `promises automatic publishing:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("offers no share time anywhere until something publishes it", () => {
    // The old dialog was framed as "Plan a share time ... Nothing posts on its
    // own." No live screen saves a share time now. If one comes back, it must
    // carry that framing (never "Schedule Post") and this test must be
    // updated to check it.
    const files = possibleScheduleCallers();
    for (const dir of ["components/", "hooks/", "stores/", "utils/", "services/"]) {
      expect(
        files.some((file) => file.startsWith(dir)),
        `${dir} has no scanned files`,
      ).toBe(true);
    }
    const callers = files.filter((file) => /\bschedulePost\s*\(/.test(read(file)));
    expect(
      callers,
      "something now saves a share time: frame it as 'Nothing posts on its own.' and update this test",
    ).toEqual([]);
  });

  it("the posting-screen check fails on a planted promise (planted mutant)", () => {
    const banner = read("components/post/LockBanner.tsx");
    expect(promisesAutoPublish(banner)).toBe(false);
    const mutated = banner.replace(
      "export ",
      '// copy: "We will automatically publish it at 9 AM."\nexport ',
    );
    expect(mutated).not.toBe(banner);
    expect(promisesAutoPublish(mutated)).toBe(true);
  });
});
