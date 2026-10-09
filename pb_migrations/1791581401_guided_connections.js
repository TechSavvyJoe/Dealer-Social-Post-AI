/// <reference path="../pb_data/types.d.ts" />
// No credentials in plaintext. Both collections are accessible only to trusted
// custom routes; null rules deny record API access even to dealer managers.
migrate(
  (db) => {
    const dao = new Dao(db);
    const locked = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const common = [
      {
        name: "scope",
        type: "select",
        required: true,
        options: { maxSelect: 1, values: ["global", "dealer"] },
      },
      { name: "dealer", type: "text", options: { max: 64 } },
      {
        name: "service",
        type: "select",
        required: true,
        options: {
          maxSelect: 1,
          values: ["gemini", "anthropic", "openai", "website", "walkaround"],
        },
      },
    ];
    dao.saveCollection(
      new Collection({
        name: "managed_connections",
        type: "base",
        system: false,
        ...locked,
        schema: common.concat([
          {
            name: "revision",
            type: "number",
            required: true,
            options: { min: 1, noDecimal: true },
          },
          { name: "enabled", type: "bool" },
          { name: "ciphertext", type: "text", required: true, options: { max: 32768 } },
        ]),
        indexes: [
          "CREATE UNIQUE INDEX idx_managed_connections_scope ON managed_connections(scope, dealer, service)",
        ],
      }),
    );
    dao.saveCollection(
      new Collection({
        name: "connection_verifications",
        type: "base",
        system: false,
        ...locked,
        schema: common.concat([
          {
            name: "config_revision",
            type: "number",
            options: { min: 0, noDecimal: true },
          },
          { name: "identity", type: "text", required: true, options: { max: 64 } },
          { name: "key_hash", type: "text", required: true, options: { max: 64 } },
          { name: "request_hash", type: "text", required: true, options: { max: 64 } },
          { name: "attempt_hash", type: "text", options: { max: 64 } },
          {
            name: "state",
            type: "select",
            required: true,
            options: {
              maxSelect: 1,
              values: ["testing", "verified", "failed", "unknown"],
            },
          },
          { name: "started_at", type: "date" },
          { name: "checked_at", type: "date" },
          { name: "code", type: "text", options: { max: 80 } },
          { name: "proof_kind", type: "text", options: { max: 40 } },
          { name: "capabilities_json", type: "text", options: { max: 200 } },
        ]),
        indexes: [
          "CREATE UNIQUE INDEX idx_connection_verifications_scope ON connection_verifications(scope, dealer, service, key_hash)",
        ],
      }),
    );
  },
  (db) => {
    const dao = new Dao(db);
    dao.deleteCollection(dao.findCollectionByNameOrId("connection_verifications"));
    dao.deleteCollection(dao.findCollectionByNameOrId("managed_connections"));
  },
);
