/**
 * A server write must either leave `posts.updated` alone or hand the editor the
 * new revision, or the editor's next draft save / share receipt is rejected as
 * stale. These run the real route source against fakes of the PocketBase
 * runtime (the same pattern as postShareEvents.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { fakeCollection, fieldsOf } from "../test/fakePocketBaseSchema";

type AnyRecord = Record<string, unknown>;
type RouteResult = { status: number; payload: AnyRecord };

const hookSource = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

const routeSource = (start: string): string => {
  const from = hookSource.indexOf(start);
  expect(from, `route ${start} exists`).toBeGreaterThan(-1);
  const to = hookSource.indexOf("routerAdd(", from + 20);
  expect(to).toBeGreaterThan(from);
  return hookSource.slice(from, to);
};

const fakePost = (values: AnyRecord) => {
  const record = {
    id: "post-1",
    getString: (field: string) => (values[field] ?? "").toString(),
    getBool: (field: string) => values[field] === true,
    get: (field: string) => values[field],
    set: (field: string, value: unknown) => {
      values[field] = value;
    },
  };
  return record;
};

const dealer = { id: "dealer-1" };

const runRoute = (
  start: string,
  post: ReturnType<typeof fakePost>,
  options: { role?: string; onSave?: () => void; body?: AnyRecord } = {},
) => {
  let handler: ((c: unknown) => RouteResult) | undefined;
  const saved: unknown[] = [];
  const queries: Array<{ sql: string; params: AnyRecord }> = [];
  const dao = {
    findRecordById: () => post,
    saveRecord: (record: unknown) => {
      options.onSave?.();
      saved.push(record);
    },
    db: () => ({
      newQuery: (sql: string) => ({
        bind: (params: AnyRecord) => ({
          execute: () => {
            queries.push({ sql, params });
            return { rowsAffected: () => 1 };
          },
        }),
      }),
    }),
    runInTransaction: (fn: (tx: unknown) => unknown) => fn(dao),
  };
  runInNewContext(routeSource(start), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    $apis: { requestInfo: () => ({ data: options.body || {} }) },
    require: (path: string) => {
      if (path.endsWith("/postWorkspace.js"))
        return { assertActive: () => {}, respond: () => false };
      if (path.endsWith("/helpers.js")) {
        return {
          sessionContext: () => ({
            dealer,
            role: options.role || "salesperson",
            person: { id: "person-1" },
          }),
          readSessionToken: () => "session-token",
          hashSessionToken: () => "owner-hash",
          isAuthoritativePostPerson: () => false,
          assertString: (val: unknown, maxLength = 1024) => {
            if (typeof val !== "string") throw new Error("Expected a string");
            if (val.length > maxLength)
              throw new Error("String exceeds maximum length");
            return val;
          },
        };
      }
      if (path.endsWith("/requestPolicies.js")) {
        return {
          postImageReviewRequired: () => false,
          geminiModelPolicySnapshot: () => ({ version: 5 }),
        };
      }
      if (path.endsWith("/websitePublications.js")) {
        return {
          findPublicationForPost: () => null,
          publicationSummaryForPost: () => ({ status: "not_configured" }),
          acquirePostWriteFence: (tx: typeof dao, postId: string) => {
            const result = tx
              .db()
              .newQuery("UPDATE posts SET updated = updated WHERE id = {:post}")
              .bind({ post: postId })
              .execute();
            if (!result || result.rowsAffected() !== 1)
              throw new Error("source_post_missing");
          },
        };
      }
      throw new Error("unexpected require " + path);
    },
    $app: {
      dao: () => dao,
    },
    console: { error: vi.fn(), log: vi.fn() },
  });
  expect(handler).toBeTypeOf("function");
  const result = handler!({
    pathParam: () => "post-1",
    response: () => ({ header: () => ({ set: vi.fn() }) }),
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
  return { result, saved, queries };
};

describe("revisions on non-draft writes", () => {
  it("video-generated marks the flag without rewriting the post or moving its revision", () => {
    const values: AnyRecord = {
      dealer: "dealer-1",
      owner_session_hash: "owner-hash",
      has_video: false,
      caption: "Saved by another tab after this record was read.",
      updated: "2026-10-05 10:00:00.000Z",
    };
    const { result, saved, queries } = runRoute(
      'routerAdd("POST", "/api/app/posts/:id/video-generated"',
      fakePost(values),
    );
    // No whole-record save: that would write every column back and advance
    // posts.updated, rejecting an autosave already in flight.
    expect(saved).toHaveLength(0);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /^UPDATE posts SET has_video = 1 WHERE id = \{:post\}/,
    );
    expect(queries[0].sql).not.toMatch(/updated|caption/);
    expect(queries[0].params).toEqual({ post: "post-1", dealer: "dealer-1" });
    expect(values.updated).toBe("2026-10-05 10:00:00.000Z");
    // No revision is returned: this route never checked the caller's token,
    // so an editor must not adopt one from it.
    expect(result).toEqual({ status: 200, payload: { id: "post-1", has_video: true } });
  });

  it("video-generated is a no-op once the flag is set", () => {
    const { result, saved, queries } = runRoute(
      'routerAdd("POST", "/api/app/posts/:id/video-generated"',
      fakePost({
        dealer: "dealer-1",
        owner_session_hash: "owner-hash",
        has_video: true,
        updated: "2026-10-05 10:00:00.000Z",
      }),
    );
    expect(saved).toHaveLength(0);
    expect(queries).toHaveLength(0);
    expect(result).toEqual({ status: 200, payload: { id: "post-1", has_video: true } });
  });

  it("schedule writes only scheduled_for and does not rewrite the post or move its revision", () => {
    const values: AnyRecord = {
      dealer: "dealer-1",
      owner_session_hash: "owner-hash",
      caption: "Saved by another tab after this record was read.",
      approval_status: "approved",
      updated: "2026-10-05 10:00:00.000Z",
    };
    const when = "2026-10-20T15:00:00.000Z";
    const { result, saved, queries } = runRoute(
      'routerAdd("POST", "/api/app/posts/:id/schedule"',
      fakePost(values),
      { body: { scheduled_for: when } },
    );
    expect(saved).toHaveLength(0);
    const schedule = queries.find((query) => query.sql.includes("scheduled_for"));
    expect(schedule?.sql).toMatch(
      /^UPDATE posts SET scheduled_for = \{:scheduledFor\} WHERE id = \{:post\}/,
    );
    expect(schedule?.sql).not.toMatch(/updated|caption|approval_status|has_video/);
    expect(schedule?.params).toEqual({
      scheduledFor: when,
      post: "post-1",
      dealer: "dealer-1",
    });
    expect(values.caption).toBe("Saved by another tab after this record was read.");
    expect(values.updated).toBe("2026-10-05 10:00:00.000Z");
    expect(values.scheduled_for).toBeUndefined();
    expect(result).toEqual({
      status: 200,
      payload: { id: "post-1", scheduled_for: when },
    });
  });

  it("adds the scheduled_for column the route updates", () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1791900000_post_scheduled_for.js"),
      "utf8",
    );
    let up: ((db: unknown) => void) | undefined;
    let down: ((db: unknown) => void) | undefined;
    runInNewContext(source, {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      SchemaField: function SchemaField(definition: AnyRecord) {
        return definition;
      },
    });
    const posts = Object.assign(fakeCollection([{ name: "caption", type: "text" }]), {
      name: "posts",
    });
    const saved: unknown[] = [];
    const dao = {
      findCollectionByNameOrId: () => posts,
      saveCollection: (collection: unknown) => {
        saved.push(collection);
      },
    };
    up!(dao);
    const added = fieldsOf(posts.schema).find(
      (field) => field.name === "scheduled_for",
    );
    expect(added).toMatchObject({
      type: "text",
      required: false,
      options: { max: 40 },
    });
    expect(saved).toEqual([posts]);
    down!(dao);
    expect(fieldsOf(posts.schema).map((field) => field.name)).toEqual(["caption"]);
  });

  it("the approval status poll carries the revision a manager decision produced", () => {
    const post = fakePost({
      dealer: "dealer-1",
      owner_session_hash: "owner-hash",
      approval_status: "approved",
      approved_by: "Pat Manager",
      approved_at: "2026-10-05 11:00:00.000Z",
      updated: "2026-10-05 11:00:00.000Z",
    });
    const { result } = runRoute('routerAdd("GET", "/api/app/posts/:id/status"', post);
    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({
      id: "post-1",
      approval_status: "approved",
      post_revision: "2026-10-05 11:00:00.000Z",
    });
  });
});
