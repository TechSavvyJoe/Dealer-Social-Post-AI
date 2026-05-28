/// <reference path="../pb_data/types.d.ts" />
/**
 * NEUTRALIZED 2026-05-27 — DO NOT re-create the "Admin" dealer with the
 * well-known code "0000". Combined with formerly-open collection rules this
 * was a publicly-guessable login. After migration 1748000400 locks the
 * collection rules AND we drop this seed, admin access is gated by the
 * ADMIN_DEALER_CODE env var resolving to a dealer YOU create manually with
 * a real (non-0000) code.
 *
 * Up migration is a no-op so PocketBase's migration history stays consistent.
 * Down migration is also a no-op; we intentionally do not re-introduce the
 * backdoor on rollback.
 */
migrate(
  (_db) => {
    console.log("[migration] add_admin_dealer is neutralized (no-op)");
  },
  (_db) => {
    // no-op down
  }
);

// Also wipe an existing 0000 dealer if migration 1732499996 didn't catch it
// (e.g. if it was re-created manually). This runs as a separate migration
// step so PB treats it as its own checkpoint.
migrate(
  (db) => {
    const dao = new Dao(db);
    try {
      let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!dealers) return;
      const stale = dao.findFirstRecordByFilter(
        dealers.id,
        "code = '0000'"
      );
      if (stale) {
        dao.deleteRecord(stale);
        console.log("[migration] Removed stale code=0000 dealer");
      }
    } catch (_e) {
      // none present
    }
  },
  (_db) => {
    // no-op down
  }
);
