/// <reference path="../pb_data/types.d.ts" />
/**
 * Share events: "Shared · Facebook" on a post, recorded when the salesperson
 * completes a share (the OS share sheet resolved, a download, or a copied
 * caption).
 *
 * This is its own collection, never a field on `posts`. Writing to a post
 * bumps `posts.updated`, and `updated` is the `post_revision` the website
 * hand-off compares-and-sets: a share recorded on the post itself would make
 * a salesperson's next website send fail as "changed in another window".
 *
 * Rows hold only the destination id (the platformOutputs allowlist), how the
 * share left the device, and the server-written `created` time — no caption,
 * no customer data, no person. The owning post and dealer are relations with
 * cascade delete, so deleting a post or a dealership removes its share rows.
 * Only server hooks read or write the collection; every API rule is locked.
 *
 * Down deletes the collection. It is additive and nothing else references it,
 * so a rollback loses only the share history.
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    let existing = null;
    try {
      existing = dao.findCollectionByNameOrId("post_share_events");
    } catch (_e) {}
    if (existing) return;

    const posts = dao.findCollectionByNameOrId("posts");
    const dealers = dao.findCollectionByNameOrId("dealers");

    const events = new Collection({
      name: "post_share_events",
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
          name: "channel",
          type: "text",
          required: true,
          options: { min: 1, max: 40, pattern: "^[a-z0-9_]+$" },
        },
        {
          name: "via",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["share_sheet", "download", "copy"],
          },
        },
      ],
      indexes: [
        // The share route's dedupe and 20-event cap read one post's rows.
        "CREATE INDEX `idx_post_share_events_post_created` ON `post_share_events` (`post`, `created` DESC)",
        // The History list reads one page of posts at a time, dealer-scoped.
        "CREATE INDEX `idx_post_share_events_dealer_post` ON `post_share_events` (`dealer`, `post`, `created` DESC)",
      ],
      // Server hooks are the only authority for share history.
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    dao.saveCollection(events);
  },
  (db) => {
    const dao = new Dao(db);
    let events = null;
    try {
      events = dao.findCollectionByNameOrId("post_share_events");
    } catch (_e) {}
    if (events) dao.deleteCollection(events);
  },
);
