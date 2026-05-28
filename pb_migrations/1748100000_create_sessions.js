/// <reference path="../pb_data/types.d.ts" />
/**
 * Sessions collection — replaces the unsigned `<dealerId>::<role>` cookie
 * scheme with opaque random tokens stored server-side.
 *
 * Pre-fix attack: anyone who knows their own dealer.id could forge
 * `Cookie: dealer_session=<theirId>::dealer_admin` via curl and approve their
 * own posts / edit dealer settings. The role was trusted off the wire.
 *
 * Post-fix: the cookie carries only an opaque random token. Role is read
 * server-side from this collection where it can't be tampered with. Tokens
 * support revocation (delete the row) and per-device tracking.
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
      name: "sessions",
      type: "base",
      system: false,
      schema: [
        {
          name: "token",
          type: "text",
          required: true,
          options: { min: 32, max: 128 },
        },
        {
          name: "dealer",
          type: "relation",
          required: true,
          options: {
            collectionId: dealersCol.id,
            cascadeDelete: true,
            maxSelect: 1,
            minSelect: 1,
          },
        },
        {
          name: "role",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["salesperson", "dealer_admin", "super_admin"],
          },
        },
        { name: "expires_at", type: "date", required: true },
        { name: "last_used_at", type: "date", required: false },
        { name: "ip", type: "text", required: false, options: { max: 64 } },
        {
          name: "user_agent",
          type: "text",
          required: false,
          options: { max: 512 },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_sessions_token` ON `sessions` (`token`)",
        "CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`)",
        "CREATE INDEX `idx_sessions_dealer` ON `sessions` (`dealer`)",
      ],
      // Locked — only pb_hooks reach this collection via $app.dao().
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
      let collection = null;
      try {
        collection = dao.findCollectionByNameOrId("sessions");
      } catch (e) {}
      if (collection) return dao.deleteCollection(collection);
    } catch (e) {
      // already gone
    }
  }
);
