/// <reference path="../pb_data/types.d.ts" />
/**
 * A 1080/1200px social JPEG should remain comfortably below 8 MB. Tighten the
 * old 20 MB ceiling so a compromised personal code cannot multiply oversized
 * files into a Fly-volume exhaustion incident.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const field = posts.schema.getFieldByName("creative_image");
    if (!field) throw new Error("posts.creative_image is missing");
    field.options.maxSize = 8 * 1024 * 1024;
    dao.saveCollection(posts);
  },
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const field = posts.schema.getFieldByName("creative_image");
    if (!field) return;
    field.options.maxSize = 20 * 1024 * 1024;
    dao.saveCollection(posts);
  },
);
