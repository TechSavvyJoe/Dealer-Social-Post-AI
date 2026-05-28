/// <reference path="../pb_data/types.d.ts" />
// NEUTRALIZED 2026-05-27 — Joe is no longer at Hertz; do not seed this dealer.
// Kept as a no-op so PocketBase's migration history stays consistent.
// Create real dealers via the Admin Dashboard.
migrate(
  (_db) => {
    console.log("[migration] add_hertz_dealer is neutralized (no-op)");
  },
  (_db) => {
    // no-op down
  }
);
