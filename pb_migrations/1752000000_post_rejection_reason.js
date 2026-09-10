/// <reference path="../pb_data/types.d.ts" />
/**
 * Why a manager rejected a post.
 *
 * The approval gate could reject but never explain: PATCH /api/app/posts/:id
 * wrote only approval_status and approved_by, and the salesperson's result
 * screen said "create another post with the requested changes" while no
 * requested changes were ever transmitted. On a lot that means guessing, or a
 * phone call, or the same post resubmitted unchanged.
 *
 * 280 characters is deliberate: it is a note to a colleague standing in a
 * showroom, not a case file, and it matches the cap already used for the
 * team-member disclosure text.
 *
 * Down uses removeField(field.id). The
 * `schema = Array.from(schema).filter(...)` idiom used by the older migrations
 * in this directory is a SILENT NO-OP on PocketBase 0.22 — the CLI prints
 * "Applied" and the column stays. Verified against 0.22.55 on real data.
 */
const POST_REJECTION_FIELDS = ["rejection_reason"];

migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    if (!posts.schema.getFieldByName("rejection_reason")) {
      posts.schema.addField(
        new SchemaField({
          name: "rejection_reason",
          type: "text",
          required: false,
          options: { max: 280 },
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
    POST_REJECTION_FIELDS.forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
