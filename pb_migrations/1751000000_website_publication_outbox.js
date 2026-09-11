/// <reference path="../pb_data/types.d.ts" />
/**
 * Durable, tenant-bound delivery queue for private Customer Hub drafts.
 *
 * The protected customer release remains in PocketBase and is never copied to
 * this collection. Each queue row stores only delivery state and a stable
 * idempotency identity; the immutable website copy and final creative stay on
 * the related post until the worker builds the signed request.
 */
const POST_WEBSITE_FIELDS = ["website_draft"];

migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const dealers = dao.findCollectionByNameOrId("dealers");

    if (!posts.schema.getFieldByName("website_draft")) {
      posts.schema.addField(
        new SchemaField({
          name: "website_draft",
          type: "text",
          required: false,
          options: { max: 16000 },
        }),
      );
      dao.saveCollection(posts);
    }

    let existing = null;
    try {
      existing = dao.findCollectionByNameOrId("website_publications");
    } catch (_e) {}
    if (existing) return;

    const publications = new Collection({
      name: "website_publications",
      type: "base",
      system: false,
      schema: [
        {
          name: "post",
          type: "relation",
          required: true,
          options: {
            collectionId: posts.id,
            cascadeDelete: true,
            maxSelect: 1,
            minSelect: 1,
          },
        },
        {
          name: "dealer",
          type: "relation",
          required: true,
          options: {
            collectionId: dealers.id,
            cascadeDelete: true,
            maxSelect: 1,
            minSelect: 1,
          },
        },
        {
          name: "destination_id",
          type: "text",
          required: true,
          options: { min: 1, max: 80, pattern: "^[a-z0-9_-]+$" },
        },
        {
          name: "event_id",
          type: "text",
          required: true,
          options: { min: 24, max: 80, pattern: "^[A-Za-z0-9_-]+$" },
        },
        {
          name: "source_revision",
          type: "number",
          required: true,
          options: { min: 1, max: 1000000, noDecimal: true },
        },
        {
          name: "payload_sent_at",
          type: "date",
          required: true,
        },
        {
          name: "payload_hash",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "waiting_approval",
              "queued",
              "delivering",
              "draft_ready",
              "retrying",
              "failed",
              "published",
              "withdrawn",
            ],
          },
        },
        {
          name: "attempts",
          type: "number",
          required: false,
          options: { min: 0, max: 100, noDecimal: true },
        },
        { name: "next_attempt_at", type: "date", required: false },
        { name: "last_attempt_at", type: "date", required: false },
        { name: "delivered_at", type: "date", required: false },
        {
          name: "remote_draft_id",
          type: "text",
          required: false,
          options: { max: 128 },
        },
        {
          name: "review_url",
          type: "text",
          required: false,
          options: { max: 2048 },
        },
        {
          name: "last_error",
          type: "text",
          required: false,
          options: { max: 120 },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_website_publications_event` ON `website_publications` (`event_id`)",
        "CREATE UNIQUE INDEX `idx_website_publications_revision` ON `website_publications` (`post`, `destination_id`, `source_revision`)",
        "CREATE INDEX `idx_website_publications_due` ON `website_publications` (`status`, `next_attempt_at`)",
        "CREATE INDEX `idx_website_publications_dealer_created` ON `website_publications` (`dealer`, `created` DESC)",
      ],
      // Server hooks are the only authority for queue state and delivery.
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    dao.saveCollection(publications);
  },
  (db) => {
    const dao = new Dao(db);
    let publications = null;
    try {
      publications = dao.findCollectionByNameOrId("website_publications");
    } catch (_e) {}
    if (publications) dao.deleteCollection(publications);

    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the column is still there.
    // `removeField` takes the field id, not its name.
    POST_WEBSITE_FIELDS.forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
