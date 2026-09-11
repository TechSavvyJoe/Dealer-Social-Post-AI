/// <reference path="../pb_data/types.d.ts" />
/**
 * Purges attempted login credentials from auth_events and keeps only a boolean
 * indicating whether a credential was supplied. The down migration is
 * intentionally a no-op: rolling back must never recreate a credential sink.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let events = null;
    try {
      events = dao.findCollectionByNameOrId("auth_events");
    } catch (_e) {}
    if (!events) return;

    if (!events.schema.getFieldByName("credential_present")) {
      events.schema.addField(
        new SchemaField({
          name: "credential_present",
          type: "bool",
          required: false,
        }),
      );
      dao.saveCollection(events);
    }

    // Preserve only non-sensitive presence metadata for existing rows before
    // dropping the plaintext field. No attempted value leaves SQLite.
    if (events.schema.getFieldByName("code_attempted")) {
      db.newQuery(
        "UPDATE auth_events SET credential_present = CASE WHEN code_attempted IS NOT NULL AND code_attempted != '' THEN 1 ELSE 0 END",
      ).execute();

      events = dao.findCollectionByNameOrId("auth_events");
      // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on
      // PocketBase 0.22: the migration reports "Applied" and the plaintext
      // column stays behind. `removeField` takes the field id, not its name.
      const field = events.schema.getFieldByName("code_attempted");
      if (field) events.schema.removeField(field.id);
      dao.saveCollection(events);
    }
  },
  (_db) => {
    // Security invariant: never restore storage for attempted credentials.
  },
);
