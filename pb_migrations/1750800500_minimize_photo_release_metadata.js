migrate(
  function (db) {
    // Unsalted IP hashes are enumerable and full user-agent strings are not
    // needed for the release ownership/audit chain. Minimize both historical
    // and future legal records; the schema fields stay for compatibility.
    db.newQuery(
      "UPDATE photo_releases SET ip_hash = '', user_agent = '' " +
        "WHERE ip_hash != '' OR user_agent != ''",
    ).execute();
  },
  function (_db) {
    // Privacy minimization is intentionally irreversible.
  },
);
