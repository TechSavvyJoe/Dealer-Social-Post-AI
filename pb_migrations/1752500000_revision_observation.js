// Internal aggregate only: no account, post, caption or session identifiers.
migrate(
  (db) => {
    db.newQuery(
      "CREATE TABLE IF NOT EXISTS _revision_compatibility (" +
        "id INTEGER PRIMARY KEY CHECK (id = 1), window_key TEXT NOT NULL DEFAULT '', " +
        "started_ms INTEGER NOT NULL, last_legacy_ms INTEGER NOT NULL DEFAULT 0, " +
        "draft_requests INTEGER NOT NULL DEFAULT 0, share_requests INTEGER NOT NULL DEFAULT 0)",
    ).execute();
  },
  (db) => {
    db.newQuery("DROP TABLE IF EXISTS _revision_compatibility").execute();
  },
);
