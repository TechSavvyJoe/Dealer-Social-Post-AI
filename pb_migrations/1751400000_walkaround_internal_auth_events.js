/// <reference path="../pb_data/types.d.ts" />
/**
 * Walkaround internal-surface hardening:
 * - audit kinds for worker-HMAC rejections and walkaround rate limiting, so
 *   the previously silent /api/internal/* denial path becomes observable with
 *   the same coalesced telemetry as /api/proxy/*.
 *
 * Forward-only: removing enum values would make an older binary reject
 * existing audit rows.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const events = dao.findCollectionByNameOrId("auth_events");
    const kind = events.schema.getFieldByName("kind");
    if (!kind) throw new Error("auth_events.kind field not found");

    kind.options = kind.options || {};
    kind.options.maxSelect = 1;
    const values = Array.from(kind.options.values || []);
    ["walkaround_internal_unauthorized", "walkaround_rate_limited"].forEach((value) => {
      if (values.indexOf(value) === -1) values.push(value);
    });
    kind.options.values = values;
    dao.saveCollection(events);
  },
  (_db) => {
    // Forward-only operational security migration.
  },
);
