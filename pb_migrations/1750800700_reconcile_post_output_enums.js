migrate(
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_error) {}
    if (!posts) return;

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
    if (aspectValues.indexOf("4:5") === -1) {
      const squareIndex = aspectValues.indexOf("1:1");
      aspectValues.splice(squareIndex >= 0 ? squareIndex + 1 : 0, 0, "4:5");
    }
    aspectRatio.options.values = aspectValues;

    dao.saveCollection(posts);
  },
  (_db) => {
    // Forward compatibility repair: do not remove enum values that saved posts
    // may already reference during a migration rollback.
  },
);
