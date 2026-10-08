// Routine restarts (including nightly backup-secret refreshes) preserve the
// durable window. Deploy/recovery operations rotate the external epoch; it is
// not restored with the database, so restored observations cannot prove coverage.
function windowKey() {
  const release = ($os.getenv("RELEASE_SHA") || "").trim();
  const epoch = ($os.getenv("REVISION_OBSERVATION_EPOCH") || "").trim();
  return release && epoch ? release + ":" + epoch : "";
}

function beginWindow() {
  const key = windowKey();
  $app
    .dao()
    .db()
    .newQuery(
      "INSERT INTO _revision_compatibility (id, window_key, started_ms) VALUES (1, {:key}, {:now}) " +
        "ON CONFLICT(id) DO UPDATE SET window_key = excluded.window_key, started_ms = excluded.started_ms, " +
        "last_legacy_ms = 0, draft_requests = 0, share_requests = 0 " +
        "WHERE _revision_compatibility.window_key != excluded.window_key OR {:reset} = 1",
    )
    .bind({ key: key, now: Date.now(), reset: key ? 0 : 1 })
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
      "INSERT INTO _revision_compatibility (id, window_key, started_ms, last_legacy_ms, " +
        column +
        ") VALUES (1, {:key}, {:now}, {:now}, 1) ON CONFLICT(id) DO UPDATE SET " +
        "last_legacy_ms = MAX(last_legacy_ms, excluded.last_legacy_ms), " +
        column +
        " = " +
        column +
        " + 1",
    )
    .bind({ now: Date.now(), key: windowKey() })
    .execute();
}

function snapshot() {
  const row = new DynamicModel({ started_ms: 0, last_legacy_ms: 0, window_key: "" });
  $app
    .dao()
    .db()
    .newQuery(
      "SELECT started_ms, last_legacy_ms, window_key FROM _revision_compatibility WHERE id = 1",
    )
    .one(row);
  if (!windowKey() || row.window_key !== windowKey())
    throw new Error("Unverified deployment window");
  const started = Number(row.started_ms);
  const last = Number(row.last_legacy_ms);
  const now = Date.now();
  if (!(started > 0) || last < 0 || started > now || last > now) {
    throw new Error("Invalid revision observation window");
  }
  const clearSince = Math.max(started, last);
  const eligibleAfter = clearSince + 7 * 24 * 60 * 60 * 1000;
  return {
    coverage: "durable-deployment-window",
    observedSince: new Date(started).toISOString(),
    clearSince: new Date(clearSince).toISOString(),
    eligibleAfter: new Date(eligibleAfter).toISOString(),
    ready: now >= eligibleAfter,
  };
}

module.exports = { beginWindow, recordLegacy, snapshot };
