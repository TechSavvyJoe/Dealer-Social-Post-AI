/// <reference path="../pb_data/types.d.ts" />
/**
 * Share time stored by POST /api/app/posts/:id/schedule.
 *
 * The route writes this column directly. It was never added to the posts
 * schema, so a record save could not persist it and a column update would
 * fail. 40 characters matches the route's assertString cap.
 */
const POST_SCHEDULE_FIELDS = ["scheduled_for"];

migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    if (!posts.schema.getFieldByName("scheduled_for")) {
      posts.schema.addField(
        new SchemaField({
          name: "scheduled_for",
          type: "text",
          required: false,
          options: { max: 40 },
        }),
      );
    }
    dao.saveCollection(posts);
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_error) {}
    if (!posts) return;
    POST_SCHEDULE_FIELDS.forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
