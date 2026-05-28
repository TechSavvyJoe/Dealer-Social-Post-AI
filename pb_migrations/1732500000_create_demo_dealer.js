/// <reference path="../pb_data/types.d.ts" />
// NEUTRALIZED 2026-05-27 — no auto-seeded demo dealer.
// Kept as a no-op so PocketBase's migration history stays consistent.
// If you want a demo dealer, create one via the Admin Dashboard.
migrate(
  (_db) => {
    console.log("[migration] create_demo_dealer is neutralized (no-op)");
  },
  (_db) => {
    // no-op down
  }
);
