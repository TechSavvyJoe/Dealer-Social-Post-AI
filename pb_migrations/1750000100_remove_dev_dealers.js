/// <reference path="../pb_data/types.d.ts" />

/**
 * SECURITY CLEANUP (companion to 1750000000_add_dev_dealers.js).
 *
 * The dev-dealers migration seeded the well-known login codes 0000 / 1111 /
 * 2222, which 1748200000_migrate_to_6_digit_codes later rewrote to 000000 /
 * 111100 / 222200. This migration deletes every one of those backdoor rows
 * (both forms) so production never ships guessable cross-tenant credentials.
 *
 * Gated on the SAME SEED_DEV_DEALERS flag as the seed migration: if a developer
 * explicitly opted into dev dealers, keep them (otherwise the seed at
 * 1750000000 would be purged here, since this migration runs after it). With
 * the flag unset (production) the backdoor dealers are removed.
 */
migrate(
  (db) => {
    if (($os.getenv("SEED_DEV_DEALERS") || "").trim() === "1") {
      console.log("SEED_DEV_DEALERS=1 — keeping dev dealers, skipping purge");
      return;
    }

    const dao = new Dao(db);
    const backdoorCodes = [
      "0000",
      "1111",
      "2222",
      "000000",
      "111100",
      "222200",
    ];
    let removed = 0;
    for (const code of backdoorCodes) {
      try {
        // findRecordsByFilter binds a single value safely and returns an array
        // (no throw on no-match). dbx does NOT expand an array into an IN list,
        // so the previous `IN ({:codes})` form matched nothing.
        const recs = dao.findRecordsByFilter(
          "dealers",
          "code = {:c}",
          "",
          100,
          0,
          { c: code }
        );
        for (const r of recs) {
          dao.deleteRecord(r);
          removed++;
          console.log("Removed backdoor dealer code:", code);
        }
      } catch (err) {
        console.log("remove_dev_dealers: delete failed for", code, err);
      }
    }
    console.log("remove_dev_dealers: removed " + removed + " backdoor dealer(s)");
  },
  (db) => {
    // Irreversible by design — we will not re-create backdoor dealers.
  }
);
