/// <reference path="../pb_data/types.d.ts" />
// Private recovery mapping survives dealer deletion and provider-resource GC.
// The opaque provider ID is the only provider data kept here.
migrate(
  (db) => {
    const dao = new Dao(db);
    return dao.saveCollection(
      new Collection({
        name: "omni_interactions",
        type: "base",
        system: false,
        schema: [
          {
            name: "operation_name",
            type: "text",
            required: true,
            options: { min: 48, max: 48, pattern: "^operations/omni-[A-Za-z0-9]{32}$" },
          },
          {
            name: "provider_id",
            type: "text",
            required: true,
            options: { min: 1, max: 2048 },
          },
          {
            name: "key_fingerprint",
            type: "text",
            required: true,
            options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
          },
          { name: "expires_at", type: "date", required: true },
          { name: "cleanup_after", type: "date", required: true },
          {
            name: "cleanup_attempts",
            type: "number",
            options: { min: 0, max: 1000000, noDecimal: true },
          },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_omni_operation ON omni_interactions (operation_name)",
          "CREATE INDEX idx_omni_cleanup ON omni_interactions (cleanup_after)",
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
      }),
    );
  },
  (db) => {
    const dao = new Dao(db);
    // Never erase the only cleanup identities during a rollback. Finish
    // provider cleanup first; an empty queue can be safely removed.
    if (dao.findRecordsByFilter("omni_interactions", "id != ''", "id", 1, 0).length) {
      throw new Error("Cannot remove pending video recovery state");
    }
    return dao.deleteCollection(dao.findCollectionByNameOrId("omni_interactions"));
  },
);
