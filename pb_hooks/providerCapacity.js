// Get + Set on $app.store() is not an atomic reservation. A conditional INSERT
// runs under SQLite's write lock, so concurrent JSVMs cannot overwrite a lease.
// Keep leases longer than the longest upstream timeout (300 seconds). A crashed
// request recovers without a restart, and an old release cannot free a new slot.
const LEASE_MS = 6 * 60 * 1000;
const MAX_SCOPES = 512;

function acquire(key, maxConcurrent) {
  const scope = String(key || "").slice(0, 256);
  const limit = Math.max(1, Math.min(100, Number(maxConcurrent) || 1));
  const denied = { ok: false, retryAfterMs: 1000 };
  if (!scope) return denied;
  try {
    const db = $app.dao().db();
    const now = Date.now();
    const token = $security.randomString(40);
    db.newQuery("DELETE FROM _provider_capacity WHERE expires_ms <= {:now}")
      .bind({ now: now })
      .execute();
    const inserted = db
      .newQuery(
        "INSERT INTO _provider_capacity(token, scope, expires_ms) " +
          "SELECT {:token}, {:scope}, {:expires} " +
          "WHERE (SELECT COUNT(*) FROM _provider_capacity WHERE scope = {:scope} AND expires_ms > {:now}) < {:limit} " +
          "AND (EXISTS(SELECT 1 FROM _provider_capacity WHERE scope = {:scope}) " +
          "OR (SELECT COUNT(DISTINCT scope) FROM _provider_capacity) < {:maxScopes})",
      )
      .bind({
        token,
        scope,
        expires: now + LEASE_MS,
        now,
        limit,
        maxScopes: MAX_SCOPES,
      })
      .execute();
    if (inserted.rowsAffected() !== 1) return denied;
    let released = false;
    return {
      ok: true,
      release: function () {
        if (released) return;
        try {
          db.newQuery("DELETE FROM _provider_capacity WHERE token = {:token}")
            .bind({ token: token })
            .execute();
          released = true;
        } catch (_e) {
          // Preserve the lease until expiry; never manufacture spare capacity.
        }
      },
    };
  } catch (_e) {
    // A missing migration or unavailable database must stop paid calls.
    return denied;
  }
}

module.exports = { acquire };
