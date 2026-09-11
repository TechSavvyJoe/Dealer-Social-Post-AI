/// <reference path="../pb_data/types.d.ts" />
/**
 * Finish what 1750200000_harden_auth_events.js set out to do.
 *
 * That migration replaced the plaintext `code_attempted` column on auth_events
 * with a `credential_present` boolean, and its own comment says "No attempted
 * value leaves SQLite." The boolean was added and backfilled correctly. The
 * drop was not: it used `schema = Array.from(schema).filter(...)`, which is a
 * SILENT NO-OP on PocketBase 0.22 — the CLI printed "Applied", the migration
 * was recorded as run, and the column stayed. Verified 2026-09-10 against
 * 0.22.55 on a copy of real pb_data: `code_attempted` is still in both the
 * table and the collection schema, with the migration marked applied.
 *
 * Nothing reads or writes the column any more (grep pb_hooks, services,
 * components: zero hits) and auth_events is admin-only, so this is a latent
 * credential sink rather than an exposure. It still has to go. Rows that
 * existed before 1750200000 ran may carry attempted personal codes or manager
 * passwords in it.
 *
 * Two steps, deliberately redundant: blank the values first, then drop the
 * column with the API that actually works (`removeField` takes the field ID,
 * not the name). If the drop were ever to silently fail again, the data would
 * already be gone. Guarded on the field's presence so a fresh install, where
 * the corrected 1750200000 has already dropped the column, does nothing.
 *
 * The down migration is a no-op for the same reason 1750200000's is: rolling
 * back must never recreate a place to store attempted credentials.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let events = null;
    try {
      events = dao.findCollectionByNameOrId("auth_events");
    } catch (_error) {}
    if (!events) return;

    const field = events.schema.getFieldByName("code_attempted");
    if (!field) return;

    db.newQuery(
      "UPDATE auth_events SET code_attempted = '' WHERE code_attempted != ''",
    ).execute();

    events.schema.removeField(field.id);
    dao.saveCollection(events);
  },
  (_db) => {
    // Security invariant: never restore storage for attempted credentials.
  },
);
