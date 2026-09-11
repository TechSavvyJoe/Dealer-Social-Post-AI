/// <reference path="../pb_data/types.d.ts" />
/**
 * Normalise timestamps the old outbox writer stored in the wrong encoding.
 *
 * PocketBase stores date columns as "YYYY-MM-DD HH:MM:SS.mmmZ" (a space
 * between date and time) and SQLite compares them as text. Until this
 * branch, claimDuePublication wrote `last_attempt_at` and `updated` with raw
 * SQL bound to `new Date().toISOString()`, which puts a "T" there instead.
 * Every other writer goes through the DAO, which normalises on save, so the
 * "T" form survives only on rows that were claimed by raw SQL and never saved
 * again — which is precisely a row stuck in 'delivering'.
 *
 * The hook now writes the space form everywhere, and recoverStaleDeliveries
 * compares against a space-form cutoff. That comparison is silently false
 * for a "T"-form row: 'T' (0x54) sorts after ' ' (0x20), so a legacy row
 * with any time on the cutoff's date reads as newer than the cutoff, is never
 * matched, and is never rescued. Verified in SQLite:
 *   '2026-09-10T22:00:00.000Z' <= '2026-09-10 22:10:00.000Z'  ->  0
 *   '2026-09-10 22:00:00.000Z' <= '2026-09-10 22:10:00.000Z'  ->  1
 *
 * Rewriting the stored value is safer than teaching the reader two
 * encodings: a two-encoding filter has to avoid matching a fresh space-form
 * row against a "T"-form cutoff (where the same ordering quirk makes every
 * same-day row look stale), and getting that wrong would kick live
 * deliveries back into retry. REPLACE is idempotent — a value with no "T" is
 * untouched — and there is exactly one "T" in an ISO timestamp.
 *
 * Down is a no-op: this is data hygiene, not a schema change, and the
 * normalised form is the correct one under either version of the hook.
 */
migrate(
  (db) => {
    const columns = ["last_attempt_at", "updated"];
    columns.forEach((column) => {
      try {
        db.newQuery(
          "UPDATE website_publications SET " +
            column +
            " = REPLACE(" +
            column +
            ", 'T', ' ') WHERE " +
            column +
            " LIKE '%T%'",
        ).execute();
      } catch (_error) {
        // The table is created by 1751000000, which runs first; a missing
        // table here means a database this migration has nothing to fix.
      }
    });
  },
  (_db) => {
    // Data normalisation only; nothing to revert.
  },
);
