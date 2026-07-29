import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logPost } from "../services/posts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("post output-profile persistence", () => {
  it("adds and removes the PocketBase 0.22 schema fields", () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750800000_persist_post_output_profile.js"),
      "utf8",
    );

    type MigrationHandler = (db: unknown) => unknown;
    let up: MigrationHandler | undefined;
    let down: MigrationHandler | undefined;
    const fields: Array<Record<string, unknown>> = [];
    const schema = {
      getFieldByName: (name: string) =>
        fields.find((field) => field.name === name) || null,
      addField: (field: Record<string, unknown>) => fields.push(field),
      *[Symbol.iterator]() {
        yield* fields;
      },
    };
    const posts: { schema: unknown } = { schema };
    const saveCollection = vi.fn();
    const dao = {
      findCollectionByNameOrId: vi.fn(() => posts),
      saveCollection,
    };

    runInNewContext(source, {
      migrate: (apply: MigrationHandler, rollback: MigrationHandler) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao() {
        return dao;
      },
      SchemaField: class SchemaField {
        constructor(definition: Record<string, unknown>) {
          Object.assign(this, definition);
        }
      },
    });

    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    up?.(dao);

    expect(fields.map((field) => field.name)).toEqual([
      "platform_ids",
      "primary_format_id",
      "image_aspect_ratio",
    ]);
    expect(fields[0]).toMatchObject({
      type: "text",
      options: { max: 400 },
    });
    expect(fields[1]).toMatchObject({
      type: "select",
      options: {
        maxSelect: 1,
        values: ["feed_square", "story_vertical", "marketplace", "gbp"],
      },
    });
    expect(fields[2]).toMatchObject({
      type: "select",
      options: {
        maxSelect: 1,
        values: ["1:1", "9:16", "16:9", "4:3"],
      },
    });

    down?.(dao);
    expect(posts.schema).toEqual([]);
    expect(saveCollection).toHaveBeenCalledTimes(2);
  });

  it("sends the selected destinations and exact master canvas with the creative", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("data:image/")) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        request = init;
        return new Response(
          JSON.stringify({
            id: "post-profile-1",
            dealer: "dealer-1",
            generated_at: "2026-07-28T12:00:00.000Z",
            approval_status: "n_a",
            platform_ids: ["instagram_story", "tiktok"],
            primary_format_id: "story_vertical",
            image_aspect_ratio: "9:16",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await logPost({
      caption: "Delivery day",
      imageDataUrl: "data:image/png;base64,AQID",
      platformIds: ["instagram_story", "tiktok"],
      platformCaptions: {
        instagram_story: "Vertical delivery caption",
        tiktok: "Short video caption",
      },
      primaryFormatId: "story_vertical",
      imageAspectRatio: "9:16",
    });

    const form = request?.body as FormData;
    expect(JSON.parse(String(form.get("platform_ids")))).toEqual([
      "instagram_story",
      "tiktok",
    ]);
    expect(JSON.parse(String(form.get("platform_captions")))).toEqual({
      instagram_story: "Vertical delivery caption",
      tiktok: "Short video caption",
    });
    expect(form.get("primary_format_id")).toBe("story_vertical");
    expect(form.get("image_aspect_ratio")).toBe("9:16");
    expect(result).toMatchObject({
      platform_ids: ["instagram_story", "tiktok"],
      primary_format_id: "story_vertical",
      image_aspect_ratio: "9:16",
    });
  });

  it("validates server allowlists and returns only no-store history metadata", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const postStart = hook.indexOf('routerAdd("POST", "/api/app/posts"');
    const postEnd = hook.indexOf(
      'routerAdd("POST", "/api/app/posts/:id/video-generated"',
      postStart,
    );
    const postRoute = hook.slice(postStart, postEnd);
    const listStart = hook.indexOf('routerAdd("GET", "/api/app/posts"');
    const listEnd = hook.indexOf('routerAdd("PATCH", "/api/app/posts/:id"', listStart);
    const listRoute = hook.slice(listStart, listEnd);

    for (const platform of [
      "instagram_feed",
      "instagram_story",
      "facebook_feed",
      "tiktok",
      "gbp",
      "marketplace",
      "linkedin",
      "x_twitter",
      "native_share",
    ]) {
      expect(postRoute).toContain(`"${platform}"`);
    }
    expect(postRoute).toContain("allowedPrimaryFormatIds.indexOf(primaryFormatId)");
    expect(postRoute).toContain("allowedImageAspectRatios.indexOf(imageAspectRatio)");
    expect(postRoute).toContain(
      "expectedAspectByFormat[primaryFormatId] !== imageAspectRatio",
    );
    expect(postRoute).toContain("platform_ids: JSON.stringify(platformIds)");
    expect(postRoute).toContain("platform_captions: parsedPlatformCaptions.serialized");
    expect(postRoute).toContain("helpers.resolvePostScenarioPolicy");
    expect(postRoute).toContain('error: "Invalid post scenario"');
    expect(postRoute).toContain('"Cache-Control", "private, no-store"');

    expect(listRoute).toContain("platform_ids: platformIds");
    expect(listRoute).toContain("platform_captions: parsedPlatformCaptions.ok");
    expect(listRoute).toContain("caption_source:");
    expect(listRoute).toContain('primary_format_id: r.getString("primary_format_id")');
    expect(listRoute).toContain(
      'image_aspect_ratio: r.getString("image_aspect_ratio")',
    );
    expect(listRoute).toContain('"Cache-Control", "private, no-store"');
  });

  it("restores the saved output profile when History reopens a creative", () => {
    const history = readFileSync(
      resolve(process.cwd(), "components/PostHistory.tsx"),
      "utf8",
    );

    expect(history).toContain("platformIds:");
    expect(history).toContain("post.platform_ids");
    expect(history).toContain("post.platform_captions");
    expect(history).toContain("captionSource: post.caption_source");
    expect(history).toContain('post.caption_source === "basic_fallback"');
    expect(history).toContain("primaryFormatId: post.primary_format_id");
    expect(history).toContain("imageAspectRatio: post.image_aspect_ratio");
  });

  it("adds the forward release and platform-caption fields without editing the applied profile migration", () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750800100_persist_post_release_state.js"),
      "utf8",
    );
    expect(source).toContain('ensure("scenario_id"');
    expect(source).toContain('ensure("release_required"');
    expect(source).toContain('ensure("release_status"');
    expect(source).toContain('ensure("platform_captions"');
    expect(source).toContain("UPDATE posts SET");
    expect(source).toContain("OR approval_status = 'pending'");
    expect(source).not.toContain("findRecordsByFilter(");
    expect(source).toContain("{},");
  });

  it("keeps legacy display attribution from becoming a post authorization grant", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1750800300_authoritative_post_ownership.js",
      ),
      "utf8",
    );
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");

    expect(source).toContain('name: "owner_person_id"');
    expect(source).toContain('name: "attribution_authoritative"');
    expect(source).toContain("Intentionally no legacy backfill");
    expect(helpers).toContain(
      'context.person.id === record.getString("owner_person_id")',
    );
    expect(helpers).not.toContain(
      'context.person.id === record.getString("salesperson_id")',
    );
    expect(hook).toContain("helpers.isAuthoritativePostPerson(context, record)");
  });
});
