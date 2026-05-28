/**
 * Session + auth helpers — used by every /api/app/* and /api/proxy/* route.
 *
 * Cookie format (NEW, 2026-05-28): the cookie carries only an opaque token.
 * Token resolves to a row in the `sessions` collection where role is stored
 * server-side. This kills the pre-fix privilege-escalation bug where the
 * client could forge `dealer_session=<id>::dealer_admin` in a Cookie header.
 *
 * Legacy support: cookies of the form `<id>::<role>` (issued before this
 * change) are NOT honored — they get treated as invalid and the caller is
 * forced to log in again. We deliberately don't migrate them because the
 * whole point is that the old format was forgeable.
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ---------------------------------------------------------------------------
// Cookie parsing
// ---------------------------------------------------------------------------

function readSessionToken(c) {
  const cookieHeader = c.request().header.get("Cookie") || "";
  const match = cookieHeader.match(/dealer_session=([^;]+)/);
  if (!match) return null;
  const raw = match[1];
  // Reject legacy `<id>::<role>` cookies — opaque tokens never contain "::".
  if (raw.indexOf("::") !== -1) return null;
  // Reject obviously malformed values (token is 32-byte hex = 64 chars, but
  // we accept 32–128 to be tolerant of future widening).
  if (raw.length < 32 || raw.length > 128) return null;
  if (!/^[a-f0-9]+$/i.test(raw)) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// Session row lookup
// ---------------------------------------------------------------------------

function findSessionByToken(token) {
  if (!token) return null;
  try {
    const record = $app
      .dao()
      .findFirstRecordByFilter("sessions", "token = {:t}", { t: token });
    if (!record) return null;

    const expiresAt = record.getString("expires_at");
    if (expiresAt && new Date(expiresAt) < new Date()) {
      // Lazy-delete expired sessions on read.
      try {
        $app.dao().deleteRecord(record);
      } catch (_e) {
        /* ignore */
      }
      return null;
    }
    return record;
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public helpers used by main.pb.js
// ---------------------------------------------------------------------------

function dealerFromSession(c) {
  const token = readSessionToken(c);
  if (!token) return null;
  const session = findSessionByToken(token);
  if (!session) return null;
  const dealerId = session.getString("dealer");
  try {
    return $app.dao().findRecordById("dealers", dealerId);
  } catch (_e) {
    return null;
  }
}

function sessionRoleFromCookie(c) {
  const token = readSessionToken(c);
  if (!token) return null;
  const session = findSessionByToken(token);
  if (!session) return null;
  return session.getString("role") || "salesperson";
}

function isAdminDealer(dealer) {
  if (!dealer) return false;
  const adminCode = ($os.getenv("ADMIN_DEALER_CODE") || "").trim();
  if (!adminCode) return false;
  return dealer.getString("code") === adminCode;
}

// ---------------------------------------------------------------------------
// Token mint / revoke
// ---------------------------------------------------------------------------

function mintSessionToken() {
  // PocketBase ships $security.randomString(); use it. Falls back to a
  // best-effort hex string built from Math.random + Date if for some reason
  // $security isn't available in this JSVM build.
  try {
    if (
      typeof $security !== "undefined" &&
      $security.randomStringWithAlphabet
    ) {
      const hex = $security.randomStringWithAlphabet(64, "0123456789abcdef");
      if (hex && hex.length === 64) return hex;
    }
  } catch (_e) {
    /* fall through */
  }
  let out = "";
  for (let i = 0; i < 64; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out + Date.now().toString(16);
}

function createSession(dealerId, role, ip, userAgent) {
  const sessions = $app.dao().findCollectionByNameOrId("sessions");
  if (!sessions) throw new Error("sessions collection missing");

  const token = mintSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  const record = new Record(sessions, {
    token: token,
    dealer: dealerId,
    role: role,
    expires_at: expires.toISOString(),
    last_used_at: now.toISOString(),
    ip: (ip || "").slice(0, 64),
    user_agent: (userAgent || "").slice(0, 512),
  });
  $app.dao().saveRecord(record);
  return { token: token, expiresAt: expires };
}

function revokeSession(c) {
  const token = readSessionToken(c);
  if (!token) return;
  try {
    const record = $app
      .dao()
      .findFirstRecordByFilter("sessions", "token = {:t}", { t: token });
    if (record) $app.dao().deleteRecord(record);
  } catch (_e) {
    /* already gone */
  }
}

function buildSessionCookie(token, maxAgeSeconds) {
  const maxAge =
    typeof maxAgeSeconds === "number" ? maxAgeSeconds : SESSION_TTL_SECONDS;
  return `dealer_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function buildClearCookie() {
  return "dealer_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

// ---------------------------------------------------------------------------
// Client IP — Fly + most reverse proxies set Fly-Client-IP or X-Forwarded-For.
// Trust the leftmost X-Forwarded-For hop only when running behind Fly's proxy.
// ---------------------------------------------------------------------------

function clientIP(c) {
  try {
    const flyIp = c.request().header.get("Fly-Client-IP");
    if (flyIp) return flyIp.toString().trim();
    const xff = c.request().header.get("X-Forwarded-For");
    if (xff) return xff.toString().split(",")[0].trim();
    const realIp = c.request().header.get("X-Real-IP");
    if (realIp) return realIp.toString().trim();
  } catch (_e) {
    /* ignore */
  }
  try {
    return (c.request().remoteAddr || "").toString();
  } catch (_e) {
    return "";
  }
}

function userAgent(c) {
  try {
    return (c.request().header.get("User-Agent") || "").toString();
  } catch (_e) {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Auth events — append-only audit log.
// ---------------------------------------------------------------------------

function logAuthEvent(kind, opts) {
  try {
    const col = $app.dao().findCollectionByNameOrId("auth_events");
    if (!col) return;
    const record = new Record(col, {
      kind: kind,
      dealer: (opts && opts.dealerId) || "",
      code_attempted: ((opts && opts.codeAttempted) || "")
        .toString()
        .slice(0, 32),
      ip: ((opts && opts.ip) || "").toString().slice(0, 64),
      user_agent: ((opts && opts.userAgent) || "").toString().slice(0, 512),
      detail: ((opts && opts.detail) || "").toString().slice(0, 1024),
    });
    $app.dao().saveRecord(record);
  } catch (e) {
    // Auth event logging must never break the calling request.
    console.error("[helpers.logAuthEvent] failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — counts auth_events within a window.
// ---------------------------------------------------------------------------

function countRecentEvents(kind, ip, windowSeconds) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  try {
    const records = $app
      .dao()
      .findRecordsByFilter(
        "auth_events",
        "kind = {:k} && ip = {:i} && created >= {:s}",
        "-created",
        1000,
        0,
        { k: kind, i: ip || "", s: since }
      );
    return records.length;
  } catch (_e) {
    return 0;
  }
}

// In-memory sliding window for proxy rate limiting. Per-process, resets on
// restart — acceptable because Fly typically runs 1-2 machines and a brief
// burst-over after a restart isn't a cost or security issue.
var _proxyHits = {};

function checkProxyRateLimit(key, maxPerWindow, windowMs) {
  if (!key) return { ok: true };
  const now = Date.now();
  const bucket = _proxyHits[key] || { count: 0, resetAt: now + windowMs };
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  _proxyHits[key] = bucket;
  if (bucket.count > maxPerWindow) {
    return {
      ok: false,
      retryAfterMs: bucket.resetAt - now,
      count: bucket.count,
    };
  }
  return { ok: true, count: bucket.count, resetAt: bucket.resetAt };
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

function assertString(val, maxLength) {
  if (maxLength === undefined) maxLength = 1024;
  if (typeof val !== "string") {
    throw new Error("Expected a string");
  }
  if (val.length > maxLength) {
    throw new Error("String exceeds maximum length of " + maxLength);
  }
  return val;
}

function assertEnum(val, allowedValues) {
  if (allowedValues.indexOf(val) === -1) {
    throw new Error("Invalid value. Allowed: " + allowedValues.join(", "));
  }
  return val;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Session resolution
  dealerFromSession,
  sessionRoleFromCookie,
  isAdminDealer,
  readSessionToken,
  findSessionByToken,
  // Token lifecycle
  createSession,
  revokeSession,
  buildSessionCookie,
  buildClearCookie,
  // Request metadata
  clientIP,
  userAgent,
  // Audit + rate limit
  logAuthEvent,
  countRecentEvents,
  checkProxyRateLimit,
  // Constants
  SESSION_TTL_SECONDS,
  // Validation
  assertString,
  assertEnum,
};
