/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const bindings = {
      website_publications: ["config_revision", "destination_identity"],
      walkaround_projects: [
        "config_revision",
        "destination_identity",
        "youtube_identity",
      ],
      walkaround_assets: ["metadata_revision"],
    };
    Object.keys(bindings).forEach((name) => {
      const collection = dao.findCollectionByNameOrId(name);
      bindings[name].forEach((field) => {
        if (!collection.schema.getFieldByName(field))
          collection.schema.addField(
            new SchemaField({
              name: field,
              type: field.indexOf("revision") !== -1 ? "number" : "text",
              required: false,
              options:
                field.indexOf("revision") !== -1
                  ? { min: 0, noDecimal: true }
                  : { max: 64 },
            }),
          );
      });
      dao.saveCollection(collection);
    });
  },
  (db) => {
    const dao = new Dao(db);
    const bindings = {
      website_publications: ["config_revision", "destination_identity"],
      walkaround_projects: [
        "config_revision",
        "destination_identity",
        "youtube_identity",
      ],
      walkaround_assets: ["metadata_revision"],
    };
    Object.keys(bindings).forEach((name) => {
      const collection = dao.findCollectionByNameOrId(name);
      bindings[name].forEach((name) => {
        const field = collection.schema.getFieldByName(name);
        if (field) collection.schema.removeField(field.id);
      });
      dao.saveCollection(collection);
    });
  },
);
