/// <reference path="../pb_data/types.d.ts" />
/**
 * Persist the salesperson's platform delivery intent.
 *
 * Legacy posts have an empty value and reopen as photo-only. Keeping this as a
 * constrained select prevents arbitrary client metadata from being stored
 * alongside customer creatives.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    if (!posts.schema.getFieldByName("media_output_mode")) {
      posts.schema.addField(
        new SchemaField({
          name: "media_output_mode",
          type: "select",
          required: false,
          options: {
            maxSelect: 1,
            values: ["photo", "video", "both"],
          },
        }),
      );
    }

    // Existing databases already have these constrained fields. Extend their
    // enums before a 4:5 feed post can be saved.
    const primaryFormat = posts.schema.getFieldByName("primary_format_id");
    if (!primaryFormat) throw new Error("posts.primary_format_id field not found");
    primaryFormat.options = primaryFormat.options || {};
    primaryFormat.options.maxSelect = 1;
    const primaryValues = Array.from(primaryFormat.options.values || []);
    if (primaryValues.indexOf("feed_portrait") === -1) {
      primaryValues.unshift("feed_portrait");
    }
    primaryFormat.options.values = primaryValues;

    const aspectRatio = posts.schema.getFieldByName("image_aspect_ratio");
    if (!aspectRatio) throw new Error("posts.image_aspect_ratio field not found");
    aspectRatio.options = aspectRatio.options || {};
    aspectRatio.options.maxSelect = 1;
    const aspectValues = Array.from(aspectRatio.options.values || []);
    if (aspectValues.indexOf("4:5") === -1) aspectValues.splice(1, 0, "4:5");
    aspectRatio.options.values = aspectValues;

    dao.saveCollection(posts);
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;
    posts.schema = Array.from(posts.schema).filter(
      (field) => field.name !== "media_output_mode",
    );
    dao.saveCollection(posts);
  },
);
