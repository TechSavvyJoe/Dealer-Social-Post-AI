/// <reference path="../pb_data/types.d.ts" />
/**
 * Separate current server-derived post ownership from legacy display
 * attribution. Older clients could submit salesperson_id, so those rows cannot
 * authorize cross-session reads or writes merely because the displayed id
 * matches the current person.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    if (!posts.schema.getFieldByName("owner_person_id")) {
      posts.schema.addField(
        new SchemaField({
          name: "owner_person_id",
          type: "text",
          required: false,
          options: { max: 64 },
        }),
      );
    }
    if (!posts.schema.getFieldByName("attribution_authoritative")) {
      posts.schema.addField(
        new SchemaField({
          name: "attribution_authoritative",
          type: "bool",
          required: false,
          options: {},
        }),
      );
    }
    dao.saveCollection(posts);

    // Intentionally no legacy backfill: historical salesperson_id values were
    // client-selectable and therefore cannot become an authorization grant.
    db.newQuery(
      "CREATE INDEX IF NOT EXISTS `idx_posts_authoritative_owner_history` " +
        "ON `posts` (`dealer`, `attribution_authoritative`, `owner_person_id`, `generated_at` DESC)",
    ).execute();
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;
    posts.schema = Array.from(posts.schema).filter(
      (field) =>
        field.name !== "owner_person_id" && field.name !== "attribution_authoritative",
    );
    dao.saveCollection(posts);
    db.newQuery(
      "DROP INDEX IF EXISTS `idx_posts_authoritative_owner_history`",
    ).execute();
  },
);
