/// <reference path="../pb_data/types.d.ts" />
/**
 * Persist the destination mix and generated master-canvas profile on posts.
 *
 * These fields let a salesperson reopen an older creative and keep the exact
 * export/share sizing selected when it was generated. Platform ids are stored
 * as a compact JSON string because PocketBase 0.22's text field behavior is
 * stable across both the JSVM RecordUpsertForm and direct DAO reads.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const ensure = (name, field) => {
      if (!posts.schema.getFieldByName(name)) {
        posts.schema.addField(new SchemaField(field));
      }
    };

    ensure("platform_ids", {
      name: "platform_ids",
      type: "text",
      required: false,
      options: { max: 400 },
    });
    ensure("primary_format_id", {
      name: "primary_format_id",
      type: "select",
      required: false,
      options: {
        maxSelect: 1,
        values: [
          "feed_portrait",
          "feed_square",
          "story_vertical",
          "marketplace",
          "gbp",
        ],
      },
    });
    ensure("image_aspect_ratio", {
      name: "image_aspect_ratio",
      type: "select",
      required: false,
      options: {
        maxSelect: 1,
        values: ["1:1", "4:5", "9:16", "16:9", "4:3"],
      },
    });
    dao.saveCollection(posts);
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;

    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on
    // PocketBase 0.22 (reports "Applied", column stays). `removeField` takes
    // the field id, not its name.
    ["platform_ids", "primary_format_id", "image_aspect_ratio"].forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
