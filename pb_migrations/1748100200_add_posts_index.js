/// <reference path="../pb_data/types.d.ts" />
/**
 * Index posts(dealer, generated_at DESC) — the leaderboard query in
 * /api/app/posts is `dealer = X && generated_at >= S ORDER BY generated_at`.
 * Without this index, SQLite full-scans the table. At 50 dealers × 30
 * posts/day × 365 days = 547K rows this gets noticeably slow.
 *
 * SQLite uses `created` and `updated` auto-fields; we also add an index on
 * created for the auth_events sweep query.
 */
migrate(
  (db) => {
    db.newQuery(
      "CREATE INDEX IF NOT EXISTS `idx_posts_dealer_generated_at` ON `posts` (`dealer`, `generated_at` DESC)"
    ).execute();
    db.newQuery(
      "CREATE INDEX IF NOT EXISTS `idx_posts_approval_status` ON `posts` (`dealer`, `approval_status`, `generated_at` DESC)"
    ).execute();
  },
  (db) => {
    db.newQuery("DROP INDEX IF EXISTS `idx_posts_dealer_generated_at`").execute();
    db.newQuery("DROP INDEX IF EXISTS `idx_posts_approval_status`").execute();
  }
);
