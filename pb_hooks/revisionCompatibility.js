// A restart (including restore/rollback) starts a new conservative window.
// This prevents time spent on an uninstrumented backend from counting as clear.
function beginWindow() {
  $app
    .dao()
    .db()
    .newQuery(
      "INSERT INTO _revision_compatibility (id, started_ms) VALUES (1, {:now}) " +
        "ON CONFLICT(id) DO UPDATE SET started_ms = excluded.started_ms, " +
        "last_legacy_ms = 0, draft_requests = 0, share_requests = 0",
    )
    .bind({ now: Date.now() })
    .execute();
}

// Called before accepting either legacy route. Never swallow persistence
// errors: a legacy write without an observation must not be accepted.
function recordLegacy(route) {
  if (route !== "draft" && route !== "share") throw new Error("Unknown revision route");
  const column = route === "draft" ? "draft_requests" : "share_requests";
  $app
    .dao()
    .db()
    .newQuery(
      "INSERT INTO _revision_compatibility (id, started_ms, last_legacy_ms, " +
        column +
        ") VALUES (1, {:now}, {:now}, 1) ON CONFLICT(id) DO UPDATE SET " +
        "last_legacy_ms = MAX(last_legacy_ms, excluded.last_legacy_ms), " +
        column +
        " = " +
        column +
        " + 1",
    )
    .bind({ now: Date.now() })
    .execute();
}

function snapshot() {
  const row = new DynamicModel({ started_ms: 0, last_legacy_ms: 0 });
  $app
    .dao()
    .db()
    .newQuery(
      "SELECT started_ms, last_legacy_ms FROM _revision_compatibility WHERE id = 1",
    )
    .one(row);
  const started = Number(row.started_ms);
  const last = Number(row.last_legacy_ms);
  const now = Date.now();
  if (!(started > 0) || last < 0 || started > now || last > now) {
    throw new Error("Invalid revision observation window");
  }
  const clearSince = Math.max(started, last);
  const eligibleAfter = clearSince + 7 * 24 * 60 * 60 * 1000;
  return {
    coverage: "continuous-since-server-start",
    observedSince: new Date(started).toISOString(),
    clearSince: new Date(clearSince).toISOString(),
    eligibleAfter: new Date(eligibleAfter).toISOString(),
    ready: now >= eligibleAfter,
  };
}

module.exports = { beginWindow, recordLegacy, snapshot };
