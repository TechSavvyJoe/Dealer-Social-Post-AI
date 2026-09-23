/**
 * Share events (PR2-0, unit U07; amendment B1).
 *
 * A completed share is recorded in its own `post_share_events` collection —
 * never on the post, so recording one never bumps `posts.updated`, the
 * website hand-off's compare-and-set post_revision. These tests run the real
 * migration, the real route and the real list projection against fakes of the
 * PocketBase runtime, with the real policy, helper and identity-review modules
 * doing the deciding.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCollection, fieldsOf } from "../test/fakePocketBaseSchema";
import {
  listPostsPage,
  projectPostRecordForUi,
  projectShareSummary,
  recordPostShared,
  type PostRecord,
} from "../services/posts";
import { PLATFORM_OUTPUT_PROFILES } from "../services/platformOutputs";
import { postStatusFor } from "../utils/historyPost";
import { setActiveAuthEpoch } from "../utils/authBoundary";

type AnyRecord = Record<string, unknown>;

const loadCommonJs = <T>(relativePath: string): T => {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

type RealHelpers = {
  isAuthoritativePostPerson: (context: unknown, record: unknown) => boolean;
  allowedPostPlatformIds: () => string[];
  parsePostPlatformCaptions: (
    raw: unknown,
    allowed: string[],
    selected: string[],
  ) => { ok: boolean; value?: Record<string, string> };
  databaseTimestamp: (value: string) => string;
};
type RealPolicies = {
  geminiModelPolicySnapshot: () => { version: string };
};

const realHelpers = loadCommonJs<RealHelpers>("pb_hooks/helpers.js");
const realPolicies = loadCommonJs<RealPolicies>("pb_hooks/requestPolicies.js");
const realWebsite = loadCommonJs<AnyRecord>("pb_hooks/websitePublications.js");
const hookSource = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
const currentPolicyVersion = realPolicies.geminiModelPolicySnapshot().version;

const routeSource = (start: string, end?: string): string => {
  const from = hookSource.indexOf(start);
  expect(from, `route ${start} exists`).toBeGreaterThan(-1);
  const to = end
    ? hookSource.indexOf(end, from)
    : hookSource.indexOf("routerAdd(", from + 20);
  expect(to).toBeGreaterThan(from);
  return hookSource.slice(from, to);
};

/** PocketBase stores datetimes as `YYYY-MM-DD HH:MM:SS.mmmZ`. */
const dbTime = (msAgo: number): string =>
  new Date(Date.now() - msAgo).toISOString().replace("T", " ");

const fakeRecord = (id: string, values: AnyRecord) => ({
  id,
  values,
  getString: (field: string) => (values[field] ?? "").toString(),
  getBool: (field: string) => Boolean(values[field]),
  get: (field: string) => values[field],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe("post_share_events migration", () => {
  const migrationPath = "pb_migrations/1752300000_post_share_events.js";
  type Definition = {
    name: string;
    schema: Array<{
      name: string;
      type: string;
      required?: boolean;
      options?: AnyRecord;
    }>;
    indexes: string[];
  } & AnyRecord;

  const loadMigration = () => {
    const source = readFileSync(resolve(process.cwd(), migrationPath), "utf8");
    let up: ((db: unknown) => unknown) | undefined;
    let down: ((db: unknown) => unknown) | undefined;
    runInNewContext(source, {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      Collection: function Collection(definition: Definition) {
        return { ...definition, id: "col_post_share_events" };
      },
      SchemaField: function SchemaField(definition: AnyRecord) {
        return { ...definition };
      },
    });
    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    return { source, up: up!, down: down! };
  };

  const buildDao = (withExisting = false) => {
    const posts = Object.assign(
      fakeCollection([
        { name: "caption", type: "text" },
        { name: "approval_status", type: "select" },
      ]),
      { id: "col_posts", name: "posts" },
    );
    const dealers = Object.assign(fakeCollection([{ name: "name", type: "text" }]), {
      id: "col_dealers",
      name: "dealers",
    });
    let events: AnyRecord | null = withExisting
      ? { id: "col_existing", name: "post_share_events" }
      : null;
    const saveCollection = vi.fn((collection: AnyRecord) => {
      if (collection.name === "post_share_events") events = collection;
    });
    const deleteCollection = vi.fn((collection: AnyRecord) => {
      if (collection === events) events = null;
    });
    const dao = {
      findCollectionByNameOrId: (name: string) => {
        if (name === "posts") return posts;
        if (name === "dealers") return dealers;
        if (name === "post_share_events" && events) return events;
        throw new Error("missing collection " + name);
      },
      saveCollection,
      deleteCollection,
    };
    return { dao, posts, saveCollection, deleteCollection, current: () => events };
  };

  it("creates a server-only collection bound to the post and dealer, never a field on posts", () => {
    const { up } = loadMigration();
    const { dao, posts, saveCollection, current } = buildDao();

    up(dao);

    expect(saveCollection).toHaveBeenCalledTimes(1);
    const created = current() as Definition;
    expect(created.name).toBe("post_share_events");
    expect(created.type).toBe("base");
    const byName = Object.fromEntries(
      created.schema.map((field) => [field.name, field]),
    );
    // Exactly these four: nothing that could hold a caption, a customer or a person.
    expect(Object.keys(byName)).toEqual(["post", "dealer", "channel", "via"]);
    expect(byName.post).toMatchObject({
      type: "relation",
      required: true,
      options: { collectionId: "col_posts", cascadeDelete: true, maxSelect: 1 },
    });
    expect(byName.dealer).toMatchObject({
      type: "relation",
      required: true,
      options: { collectionId: "col_dealers", cascadeDelete: true, maxSelect: 1 },
    });
    expect(byName.channel).toMatchObject({
      type: "text",
      required: true,
      options: { max: 40, pattern: "^[a-z0-9_]+$" },
    });
    expect(byName.via).toMatchObject({
      type: "select",
      required: true,
      options: { maxSelect: 1, values: ["share_sheet", "download", "copy"] },
    });
    for (const rule of [
      "listRule",
      "viewRule",
      "createRule",
      "updateRule",
      "deleteRule",
    ]) {
      expect(created[rule]).toBeNull();
    }
    expect(created.indexes.join("\n")).toContain(
      "ON `post_share_events` (`post`, `created` DESC)",
    );
    expect(created.indexes.join("\n")).toContain(
      "ON `post_share_events` (`dealer`, `post`, `created` DESC)",
    );
    // The posts collection is read for its id and never changed or saved.
    expect(fieldsOf(posts.schema).map((field) => field.name)).toEqual([
      "caption",
      "approval_status",
    ]);
    expect(saveCollection.mock.calls.every(([c]) => c.name !== "posts")).toBe(true);
  });

  it("is idempotent when the collection already exists", () => {
    const { up } = loadMigration();
    const { dao, saveCollection } = buildDao(true);
    up(dao);
    expect(saveCollection).not.toHaveBeenCalled();
  });

  it("rolls back by deleting the collection and is inert without it", () => {
    const { up, down } = loadMigration();
    const { dao, deleteCollection, current } = buildDao();
    up(dao);
    const created = current();
    down(dao);
    expect(deleteCollection).toHaveBeenCalledWith(created);
    expect(current()).toBeNull();
    expect(() => down(dao)).not.toThrow();
    expect(deleteCollection).toHaveBeenCalledTimes(1);
  });

  it("never touches the posts schema in either direction", () => {
    const { source } = loadMigration();
    expect(source).not.toMatch(/posts\.schema/);
    expect(source).not.toMatch(/addField|removeField/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/app/posts/:id/shared
// ---------------------------------------------------------------------------

type RouteResult = { status: number; payload: AnyRecord };

const dealer = fakeRecord("dealer-1", {
  name: "Bob Maxey Ford of Howell",
  oem_affiliation: "Ford",
});

const salesperson = fakeRecord("person-1", { name: "Joe Gallant" });

const postValues = (overrides: AnyRecord = {}): AnyRecord => ({
  dealer: "dealer-1",
  owner_session_hash: "hash:token-author",
  owner_person_id: "person-1",
  attribution_authoritative: true,
  salesperson_name: "Joe Gallant",
  approval_status: "n_a",
  release_required: true,
  has_release: true,
  release_status: "saved",
  customer_name: "Michelle Johnson",
  caption:
    "Congratulations Michelle on your new Bronco! Ask for Joe at Bob Maxey Ford.",
  disclosures: "",
  platform_ids: JSON.stringify(["facebook_feed", "instagram_feed"]),
  platform_captions: JSON.stringify({ facebook_feed: "Congrats Michelle!" }),
  creative_image: "creative.jpg",
  model_policy_version: currentPolicyVersion,
  website_draft: "",
  updated: "2026-09-20 10:00:00.000Z",
  ...overrides,
});

interface ShareHarness {
  run: (options?: {
    body?: AnyRecord;
    postOverrides?: AnyRecord;
    context?: AnyRecord | null;
    token?: string;
    postId?: string;
  }) => RouteResult;
  events: ReturnType<typeof fakeRecord>[];
  savedRecords: unknown[];
  headers: Map<string, string>;
  rateLimit: ReturnType<typeof vi.fn>;
}

const shareHarness = (): ShareHarness => {
  const source = routeSource('routerAdd("POST", "/api/app/posts/:id/shared"');
  const events: ReturnType<typeof fakeRecord>[] = [];
  const savedRecords: unknown[] = [];
  const headers = new Map<string, string>();
  const rateLimit = vi.fn((): AnyRecord => ({ ok: true }));
  let eventSeq = 0;

  const run: ShareHarness["run"] = (options = {}) => {
    const post = fakeRecord("post-1", postValues(options.postOverrides));
    const context =
      options.context === undefined
        ? {
            dealer,
            person: salesperson,
            session: { id: "session-1" },
            role: "salesperson",
          }
        : options.context;
    const token = options.token ?? "token-author";
    const helpers = {
      sessionContext: () => context,
      readSessionToken: () => token,
      hashSessionToken: (value: string) => "hash:" + value,
      isAuthoritativePostPerson: realHelpers.isAuthoritativePostPerson,
      checkProxyRateLimit: rateLimit,
      allowedPostPlatformIds: realHelpers.allowedPostPlatformIds,
      parsePostPlatformCaptions: realHelpers.parsePostPlatformCaptions,
      databaseTimestamp: realHelpers.databaseTimestamp,
    };
    const txDao = {
      findRecordsByFilter: (
        collection: string,
        filter: string,
        sort: string,
        _limit: number,
        _offset: number,
        params: AnyRecord,
      ) => {
        expect(collection).toBe("post_share_events");
        expect(filter).toBe("post = {:post}");
        expect(sort).toBe("-created,-id");
        return events
          .filter((event) => event.values.post === params.post)
          .sort((a, b) => b.getString("created").localeCompare(a.getString("created")));
      },
      findCollectionByNameOrId: (name: string) => ({ name }),
      saveRecord: (record: ReturnType<typeof fakeRecord>) => {
        savedRecords.push(record);
        eventSeq += 1;
        record.values.created = dbTime(0);
        record.values.id = `event-new-${eventSeq}`;
        events.push(record);
      },
      deleteRecord: (record: ReturnType<typeof fakeRecord>) => {
        const index = events.indexOf(record);
        if (index >= 0) events.splice(index, 1);
      },
    };
    let handler: ((c: unknown) => RouteResult) | undefined;
    runInNewContext(source, {
      __hooks: "/hooks",
      routerAdd: (_method: string, _path: string, callback: typeof handler) => {
        handler = callback;
      },
      require: (path: string) => {
        if (path.endsWith("/helpers.js")) return helpers;
        if (path.endsWith("/requestPolicies.js")) return realPolicies;
        if (path.endsWith("/websitePublications.js")) return realWebsite;
        throw new Error("unexpected require " + path);
      },
      $app: {
        dao: () => ({
          findRecordById: (collection: string, id: string) => {
            if (collection === "posts" && id === post.id) return post;
            throw new Error("not found");
          },
          runInTransaction: (fn: (dao: typeof txDao) => void) => fn(txDao),
        }),
      },
      $apis: { requestInfo: () => ({ data: options.body ?? {} }) },
      Record: function Record(collection: { name: string }) {
        const values: AnyRecord = { collection: collection.name };
        const record = fakeRecord("", values);
        return Object.assign(record, {
          set: (field: string, value: unknown) => {
            values[field] = value;
          },
        });
      },
      console: { error: vi.fn(), log: vi.fn() },
    });
    expect(handler).toBeTypeOf("function");
    return handler!({
      pathParam: () => options.postId ?? "post-1",
      response: () => ({
        header: () => ({
          set: (name: string, value: string) => headers.set(name, value),
        }),
      }),
      json: (status: number, payload: AnyRecord) => ({ status, payload }),
    });
  };
  return { run, events, savedRecords, headers, rateLimit };
};

const seedEvent = (
  harness: ShareHarness,
  id: string,
  values: { channel: string; via: string; msAgo: number; post?: string },
) => {
  harness.events.push(
    fakeRecord(id, {
      post: values.post ?? "post-1",
      dealer: "dealer-1",
      channel: values.channel,
      via: values.via,
      created: dbTime(values.msAgo),
    }),
  );
};

describe("POST /api/app/posts/:id/shared", () => {
  it("records the author's completed share in post_share_events and never saves the post", () => {
    const harness = shareHarness();
    const result = harness.run({
      body: { channel: "facebook_feed", via: "share_sheet" },
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({
      id: "post-1",
      channel: "facebook_feed",
      via: "share_sheet",
      deduplicated: false,
    });
    expect(result.payload.shared_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0].values).toMatchObject({
      collection: "post_share_events",
      post: "post-1",
      dealer: "dealer-1",
      channel: "facebook_feed",
      via: "share_sheet",
    });
    // The only write is the event row: the post (and so posts.updated, the
    // website hand-off's post_revision) is untouched.
    expect(harness.savedRecords).toEqual([harness.events[0]]);
    expect(harness.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("takes only channel and via from the client; the server owns post, dealer and time", () => {
    const harness = shareHarness();
    const result = harness.run({
      body: {
        channel: "instagram_feed",
        via: "download",
        post: "post-other",
        dealer: "dealer-other",
        created: "2000-01-01 00:00:00.000Z",
      },
    });
    expect(result.status).toBe(200);
    expect(harness.events[0].values.post).toBe("post-1");
    expect(harness.events[0].values.dealer).toBe("dealer-1");
    expect(harness.events[0].getString("created")).not.toContain("2000-01-01");
  });

  it.each([
    ["website", "share_sheet"],
    ["facebook", "share_sheet"],
    ["", "share_sheet"],
    ["facebook_feed", "web-share"],
    ["facebook_feed", ""],
  ])("rejects channel %j via %j with 400 and records nothing", (channel, via) => {
    const harness = shareHarness();
    const result = harness.run({ body: { channel, via } });
    expect(result.status).toBe(400);
    expect(harness.events).toHaveLength(0);
  });

  it("accepts every destination in the client's platformOutputs contract, and only those", () => {
    const clientIds = [
      ...new Set(PLATFORM_OUTPUT_PROFILES.map((p) => p.destinationId)),
    ];
    expect([...realHelpers.allowedPostPlatformIds()].sort()).toEqual(
      [...clientIds].sort(),
    );
    for (const via of ["share_sheet", "download", "copy"]) {
      const harness = shareHarness();
      expect(harness.run({ body: { channel: clientIds[0], via } }).status).toBe(200);
    }
  });

  it("requires a session", () => {
    const harness = shareHarness();
    const result = harness.run({
      context: null,
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(401);
    expect(harness.events).toHaveLength(0);
  });

  it("404s an unknown post", () => {
    const harness = shareHarness();
    const result = harness.run({
      postId: "post-missing",
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(404);
  });

  it("blocks another dealership's post", () => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: { dealer: "dealer-2" },
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(403);
    expect(harness.events).toHaveLength(0);
  });

  it("lets only the author record: a manager on a teammate's post gets 403", () => {
    const harness = shareHarness();
    const result = harness.run({
      context: {
        dealer,
        person: fakeRecord("manager-1", { name: "Pat Manager" }),
        session: { id: "session-manager" },
        role: "dealer_admin",
      },
      token: "token-manager",
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(403);
    expect(harness.events).toHaveLength(0);
  });

  it("accepts the author's creating session even without a person binding", () => {
    const harness = shareHarness();
    const result = harness.run({
      context: {
        dealer,
        person: null,
        session: { id: "session-admin" },
        role: "super_admin",
      },
      token: "token-author",
      body: { channel: "facebook_feed", via: "copy" },
    });
    expect(result.status).toBe(200);
  });

  it.each(["pending", "rejected", ""])(
    "fails closed while approval is %j",
    (approval) => {
      const harness = shareHarness();
      const result = harness.run({
        postOverrides: { approval_status: approval },
        body: { channel: "facebook_feed", via: "share_sheet" },
      });
      expect(result.status).toBe(409);
      expect(result.payload.code).toBe("APPROVAL_REQUIRED");
      expect(harness.events).toHaveLength(0);
    },
  );

  it.each(["approved", "n_a"])("records once approval is %j", (approval) => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: { approval_status: approval },
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(200);
  });

  it.each([
    [{ has_release: false, release_status: "saved" }],
    [{ has_release: true, release_status: "pending" }],
    [{ has_release: false, release_status: "" }],
  ])("fails closed when a required release is not saved (%j)", (overrides) => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: overrides,
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(409);
    expect(result.payload.code).toBe("RELEASE_NOT_SAVED");
    expect(harness.events).toHaveLength(0);
  });

  it("records a post that never needed a release", () => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: {
        release_required: false,
        has_release: false,
        release_status: "not_required",
        customer_name: "",
        caption: "Fresh arrivals on the lot at Bob Maxey Ford of Howell this week!",
        platform_captions: "",
      },
      body: { channel: "gbp", via: "download" },
    });
    expect(result.status).toBe(200);
  });

  it("fails closed on a creative archived under an older model policy", () => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: { model_policy_version: "1999-01-01" },
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(409);
    expect(result.payload.code).toBe("IMAGE_REVIEW_REQUIRED");
    expect(harness.events).toHaveLength(0);
  });

  it.each([
    [
      "the caption keeps the protected full name",
      { caption: "Congrats Michelle Johnson!" },
    ],
    [
      "a destination caption names someone else",
      {
        platform_captions: JSON.stringify({
          facebook_feed: "Congrats to Sarah Williams!",
        }),
      },
    ],
    [
      "the caption names someone else",
      { caption: "Congratulations Sarah Williams on your new Bronco!" },
    ],
  ])("fails closed when %s", (_label, overrides) => {
    const harness = shareHarness();
    const result = harness.run({
      postOverrides: overrides,
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(409);
    expect(result.payload.code).toBe("IDENTITY_REVIEW_REQUIRED");
    expect(harness.events).toHaveLength(0);
  });

  it("deduplicates the same channel and method within 60 seconds", () => {
    const harness = shareHarness();
    seedEvent(harness, "event-recent", {
      channel: "facebook_feed",
      via: "share_sheet",
      msAgo: 30_000,
    });
    const repeat = harness.run({
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(repeat.status).toBe(200);
    expect(repeat.payload.deduplicated).toBe(true);
    expect(harness.events).toHaveLength(1);
    expect(harness.savedRecords).toHaveLength(0);

    // Another method, or another destination, is a new share.
    expect(
      harness.run({ body: { channel: "facebook_feed", via: "download" } }).payload
        .deduplicated,
    ).toBe(false);
    expect(
      harness.run({ body: { channel: "instagram_feed", via: "share_sheet" } }).payload
        .deduplicated,
    ).toBe(false);
    expect(harness.events).toHaveLength(3);
  });

  it("records the same channel and method again after 60 seconds", () => {
    const harness = shareHarness();
    seedEvent(harness, "event-old", {
      channel: "facebook_feed",
      via: "share_sheet",
      msAgo: 5 * 60_000,
    });
    const result = harness.run({
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.payload.deduplicated).toBe(false);
    expect(harness.events).toHaveLength(2);
  });

  it("keeps the newest 20 events per post and never trims another post", () => {
    const harness = shareHarness();
    for (let i = 0; i < 20; i++) {
      seedEvent(harness, `event-${i}`, {
        channel: "facebook_feed",
        via: "download",
        // event-19 is the oldest.
        msAgo: (i + 2) * 60_000,
      });
    }
    seedEvent(harness, "event-other-post", {
      channel: "facebook_feed",
      via: "download",
      msAgo: 99 * 60_000,
      post: "post-2",
    });

    const result = harness.run({
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(200);
    const forPost = harness.events.filter((event) => event.values.post === "post-1");
    expect(forPost).toHaveLength(20);
    expect(forPost.map((event) => event.id)).not.toContain("event-19");
    expect(forPost.some((event) => event.values.via === "share_sheet")).toBe(true);
    expect(harness.events.map((event) => event.id)).toContain("event-other-post");
  });

  it("rate-limits per dealer and writer with Retry-After", () => {
    const harness = shareHarness();
    harness.rateLimit.mockReturnValue({ ok: false, retryAfterMs: 1500 });
    const result = harness.run({
      body: { channel: "facebook_feed", via: "share_sheet" },
    });
    expect(result.status).toBe(429);
    expect(result.payload.code).toBe("WRITE_RATE_LIMITED");
    expect(harness.headers.get("Retry-After")).toBe("2");
    expect(harness.rateLimit).toHaveBeenCalledWith(
      "app-write:post-share:hour:dealer-1:person-1",
      120,
      60 * 60 * 1000,
    );
    expect(harness.events).toHaveLength(0);
  });

  it("sits outside the schedule route's owner-scoping slice", () => {
    // backendHookPolicies slices schedule → status; this route must not land
    // inside that window, and it follows the status route.
    const schedule = hookSource.indexOf(
      'routerAdd("POST", "/api/app/posts/:id/schedule"',
    );
    const status = hookSource.indexOf('routerAdd("GET", "/api/app/posts/:id/status"');
    const shared = hookSource.indexOf('routerAdd("POST", "/api/app/posts/:id/shared"');
    expect(shared).toBeGreaterThan(status);
    expect(schedule).toBeLessThan(status);
    const route = routeSource('routerAdd("POST", "/api/app/posts/:id/shared"');
    expect(route).not.toContain("isManager");
    expect(route).not.toMatch(/saveRecord\(record\)|record\.set\(/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/app/posts — share_summary projection
// ---------------------------------------------------------------------------

describe("GET /api/app/posts share_summary", () => {
  type ShareRow = {
    dealer: string;
    post: string;
    channel: string;
    via: string;
    created: string;
  };

  const runList = (
    shareRows: ShareRow[],
    options: { failShareQuery?: boolean } = {},
  ) => {
    const source = routeSource(
      'routerAdd("GET", "/api/app/posts"',
      'routerAdd("PATCH", "/api/app/posts/:id"',
    );
    const posts = ["post-1", "post-2"].map((id, index) =>
      fakeRecord(
        id,
        postValues({
          generated_at: `2026-09-2${index} 10:00:00.000Z`,
          creative_image: "",
          platform_captions: "",
        }),
      ),
    );
    const queries: Array<{ sql: string; params: AnyRecord }> = [];
    const errors = vi.fn();
    const helpers = {
      sessionContext: () => ({
        dealer,
        person: salesperson,
        session: { id: "session-1" },
        role: "salesperson",
      }),
      databaseTimestamp: realHelpers.databaseTimestamp,
      allowedPostPlatformIds: realHelpers.allowedPostPlatformIds,
      parsePostPlatformCaptions: realHelpers.parsePostPlatformCaptions,
    };
    const website = {
      ...realWebsite,
      publicationSummariesForDealer: () => ({}),
    };
    let handler: ((c: unknown) => RouteResult) | undefined;
    runInNewContext(source, {
      __hooks: "/hooks",
      routerAdd: (_method: string, _path: string, callback: typeof handler) => {
        handler = callback;
      },
      require: (path: string) => {
        if (path.endsWith("/helpers.js")) return helpers;
        if (path.endsWith("/requestPolicies.js")) return realPolicies;
        if (path.endsWith("/websitePublications.js")) return website;
        throw new Error("unexpected require " + path);
      },
      $apis: { requestInfo: () => ({ query: { limit: "50" } }) },
      $app: {
        dao: () => ({
          findRecordsByFilter: () => posts,
          db: () => ({
            newQuery: (sql: string) => ({
              bind: (params: AnyRecord) => ({
                all: (rows: AnyRecord[]) => {
                  queries.push({ sql, params });
                  if (options.failShareQuery) throw new Error("no such table");
                  const ids = Object.entries(params)
                    .filter(([key]) => key.startsWith("post"))
                    .map(([, value]) => value);
                  shareRows
                    .filter(
                      (row) => row.dealer === params.dealer && ids.includes(row.post),
                    )
                    .sort((a, b) => b.created.localeCompare(a.created))
                    .forEach((row) => rows.push({ ...row }));
                },
              }),
            }),
          }),
        }),
      },
      arrayOf: () => [],
      DynamicModel: function DynamicModel(shape: AnyRecord) {
        return shape;
      },
      console: { error: errors, log: vi.fn() },
    });
    expect(handler).toBeTypeOf("function");
    const result = handler!({
      response: () => ({ header: () => ({ set: vi.fn() }) }),
      json: (status: number, payload: AnyRecord) => ({ status, payload }),
    });
    return { result, queries, errors };
  };

  it("projects a derived summary per post, newest first, and null for an unshared post", () => {
    const { result, queries } = runList([
      {
        dealer: "dealer-1",
        post: "post-1",
        channel: "instagram_feed",
        via: "download",
        created: "2026-09-21 09:00:00.000Z",
      },
      {
        dealer: "dealer-1",
        post: "post-1",
        channel: "facebook_feed",
        via: "share_sheet",
        created: "2026-09-22 09:00:00.000Z",
      },
      {
        dealer: "dealer-1",
        post: "post-1",
        channel: "facebook_feed",
        via: "copy",
        created: "2026-09-20 09:00:00.000Z",
      },
      // Another dealership's row for the same id never leaks in.
      {
        dealer: "dealer-2",
        post: "post-2",
        channel: "tiktok",
        via: "share_sheet",
        created: "2026-09-23 09:00:00.000Z",
      },
    ]);

    expect(result.status).toBe(200);
    const items = result.payload.items as AnyRecord[];
    expect(items.map((item) => item.id)).toEqual(["post-1", "post-2"]);
    expect(items[0].share_summary).toEqual({
      count: 3,
      last_shared_at: "2026-09-22 09:00:00.000Z",
      last_channel: "facebook_feed",
      last_via: "share_sheet",
      channels: ["facebook_feed", "instagram_feed"],
    });
    expect(items[1].share_summary).toBeNull();

    // One placeholder per id (dbx rejects a JS array in IN()), dealer-scoped.
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("FROM post_share_events");
    expect(queries[0].sql).toContain(
      "WHERE dealer = {:dealer} AND post IN ({:post0}, {:post1})",
    );
    expect(queries[0].params).toEqual({
      dealer: "dealer-1",
      post0: "post-1",
      post1: "post-2",
    });
    expect(Object.values(queries[0].params).some(Array.isArray)).toBe(false);
  });

  it("keeps listing when the share read fails, with every summary null", () => {
    const { result, errors } = runList([], { failShareQuery: true });
    expect(result.status).toBe(200);
    const items = result.payload.items as AnyRecord[];
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.share_summary === null)).toBe(true);
    expect(errors).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Client: services/posts.ts
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("recordPostShared", () => {
  it("POSTs only the channel and method to the owner-scoped route", async () => {
    setActiveAuthEpoch(701);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "post/1",
        channel: "facebook_feed",
        via: "share_sheet",
        shared_at: "2026-09-23 12:00:00.000Z",
        deduplicated: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const recorded = await recordPostShared("post/1", {
      channel: "facebook_feed",
      via: "share_sheet",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/app/posts/post%2F1/shared");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      channel: "facebook_feed",
      via: "share_sheet",
    });
    expect(recorded).toMatchObject({ channel: "facebook_feed", deduplicated: false });
  });

  it("surfaces a locked post as an error instead of a recorded share", async () => {
    setActiveAuthEpoch(702);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "APPROVAL_REQUIRED",
            code: "APPROVAL_REQUIRED",
            message: "This post is waiting for a manager's approval.",
          },
          409,
        ),
      ),
    );
    await expect(
      recordPostShared("post-1", { channel: "facebook_feed", via: "download" }),
    ).rejects.toBeTruthy();
  });
});

describe("share_summary client projection", () => {
  const record = (overrides: Partial<PostRecord> = {}): PostRecord => ({
    id: "post-1",
    dealer: "dealer-1",
    generated_at: "2026-09-22 10:00:00.000Z",
    salesperson_name: "Joe Gallant",
    caption: "Fresh arrivals on the lot this week!",
    approval_status: "n_a",
    ...overrides,
  });

  it("normalizes the server summary and keeps an older backend's absence absent", () => {
    expect(projectShareSummary(undefined)).toBeUndefined();
    expect(projectShareSummary(null)).toBeNull();
    expect(projectShareSummary({ count: 0 })).toBeNull();
    expect(
      projectShareSummary({ count: 2, last_channel: "x", last_via: "fax" }),
    ).toBeNull();
    expect(
      projectShareSummary({
        count: 2,
        last_shared_at: "2026-09-22 09:00:00.000Z",
        last_channel: "facebook_feed",
        last_via: "share_sheet",
        channels: ["facebook_feed", 7, "facebook_feed", "instagram_feed"],
      }),
    ).toEqual({
      count: 2,
      last_shared_at: "2026-09-22 09:00:00.000Z",
      last_channel: "facebook_feed",
      last_via: "share_sheet",
      channels: ["facebook_feed", "instagram_feed"],
    });

    expect("share_summary" in projectPostRecordForUi(record())).toBe(false);
    expect(
      projectPostRecordForUi(record({ share_summary: null })).share_summary,
    ).toBeNull();
  });

  it("reads as shared in My work once projected from the list", async () => {
    setActiveAuthEpoch(703);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            record({
              share_summary: {
                count: 1,
                last_shared_at: "2026-09-22 09:00:00.000Z",
                last_channel: "facebook_feed",
                last_via: "share_sheet",
                channels: ["facebook_feed"],
              },
            }),
            record({ id: "post-2", share_summary: null }),
            record({
              id: "post-3",
              approval_status: "pending",
              share_summary: {
                count: 1,
                last_shared_at: "2026-09-22 09:00:00.000Z",
                last_channel: "facebook_feed",
                last_via: "copy",
                channels: ["facebook_feed"],
              },
            }),
          ],
        }),
      ),
    );
    const page = await listPostsPage({ limit: 3 });
    expect(page.items.map(postStatusFor)).toEqual(["shared", "draft", "waiting"]);
    expect(page.items[0].share_summary?.last_channel).toBe("facebook_feed");
  });
});
