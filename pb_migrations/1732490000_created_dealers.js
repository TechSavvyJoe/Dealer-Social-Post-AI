/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const collection = new Collection({
      id: "dealers_collection",
      created: "2024-11-24 22:00:00.000Z",
      updated: "2024-11-24 22:00:00.000Z",
      name: "dealers",
      type: "base",
      system: false,
      schema: [
        {
          system: false,
          id: "name_field",
          name: "name",
          type: "text",
          required: true,
          presentable: false,
          unique: false,
          options: {
            min: null,
            max: null,
            pattern: "",
          },
        },
        {
          system: false,
          id: "code_field",
          name: "code",
          type: "text",
          required: true,
          presentable: false,
          unique: true,
          options: {
            min: 4,
            max: 4,
            pattern: "^[0-9]{4}$",
          },
        },

        {
          system: false,
          id: "logo_field",
          name: "logo",
          type: "file",
          required: false,
          presentable: false,
          unique: false,
          options: {
            mimeTypes: [
              "image/png",
              "image/jpeg",
              "image/svg+xml",
              "image/gif",
              "image/webp",
            ],
            thumbs: [],
            maxSelect: 1,
            maxSize: 5242880,
            protected: false,
          },
        },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_code` ON `dealers` (`code`)"],
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      options: {},
    });

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers_collection");

    return dao.deleteCollection(collection);
  }
);
