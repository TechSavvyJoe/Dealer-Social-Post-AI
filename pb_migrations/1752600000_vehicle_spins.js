/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const dealers = dao.findCollectionByNameOrId("dealers");
    const people = dao.findCollectionByNameOrId("salespeople");
    const locked = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const spins = new Collection({
      name: "vehicle_spins",
      type: "base",
      system: false,
      ...locked,
      schema: [
        {
          name: "dealer",
          type: "relation",
          required: true,
          options: { collectionId: dealers.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "person",
          type: "relation",
          required: true,
          options: { collectionId: people.id, maxSelect: 1, cascadeDelete: true },
        },
        { name: "vehicle", type: "json", required: true, options: { maxSize: 8000 } },
        {
          name: "state",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["uploading", "pending", "approved", "n_a", "rejected"],
          },
        },
        {
          name: "frame_count",
          type: "number",
          required: true,
          options: { min: 24, max: 72, noDecimal: true },
        },
        {
          name: "background",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["original", "graphite", "pearl", "custom"],
          },
        },
        { name: "reviewed_by", type: "text", options: { max: 80 } },
        { name: "review_note", type: "text", options: { max: 400 } },
        { name: "link_token", type: "text", options: { max: 64 } },
      ],
      indexes: [
        "CREATE INDEX idx_vehicle_spins_owner ON vehicle_spins (dealer, person)",
        "CREATE UNIQUE INDEX idx_vehicle_spins_token ON vehicle_spins (link_token) WHERE link_token != ''",
      ],
    });
    dao.saveCollection(spins);
    dao.saveCollection(
      new Collection({
        name: "vehicle_spin_frames",
        type: "base",
        system: false,
        ...locked,
        schema: [
          {
            name: "spin",
            type: "relation",
            required: true,
            options: { collectionId: spins.id, maxSelect: 1, cascadeDelete: true },
          },
          {
            name: "angle",
            type: "number",
            required: false,
            options: { min: 0, max: 71, noDecimal: true },
          },
          {
            name: "image",
            type: "file",
            required: true,
            options: {
              maxSelect: 1,
              maxSize: 500000,
              mimeTypes: ["image/jpeg"],
              protected: true,
              thumbs: [],
            },
          },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_vehicle_spin_angle ON vehicle_spin_frames (spin, angle)",
        ],
      }),
    );
  },
  (db) => {
    const dao = new Dao(db);
    dao.deleteCollection(dao.findCollectionByNameOrId("vehicle_spin_frames"));
    dao.deleteCollection(dao.findCollectionByNameOrId("vehicle_spins"));
  },
);
