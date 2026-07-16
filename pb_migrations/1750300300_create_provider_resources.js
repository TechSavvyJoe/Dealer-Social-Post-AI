/// <reference path="../pb_data/types.d.ts" />
/**
 * Durable ownership ledger for provider-created long-running operations and
 * generated files. The proxy stores only the opaque provider identifier and
 * its dealer owner; provider payloads and credentials never enter this table.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const dealers = dao.findCollectionByNameOrId("dealers");

    const collection = new Collection({
      name: "provider_resources",
      type: "base",
      system: false,
      schema: [
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
          name: "provider",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["gemini", "vertex"] },
        },
        {
          name: "resource_type",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["operation", "file"] },
        },
        {
          name: "resource_id",
          type: "text",
          required: true,
          options: { min: 1, max: 500 },
        },
        { name: "expires_at", type: "date", required: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_provider_resources_identity` ON `provider_resources` (`provider`, `resource_type`, `resource_id`)",
        "CREATE INDEX `idx_provider_resources_dealer` ON `provider_resources` (`dealer`)",
        "CREATE INDEX `idx_provider_resources_expiry` ON `provider_resources` (`expires_at`)",
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    return dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const collection = dao.findCollectionByNameOrId("provider_resources");
      if (collection) return dao.deleteCollection(collection);
    } catch (_e) {
      // Already absent.
    }
  },
);
