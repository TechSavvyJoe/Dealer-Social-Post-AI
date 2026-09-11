/// <reference path="../pb_data/types.d.ts" />
/**
 * Per-salesperson roster. Lets the GSM manage who works at their dealership
 * with proper add/remove/deactivate semantics instead of relying on free-text
 * names typed on each post.
 *
 *  - dealer: relation → dealers (the tenant boundary)
 *  - name: display name shown on the leaderboard + post history
 *  - pin: optional short identifier the salesperson can pick from a dropdown
 *         (NOT a login credential — auth is still the shared dealer code)
 *  - active: deactivated salespeople still appear in historical posts but
 *            don't show in the active picker
 *  - created_at: when they were added
 *
 * Posts get an optional salesperson_id field on top so historical attribution
 * survives a renaming.
 */
const POST_SALESPERSON_FIELDS = ["salesperson_id"];

migrate(
  (db) => {
    const dao = new Dao(db);

    let spCol = null;
    try {
      spCol = dao.findCollectionByNameOrId("salespeople");
    } catch (e) {}

    // 1. salespeople collection
    if (!spCol) {
      let dealers = null;
      try {
        dealers = dao.findCollectionByNameOrId("dealers");
      } catch (e) {}
      if (!dealers) throw new Error("dealers collection missing");

      const collection = new Collection({
        name: "salespeople",
        type: "base",
        system: false,
        schema: [
          {
            name: "dealer",
            type: "relation",
            required: true,
            options: {
              collectionId: dealers.id,
              cascadeDelete: false,
              maxSelect: 1,
              minSelect: 1,
            },
          },
          {
            name: "name",
            type: "text",
            required: true,
            options: { min: 1, max: 120 },
          },
          {
            name: "pin",
            type: "text",
            required: false,
            options: { max: 12 },
          },
          {
            name: "active",
            type: "bool",
            required: false,
          },
          {
            name: "created_at",
            type: "date",
            required: false,
          },
        ],
        // Locked rules — access via /api/app/salespeople endpoints only.
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        indexes: [
          "CREATE INDEX `idx_salespeople_dealer` ON `salespeople` (`dealer`)",
          "CREATE INDEX `idx_salespeople_active` ON `salespeople` (`dealer`, `active`)",
        ],
      });
      dao.saveCollection(collection);
    }

    // 2. posts.salesperson_id (relation) — optional; legacy posts keep the
    //    free-text salesperson_name field for backward compat.
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (e) {}
    let salespeople = null;
    try {
      salespeople = dao.findCollectionByNameOrId("salespeople");
    } catch (e) {}
    if (posts && salespeople && !posts.schema.getFieldByName("salesperson_id")) {
      posts.schema.addField(
        new SchemaField({
          name: "salesperson_id",
          type: "relation",
          required: false,
          options: {
            collectionId: salespeople.id,
            cascadeDelete: false,
            maxSelect: 1,
            minSelect: 0,
          },
        }),
      );
      dao.saveCollection(posts);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (e) {}
    if (posts) {
      // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
      // 0.22 — it reports "Applied" and the column stays. `removeField` takes the
      // field id, not its name.
      POST_SALESPERSON_FIELDS.forEach((name) => {
        const field = posts.schema.getFieldByName(name);
        if (field) posts.schema.removeField(field.id);
      });
      dao.saveCollection(posts);
    }
    let sp = null;
    try {
      sp = dao.findCollectionByNameOrId("salespeople");
    } catch (e) {}
    if (sp) dao.deleteCollection(sp);
  },
);
