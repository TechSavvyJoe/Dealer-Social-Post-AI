import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPocketBaseModule } from "../test/loadPocketBaseModule";
import { runInNewContext } from "node:vm";

type Values = Record<string, any>;
class FakeRecord {
  id: string;
  collection: string;
  values: Values;
  constructor(collection: { name: string }, values: Values = {}) {
    this.collection = collection.name;
    this.id = `record-${Math.random().toString(36).slice(2)}`;
    this.values = { ...values };
  }
  getString(key: string) {
    return String(this.values[key] ?? "");
  }
  getBool(key: string) {
    return !!this.values[key];
  }
  get(key: string) {
    return this.values[key];
  }
  set(key: string, value: unknown) {
    this.values[key] = value;
  }
}
const common = (name: string) => loadPocketBaseModule<Values>(name, {});
const realHelpers = common("helpers.js");
const policies = common("requestPolicies.js");
const website = common("websitePublications.js");
const makePost = (id: string, values: Values = {}) => {
  const record = new FakeRecord(
    { name: "posts" },
    {
      dealer: "dealer-1",
      owner_person_id: "author-1",
      attribution_authoritative: true,
      salesperson_name: "Team Member",
      generated_at: "2026-10-12 10:00:00.000Z",
      updated: "2026-10-12 10:00:00.000Z",
      approval_status: "n_a",
      caption: "A vehicle is ready for the road.",
      creative_image: "image.jpg",
      image_attempt_id: "image-attempt",
      model_policy_version: policies.geminiModelPolicySnapshot().version,
      ...values,
    },
  );
  record.id = id;
  return record;
};
function harness(posts: FakeRecord[] = [makePost("post-1")]) {
  const tables: Record<string, FakeRecord[]> = {
    posts,
    post_workspace_state: [],
    post_workspace_events: [],
  };
  const context: Values = {
    dealer: new FakeRecord(
      { name: "dealers" },
      { name: "Test Motors", oem_affiliation: "Ford" },
    ),
    person: new FakeRecord({ name: "salespeople" }, { name: "Reviewer" }),
    role: "dealer_admin",
  };
  context.dealer.id = "dealer-1";
  context.person.id = "author-1";
  let body: Values = {};
  let query: Values = {};
  let id = "post-1";
  let failStateRead = false;
  let failAudit = false;
  const queries: Array<{ sql: string; params: Values }> = [];
  const dao: Values = {
    findRecordById: (table: string, key: string) => {
      const record = tables[table]?.find((record) => record.id === key);
      if (!record) throw new Error("not found");
      return record;
    },
    findCollectionByNameOrId: (name: string) => ({ name }),
    findRecordsByFilter: (
      table: string,
      _filter: string,
      sort: string,
      limit: number,
      offset: number,
      params: Values,
    ) => {
      if (table === "post_workspace_state" && failStateRead)
        throw new Error("state unavailable");
      let rows = [...(tables[table] || [])];
      if (params?.dealer)
        rows = rows.filter((row) => row.getString("dealer") === params.dealer);
      if (params?.person)
        rows = rows.filter(
          (row) =>
            row.getBool("attribution_authoritative") &&
            row.getString("owner_person_id") === params.person,
        );
      if (params?.post)
        rows = rows.filter((row) => row.getString("post") === params.post);
      const ids = Object.keys(params || {})
        .filter((key) => /^id\d+$/.test(key))
        .map((key) => params[key]);
      if (ids.length) rows = rows.filter((row) => ids.includes(row.getString("post")));
      if (table === "posts") {
        const field = sort.includes("updated") ? "updated" : "generated_at";
        rows.sort((a, b) => {
          const cmp =
            a.getString(field).localeCompare(b.getString(field)) ||
            a.id.localeCompare(b.id);
          return sort.startsWith("-") ? -cmp : cmp;
        });
      }
      return rows.slice(offset, offset + limit);
    },
    db: () => ({
      newQuery: (sql: string) => ({
        bind: (params: Values) => ({
          execute: () => {
            queries.push({ sql, params });
            return {
              rowsAffected: () =>
                tables.posts.some(
                  (post) =>
                    post.id === params.post &&
                    (!params.dealer || post.getString("dealer") === params.dealer),
                )
                  ? 1
                  : 0,
            };
          },
          all: () => {},
        }),
      }),
    }),
    saveRecord: (record: FakeRecord) => {
      if (record.collection === "post_workspace_events" && failAudit)
        throw new Error("audit unavailable");
      const table = tables[record.collection];
      if (!table.some((row) => row.id === record.id)) table.push(record);
    },
    runInTransaction: (fn: (dao: Values) => unknown) => {
      const before = Object.fromEntries(
        Object.entries(tables).map(([name, records]) => [
          name,
          records.map((record) => ({ record, values: { ...record.values } })),
        ]),
      );
      try {
        return fn(dao);
      } catch (error) {
        for (const [name, records] of Object.entries(before))
          tables[name] = records.map(({ record, values }) => {
            record.values = values;
            return record;
          });
        throw error;
      }
    },
  };
  const globals: Values = {
    __hooks: "/hooks",
    $app: { dao: () => dao },
    $apis: { requestInfo: () => ({ data: body, query }) },
    Record: FakeRecord,
    DynamicModel: function (shape: Values) {
      return shape;
    },
    arrayOf: () => [],
    console: { error: () => {} },
  };
  const cache: Values = {};
  globals.require = (path: string) => {
    const name = path.split("/").pop()!;
    if (name === "helpers.js")
      return {
        ...realHelpers,
        sessionContext: () => context,
        readSessionToken: () => "token",
        hashSessionToken: () => "owner",
        checkProxyRateLimit: () => ({ ok: true }),
      };
    if (name === "requestPolicies.js") return policies;
    if (name === "websitePublications.js")
      return {
        ...website,
        publicationSummariesForDealer: () => ({}),
        publicationSummariesForPosts: (...args: unknown[]) =>
          loadPocketBaseModule<Values>(
            "websitePublications.js",
            globals,
          ).publicationSummariesForPosts(...args),
      };
    return (cache[name] ||= loadPocketBaseModule(name, globals));
  };
  const workspace = globals.require("/hooks/postWorkspace.js");
  let lastResponse: any;
  const c = {
    pathParam: () => id,
    response: () => ({ header: () => ({ set: () => {} }) }),
    json: (status: number, payload: Values) => (lastResponse = { status, payload }),
  };
  return {
    workspace,
    context,
    dao,
    tables,
    posts,
    queries,
    c,
    globals,
    list: (value: Values = {}) => {
      query = value;
      return workspace.list(c, context) || lastResponse;
    },
    detail: (postId = "post-1") => {
      id = postId;
      return workspace.detail(c) || lastResponse;
    },
    mutate: (value: Values, archived = true, bulk = false) => {
      body = value;
      return workspace.mutate(c, archived, bulk) || lastResponse;
    },
    invoke: (handler: (c: unknown) => any) => handler(c) || lastResponse,
    failState: () => {
      failStateRead = true;
    },
    failAudit: () => {
      failAudit = true;
    },
  };
}
const revision = (post: FakeRecord, workspace = 0) => ({
  expected_post_revision: post.getString("updated"),
  expected_workspace_revision: workspace,
});

describe("post workspace authorized search and detail", () => {
  it("searches beyond 50 and 1000, counts all selected filters, and pages matching rows", () => {
    const posts = Array.from({ length: 1007 }, (_, i) =>
      makePost(`post-${String(i).padStart(4, "0")}`, {
        caption:
          i % 2 ? "A rare road-ready vehicle." : "A vehicle is ready for the road.",
        approval_status: i % 3 ? "approved" : "pending",
      }),
    );
    const h = harness(posts);
    const first = h.list({ q: "rare", approval_status: "approved", limit: "2" });
    expect(first.status).toBe(200);
    const expected = posts.filter(
      (p) =>
        p.getString("caption").includes("rare") &&
        p.getString("approval_status") === "approved",
    ).length;
    expect(first.payload.total).toBe(expected);
    expect(first.payload.counts).toEqual({
      n_a: 0,
      pending: 0,
      approved: expected,
      rejected: 0,
    });
    expect(first.payload.items).toHaveLength(2);
    const next = h.list({
      q: "rare",
      approval_status: "approved",
      limit: "2",
      cursor: first.payload.nextCursor,
    });
    expect(next.payload.total).toBe(expected);
    expect(next.payload.items.map((p: Values) => p.id)).not.toEqual(
      first.payload.items.map((p: Values) => p.id),
    );
  });
  it("scopes every batch, count and detail to the session dealer and authoritative author", () => {
    const own = makePost("own"),
      teammate = makePost("teammate", { owner_person_id: "author-2" }),
      foreign = makePost("foreign", { dealer: "dealer-2" }),
      legacy = makePost("legacy", { attribution_authoritative: false });
    const h = harness([own, teammate, foreign, legacy]);
    h.context.role = "salesperson";
    expect(h.list().payload.items.map((p: Values) => p.id)).toEqual(["own"]);
    expect(h.list({ owner_person_id: "author-2" }).payload.total).toBe(0);
    expect(h.detail("teammate").status).toBe(404);
    expect(h.detail("foreign").status).toBe(404);
    h.context.role = "super_admin";
    expect(h.detail("foreign").status).toBe(404);
    expect(h.list().payload.total).toBe(3);
  });
  it("never matches private surname or identity-held copy through total/counts", () => {
    const h = harness([
      makePost("safe", {
        customer_name: "Lisa Sample",
        caption: "Congratulations to Lisa! A vehicle is ready for the road.",
      }),
      makePost("held", {
        customer_name: "Lisa Sample",
        caption:
          "Congratulations to Lisa and Jordan! A rare delivery day for Lisa and Jordan.",
        release_required: true,
        platform_captions: JSON.stringify({
          facebook_feed: "Lisa and Jordan are ready.",
        }),
      }),
    ]);
    expect(h.list({ q: "Sample" }).payload.total).toBe(0);
    expect(h.list({ q: "Jordan" }).payload.total).toBe(0);
    expect(h.list({ q: "rare" }).payload.total).toBe(0);
    expect(h.detail("held").payload.identity_review_required).toBe(true);
    expect(JSON.stringify(h.detail("held").payload)).not.toContain("Jordan");
  });
  it("includes the whole UTC day for a date-only until filter", () => {
    const h = harness([
      makePost("same-day", { generated_at: "2026-10-12 23:59:59.999Z" }),
      makePost("next-day", { generated_at: "2026-10-13 00:00:00.000Z" }),
    ]);
    expect(
      h
        .list({ since: "2026-10-12", until: "2026-10-12" })
        .payload.items.map((row: Values) => row.id),
    ).toEqual(["same-day"]);
    expect(h.list({ until: "2026-10-12T00:00:00.000Z" }).payload.total).toBe(0);
    const mixed = harness([
      makePost("whole-second", { generated_at: "2026-10-12 23:59:59Z" }),
      makePost("next-instant", { generated_at: "2026-10-13T00:00:00.000Z" }),
    ]);
    expect(
      mixed
        .list({ since: "2026-10-12", until: "2026-10-12" })
        .payload.items.map((row: Values) => row.id),
    ).toEqual(["whole-second"]);
  });
  it("filters dates, actual image availability, generated-video metadata and website state", () => {
    const h = harness([
      makePost("old", { generated_at: "2026-09-01 10:00:00.000Z", creative_image: "" }),
      makePost("video", { has_video: true }),
    ]);
    expect(
      h.list({
        since: "2026-10-01T00:00:00.000Z",
        media: "image",
        website_status: "not_requested",
      }).payload.total,
    ).toBe(1);
    const row = h.list({ media: "video_generated" }).payload.items[0];
    expect(row.id).toBe("video");
    expect(row.video_availability).toBe("unavailable");
    expect(row.video_url).toBeUndefined();
  });
  it.each(["newest_created", "newest_updated", "oldest_created"])(
    "uses stable timestamp/id paging for %s",
    (sort) => {
      const h = harness([makePost("a"), makePost("b"), makePost("c")]);
      const first = h.list({ sort, limit: "1" });
      const next = h.list({ sort, limit: "1", cursor: first.payload.nextCursor });
      expect(next.payload.items).toHaveLength(1);
      expect(next.payload.items[0].id).not.toBe(first.payload.items[0].id);
      expect(
        h.list({
          sort: sort === "oldest_created" ? "newest_updated" : "oldest_created",
          cursor: first.payload.nextCursor,
        }).status,
      ).toBe(400);
    },
  );
  it("pages mixed PB and ISO updated timestamps by instant without changing revision tokens", () => {
    const timestamps: Record<string, string> = {
      a: "2026-10-12T08:00:00.000Z",
      b: "2026-10-12 23:00:00.000Z",
      c: "2026-10-12T23:00:00.000Z",
      d: "2026-10-12 09:00:00.000Z",
    };
    const h = harness([
      ...Object.entries(timestamps).map(([id, updated]) => makePost(id, { updated })),
      ...Array.from({ length: 501 }, (_, i) =>
        makePost(`filler-${i}`, { updated: "2026-10-11T23:00:00.000Z" }),
      ),
    ]);
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result = h.list({ sort: "newest_updated", limit: "1", cursor });
      expect(result.payload.total).toBe(505);
      const item = result.payload.items[0];
      seen.push(item.id);
      expect(item.updated).toBe(timestamps[item.id]);
      cursor = result.payload.nextCursor;
    }
    expect(seen).toEqual(["c", "b", "d", "a"]);
  });
  it.each([
    { q: "x".repeat(121) },
    { sort: "sql injection" },
    { media: "playable" },
    { archived: "deleted" },
    { approval_status: "unknown" },
    { website_status: "facebook_published" },
    { since: "yesterday" },
    { since: "2026-10-12", until: "2026-09-12" },
    { limit: "1001" },
    { cursor: "bad" },
  ])("rejects invalid filter %j", (query) => {
    expect(harness().list(query).status).toBe(400);
  });
  it("fails closed when filing state cannot be read", () => {
    const h = harness();
    h.failState();
    expect(h.list().status).toBe(500);
    expect(h.detail().status).toBe(500);
  });
});
describe("post workspace filing CAS", () => {
  it("archives and restores without changing creative revision, approval, consent or media", () => {
    const h = harness();
    const before = { ...h.posts[0].values };
    const archived = h.mutate(revision(h.posts[0]));
    expect(archived.status).toBe(200);
    expect(archived.payload.workspace_revision).toBe(1);
    expect(archived.payload.archived).toBe(true);
    expect(h.posts[0].values).toEqual(before);
    expect(h.list().payload.total).toBe(0);
    expect(h.list({ archived: "archived" }).payload.total).toBe(1);
    expect(h.detail().payload.archived).toBe(true);
    expect(() => h.workspace.assertActive(h.dao, "post-1")).toThrow("Restore");
    const restored = h.mutate(revision(h.posts[0], 1), false);
    expect(restored.payload.workspace_revision).toBe(2);
    expect(restored.payload.archived).toBe(false);
    expect(h.posts[0].values).toEqual(before);
    expect(h.tables.post_workspace_events.map((r) => r.getString("action"))).toEqual([
      "archive",
      "restore",
    ]);
  });
  it("requires both revisions, allows explicit workspace0, and rejects stale tokens", () => {
    const h = harness();
    expect(
      h.mutate({ expected_post_revision: h.posts[0].getString("updated") }).status,
    ).toBe(400);
    expect(
      h.mutate({ ...revision(h.posts[0]), expected_workspace_revision: "0" }).status,
    ).toBe(400);
    expect(
      h.mutate({ ...revision(h.posts[0]), expected_post_revision: "stale" }).status,
    ).toBe(409);
    expect(h.mutate(revision(h.posts[0])).status).toBe(200);
    expect(h.mutate(revision(h.posts[0]), false).status).toBe(409);
    expect(h.tables.post_workspace_events).toHaveLength(1);
  });
  it("allows manager filing teammates but rejects foreign IDs and salesperson legacy attribution", () => {
    const teammate = makePost("post-1", { owner_person_id: "author-2" });
    const h = harness([teammate]);
    expect(h.mutate(revision(teammate)).status).toBe(200);
    h.context.role = "salesperson";
    expect(h.mutate(revision(teammate, 1), false).status).toBe(404);
    h.context.role = "super_admin";
    h.context.dealer.id = "dealer-2";
    expect(h.mutate(revision(teammate, 1), false).status).toBe(404);
    const legacy = makePost("post-1", { attribution_authoritative: false });
    const other = harness([legacy]);
    other.context.role = "salesperson";
    expect(other.mutate(revision(legacy)).status).toBe(404);
  });
  it("rolls back filing state when audit persistence fails", () => {
    const h = harness();
    h.failAudit();
    expect(h.mutate(revision(h.posts[0])).status).toBe(500);
    expect(h.tables.post_workspace_state).toHaveLength(0);
    expect(h.posts[0].getString("updated")).toBe(
      revision(h.posts[0]).expected_post_revision,
    );
  });
  it("returns bounded independent bulk success/conflict/not-found outcomes", () => {
    const posts = [
      makePost("a"),
      makePost("b"),
      makePost("foreign", { dealer: "dealer-2" }),
    ];
    const h = harness(posts);
    const result = h.mutate(
      {
        items: [
          { id: "a", ...revision(posts[0]) },
          { id: "b", ...revision(posts[1]), expected_post_revision: "stale" },
          { id: "foreign", ...revision(posts[2]) },
        ],
      },
      true,
      true,
    );
    expect(result.status).toBe(200);
    expect(result.payload.results.map((r: Values) => r.ok)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.payload.results.map((r: Values) => r.status)).toEqual([
      undefined,
      409,
      404,
    ]);
    expect(h.tables.post_workspace_events).toHaveLength(1);
    expect(
      h.mutate(
        {
          items: [
            { id: "a", ...revision(posts[0], 1) },
            { id: "a", ...revision(posts[0], 1) },
          ],
        },
        true,
        true,
      ).status,
    ).toBe(400);
    expect(
      h.mutate(
        {
          items: Array.from({ length: 51 }, (_, i) => ({
            id: `id-${i}`,
            ...revision(posts[0]),
          })),
        },
        true,
        true,
      ).status,
    ).toBe(400);
  });
});
describe("workspace migration and archived write boundaries", () => {
  it("locks state/audit REST rules and preserves post schema/files", () => {
    const created: Values[] = [];
    const dao = {
      findCollectionByNameOrId: (name: string) => {
        if (["posts", "dealers"].includes(name)) return { id: name };
        throw Error("missing");
      },
      saveCollection: (collection: Values) => created.push(collection),
    };
    runInNewContext(
      readFileSync(
        resolve(process.cwd(), "pb_migrations/1791800000_post_workspace.js"),
        "utf8",
      ),
      {
        migrate: (up: (db: unknown) => void) => up({}),
        Dao: function () {
          return dao;
        },
        Collection: function (definition: Values) {
          return definition;
        },
      },
    );
    expect(created).toHaveLength(2);
    for (const collection of created)
      for (const rule of [
        "listRule",
        "viewRule",
        "createRule",
        "updateRule",
        "deleteRule",
      ])
        expect(collection[rule]).toBeNull();
    expect(created[0].indexes.join(" ")).toContain("UNIQUE");
  });
  it("guards transaction writes and leaves the existing outbox worker able to complete", () => {
    const hooks = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const website = readFileSync(
      resolve(process.cwd(), "pb_hooks/websitePublications.js"),
      "utf8",
    );
    expect(hooks).toContain(".assertActive(txDao, current.id)");
    expect(hooks).toContain("ws.archived = 1");
    expect(
      website.slice(
        website.indexOf("function claimPublicationForPost"),
        website.indexOf("function reconcilePublicationForPost"),
      ),
    ).toContain("assertActive(txDao, post.id)");
    expect(
      website.slice(
        website.indexOf("function retryPublication(post)"),
        website.indexOf("function testWebsiteDraft"),
      ),
    ).toContain("assertActive(tx, post.id)");
    expect(
      website.slice(
        website.indexOf("function processDuePublications"),
        website.indexOf("function retryPublicationWithDao"),
      ),
    ).not.toContain("assertActive");
  });
});

describe("archived existing write handlers", () => {
  it.each([
    ["PATCH", "/api/app/posts/:id/draft"],
    ["PATCH", "/api/app/posts/:id"],
    ["POST", "/api/app/posts/:id/shared"],
    ["POST", "/api/app/posts/:id/schedule"],
    ["POST", "/api/app/posts/:id/video-generated"],
    ["POST", "/api/app/posts/:id/website-publication"],
    ["POST", "/api/app/posts/:id/website-publication/retry"],
  ])("rejects %s %s before any post-bound operation", (method, path) => {
    const h = harness();
    h.mutate(revision(h.posts[0]));
    const before = { ...h.posts[0].values };
    const source = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const start = source.indexOf(`routerAdd("${method}", "${path}"`);
    const end = source.indexOf("routerAdd(", start + 20);
    let handler: any;
    runInNewContext(source.slice(start, end), {
      ...h.globals,
      cronAdd: () => {},
      routerAdd: (_method: string, _path: string, fn: any) => {
        handler = fn;
      },
    });
    const result = h.invoke(handler);
    expect(result.status).toBe(409);
    expect(result.payload.code).toBe("POST_ARCHIVED");
    expect(h.posts[0].values).toEqual(before);
  });
});
