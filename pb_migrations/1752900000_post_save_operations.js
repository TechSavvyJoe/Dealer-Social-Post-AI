// Private recovery ledger. It contains only opaque operation/session verifiers
// and a payload digest, never captions, signatures or customer identities.
migrate(
  (db) => {
    db.newQuery(
      "CREATE TABLE IF NOT EXISTS _post_save_operations (" +
        "dealer TEXT NOT NULL, owner_session_hash TEXT NOT NULL, operation_id TEXT NOT NULL, " +
        "payload_digest TEXT NOT NULL, post_id TEXT NOT NULL, result_digest TEXT NOT NULL DEFAULT '', " +
        "PRIMARY KEY (dealer, owner_session_hash, operation_id))",
    ).execute();
  },
  (db) => db.newQuery("DROP TABLE IF EXISTS _post_save_operations").execute(),
);
