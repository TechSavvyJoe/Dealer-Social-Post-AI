/// <reference path="../pb_data/types.d.ts" />
/**
 * Auth events — every login attempt (success or fail), every privilege check
 * miss, every session creation. Powers:
 *   - rate limiting (count fails per IP per 15 min on POST /api/app/session)
 *   - compliance audit log (dealers' GMs will ask "who logged in last night")
 *   - incident response (after a key rotation, which dealers were active?)
 *
 * Append-only. Locked from direct REST. Read via /api/app/auth_events
 * (super-admin only) — added in a follow-up migration if needed.
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    let dealersCol = null;
    try {
      dealersCol = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}

    const schema = [
      {
        name: "kind",
        type: "select",
        required: true,
        options: {
          maxSelect: 1,
          values: [
            "login_success",
            "login_fail",
            "login_locked",
            "session_revoked",
            "role_escalation_attempt",
            "proxy_unauthorized",
            "proxy_rate_limited",
          ],
        },
      },
      // Nullable — failed logins don't have a dealer yet.
      {
        name: "dealer",
        type: "relation",
        required: false,
        options: {
          collectionId: dealersCol ? dealersCol.id : "",
          cascadeDelete: false,
          maxSelect: 1,
          minSelect: 0,
        },
      },
      {
        name: "code_attempted",
        type: "text",
        required: false,
        options: { max: 32 },
      },
      { name: "ip", type: "text", required: false, options: { max: 64 } },
      {
        name: "user_agent",
        type: "text",
        required: false,
        options: { max: 512 },
      },
      {
        name: "detail",
        type: "text",
        required: false,
        options: { max: 1024 },
      },
    ];

    const collection = new Collection({
      name: "auth_events",
      type: "base",
      system: false,
      schema: schema,
      indexes: [
        "CREATE INDEX `idx_auth_events_kind_created` ON `auth_events` (`kind`, `created`)",
        "CREATE INDEX `idx_auth_events_ip_created` ON `auth_events` (`ip`, `created`)",
        "CREATE INDEX `idx_auth_events_dealer_created` ON `auth_events` (`dealer`, `created`)",
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
      let collection = null;
      try {
        collection = dao.findCollectionByNameOrId("auth_events");
      } catch (e) {}
      if (collection) return dao.deleteCollection(collection);
    } catch (e) {
      // already gone
    }
  }
);
