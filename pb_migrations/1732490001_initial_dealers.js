/// <reference path="../pb_data/types.d.ts" />
// NEUTRALIZED 2026-05-27 — formerly seeded a dealer with code "0000". That's
// the well-known backdoor; we never want it created automatically. See
// pb_migrations/1733351001_add_admin_dealer.js for the matching no-op +
// cleanup of any pre-existing stale record.
migrate(
  (_db) => {
    console.log("[migration] initial_dealers is neutralized (no-op)");
  },
  (_db) => {
    // no-op down
  }
);
