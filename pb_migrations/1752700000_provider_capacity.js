// Ephemeral leases, never customer content. One atomic SQLite statement grants
// each slot, including across PocketBase's separate JavaScript runtimes.
migrate(
  (db) => {
    db.newQuery(
      "CREATE TABLE IF NOT EXISTS _provider_capacity (" +
        "token TEXT PRIMARY KEY, scope TEXT NOT NULL, expires_ms INTEGER NOT NULL)",
    ).execute();
    db.newQuery(
      "CREATE INDEX IF NOT EXISTS idx_provider_capacity_scope ON _provider_capacity(scope, expires_ms)",
    ).execute();
  },
  (db) => {
    db.newQuery("DROP TABLE IF EXISTS _provider_capacity").execute();
  },
);
