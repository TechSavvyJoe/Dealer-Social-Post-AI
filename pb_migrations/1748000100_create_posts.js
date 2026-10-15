/// <reference path="../pb_data/types.d.ts" />
/**
 * Creates the `posts` collection — one record per successful AI generation.
 * Powers the salesperson leaderboard and per-dealer post counts.
 *
 * Fields:
 *  - dealer:           relation → dealers (required)
 *  - salesperson_name: text (optional; free-form so dealers don't have to
 *                      pre-create salespeople rows just to launch)
 *  - generated_at:     date (required, set client-side)
 *  - style:            text (optional)
 *  - tone:             text (optional)
 *  - customer_name:    text (optional)
 *  - vin:              text (optional)
 *  - has_release:      bool (optional — true if a photo release was attached)
 *  - has_video:        bool (optional)
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealersCol = null;
    try {
      dealersCol = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealersCol) {
      throw new Error("dealers collection not found");
    }

    const collection = new Collection({
      name: "posts",
      type: "base",
      system: false,
      schema: [
        {
          name: "dealer",
          type: "relation",
          required: true,
          options: {
            collectionId: dealersCol.id,
            cascadeDelete: false,
            maxSelect: 1,
            minSelect: 1,
          },
        },
        {
          name: "salesperson_name",
          type: "text",
          required: false,
          options: { max: 120 },
        },
        {
          name: "generated_at",
          type: "date",
          required: true,
        },
        { name: "style", type: "text", required: false, options: { max: 60 } },
        { name: "tone", type: "text", required: false, options: { max: 60 } },
        {
          name: "customer_name",
          type: "text",
          required: false,
          options: { max: 120 },
        },
        { name: "vin", type: "text", required: false, options: { max: 17 } },
        { name: "has_release", type: "bool", required: false },
        { name: "has_video", type: "bool", required: false },
      ],
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: null,
      deleteRule: null,
    });

    return dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      let collection = null;
      try {
        collection = dao.findCollectionByNameOrId("posts");
      } catch (e) {}
      if (collection) return dao.deleteCollection(collection);
    } catch (e) {
      // already gone
    }
  },
);
