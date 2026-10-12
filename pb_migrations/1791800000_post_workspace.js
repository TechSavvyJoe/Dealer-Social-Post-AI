/// <reference path="../pb_data/types.d.ts" />
/** Filing and audit state are private server-only records, never creative revisions. */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const dealers = dao.findCollectionByNameOrId("dealers");
    function relation(name, collection) {
      return {
        name: name,
        type: "relation",
        required: true,
        options: {
          collectionId: collection.id,
          cascadeDelete: true,
          maxSelect: 1,
          minSelect: 1,
        },
      };
    }
    function create(name, schema, indexes) {
      let existing;
      try {
        existing = dao.findCollectionByNameOrId(name);
      } catch (_error) {}
      if (existing) return;
      dao.saveCollection(
        new Collection({
          name: name,
          type: "base",
          system: false,
          schema: [relation("post", posts), relation("dealer", dealers)].concat(schema),
          indexes: indexes,
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
        }),
      );
    }
    create(
      "post_workspace_state",
      [
        { name: "archived", type: "bool", required: false },
        {
          name: "revision",
          type: "number",
          required: true,
          options: { min: 1, noDecimal: true },
        },
        { name: "archived_at", type: "date", required: false },
        { name: "archived_by", type: "text", required: false, options: { max: 120 } },
      ],
      [
        "CREATE UNIQUE INDEX idx_post_workspace_state_post ON post_workspace_state (post)",
        "CREATE INDEX idx_post_workspace_state_dealer_archived ON post_workspace_state (dealer, archived)",
      ],
    );
    create(
      "post_workspace_events",
      [
        {
          name: "action",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["archive", "restore"] },
        },
        {
          name: "actor_person_id",
          type: "text",
          required: false,
          options: { max: 64 },
        },
        { name: "actor_name", type: "text", required: false, options: { max: 120 } },
        { name: "post_revision", type: "text", required: true, options: { max: 80 } },
        {
          name: "workspace_revision",
          type: "number",
          required: true,
          options: { min: 1, noDecimal: true },
        },
      ],
      [
        "CREATE INDEX idx_post_workspace_events_dealer_post ON post_workspace_events (dealer, post, created)",
      ],
    );
  },
  (db) => {
    const dao = new Dao(db);
    ["post_workspace_events", "post_workspace_state"].forEach((name) => {
      let collection;
      try {
        collection = dao.findCollectionByNameOrId(name);
      } catch (_error) {}
      if (collection) dao.deleteCollection(collection);
    });
  },
);
