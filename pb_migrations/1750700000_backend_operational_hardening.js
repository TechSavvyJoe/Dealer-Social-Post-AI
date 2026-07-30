/// <reference path="../pb_data/types.d.ts" />
/**
 * Operational security follow-up:
 * - support the exact kind/IP/time lookup used to coalesce denial telemetry;
 * - add dealer lifecycle kinds required by fail-closed privileged auditing.
 *
 * Forward-only: removing the index or enum values would make an older binary
 * reject existing audit rows and would reintroduce an avoidable denial path.
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
    ["dealer_created", "dealer_updated", "dealer_deleted"].forEach((value) => {
      if (values.indexOf(value) === -1) values.push(value);
    });
    kind.options.values = values;

    events.indexes = Array.from(events.indexes || []).filter(
      (index) => String(index).indexOf("idx_auth_events_kind_ip_created") === -1,
    );
    events.indexes.push(
      "CREATE INDEX `idx_auth_events_kind_ip_created` ON `auth_events` (`kind`, `ip`, `created`)",
    );
    dao.saveCollection(events);
  },
  (_db) => {
    // Forward-only operational security migration.
  },
);
