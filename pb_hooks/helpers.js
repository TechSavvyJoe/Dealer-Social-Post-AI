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
const PROVIDER_RESOURCE_TTL_SECONDS = 48 * 60 * 60; // provider jobs/files are short-lived
const API_CONTRACT_VERSION = "2026-07-17.v2";

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
    const tokenHash = hashSessionToken(token);
    const record = $app.dao().findFirstRecordByFilter("sessions", "token_hash = {:h}", {
      h: tokenHash,
    });
    if (!record) return null;

    if (sessionIsExpired(record)) {
      deleteSessionRecord(record);
      return null;
    }
    return record;
  } catch (_e) {
    return null;
  }
}

function deleteSessionRecord(record) {
  if (!record) return;
  try {
    $app.dao().deleteRecord(record);
  } catch (_e) {
    /* authorization still fails when best-effort cleanup cannot run */
  }
}

function databaseTimestamp(value) {
  return (value || "").toString().replace("T", " ");
}

function sessionIsExpired(record) {
  if (!record) return true;
  const expiresAt = databaseTimestamp(record.getString("expires_at"));
  const now = databaseTimestamp(new Date().toISOString());
  return !expiresAt || expiresAt <= now;
}

function recordBool(record, field) {
  if (!record) return false;
  try {
    if (record.getBool) return !!record.getBool(field);
  } catch (_e) {}
  try {
    return !!record.get(field);
  } catch (_e) {
    return false;
  }
}

/**
 * Return the deployment credential only when it is valid exactly as supplied.
 * Whitespace is deliberately not normalized: ADMIN_DEALER_CODE is a secret,
 * not user-facing prose, and login comparison is case-sensitive.
 */
function configuredAdminSecret() {
  let raw = "";
  try {
    raw = ($os.getenv("ADMIN_DEALER_CODE") || "").toString();
  } catch (_e) {
    return "";
  }
  if (raw !== raw.trim()) return "";
  return /^[A-Za-z0-9]{12}$/.test(raw) ? raw : "";
}

/** One-way, context-bound verifier used to invalidate admin sessions on rotation. */
function adminSecretFingerprint(secret) {
  if (!secret || typeof secret !== "string") return "";
  try {
    const fingerprint = $security.sha256(
      "dealer-social-post-ai:admin-session:v1:" + secret,
    );
    if (/^[a-f0-9]{64}$/i.test(fingerprint || "")) {
      return fingerprint.toLowerCase();
    }
  } catch (_e) {}
  throw new Error("Secure admin credential fingerprinting is unavailable");
}

function personPinFingerprint(person) {
  if (!person) return "";
  const pin = person.getString("pin");
  if (!isValidPersonPin(pin)) return "";
  try {
    const fingerprint = $security.sha256(
      "dealer-social-post-ai:person-pin:v1:" + person.id + ":" + pin,
    );
    if (/^[a-f0-9]{64}$/i.test(fingerprint || "")) {
      return fingerprint.toLowerCase();
    }
  } catch (_e) {}
  throw new Error("Secure person credential fingerprinting is unavailable");
}

function findSystemDealer() {
  try {
    return $app.dao().findFirstRecordByFilter("dealers", "is_system = true", {});
  } catch (_e) {
    return null;
  }
}

function validateSuperAdminSession(session, daoOverride) {
  if (!session || sessionIsExpired(session)) return null;
  if (session.getString("role") !== "super_admin") return null;
  if (session.getString("person")) return null;
  if (recordBool(session, "is_impersonation")) return null;
  if (session.getString("impersonator_session")) return null;

  const secret = configuredAdminSecret();
  if (!secret) return null;
  let fingerprint = "";
  try {
    fingerprint = adminSecretFingerprint(secret);
  } catch (_e) {
    return null;
  }
  if (session.getString("admin_secret_fingerprint") !== fingerprint) {
    return null;
  }

  let dealer = null;
  try {
    const dao = daoOverride || $app.dao();
    dealer = dao.findRecordById("dealers", session.getString("dealer"));
  } catch (_e) {
    return null;
  }
  return recordBool(dealer, "is_system") ? dealer : null;
}

/**
 * Resolve and revalidate the complete authenticated identity on every request.
 * Stored session roles are never sufficient authority on their own: person
 * activity, tenant, current role, admin-secret rotation, and impersonation
 * provenance are checked against the current database state.
 */
function sessionContext(c) {
  const token = readSessionToken(c);
  if (!token) return null;
  const session = findSessionByToken(token);
  if (!session) {
    try {
      c.response().header().add("Set-Cookie", buildClearCookie());
    } catch (_e) {}
    return null;
  }

  const reject = function () {
    deleteSessionRecord(session);
    try {
      c.response().header().add("Set-Cookie", buildClearCookie());
    } catch (_e) {}
    return null;
  };
  const role = session.getString("role");

  if (role === "super_admin") {
    const systemDealer = validateSuperAdminSession(session);
    if (!systemDealer) return reject();
    return {
      token: token,
      session: session,
      dealer: systemDealer,
      person: null,
      role: role,
      isImpersonating: false,
      impersonatorSession: null,
    };
  }

  if (role !== "dealer_admin" && role !== "salesperson") return reject();
  const personId = session.getString("person");
  if (!personId) return reject();

  let person = null;
  let dealer = null;
  try {
    person = $app.dao().findRecordById("salespeople", personId);
    dealer = $app.dao().findRecordById("dealers", session.getString("dealer"));
  } catch (_e) {
    return reject();
  }
  if (!recordBool(person, "active")) return reject();
  if (person.getString("dealer") !== dealer.id) return reject();
  if (recordBool(dealer, "is_system")) return reject();
  if (personRoleToSessionRole(person.getString("role")) !== role) {
    return reject();
  }
  let currentPinFingerprint = "";
  try {
    currentPinFingerprint = personPinFingerprint(person);
  } catch (_e) {
    return reject();
  }
  if (
    !currentPinFingerprint ||
    session.getString("person_pin_fingerprint") !== currentPinFingerprint
  ) {
    return reject();
  }

  const isImpersonating = recordBool(session, "is_impersonation");
  const sourceId = session.getString("impersonator_session");
  let source = null;
  if (isImpersonating) {
    if (!sourceId || sourceId === session.id) return reject();
    try {
      source = $app.dao().findRecordById("sessions", sourceId);
    } catch (_e) {
      source = null;
    }
    if (!validateSuperAdminSession(source)) {
      if (source && sessionIsExpired(source)) deleteSessionRecord(source);
      return reject();
    }
  } else if (sourceId) {
    return reject();
  }

  return {
    token: token,
    session: session,
    dealer: dealer,
    person: person,
    role: role,
    isImpersonating: isImpersonating,
    impersonatorSession: source,
  };
}

// ---------------------------------------------------------------------------
// Public helpers used by main.pb.js
// ---------------------------------------------------------------------------

function dealerFromSession(c) {
  const context = sessionContext(c);
  return context ? context.dealer : null;
}

function sessionRoleFromCookie(c) {
  const context = sessionContext(c);
  return context ? context.role : null;
}

// ---------------------------------------------------------------------------
// Token mint / revoke
// ---------------------------------------------------------------------------

function secureRandomString(length, alphabet) {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error("Secure random length must be a positive integer");
  }
  if (typeof alphabet !== "string" || alphabet.length < 2) {
    throw new Error("Secure random alphabet is invalid");
  }

  try {
    if (typeof $security !== "undefined" && $security.randomStringWithAlphabet) {
      const value = $security.randomStringWithAlphabet(length, alphabet);
      if (value && value.length === length) return value;
    }
  } catch (_e) {
    /* fail closed below */
  }

  throw new Error("Cryptographically secure random generation is unavailable");
}

function mintSessionToken() {
  return secureRandomString(64, "0123456789abcdef");
}

function hashSessionToken(token) {
  if (typeof token !== "string" || !token) {
    throw new Error("Session token is invalid");
  }

  try {
    if (typeof $security !== "undefined" && $security.sha256) {
      const hash = $security.sha256(token);
      if (/^[a-f0-9]{64}$/i.test(hash || "")) return hash.toLowerCase();
    }
  } catch (_e) {
    /* fail closed below */
  }

  throw new Error("Secure session token hashing is unavailable");
}

/**
 * @param {string} dealerId
 * @param {string} role
 * @param {string} ip
 * @param {string} userAgent
 * @param {{ personId?: string, isImpersonation?: boolean, impersonatorSessionId?: string, expectedPersonPinFingerprint?: string }} [opts]
 */
function createSessionWithDao(dao, dealerId, role, ip, userAgent, opts) {
  const sessions = dao.findCollectionByNameOrId("sessions");
  if (!sessions) throw new Error("sessions collection missing");

  const options = opts || {};
  let dealer = null;
  try {
    dealer = dao.findRecordById("dealers", dealerId);
  } catch (_e) {
    throw new Error("Session dealer is invalid");
  }

  let person = null;
  let adminFingerprint = "";
  if (role === "super_admin") {
    if (options.personId || options.isImpersonation || options.impersonatorSessionId) {
      throw new Error("Super-admin session provenance is invalid");
    }
    if (!recordBool(dealer, "is_system")) {
      throw new Error("Super-admin session requires the system dealer");
    }
    const secret = configuredAdminSecret();
    if (!secret) throw new Error("Administrative login is not configured");
    adminFingerprint = adminSecretFingerprint(secret);
  } else {
    if (role !== "dealer_admin" && role !== "salesperson") {
      throw new Error("Session role is invalid");
    }
    if (recordBool(dealer, "is_system") || !options.personId) {
      throw new Error("Person-bound session identity is required");
    }
    try {
      person = dao.findRecordById("salespeople", options.personId);
    } catch (_e) {
      throw new Error("Session person is invalid");
    }
    if (
      !recordBool(person, "active") ||
      person.getString("dealer") !== dealer.id ||
      personRoleToSessionRole(person.getString("role")) !== role
    ) {
      throw new Error("Session person authority is invalid");
    }
    if (options.isImpersonation) {
      if (!options.impersonatorSessionId) {
        throw new Error("Impersonation source is required");
      }
      let source = null;
      try {
        source = dao.findRecordById("sessions", options.impersonatorSessionId);
      } catch (_e) {}
      if (!validateSuperAdminSession(source, dao)) {
        throw new Error("Impersonation source is invalid");
      }
    } else if (options.impersonatorSessionId) {
      throw new Error("Unexpected impersonation source");
    }

    const currentPinFingerprint = personPinFingerprint(person);
    if (!options.isImpersonation) {
      const expectedPinFingerprint = (
        options.expectedPersonPinFingerprint || ""
      ).toString();
      if (!expectedPinFingerprint || currentPinFingerprint !== expectedPinFingerprint) {
        // The login route must bind the bearer to the exact PIN-bearing record
        // that matched the submitted credential. Re-reading the person and then
        // silently adopting a concurrently rotated PIN lets an old credential
        // mint a session that survives the rotation.
        throw new Error("Session person credential changed during sign-in");
      }
    }
  }

  const token = mintSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  const payload = {
    // The cookie keeps the opaque token; SQLite stores only its SHA-256
    // verifier. Tokens contain 256 bits of CSPRNG entropy, so an offline
    // preimage attack remains infeasible without retaining plaintext secrets.
    token_hash: tokenHash,
    dealer: dealerId,
    role: role,
    expires_at: expires.toISOString(),
    last_used_at: now.toISOString(),
    ip: (ip || "").slice(0, 64),
    user_agent: (userAgent || "").slice(0, 512),
    is_impersonation: !!options.isImpersonation,
  };
  if (person) payload.person = person.id;
  if (person) payload.person_pin_fingerprint = personPinFingerprint(person);
  if (adminFingerprint) {
    payload.admin_secret_fingerprint = adminFingerprint;
  }
  if (options.impersonatorSessionId) {
    payload.impersonator_session = String(options.impersonatorSessionId).slice(0, 64);
  }

  const record = new Record(sessions, payload);
  dao.saveRecord(record);
  return { token: token, expiresAt: expires, sessionId: record.id };
}

function createSession(dealerId, role, ip, userAgent, opts) {
  return createSessionWithDao($app.dao(), dealerId, role, ip, userAgent, opts);
}

/**
 * Replace an impersonation child and its parked source with one fresh admin
 * session in a single database transaction. Any failed delete rolls back the
 * replacement too, so copied pre-exit cookies never remain valid alongside the
 * new super-admin bearer.
 */
function replaceImpersonationSession(
  impersonationSessionId,
  sourceSessionId,
  ip,
  userAgent,
) {
  if (!impersonationSessionId || !sourceSessionId) {
    throw new Error("Impersonation session provenance is missing");
  }
  let minted = null;
  $app.dao().runInTransaction(function (txDao) {
    const child = txDao.findRecordById("sessions", impersonationSessionId.toString());
    const source = txDao.findRecordById("sessions", sourceSessionId.toString());
    if (
      !child ||
      sessionIsExpired(child) ||
      !recordBool(child, "is_impersonation") ||
      child.getString("impersonator_session") !== source.id
    ) {
      throw new Error("Impersonation session is invalid");
    }
    const systemDealer = validateSuperAdminSession(source, txDao);
    if (!systemDealer) {
      throw new Error("Impersonation source is invalid");
    }

    minted = createSessionWithDao(
      txDao,
      systemDealer.id,
      "super_admin",
      ip,
      userAgent,
      {},
    );
    txDao.deleteRecord(child);
    txDao.deleteRecord(source);
  });
  if (!minted) throw new Error("Failed to replace impersonation session");
  return minted;
}

/** Exactly 4 digits — personal access codes for managers and salespeople. */
function isValidPersonPin(value) {
  return typeof value === "string" && /^[0-9]{4}$/.test(value);
}

function normalizePersonPin(value) {
  return (value || "").toString().trim();
}

/**
 * Find an active person by personal 4-digit pin without conflating an empty
 * result with a failed database lookup. `findFirstRecordByFilter` throws for
 * both cases in PocketBase 0.22, so use a bounded list query whose empty array
 * is an authoritative not-found result.
 */
function findActivePersonByPin(pin) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    return { status: "not_found", person: null };
  }
  try {
    const records = $app
      .dao()
      .findRecordsByFilter(
        "salespeople",
        "pin = {:pin} && active = true",
        "created",
        1,
        0,
        { pin: normalized },
      );
    if (!records || typeof records.length !== "number") {
      return { status: "unavailable", person: null };
    }
    return records.length > 0
      ? { status: "found", person: records[0] }
      : { status: "not_found", person: null };
  } catch (_e) {
    return { status: "unavailable", person: null };
  }
}

/**
 * Ensure a pin is globally free (optionally excluding a record id). Inactive
 * records keep their credential reserved so reactivation cannot fail or cause
 * an identity collision later.
 */
function assertPersonPinAvailable(pin, excludePersonId) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    throw new Error("Access code must be exactly 4 digits");
  }
  let match = null;
  try {
    let filter = "pin = {:pin}";
    const params = { pin: normalized };
    if (excludePersonId) {
      filter += " && id != {:excludeId}";
      params.excludeId = excludePersonId;
    }
    match = $app.dao().findFirstRecordByFilter("salespeople", filter, params);
  } catch (_e) {
    match = null;
  }
  if (match) throw new Error("Access code is already in use");
  return normalized;
}

function personRoleToSessionRole(personRole) {
  if (personRole === "manager") return "dealer_admin";
  if (personRole === "salesperson") return "salesperson";
  return "";
}

/** Minimal identity DTO used by login, restore, and impersonation responses. */
function serializePersonSummary(record) {
  if (!record) return null;
  return {
    id: record.id,
    dealer: record.getString("dealer"),
    name: record.getString("name"),
    role: record.getString("role") || "salesperson",
    active: recordBool(record, "active"),
  };
}

/** Manager roster DTO. Credential values are represented only by booleans. */
function serializePerson(record) {
  if (!record) return null;
  const pin = record.getString("pin");
  return {
    ...serializePersonSummary(record),
    created_at: record.getString("created_at"),
    hasPin: isValidPersonPin(pin),
    pinNeedsDistribution: recordBool(record, "pin_needs_distribution"),
  };
}

/**
 * Mint a unique 4-digit pin for a new person. Retries on collision.
 */
function generateUniquePersonPin() {
  const seed = secureRandomString(4, "0123456789");
  const start = parseInt(seed, 10);
  for (let offset = 0; offset < 10000; offset++) {
    const value = (start + offset) % 10000;
    const pin = String(10000 + value).slice(1);
    try {
      assertPersonPinAvailable(pin, "");
      return pin;
    } catch (_e) {
      /* try again */
    }
  }
  throw new Error("The four-digit access-code space is exhausted");
}

/**
 * Extend both sides of the sliding session window together. Refreshing only
 * the cookie leaves the authoritative database expiry unchanged and causes an
 * active browser to be logged out when the original seven-day deadline hits.
 */
function refreshSession(session) {
  if (!session) throw new Error("Session record is required");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  session.set("last_used_at", now.toISOString());
  session.set("expires_at", expires.toISOString());
  $app.dao().saveRecord(session);
  return expires;
}

function revokeSession(c) {
  const token = readSessionToken(c);
  if (!token) return 0;
  const tokenHash = hashSessionToken(token);
  // One SQLite statement atomically removes the presented bearer and, when it
  // is an impersonation child, its parked super-admin source. Database errors
  // must propagate: returning a successful logout while either copied bearer
  // remains valid is an authorization failure, not best-effort cleanup.
  return deleteSessionsWhere(
    "WITH doomed(id) AS (" +
      "SELECT id FROM sessions WHERE token_hash = {:hash} " +
      "UNION SELECT impersonator_session FROM sessions " +
      "WHERE token_hash = {:hash} AND is_impersonation = 1 " +
      "AND impersonator_session != ''" +
      ") DELETE FROM sessions WHERE id IN (SELECT id FROM doomed)",
    { hash: tokenHash },
  );
}

/**
 * Execute one unbounded SQLite DELETE and surface every failure to the caller.
 * A single statement is atomic; per-record DAO loops can partially revoke,
 * cap out at an arbitrary page size, and accidentally preserve live bearers.
 */
function deleteSessionsWhere(sql, params) {
  const result = $app.dao().db().newQuery(sql).bind(params).execute();
  if (!result || typeof result.rowsAffected !== "function") {
    throw new Error("Session revocation did not return an affected-row count");
  }
  const affected = Number(result.rowsAffected());
  if (!Number.isFinite(affected) || affected < 0) {
    throw new Error("Session revocation returned an invalid affected-row count");
  }
  return affected;
}

/**
 * Revoke every opaque session for a dealership after either login credential
 * changes. The caller may preserve its own token when a super-admin rotates
 * the credential on the dealer record backing the active admin session.
 */
function revokeDealerSessions(dealerId, preserveToken) {
  if (!dealerId) return 0;
  const params = { dealer: dealerId.toString() };
  let sql = "DELETE FROM sessions WHERE dealer = {:dealer}";
  if (preserveToken) {
    params.preserve = hashSessionToken(preserveToken);
    sql += " AND token_hash != {:preserve}";
  }
  return deleteSessionsWhere(sql, params);
}

/**
 * End every session tied to a person (pin rotate / deactivate).
 * Next sign-in must use the current access code.
 */
function revokePersonSessions(personId) {
  if (!personId) return 0;
  return deleteSessionsWhere("DELETE FROM sessions WHERE person = {:person}", {
    person: personId.toString(),
  });
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
// Client IP — direct Fly traffic uses Fly-Client-IP. Vercel sits in front of
// Fly for the production web origin, so its original client header is trusted
// only when the version-controlled rewrite injects a shared edge credential.
// ---------------------------------------------------------------------------

function safeForwardedIp(value) {
  let candidate = (value || "").toString().split(",")[0].trim();
  const bracketed = candidate.match(/^\[([0-9a-f:]+)\](?::\d+)?$/i);
  if (bracketed) candidate = bracketed[1];
  else if (/^[0-9.]+:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  if (!candidate || candidate.length > 64) return "";
  return /^[0-9a-f:.]+$/i.test(candidate) ? candidate : "";
}

function trustedVercelProxyRequest(c) {
  let configured = "";
  let supplied = "";
  try {
    configured = ($os.getenv("VERCEL_TO_FLY_PROXY_SECRET") || "").toString();
    supplied = (c.request().header.get("X-Dealer-Proxy-Secret") || "").toString();
  } catch (_e) {
    return false;
  }
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  try {
    return $security.sha256(supplied) === $security.sha256(configured);
  } catch (_e) {
    return false;
  }
}

function clientIP(c) {
  try {
    if (trustedVercelProxyRequest(c)) {
      const vercelIp = safeForwardedIp(
        c.request().header.get("X-Vercel-Forwarded-For") ||
          c.request().header.get("X-Forwarded-For"),
      );
      if (vercelIp) return vercelIp;
    }
    const flyIp = safeForwardedIp(c.request().header.get("Fly-Client-IP"));
    if (flyIp) return flyIp;
  } catch (_e) {
    /* ignore */
  }
  try {
    return safeForwardedIp(c.request().remoteAddr);
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

function legacyClientCompatibilityEnabled(c) {
  let enabled = false;
  let clientContract = "";
  try {
    enabled =
      ($os.getenv("LEGACY_CLIENT_COMPATIBILITY_ENABLED") || "")
        .toString()
        .trim()
        .toLowerCase() === "true";
    clientContract = (c.request().header.get("X-Dealer-Client-Contract") || "")
      .toString()
      .trim();
  } catch (_e) {
    return false;
  }
  return enabled && clientContract !== API_CONTRACT_VERSION;
}

// ---------------------------------------------------------------------------
// Generation provenance. PocketBase serializes every route callback into an
// isolated program, so route handlers must call these through this CommonJS
// module instead of closing over declarations in main.pb.js.
// ---------------------------------------------------------------------------

function proxyRequestHeader(requestInfo, name) {
  const headers = (requestInfo && requestInfo.headers) || {};
  const normalized = name.toLowerCase();
  const underscore = normalized.replace(/-/g, "_");
  const candidates = [normalized, underscore, name, name.toUpperCase()];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = headers[candidates[i]];
    if (value !== undefined && value !== null) {
      return value.toString().trim();
    }
  }
  return "";
}

function proxyGenerationIdentity(path, requestInfo, policies, provider, modelOverride) {
  const policy = policies.geminiModelPolicySnapshot();
  const normalizedPath = (path || "").toString();
  let model = (modelOverride || "").toString();
  if (!model) {
    const match = normalizedPath.match(
      /^v1beta\/models\/([a-z0-9._-]+):(generateContent|predictLongRunning)$/i,
    );
    if (!match) return null;
    model = match[1];
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(model)) return null;

  let kind = "";
  if (provider === "anthropic") kind = "text";
  else if (provider === "openai") kind = "image";
  else if (normalizedPath.indexOf(":predictLongRunning") !== -1) {
    kind = "video";
  } else {
    const taskNames = Object.keys(policy.tasks);
    for (let i = 0; i < taskNames.length; i += 1) {
      const task = policy.tasks[taskNames[i]];
      if (task.models.indexOf(model) !== -1) {
        kind = task.kind;
        if (kind === "image") break;
      }
    }
  }
  if (!kind) return null;

  const requestedTask = proxyRequestHeader(requestInfo, "x-generation-task");
  const requestedPolicyVersion = proxyRequestHeader(
    requestInfo,
    "x-model-policy-version",
  );
  let taskName = "";
  if (requestedTask && policy.tasks[requestedTask]) {
    const requested = policy.tasks[requestedTask];
    const providerModelAllowed =
      provider === "gemini" ? requested.models.indexOf(model) !== -1 : true;
    if (
      requested.kind === kind &&
      providerModelAllowed &&
      (!requestedPolicyVersion || requestedPolicyVersion === String(policy.version))
    ) {
      taskName = requestedTask;
    }
  }

  if (!taskName) {
    const fallbacks =
      kind === "text"
        ? ["caption"]
        : kind === "video"
          ? ["video_standard", "video_quality"]
          : ["image_standard", "image_studio"];
    for (let i = 0; i < fallbacks.length; i += 1) {
      const candidate = policy.tasks[fallbacks[i]];
      if (
        candidate &&
        (provider !== "gemini" || candidate.models.indexOf(model) !== -1)
      ) {
        taskName = fallbacks[i];
        break;
      }
    }
  }
  if (!taskName || !policy.tasks[taskName]) return null;

  return {
    task: taskName,
    kind: kind,
    tier: policy.tasks[taskName].tier,
    provider: provider,
    model: model,
    modelPolicyVersion: String(policy.version),
  };
}

function proxyGenerationResponseSucceeded(identity, statusCode, payload) {
  if (!identity || statusCode < 200 || statusCode >= 300 || !payload) {
    return false;
  }
  if (identity.provider === "openai") {
    return !!(
      Array.isArray(payload.data) &&
      payload.data.some(function (item) {
        return !!(item && (item.b64_json || item.url));
      })
    );
  }
  if (identity.provider === "anthropic") {
    return !!(
      Array.isArray(payload.content) &&
      payload.content.some(function (block) {
        return !!(block && block.type === "text" && String(block.text || "").trim());
      })
    );
  }
  if (identity.kind === "video") {
    return typeof payload.name === "string" && payload.name.length > 0;
  }
  const parts =
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts;
  if (!Array.isArray(parts)) return false;
  if (identity.kind === "text") {
    return parts.some(function (part) {
      return !!(part && typeof part.text === "string" && part.text.trim());
    });
  }
  return parts.some(function (part) {
    return !!(
      part &&
      part.inlineData &&
      typeof part.inlineData.data === "string" &&
      part.inlineData.data.length > 0
    );
  });
}

function recordProxyGenerationEvent(
  c,
  dealer,
  requestInfo,
  path,
  statusCode,
  provider,
  modelOverride,
  responsePayload,
) {
  let generationEventStage = "start";
  try {
    if (!dealer || !requestInfo) return;
    generationEventStage = "identity";
    const policies = require(__hooks + "/requestPolicies.js");
    const identity = proxyGenerationIdentity(
      path,
      requestInfo,
      policies,
      provider,
      modelOverride,
    );
    if (!identity) return;
    generationEventStage = "session";
    const token = readSessionToken(c);
    if (!token) return;
    const ownerSessionHash = hashSessionToken(token);
    generationEventStage = "attempt";
    let attemptId = proxyRequestHeader(requestInfo, "x-generation-attempt-id");
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(attemptId)) {
      attemptId = secureRandomString(32, "0123456789abcdef");
    }
    generationEventStage = "collection";
    const collection = $app.dao().findCollectionByNameOrId("generation_events");
    generationEventStage = "record";
    const record = new Record(collection, {
      dealer: dealer.id,
      owner_session_hash: ownerSessionHash,
      attempt_id: attemptId,
      task: identity.task,
      tier: identity.tier,
      provider: identity.provider,
      model: identity.model,
      succeeded: proxyGenerationResponseSucceeded(
        identity,
        statusCode,
        responsePayload,
      ),
      status_code: Math.max(0, Math.min(599, Number(statusCode) || 0)),
      model_policy_version: identity.modelPolicyVersion,
      occurred_at: new Date().toISOString(),
      consumed_post: "",
    });
    generationEventStage = "save";
    $app.dao().saveRecord(record);
  } catch (_err) {
    // Diagnostics must never make a valid provider request fail.
    console.error(
      "[generation-event] persistence failed at stage " + generationEventStage,
    );
  }
}

// ---------------------------------------------------------------------------
// Client telemetry privacy envelope. Only this CommonJS helper is called by
// the isolated telemetry handler; arbitrary browser text never reaches disk.
// ---------------------------------------------------------------------------

function redactTelemetryVinStrings(value) {
  return String(value).replace(/[A-HJ-NPR-Z0-9]{17}/gi, function (candidate) {
    if (!/\d/.test(candidate)) return candidate;
    return "[REDACTED_VIN]";
  });
}

function buildSafeTelemetryEnvelope(plainBody) {
  const rawName = (plainBody.name || "client.error").toString().slice(0, 120);
  const name = redactTelemetryVinStrings(rawName.replace(/[^A-Za-z0-9._:-]/g, "_"));
  const payloadObject =
    plainBody.payload && typeof plainBody.payload === "object" ? plainBody.payload : {};
  const safePayload = {};
  [
    "errorCode",
    "status",
    "task",
    "target",
    "kind",
    "handoff",
    "blocked",
    "fallbackCount",
    "modelPolicyVersion",
  ].forEach(function (key) {
    const value = payloadObject[key];
    if (typeof value === "boolean") {
      safePayload[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safePayload[key] = Math.max(-1000000, Math.min(1000000, value));
    } else if (
      typeof value === "string" &&
      value.length <= 120 &&
      /^[A-Za-z0-9._: -]*$/.test(value)
    ) {
      safePayload[key] = redactTelemetryVinStrings(value);
    }
  });
  const safeIdentifier = function (value) {
    const candidate = redactTelemetryVinStrings((value || "unknown").toString());
    return /^[A-Za-z0-9._:-]{1,64}$/.test(candidate) ? candidate : "unknown";
  };
  return {
    name: name || "client.error",
    payload: JSON.stringify(safePayload).slice(0, 2000),
    releaseSha: safeIdentifier(payloadObject.releaseSha),
    apiContractVersion: safeIdentifier(payloadObject.apiContractVersion),
  };
}

// ---------------------------------------------------------------------------
// Auth events — append-only audit log.
// ---------------------------------------------------------------------------

function saveAuthEvent(dao, kind, opts) {
  const col = dao.findCollectionByNameOrId("auth_events");
  if (!col) throw new Error("auth_events collection missing");
  const record = new Record(col, {
    kind: kind,
    dealer: (opts && opts.dealerId) || "",
    // Never persist the attempted credential. Presence is enough for abuse
    // diagnostics without turning the audit table into a credential dump.
    credential_present: !!(opts && opts.credentialPresent),
    ip: ((opts && opts.ip) || "").toString().slice(0, 64),
    user_agent: ((opts && opts.userAgent) || "").toString().slice(0, 512),
    detail: ((opts && opts.detail) || "").toString().slice(0, 1024),
  });
  dao.saveRecord(record);
  return record;
}

function logAuthEvent(kind, opts) {
  try {
    saveAuthEvent($app.dao(), kind, opts);
    return true;
  } catch (e) {
    // Callers performing a credential rejection must treat false as an
    // unavailable rate-limit store. Other audit-only call sites may remain
    // best effort without losing the explicit failure signal.
    console.error("[helpers.logAuthEvent] failed:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — counts auth_events within a window.
// ---------------------------------------------------------------------------

function countRecentEvents(kind, ip, windowSeconds) {
  const since = databaseTimestamp(
    new Date(Date.now() - windowSeconds * 1000).toISOString(),
  );
  try {
    const records = $app
      .dao()
      .findRecordsByFilter(
        "auth_events",
        "kind = {:k} && ip = {:i} && created >= {:s}",
        "-created",
        1000,
        0,
        { k: kind, i: ip || "", s: since },
      );
    return records.length;
  } catch (_e) {
    return 0;
  }
}

/**
 * Return the rolling failure count and an accurate lockout countdown. When
 * there are more failures than the threshold, the threshold-th newest event
 * is the one whose expiry will lower the count below the hard-lock boundary.
 */
function loginFailureStateWithDao(dao, ip, threshold, windowSeconds, excludeRecordId) {
  const now = Date.now();
  const since = databaseTimestamp(new Date(now - windowSeconds * 1000).toISOString());
  let records = [];
  try {
    records = dao.findRecordsByFilter(
      "auth_events",
      "kind = {:k} && ip = {:i} && created >= {:s}",
      "-created",
      1000,
      0,
      { k: "login_fail", i: ip || "", s: since },
    );
    if (excludeRecordId) {
      records = records.filter(function (record) {
        return record.id !== excludeRecordId;
      });
    }
  } catch (_e) {
    // Never turn a rate-limit database outage into a fresh, unlocked bucket.
    // `locked: true` is the fail-closed default for call sites that have not
    // yet learned the explicit `unavailable` signal.
    return {
      count: threshold,
      locked: true,
      retryAfterSeconds: windowSeconds,
      unavailable: true,
    };
  }

  const count = records.length;
  if (count < threshold) {
    return {
      count: count,
      locked: false,
      retryAfterSeconds: 0,
      unavailable: false,
    };
  }

  const boundary = records[Math.max(0, threshold - 1)];
  const rawCreated = boundary ? boundary.getString("created") : "";
  const normalizedCreated =
    rawCreated.indexOf("T") === -1 ? rawCreated.replace(" ", "T") : rawCreated;
  const createdAt = Date.parse(normalizedCreated);
  const elapsedMs = Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : 0;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowSeconds * 1000 - elapsedMs) / 1000),
  );
  return {
    count: count,
    locked: true,
    retryAfterSeconds: retryAfterSeconds,
    unavailable: false,
  };
}

function loginFailureState(ip, threshold, windowSeconds) {
  return loginFailureStateWithDao($app.dao(), ip, threshold, windowSeconds, "");
}

/**
 * Atomically reserve a credential comparison in the durable failure bucket.
 *
 * The first statement in the transaction is a write, which serializes callers
 * before they inspect the bucket. Without this reservation a parallel burst can
 * make every request observe the same pre-failure count and compare thousands
 * of four-digit PINs before Turnstile or the hard lock activates.
 *
 * The provisional row starts as `login_fail`, so a crashed request fails closed.
 * Successful authentication finalizes that same row as `login_success` before
 * the bearer cookie is exposed.
 */
function reserveLoginAttempt(opts) {
  const options = opts || {};
  const threshold = Number(options.threshold) || 10;
  const challengeAfter = Number(options.challengeAfter) || 3;
  const windowSeconds = Number(options.windowSeconds) || 15 * 60;
  let outcome = { status: "unavailable" };

  try {
    $app.dao().runInTransaction(function (txDao) {
      const reservation = saveAuthEvent(txDao, "login_fail", {
        credentialPresent: !!options.credentialPresent,
        ip: options.ip || "",
        userAgent: options.userAgent || "",
        detail: "credential comparison reserved",
      });

      const state = loginFailureStateWithDao(
        txDao,
        options.ip || "",
        threshold,
        windowSeconds,
        reservation.id,
      );
      if (state.unavailable) {
        throw new Error("Login failure state is unavailable");
      }
      if (state.locked) {
        txDao.deleteRecord(reservation);
        outcome = {
          status: "locked",
          retryAfterSeconds: state.retryAfterSeconds,
          count: state.count,
        };
        return;
      }
      if (state.count >= challengeAfter && !options.challengeValidated) {
        txDao.deleteRecord(reservation);
        outcome = { status: "challenge_required", count: state.count };
        return;
      }

      outcome = {
        status: "reserved",
        attemptId: reservation.id,
        count: state.count,
      };
    });
  } catch (_e) {
    return { status: "unavailable" };
  }
  return outcome;
}

function finalizeLoginAttempt(attemptId, kind, opts) {
  if (!attemptId || (kind !== "login_fail" && kind !== "login_success")) {
    return false;
  }
  try {
    const record = $app.dao().findRecordById("auth_events", attemptId);
    record.set("kind", kind);
    record.set("dealer", (opts && opts.dealerId) || "");
    record.set("credential_present", !!(opts && opts.credentialPresent));
    record.set("detail", ((opts && opts.detail) || "").toString().slice(0, 1024));
    $app.dao().saveRecord(record);
    return true;
  } catch (_e) {
    return false;
  }
}

function cancelLoginAttempt(attemptId) {
  if (!attemptId) return true;
  try {
    const records = $app
      .dao()
      .findRecordsByFilter("auth_events", "id = {:id}", "id", 1, 0, { id: attemptId });
    if (!records.length) return true;
    $app.dao().deleteRecord(records[0]);
    return true;
  } catch (_e) {
    return false;
  }
}

const TURNSTILE_ACTION = "turnstile-spin-v2";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_TEST_SITE_KEYS = [
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
];
const TURNSTILE_TEST_SECRETS = [
  TURNSTILE_TEST_SECRET,
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
];

function isTurnstileTestSiteKey(value) {
  return TURNSTILE_TEST_SITE_KEYS.indexOf((value || "").toString()) !== -1;
}

function isTurnstileTestSecret(value) {
  return TURNSTILE_TEST_SECRETS.indexOf((value || "").toString()) !== -1;
}

function formEncode(value) {
  return encodeURIComponent((value || "").toString()).replace(/%20/g, "+");
}

function configuredTurnstileHostnames() {
  const defaults = [
    "localhost",
    "127.0.0.1",
    "dealer-social-post-ai.vercel.app",
    "dealer-social-post-ai-production.fly.dev",
  ];
  let configured = "";
  try {
    configured = ($os.getenv("TURNSTILE_ALLOWED_HOSTNAMES") || "").toString();
  } catch (_e) {}
  const values = defaults.concat(configured.split(","));
  const seen = {};
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const hostname = values[i].toString().trim().toLowerCase();
    if (!hostname || seen[hostname]) continue;
    seen[hostname] = true;
    result.push(hostname);
  }
  return result;
}

/**
 * Canonical Cloudflare Turnstile siteverify call. Tokens and secrets are never
 * logged or persisted. Hostname and action are verified in addition to the
 * provider's success bit so a token minted for another surface is rejected.
 */
function verifyTurnstileToken(token, remoteIp) {
  const responseToken = (token || "").toString();
  if (!responseToken || responseToken.length > 2048) {
    return { ok: false, unavailable: false };
  }

  let secret = "";
  try {
    secret = ($os.getenv("TURNSTILE_SECRET") || "").toString();
  } catch (_e) {}
  if (!secret) return { ok: false, unavailable: true };
  try {
    if (($os.getenv("FLY_APP_NAME") || "") && isTurnstileTestSecret(secret)) {
      // Cloudflare test keys are useful only for deterministic local/CI
      // verification and must never satisfy a production challenge.
      return { ok: false, unavailable: true };
    }
  } catch (_e) {}

  let response;
  try {
    const fields = [
      "secret=" + formEncode(secret),
      "response=" + formEncode(responseToken),
    ];
    if (remoteIp) fields.push("remoteip=" + formEncode(remoteIp));
    response = $http.send({
      url: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fields.join("&"),
      // PocketBase 0.22 expresses $http timeouts in seconds, not milliseconds.
      timeout: 10,
    });
  } catch (_e) {
    return { ok: false, unavailable: true };
  }

  if (!response || response.statusCode !== 200 || !response.json) {
    return { ok: false, unavailable: true };
  }
  const result = response.json;
  if (result.success !== true) {
    const errorCodes = Array.isArray(result["error-codes"])
      ? result["error-codes"].map((value) => String(value))
      : [];
    const configurationFailure = errorCodes.some(
      (code) =>
        code === "missing-input-secret" ||
        code === "invalid-input-secret" ||
        code === "internal-error",
    );
    return { ok: false, unavailable: configurationFailure };
  }

  const hostname = (result.hostname || "").toString().trim().toLowerCase();
  const action = (result.action || "").toString();
  const usingTestSecret = secret === TURNSTILE_TEST_SECRET;
  const validatedTestResponse =
    usingTestSecret &&
    ((result.metadata && result.metadata.result_with_testing_key === true) ||
      hostname === "dummy-key-pass");
  if (
    !validatedTestResponse &&
    configuredTurnstileHostnames().indexOf(hostname) === -1
  ) {
    return { ok: false, unavailable: false };
  }
  if (action !== TURNSTILE_ACTION && !validatedTestResponse) {
    return { ok: false, unavailable: false };
  }
  return { ok: true, unavailable: false };
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

const DEALER_TEXT_FIELD_LIMITS = {
  name: 200,
  brand_voice: 1500,
  banned_phrases: 1500,
  oem_affiliation: 120,
  brand_color: 12,
  website: 500,
  phone: 40,
  address: 500,
  hours: 500,
  tagline: 200,
  facebook_url: 500,
  instagram_handle: 100,
  tiktok_handle: 100,
  x_handle: 100,
  gbp_url: 500,
  default_hashtags: 1500,
  default_footer: 500,
  enabled_styles: 500,
  default_style: 60,
  enabled_fun_styles: 2000,
  custom_scenarios: 32000,
};

/**
 * Build the allowlisted mutable dealers fields for the custom multipart
 * routes. Credential switches are passed by the authorized route so a
 * dealer-admin can never smuggle code/admin_code through the same payload.
 */
function dealerMutationData(body, allowCode, allowAdminCode) {
  const data = {};
  const fields = Object.keys(DEALER_TEXT_FIELD_LIMITS);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (body[field] === undefined) continue;
    let value = (body[field] || "").toString();
    if (field === "name") value = value.trim();
    data[field] = assertString(value, DEALER_TEXT_FIELD_LIMITS[field]);
  }

  // Login no longer uses dealers.code / admin_code for store access. They are
  // accepted only for one legacy client compatibility release and are never
  // populated on the canonical system dealer.
  if (allowCode && body.code !== undefined) {
    const code = assertString((body.code || "").toString().trim(), 12);
    if (code && !/^[A-Za-z0-9]{4,12}$/.test(code)) {
      throw new Error("Dealer code must be 4-12 alphanumeric characters");
    }
    data.code = code;
  }

  if (allowAdminCode && body.admin_code !== undefined) {
    const adminCode = assertString((body.admin_code || "").toString().trim(), 12);
    if (adminCode && !/^[A-Za-z0-9]{4,12}$/.test(adminCode)) {
      throw new Error("Manager code must be 4-12 alphanumeric characters");
    }
    data.admin_code = adminCode;
  }

  if (body.requires_approval !== undefined) {
    if (body.requires_approval === true || body.requires_approval === "true") {
      data.requires_approval = true;
    } else if (body.requires_approval === false || body.requires_approval === "false") {
      data.requires_approval = false;
    } else {
      throw new Error("requires_approval must be true or false");
    }
  }

  return data;
}

/**
 * Restrict the request-local collection model so RecordUpsertForm performs its
 * content-sniffed MIME validation against only the raster types the generation
 * pipeline supports. Assigning the complete options object is required by
 * PocketBase 0.22's schema bridge.
 */
function restrictDealerLogoSchema(collection) {
  const field = collection.schema.getFieldByName("logo");
  if (!field) throw new Error("Dealer logo field is unavailable");
  const options = field.options || {};
  options.mimeTypes = ["image/png", "image/jpeg", "image/webp"];
  options.maxSize = 5 * 1024 * 1024;
  field.options = options;
}

/** Parse an optional logo after the route-local schema has been restricted. */
function dealerLogoFile(c) {
  let header = null;
  try {
    header = c.formFile("logo");
  } catch (_e) {
    return null;
  }
  if (!header) return null;

  const file = $filesystem.fileFromMultipart(header);
  if (!file || file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new Error("Dealer logo must be no larger than 5 MB");
  }
  const originalName = (file.originalName || "").toString().toLowerCase();
  if (!/\.(png|jpe?g|webp)$/.test(originalName)) {
    throw new Error("Dealer logo must be a PNG, JPEG, or WebP image");
  }
  return file;
}

/**
 * Login resolves dealer codes and manager codes from the same credential
 * namespace. Enforce uniqueness across both columns so a new salesperson code
 * cannot shadow another dealership's manager credential (or vice versa).
 */
function assertDealerCredentialAvailable(credential, excludeDealerId) {
  if (!credential) return credential;
  let match = null;
  try {
    let filter = "code = {:credential} || admin_code = {:credential}";
    const params = { credential: credential };
    if (excludeDealerId) {
      filter = "(" + filter + ") && id != {:excludeId}";
      params.excludeId = excludeDealerId;
    }
    match = $app.dao().findFirstRecordByFilter("dealers", filter, params);
  } catch (_e) {
    // PocketBase throws when no row matches.
  }
  if (match) throw new Error("Dealer credential is already in use");
  return credential;
}

function mutationErrorText(err) {
  try {
    if (err && err.message) return err.message.toString();
    return (err || "").toString();
  } catch (_e) {
    return "";
  }
}

function safeDealerMutationError(err) {
  const message = mutationErrorText(err);
  const known = [
    "Dealer code must be exactly 6 digits",
    "Dealer code must be 4-12 alphanumeric characters",
    "Manager code must be 4-12 alphanumeric characters",
    "Dealer credential is already in use",
    "Dealer logo must be no larger than 5 MB",
    "Dealer logo must be a PNG, JPEG, or WebP image",
    "requires_approval must be true or false",
    "Access code must be exactly 4 digits",
    "Access code is already in use",
  ];
  for (let i = 0; i < known.length; i++) {
    if (message.indexOf(known[i]) !== -1) return known[i];
  }
  if (message.indexOf("Value must be unique") !== -1) {
    return "Access code is already in use";
  }
  if (message.indexOf("String exceeds maximum length") !== -1) {
    return "A dealer field exceeds its maximum length";
  }
  if (
    message.indexOf("logo") !== -1 &&
    (message.indexOf("mime type") !== -1 ||
      message.indexOf("maximum allowed file size") !== -1)
  ) {
    return "Dealer logo must be a PNG, JPEG, or WebP image under 5 MB";
  }
  return "Failed to save dealer";
}

function safePhotoReleaseError(err) {
  const message = mutationErrorText(err);
  if (
    message.indexOf("signature_png") !== -1 &&
    (message.indexOf("mime type") !== -1 ||
      message.indexOf("maximum allowed file size") !== -1)
  ) {
    return "Signature must be a PNG image under 500 KB";
  }
  if (message.indexOf("String exceeds maximum length") !== -1) {
    return "A photo-release field exceeds its maximum length";
  }
  return "Failed to save photo release";
}

// ---------------------------------------------------------------------------
// Durable provider-resource ownership
// ---------------------------------------------------------------------------

function normalizeProviderResource(resource) {
  if (!resource || typeof resource !== "object") {
    throw new Error("Provider resource is invalid");
  }
  const provider = (resource.provider || "").toString();
  const resourceType = (resource.resource_type || "").toString();
  const resourceId = (resource.resource_id || "").toString();
  if (
    (provider !== "gemini" && provider !== "vertex") ||
    (resourceType !== "operation" && resourceType !== "file") ||
    !resourceId ||
    resourceId.length > 500
  ) {
    throw new Error("Provider resource is invalid");
  }

  let validId = false;
  if (provider === "gemini" && resourceType === "operation") {
    validId =
      /^(?:operations\/[a-z0-9._~-]+|models\/[a-z0-9._-]+\/operations\/[a-z0-9._~-]+)$/i.test(
        resourceId,
      );
  } else if (provider === "gemini" && resourceType === "file") {
    validId = /^files\/[a-z0-9._~-]+$/i.test(resourceId);
  } else if (provider === "vertex" && resourceType === "operation") {
    validId =
      /^projects\/[a-z0-9._-]+\/locations\/[a-z0-9-]+\/operations\/[a-z0-9._~-]+$/i.test(
        resourceId,
      );
  }
  if (!validId) throw new Error("Provider resource is invalid");

  return {
    provider: provider,
    resource_type: resourceType,
    resource_id: resourceId,
  };
}

function providerResourceDate(date) {
  return date.toISOString().replace("T", " ");
}

function findProviderResource(resource) {
  try {
    return $app
      .dao()
      .findFirstRecordByFilter(
        "provider_resources",
        "provider = {:provider} && resource_type = {:type} && resource_id = {:id}",
        {
          provider: resource.provider,
          type: resource.resource_type,
          id: resource.resource_id,
        },
      );
  } catch (_e) {
    return null;
  }
}

function claimProviderResource(dealerId, input) {
  if (!dealerId) throw new Error("Provider resource dealer is required");
  const resource = normalizeProviderResource(input);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PROVIDER_RESOURCE_TTL_SECONDS * 1000);

  // Opportunistic cleanup keeps the locked ledger bounded without a scheduler.
  try {
    $app
      .dao()
      .db()
      .newQuery("DELETE FROM provider_resources WHERE expires_at <= {:now}")
      .bind({ now: providerResourceDate(now) })
      .execute();
  } catch (_e) {
    /* collection may not exist during a rolling migration */
  }

  let existing = findProviderResource(resource);
  if (existing) {
    if (existing.getString("dealer") !== dealerId) {
      throw new Error("Provider resource ownership collision");
    }
    existing.set("expires_at", providerResourceDate(expiresAt));
    $app.dao().saveRecord(existing);
    return existing;
  }

  const collection = $app.dao().findCollectionByNameOrId("provider_resources");
  const record = new Record(collection, {
    dealer: dealerId,
    provider: resource.provider,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    expires_at: providerResourceDate(expiresAt),
  });
  try {
    $app.dao().saveRecord(record);
    return record;
  } catch (err) {
    // Resolve a unique-index race without ever transferring ownership.
    existing = findProviderResource(resource);
    if (!existing || existing.getString("dealer") !== dealerId) throw err;
    existing.set("expires_at", providerResourceDate(expiresAt));
    $app.dao().saveRecord(existing);
    return existing;
  }
}

function claimProviderResources(dealerId, resources) {
  if (!Array.isArray(resources)) {
    throw new Error("Provider resource list is invalid");
  }
  for (let i = 0; i < resources.length; i++) {
    claimProviderResource(dealerId, resources[i]);
  }
  return resources.length;
}

function dealerOwnsProviderResource(dealerId, input) {
  if (!dealerId) return false;
  let resource = null;
  try {
    resource = normalizeProviderResource(input);
  } catch (_e) {
    return false;
  }
  const record = findProviderResource(resource);
  if (!record) return false;

  const expiresAt = record.getString("expires_at");
  // PocketBase stores sortable UTC strings (`YYYY-MM-DD HH:mm:ss.SSSZ`).
  // Goja's Date parser does not reliably accept that space-separated form, so
  // compare normalized database timestamps instead of risking NaN fail-open.
  const normalizedExpiry = (expiresAt || "").replace("T", " ");
  const now = providerResourceDate(new Date());
  if (!normalizedExpiry || normalizedExpiry <= now) {
    try {
      $app.dao().deleteRecord(record);
    } catch (_e) {}
    return false;
  }
  return record.getString("dealer") === dealerId;
}

/**
 * Serialize a dealers collection record into the public dealer payload shared
 * by POST and GET /api/app/session. Keep these in sync — a refresh must not
 * drop brand/settings fields that login returned.
 */
function serializeDealer(record) {
  let logoUrl = record.getString("logo");
  if (logoUrl && !logoUrl.startsWith("http")) {
    logoUrl = `/api/files/dealers/${record.id}/${logoUrl}`;
  }

  return {
    id: record.id,
    name: record.getString("name"),
    is_system: recordBool(record, "is_system"),
    logo: logoUrl,
    brand_voice: record.getString("brand_voice"),
    banned_phrases: record.getString("banned_phrases"),
    oem_affiliation: record.getString("oem_affiliation"),
    requires_approval: record.getBool
      ? record.getBool("requires_approval")
      : !!record.get("requires_approval"),
    brand_color: record.getString("brand_color"),
    website: record.getString("website"),
    phone: record.getString("phone"),
    address: record.getString("address"),
    hours: record.getString("hours"),
    tagline: record.getString("tagline"),
    facebook_url: record.getString("facebook_url"),
    instagram_handle: record.getString("instagram_handle"),
    tiktok_handle: record.getString("tiktok_handle"),
    x_handle: record.getString("x_handle"),
    gbp_url: record.getString("gbp_url"),
    default_hashtags: record.getString("default_hashtags"),
    default_footer: record.getString("default_footer"),
    enabled_styles: record.getString("enabled_styles"),
    default_style: record.getString("default_style"),
    enabled_fun_styles: record.getString("enabled_fun_styles"),
    custom_scenarios: record.getString("custom_scenarios"),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Session resolution
  dealerFromSession,
  sessionRoleFromCookie,
  sessionContext,
  readSessionToken,
  findSessionByToken,
  findSystemDealer,
  configuredAdminSecret,
  adminSecretFingerprint,
  personPinFingerprint,
  // Token lifecycle
  secureRandomString,
  mintSessionToken,
  hashSessionToken,
  createSession,
  replaceImpersonationSession,
  refreshSession,
  revokeSession,
  revokeDealerSessions,
  revokePersonSessions,
  buildSessionCookie,
  buildClearCookie,
  databaseTimestamp,
  // Request metadata
  clientIP,
  trustedVercelProxyRequest,
  userAgent,
  legacyClientCompatibilityEnabled,
  recordProxyGenerationEvent,
  proxyGenerationResponseSucceeded,
  buildSafeTelemetryEnvelope,
  // Audit + rate limit
  logAuthEvent,
  countRecentEvents,
  loginFailureState,
  reserveLoginAttempt,
  finalizeLoginAttempt,
  cancelLoginAttempt,
  verifyTurnstileToken,
  configuredTurnstileHostnames,
  isTurnstileTestSiteKey,
  isTurnstileTestSecret,
  checkProxyRateLimit,
  // Constants
  SESSION_TTL_SECONDS,
  PROVIDER_RESOURCE_TTL_SECONDS,
  TURNSTILE_ACTION,
  API_CONTRACT_VERSION,
  // Validation
  assertString,
  assertEnum,
  dealerMutationData,
  restrictDealerLogoSchema,
  dealerLogoFile,
  assertDealerCredentialAvailable,
  safeDealerMutationError,
  safePhotoReleaseError,
  isValidPersonPin,
  normalizePersonPin,
  findActivePersonByPin,
  assertPersonPinAvailable,
  personRoleToSessionRole,
  serializePerson,
  serializePersonSummary,
  generateUniquePersonPin,
  // Provider resource ownership
  claimProviderResource,
  claimProviderResources,
  dealerOwnsProviderResource,
  // Serialization
  serializeDealer,
};
