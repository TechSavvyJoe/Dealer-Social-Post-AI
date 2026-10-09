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
const API_CONTRACT_VERSION = "2026-07-31.v4";

/**
 * Optional proxy request fields this backend accepts, advertised on every
 * session payload and on /api/app/health. The installed app sends an optional
 * field only when the server that issued its session said so, so a backend
 * rollback or the older half of a mixed-version deploy never turns a new field
 * into a validation 400 for a request that server still accepts. Deliberately
 * separate from the model policy version (exact match, guards paid model
 * routing) and from API_CONTRACT_VERSION (guards breaking response shapes):
 * adding an optional field bumps neither. Mirrored by
 * services/proxyCapabilities.ts.
 */
const PROXY_CAPABILITIES = Object.freeze({
  // buildVeoRequest forwards a bounded `parameters.negativePrompt`.
  veoNegativePrompt: true,
});

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

function findSessionByToken(token, daoOverride) {
  if (!token) return null;
  try {
    const tokenHash = hashSessionToken(token);
    const record = (daoOverride || $app.dao()).findFirstRecordByFilter(
      "sessions",
      "token_hash = {:h}",
      {
        h: tokenHash,
      },
    );
    if (!record) return null;

    if (sessionIsExpired(record)) {
      deleteSessionRecord(record, daoOverride);
      return null;
    }
    return record;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throwSessionValidationUnavailable(err);
  }
}

function isNotFoundError(err) {
  if (!err) return false;
  const code = Number(err.code || err.status || err.statusCode || 0);
  if (code === 404 || err.name === "NotFoundError") return true;
  const message = (err.message || err.toString() || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^goerror:\s*/, "");
  // PocketBase 0.22 surfaces an empty findFirstRecordByFilter query as this
  // exact Go/SQLite sentinel rather than an HTTP-shaped 404.
  return message === "sql: no rows in result set";
}

/**
 * Route-safe ownership check for posts created after authoritative attribution
 * was introduced. Legacy salesperson_id/name fields were client-selectable, so
 * they must never grant access to a saved post.
 */
function isAuthoritativePostPerson(context, record) {
  if (!context || !context.person || !record) return false;
  let authoritative = false;
  try {
    authoritative = record.getBool
      ? !!record.getBool("attribution_authoritative")
      : !!record.get("attribution_authoritative");
  } catch (_e) {
    return false;
  }
  return authoritative && context.person.id === record.getString("owner_person_id");
}

/**
 * Provider transport errors can carry request URLs, response bodies, or header
 * values. Return only a short allowlisted diagnostic for server logs.
 */
function safeProviderTransportDiagnostic(err) {
  const clean = function (value) {
    return (value || "")
      .toString()
      .replace(/[^A-Za-z0-9_.:-]/g, "")
      .slice(0, 80);
  };
  const name = clean(err && err.name);
  const code = clean(err && err.code);
  const status = clean(err && (err.statusCode || err.status));
  const details = [];
  if (name) details.push("name=" + name);
  if (code) details.push("code=" + code);
  if (status) details.push("status=" + status);
  return details.length ? details.join(" ") : "unclassified_transport_error";
}

/**
 * An unavailable database/hash dependency is not proof that a bearer is
 * invalid. Surface a 503 and preserve both the cookie and session row so a
 * transient outage cannot sign the user out or erase their private workspace.
 */
function throwSessionValidationUnavailable(err) {
  console.error("[session validation] authority could not be revalidated", err);
  if (typeof ApiError === "function") {
    throw new ApiError(503, "Session validation is temporarily unavailable", {
      code: "UNAVAILABLE",
    });
  }
  throw err instanceof Error
    ? err
    : new Error("Session validation is temporarily unavailable");
}

function deleteSessionRecord(record, daoOverride) {
  if (!record) return;
  try {
    (daoOverride || $app.dao()).deleteRecord(record);
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
 * One-way session binding for the PocketBase-managed administrator account.
 * The fingerprint incorporates the account's token key, which PocketBase
 * rotates on password change — so rotating the admin password invalidates
 * every outstanding administrator session.
 */
function adminAuthFingerprint(account) {
  if (!account) return "";
  let tokenKey = "";
  try {
    tokenKey = account.tokenKey
      ? account.tokenKey().toString()
      : account.getString("tokenKey");
  } catch (_e) {
    return "";
  }
  if (!account.id || !tokenKey) return "";
  try {
    const fingerprint = $security.sha256(
      "dealer-social-post-ai:admin-auth:v1:" + account.id + ":" + tokenKey,
    );
    if (/^[a-f0-9]{64}$/i.test(fingerprint || "")) {
      return fingerprint.toLowerCase();
    }
  } catch (_e) {}
  throw new Error("Secure admin credential fingerprinting is unavailable");
}

/**
 * Resolve the administrator auth record for a submitted username without
 * exposing whether the username exists. Callers still validate the password.
 */
function findActiveAdminLogin(username) {
  const normalized = normalizeManagerUsername(username);
  if (!isValidManagerUsername(normalized)) {
    return { status: "not_found", account: null };
  }
  try {
    const accounts = $app
      .dao()
      .findRecordsByFilter("admin_accounts", "username = {:username}", "id", 2, 0, {
        username: normalized,
      });
    if (!accounts || typeof accounts.length !== "number") {
      return { status: "unavailable", account: null };
    }
    if (accounts.length !== 1) {
      return { status: "not_found", account: null };
    }
    return { status: "found", account: accounts[0] };
  } catch (_e) {
    return { status: "unavailable", account: null };
  }
}

/**
 * Idempotent administrator-account provisioning from deployment secrets
 * (ADMIN_LOGIN_USERNAME + ADMIN_LOGIN_PASSWORD).
 *
 * Called with syncPassword=true at bootstrap (handles username/password
 * rotation), and with syncPassword=false from the health route and the login
 * path as a creation-only self-heal for fresh databases where migrations may
 * land after the bootstrap hook has already run.
 */
function ensureAdminAccountProvisioned(options) {
  const syncPassword = !!(options && options.syncPassword);
  const username = normalizeManagerUsername($os.getenv("ADMIN_LOGIN_USERNAME") || "");
  const password = ($os.getenv("ADMIN_LOGIN_PASSWORD") || "").toString();

  let accounts;
  try {
    accounts = $app
      .dao()
      .findRecordsByFilter("admin_accounts", "id != ''", "-created", 2, 0, {});
  } catch (_e) {
    // Collection missing (migrations not applied yet) — nothing to do.
    return;
  }

  if (!username || !password) {
    if (!accounts.length && syncPassword) {
      console.log(
        "[admin-bootstrap] Administrator login is not configured. Set ADMIN_LOGIN_USERNAME and ADMIN_LOGIN_PASSWORD deployment secrets.",
      );
    }
    return;
  }
  if (!isValidManagerUsername(username) || !isManagerLoginPasswordShape(password)) {
    if (syncPassword) {
      console.error(
        "[admin-bootstrap] ADMIN_LOGIN_USERNAME/ADMIN_LOGIN_PASSWORD are invalid (username: 3-32 chars starting with a letter; password: 8-128 chars). Administrator login left unchanged.",
      );
    }
    return;
  }

  let target = null;
  for (let i = 0; i < accounts.length; i++) {
    if (normalizeManagerUsername(accounts[i].getString("username")) === username) {
      target = accounts[i];
      break;
    }
  }

  try {
    if (!target && accounts.length > 1) {
      if (syncPassword) {
        console.error(
          "[admin-bootstrap] Multiple administrator accounts exist and none match ADMIN_LOGIN_USERNAME. Not modifying credentials.",
        );
      }
      return;
    }
    if (!target && accounts.length === 1) {
      if (!syncPassword) return;
      // Username rotation: rename the single existing account.
      target = accounts[0];
      target.setUsername(username);
      target.setPassword(password);
      $app.dao().saveRecord(target);
      console.log("[admin-bootstrap] Administrator username/password rotated.");
      return;
    }
    if (!target) {
      const collection = $app.dao().findCollectionByNameOrId("admin_accounts");
      const account = new Record(collection);
      account.setUsername(username);
      account.setPassword(password);
      account.setVerified(true);
      $app.dao().saveRecord(account);
      console.log("[admin-bootstrap] Administrator account created.");
      return;
    }
    if (!syncPassword) return;
    let passwordCurrent = false;
    try {
      passwordCurrent = !!target.validatePassword(password);
    } catch (_e) {}
    if (!passwordCurrent) {
      // Password rotation: outstanding administrator sessions are invalidated
      // because the account token key changes with the password.
      target.setPassword(password);
      $app.dao().saveRecord(target);
      console.log("[admin-bootstrap] Administrator password rotated.");
    }
  } catch (err) {
    console.error("[admin-bootstrap] Administrator account provisioning failed:", err);
  }
}

/** Cost-equivalent negative password check target for unknown admin usernames. */
function findAdminPasswordVerificationAccount() {
  try {
    const accounts = $app
      .dao()
      .findRecordsByFilter("admin_accounts", "id != ''", "id", 1, 0, {});
    if (!accounts || typeof accounts.length !== "number") {
      return { status: "unavailable", account: null };
    }
    return accounts.length
      ? { status: "found", account: accounts[0] }
      : { status: "empty", account: null };
  } catch (_e) {
    return { status: "unavailable", account: null };
  }
}

/** Lowercase-hex shape of a peppered access-code hash. */
function isValidPersonPinHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function salespersonPinPepper() {
  try {
    return ($os.getenv("SALESPERSON_PIN_PEPPER") || "").toString().trim();
  } catch (_e) {
    return "";
  }
}

/**
 * Peppered one-way transform for personal access codes. A four-digit code has
 * only 10^4 possibilities, so the security of stored credentials rests entirely
 * on the server-side pepper: without it a copied database row is useless.
 */
function personPinHash(pin) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    throw new Error("Access code must be exactly 4 digits");
  }
  const pepper = salespersonPinPepper();
  if (pepper.length < 32) {
    throw new Error("SALESPERSON_PIN_PEPPER is not configured");
  }
  const digest = $security.hs256(
    "dealer-social-post-ai:person-pin-hash:v1:" + normalized,
    pepper,
  );
  if (!isValidPersonPinHash((digest || "").toLowerCase())) {
    throw new Error("Secure access-code hashing is unavailable");
  }
  return digest.toLowerCase();
}

function personPinFingerprint(person) {
  if (!person) return "";
  const pinHash = person.getString("pin_hash");
  const pin = person.getString("pin");
  if (!isValidPersonPinHash(pinHash) && !isValidPersonPin(pin)) return "";
  try {
    // v2 binds sessions to the stored hash; v1 (plaintext-derived) remains only
    // for straggler rows written by an old process before the bootstrap sweep.
    const fingerprint = isValidPersonPinHash(pinHash)
      ? $security.sha256(
          "dealer-social-post-ai:person-pin:v2:" + person.id + ":" + pinHash,
        )
      : $security.sha256(
          "dealer-social-post-ai:person-pin:v1:" + person.id + ":" + pin,
        );
    if (/^[a-f0-9]{64}$/i.test(fingerprint || "")) {
      return fingerprint.toLowerCase();
    }
  } catch (_e) {}
  throw new Error("Secure person credential fingerprinting is unavailable");
}

/**
 * One-boot sweep that converts plaintext access codes to peppered hashes.
 * Idempotent: only rows with a plaintext pin and no hash are touched. Each
 * person converts inside one transaction that also rewrites the fingerprints
 * of their live sessions, so nobody is logged out by the storage change.
 * Returns counts so the bootstrap log shows exactly what happened.
 */
function backfillSalespersonPinHashes() {
  const summary = { converted: 0, skipped: 0, failed: 0 };
  // Never touch plaintext rows before the pin_hash migration has applied: on
  // PB 0.22 this bootstrap hook is not ordered strictly after pending
  // migrations on an upgraded database, and converting under the old schema
  // races the people-integrity repair (blanking codes it then re-mints). The
  // initial conversion happens inside migration 1751300001; this sweep only
  // catches stragglers written by an old process during the deploy window.
  try {
    const collection = $app.dao().findCollectionByNameOrId("salespeople");
    if (!collection.schema.getFieldByName("pin_hash")) return summary;
  } catch (_e) {
    return summary;
  }
  const BATCH = 500;
  // 10k is the entire four-digit space; anything above it means rows are
  // failing conversion and re-appearing — stop rather than spin.
  const MAX_BATCHES = 25;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let rows;
    try {
      rows = $app
        .dao()
        .findRecordsByFilter("salespeople", "pin != ''", "created", BATCH, 0, {});
    } catch (_e) {
      return summary;
    }
    if (!rows || !rows.length) return summary;
    if (salespersonPinPepper().length < 32) {
      console.error(
        "[pin-backfill] SALESPERSON_PIN_PEPPER is missing or too short; " +
          rows.length +
          " plaintext access codes remain unhashed.",
      );
      summary.skipped += rows.length;
      return summary;
    }
    let convertedThisBatch = 0;
    let malformedThisBatch = 0;
    for (let i = 0; i < rows.length; i++) {
      const person = rows[i];
      let outcome = "converted";
      try {
        $app.dao().runInTransaction(function (txDao) {
          const txPerson = txDao.findRecordById("salespeople", person.id);
          const pin = txPerson.getString("pin");
          if (!isValidPersonPin(pin)) {
            // Not convertible and not clearable; leave for investigation.
            outcome = "malformed";
            return;
          }
          // A plaintext code alongside a stored hash can only mean an
          // old-process write AFTER conversion (new code always blanks pin
          // in the same save that writes pin_hash), so the plaintext is the
          // NEWER credential — always re-hash it rather than resurrecting
          // the stored hash, and rebind live sessions to the result.
          txPerson.set("pin_hash", personPinHash(pin));
          txPerson.set("pin", "");
          txDao.saveRecord(txPerson);
          const nextFingerprint = personPinFingerprint(txPerson);
          const sessions = txDao.findRecordsByFilter(
            "sessions",
            "person = {:personId}",
            "created",
            200,
            0,
            { personId: txPerson.id },
          );
          for (let j = 0; j < (sessions || []).length; j++) {
            sessions[j].set("person_pin_fingerprint", nextFingerprint);
            txDao.saveRecord(sessions[j]);
          }
        });
        if (outcome === "malformed") {
          malformedThisBatch++;
        } else {
          summary.converted++;
          convertedThisBatch++;
        }
      } catch (err) {
        summary.failed++;
        console.error("[pin-backfill] failed for person " + person.id + ": " + err);
      }
    }
    // Malformed/failed rows keep matching the batch filter; a batch with no
    // real conversion means only those remain — stop instead of spinning.
    if (convertedThisBatch === 0) {
      if (malformedThisBatch > 0) {
        console.warn(
          "[pin-backfill] " +
            malformedThisBatch +
            " row(s) hold a non-empty but malformed pin and were left untouched — investigate manually.",
        );
      }
      return summary;
    }
  }
  console.error(
    "[pin-backfill] stopped after " +
      MAX_BATCHES +
      " batches with plaintext rows remaining — investigate before relying on the sweep.",
  );
  return summary;
}

/** One-way session binding for PocketBase-managed manager credentials. */
function managerAuthFingerprint(account) {
  if (!account) return "";
  let tokenKey = "";
  try {
    tokenKey = account.tokenKey
      ? account.tokenKey().toString()
      : account.getString("tokenKey");
  } catch (_e) {
    return "";
  }
  if (!account.id || !tokenKey) return "";
  try {
    const fingerprint = $security.sha256(
      "dealer-social-post-ai:manager-auth:v1:" + account.id + ":" + tokenKey,
    );
    if (/^[a-f0-9]{64}$/i.test(fingerprint || "")) {
      return fingerprint.toLowerCase();
    }
  } catch (_e) {}
  throw new Error("Secure manager credential fingerprinting is unavailable");
}

function findSystemDealer() {
  try {
    return $app.dao().findFirstRecordByFilter("dealers", "is_system = true", {});
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throwSessionValidationUnavailable(err);
  }
}

function validateSuperAdminSession(session, daoOverride) {
  if (!session || sessionIsExpired(session)) return null;
  if (session.getString("role") !== "super_admin") return null;
  if (session.getString("person")) return null;
  if (recordBool(session, "is_impersonation")) return null;
  if (session.getString("impersonator_session")) return null;

  // The session must match a current administrator account's credential
  // fingerprint. Password rotation changes the account token key, so stale
  // sessions stop validating here.
  const sessionFingerprint = session.getString("admin_secret_fingerprint");
  if (!/^[a-f0-9]{64}$/i.test(sessionFingerprint || "")) return null;
  let matched = false;
  try {
    const dao = daoOverride || $app.dao();
    const accounts = dao.findRecordsByFilter(
      "admin_accounts",
      "id != ''",
      "id",
      10,
      0,
      {},
    );
    for (let i = 0; i < (accounts ? accounts.length : 0); i++) {
      if (adminAuthFingerprint(accounts[i]) === sessionFingerprint) {
        matched = true;
        break;
      }
    }
  } catch (err) {
    throwSessionValidationUnavailable(err);
  }
  if (!matched) return null;

  let dealer = null;
  try {
    const dao = daoOverride || $app.dao();
    dealer = dao.findRecordById("dealers", session.getString("dealer"));
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throwSessionValidationUnavailable(err);
  }
  return recordBool(dealer, "is_system") ? dealer : null;
}

/**
 * A source super-admin bearer is parked while an active impersonation child
 * references it. The source row remains authoritative for validating and
 * exiting the child, but the copied source cookie cannot be used in parallel.
 *
 * This query must run on the caller's DAO. During impersonation creation that
 * DAO is the audited transaction DAO, so concurrent attempts serialize around
 * the check and insert instead of minting two live children.
 */
function sourceHasActiveImpersonationChild(dao, sourceSessionId) {
  if (!dao || !sourceSessionId) return false;
  let children = null;
  try {
    children = dao.findRecordsByFilter(
      "sessions",
      "is_impersonation = true && impersonator_session = {:source} && expires_at > {:now}",
      "id",
      1,
      0,
      {
        source: sourceSessionId.toString(),
        now: databaseTimestamp(new Date().toISOString()),
      },
    );
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throwSessionValidationUnavailable(err);
  }
  if (!children || typeof children.length !== "number") {
    throwSessionValidationUnavailable(
      new Error("Impersonation source lookup returned an invalid result"),
    );
  }
  return children.length > 0;
}

/**
 * Resolve and revalidate the complete authenticated identity on every request.
 * Stored session roles are never sufficient authority on their own: person
 * activity, tenant, current role, admin-secret rotation, and impersonation
 * provenance are checked against the current database state.
 */
function sessionContext(c, daoOverride) {
  const token = readSessionToken(c);
  if (!token) return null;
  const dao = daoOverride || $app.dao();
  const session = findSessionByToken(token, dao);
  if (!session) {
    try {
      c.response().header().add("Set-Cookie", buildClearCookie());
    } catch (_e) {}
    return null;
  }

  const reject = function () {
    deleteSessionRecord(session, dao);
    try {
      c.response().header().add("Set-Cookie", buildClearCookie());
    } catch (_e) {}
    return null;
  };
  const role = session.getString("role");

  if (role === "super_admin") {
    const systemDealer = validateSuperAdminSession(session, dao);
    if (!systemDealer) return reject();
    if (sourceHasActiveImpersonationChild(dao, session.id)) {
      // Do not delete the parked source: the child still needs it for
      // continuous authority checks and the atomic exit replacement.
      try {
        c.response().header().add("Set-Cookie", buildClearCookie());
      } catch (_e) {}
      return null;
    }
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
    person = dao.findRecordById("salespeople", personId);
    dealer = dao.findRecordById("dealers", session.getString("dealer"));
  } catch (err) {
    if (isNotFoundError(err)) return reject();
    throwSessionValidationUnavailable(err);
  }
  if (!recordBool(person, "active")) return reject();
  if (person.getString("dealer") !== dealer.id) return reject();
  if (recordBool(dealer, "is_system")) return reject();
  if (personRoleToSessionRole(person.getString("role")) !== role) {
    return reject();
  }
  const currentPinFingerprint = personPinFingerprint(person);
  if (
    !currentPinFingerprint ||
    session.getString("person_pin_fingerprint") !== currentPinFingerprint
  ) {
    return reject();
  }

  if (
    (recordBool(dealer, "invitation_required") ||
      session.getString("invitation_fingerprint")) &&
    !require(__hooks + "/dealershipInvitations.js").sessionAllowed(session, dealer)
  )
    return reject();

  const isImpersonating = recordBool(session, "is_impersonation");
  const sourceId = session.getString("impersonator_session");
  const managerAccountId = session.getString("manager_account");
  const storedManagerFingerprint = session.getString("manager_auth_fingerprint");

  if (isImpersonating) {
    if (managerAccountId || storedManagerFingerprint) return reject();
  } else if (managerAccountId || storedManagerFingerprint) {
    if (
      role !== "dealer_admin" ||
      person.getString("role") !== "manager" ||
      !managerAccountId ||
      !storedManagerFingerprint
    ) {
      return reject();
    }
    let account = null;
    try {
      account = dao.findRecordById("manager_accounts", managerAccountId);
    } catch (err) {
      if (isNotFoundError(err)) return reject();
      throwSessionValidationUnavailable(err);
    }
    if (
      account.getString("person") !== person.id ||
      normalizeManagerUsername(account.getString("username")) !==
        normalizeManagerUsername(person.getString("manager_username")) ||
      managerAuthFingerprint(account) !== storedManagerFingerprint
    ) {
      return reject();
    }
  }

  let source = null;
  if (isImpersonating) {
    if (!sourceId || sourceId === session.id) return reject();
    try {
      source = dao.findRecordById("sessions", sourceId);
    } catch (err) {
      if (isNotFoundError(err)) {
        source = null;
      } else {
        throwSessionValidationUnavailable(err);
      }
    }
    if (!validateSuperAdminSession(source, dao)) {
      if (source && sessionIsExpired(source)) deleteSessionRecord(source, dao);
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
 * @param {{ personId?: string, isImpersonation?: boolean, impersonatorSessionId?: string, expectedPersonPinFingerprint?: string, managerAccountId?: string, expectedManagerAuthFingerprint?: string, expectedInvitationFingerprint?: string }} [opts]
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
  let managerAccount = null;
  let managerFingerprint = "";
  let adminFingerprint = "";
  if (role === "super_admin") {
    if (options.personId || options.isImpersonation || options.impersonatorSessionId) {
      throw new Error("Super-admin session provenance is invalid");
    }
    if (!recordBool(dealer, "is_system")) {
      throw new Error("Super-admin session requires the system dealer");
    }
    if (!options.adminAccountId || !options.expectedAdminAuthFingerprint) {
      throw new Error("Administrator credential provenance is required");
    }
    let adminAccount = null;
    try {
      adminAccount = dao.findRecordById(
        "admin_accounts",
        options.adminAccountId.toString(),
      );
    } catch (_e) {
      throw new Error("Administrator credential record is invalid");
    }
    adminFingerprint = adminAuthFingerprint(adminAccount);
    if (
      !adminFingerprint ||
      adminFingerprint !== options.expectedAdminAuthFingerprint.toString()
    ) {
      throw new Error("Administrator credential changed during sign-in");
    }
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
      if (options.managerAccountId || options.expectedManagerAuthFingerprint) {
        throw new Error("Impersonation cannot carry direct manager credentials");
      }
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
      if (sourceHasActiveImpersonationChild(dao, source.id)) {
        throw new Error("Impersonation source already has an active child");
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

      if (options.managerAccountId || options.expectedManagerAuthFingerprint) {
        if (
          role !== "dealer_admin" ||
          person.getString("role") !== "manager" ||
          !options.managerAccountId ||
          !options.expectedManagerAuthFingerprint
        ) {
          throw new Error("Manager credential provenance is invalid");
        }
        try {
          managerAccount = dao.findRecordById(
            "manager_accounts",
            options.managerAccountId.toString(),
          );
        } catch (_e) {
          throw new Error("Manager credential record is invalid");
        }
        managerFingerprint = managerAuthFingerprint(managerAccount);
        if (
          managerAccount.getString("person") !== person.id ||
          normalizeManagerUsername(managerAccount.getString("username")) !==
            normalizeManagerUsername(person.getString("manager_username")) ||
          managerFingerprint !== options.expectedManagerAuthFingerprint.toString()
        ) {
          throw new Error("Manager credential changed during sign-in");
        }
      }
    }
  }

  // Recheck the invitation in the same transaction that creates the session.
  // A rotation between credential comparison and minting cannot revive access.
  const invitationFingerprint = (
    options.expectedInvitationFingerprint || ""
  ).toString();
  if (
    !options.isImpersonation &&
    !managerAccount &&
    role !== "super_admin" &&
    (recordBool(dealer, "invitation_required") || invitationFingerprint)
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(invitationFingerprint) ||
      invitationFingerprint !== dealer.getString("invitation_hash")
    )
      throw new Error("Dealership invitation changed during sign-in");
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
  if (invitationFingerprint) payload.invitation_fingerprint = invitationFingerprint;
  if (person) payload.person = person.id;
  if (person) payload.person_pin_fingerprint = personPinFingerprint(person);
  if (managerAccount) payload.manager_account = managerAccount.id;
  if (managerFingerprint) {
    payload.manager_auth_fingerprint = managerFingerprint;
  }
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
  let created;
  $app.dao().runInTransaction(function (tx) {
    created = createSessionWithDao(tx, dealerId, role, ip, userAgent, opts);
  });
  return created;
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
  audit,
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

    // The replacement inherits the source's validated administrator
    // credential binding.
    const sourceFingerprint = source.getString("admin_secret_fingerprint");
    let adminAccount = null;
    const adminAccounts = txDao.findRecordsByFilter(
      "admin_accounts",
      "id != ''",
      "id",
      10,
      0,
      {},
    );
    for (let i = 0; i < (adminAccounts ? adminAccounts.length : 0); i++) {
      if (adminAuthFingerprint(adminAccounts[i]) === sourceFingerprint) {
        adminAccount = adminAccounts[i];
        break;
      }
    }
    if (!adminAccount) {
      throw new Error("Impersonation source is invalid");
    }

    minted = createSessionWithDao(
      txDao,
      systemDealer.id,
      "super_admin",
      ip,
      userAgent,
      {
        adminAccountId: adminAccount.id,
        expectedAdminAuthFingerprint: sourceFingerprint,
      },
    );
    txDao.deleteRecord(child);
    txDao.deleteRecord(source);
    if (audit && audit.kind) {
      saveAuthEvent(txDao, audit.kind, audit.options || {});
    }
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

function normalizeManagerUsername(value) {
  return (value || "").toString().trim().toLowerCase();
}

function isValidManagerUsername(value) {
  return /^[a-z][a-z0-9._-]{2,31}$/.test(normalizeManagerUsername(value));
}

/** Login accepts only bounded input; setup applies the stronger composition rule. */
function isManagerLoginPasswordShape(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function isStrongManagerPassword(value) {
  return isManagerLoginPasswordShape(value);
}

/**
 * Resolve the active manager and its locked auth record without exposing
 * whether the username exists. Callers still validate the exact password.
 */
function findActiveManagerLogin(username) {
  const normalized = normalizeManagerUsername(username);
  if (!isValidManagerUsername(normalized)) {
    return { status: "not_found", person: null, account: null };
  }
  try {
    const people = $app
      .dao()
      .findRecordsByFilter(
        "salespeople",
        "manager_username = {:username} && role = 'manager' && active = true",
        "id",
        2,
        0,
        { username: normalized },
      );
    if (!people || typeof people.length !== "number") {
      return { status: "unavailable", person: null, account: null };
    }
    if (people.length !== 1) {
      return { status: "not_found", person: null, account: null };
    }
    const accounts = $app
      .dao()
      .findRecordsByFilter("manager_accounts", "person = {:person}", "id", 2, 0, {
        person: people[0].id,
      });
    if (!accounts || typeof accounts.length !== "number") {
      return { status: "unavailable", person: null, account: null };
    }
    if (
      accounts.length !== 1 ||
      normalizeManagerUsername(accounts[0].getString("username")) !== normalized
    ) {
      return { status: "not_found", person: null, account: null };
    }
    return { status: "found", person: people[0], account: accounts[0] };
  } catch (_e) {
    return { status: "unavailable", person: null, account: null };
  }
}

/**
 * Return an existing password verifier for cost-equivalent negative checks.
 * Once at least one manager account exists, an unknown valid username still
 * performs PocketBase's normal password verification work before the generic
 * rejection. The result is never treated as an identity match.
 */
function findManagerPasswordVerificationAccount() {
  try {
    const accounts = $app
      .dao()
      .findRecordsByFilter("manager_accounts", "id != ''", "id", 1, 0, {});
    if (!accounts || typeof accounts.length !== "number") {
      return { status: "unavailable", account: null };
    }
    return accounts.length
      ? { status: "found", account: accounts[0] }
      : { status: "empty", account: null };
  } catch (_e) {
    return { status: "unavailable", account: null };
  }
}

function findManagerAccountByPersonWithDao(dao, personId) {
  if (!dao || !personId) return null;
  const records = dao.findRecordsByFilter(
    "manager_accounts",
    "person = {:person}",
    "id",
    2,
    0,
    { person: personId.toString() },
  );
  if (!records || typeof records.length !== "number") {
    throw new Error("Manager credential lookup returned an invalid result");
  }
  if (records.length > 1) {
    throw new Error("Manager has duplicate credential records");
  }
  return records.length ? records[0] : null;
}

function assertManagerUsernameAvailableWithDao(dao, username, personId) {
  const normalized = normalizeManagerUsername(username);
  if (!isValidManagerUsername(normalized)) {
    throw new Error("Username must be 3 to 32 characters and start with a letter.");
  }
  const matches = dao.findRecordsByFilter(
    "salespeople",
    "manager_username = {:username}",
    "id",
    2,
    0,
    { username: normalized },
  );
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].id !== personId) {
      throw new Error("That manager username is already in use.");
    }
  }
  const existingAccount = findManagerAccountByPersonWithDao(dao, personId);
  const uniqueInAuthCollection = existingAccount
    ? dao.isRecordValueUnique(
        "manager_accounts",
        "username",
        normalized,
        existingAccount.id,
      )
    : dao.isRecordValueUnique("manager_accounts", "username", normalized);
  if (!uniqueInAuthCollection) {
    throw new Error("That manager username is already in use.");
  }
  return normalized;
}

/**
 * Find an active person by personal 4-digit pin without conflating an empty
 * result with a failed database lookup. `findFirstRecordByFilter` throws for
 * both cases in PocketBase 0.22, so use a bounded list query whose empty array
 * is an authoritative not-found result.
 */
function findActivePersonByPin(pin, dealerId) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    return { status: "not_found", person: null };
  }
  let pinHash = "";
  try {
    pinHash = personPinHash(normalized);
  } catch (_e) {
    // A missing pepper makes hashed lookups impossible; readiness surfaces the
    // configuration gap, and the plaintext fallback below still covers rows
    // the bootstrap sweep has not converted yet.
    pinHash = "";
  }
  try {
    // Only a verified invitation supplies dealerId on the new sign-in path.
    // Global uniqueness stays in place while older stores migrate.
    const scope = dealerId ? " && dealer = {:dealer}" : "";
    if (pinHash) {
      const records = $app
        .dao()
        .findRecordsByFilter(
          "salespeople",
          "pin_hash = {:hash} && active = true" + scope,
          "created",
          1,
          0,
          { hash: pinHash, dealer: dealerId || "" },
        );
      if (!records || typeof records.length !== "number") {
        return { status: "unavailable", person: null };
      }
      if (records.length > 0) {
        return { status: "found", person: records[0] };
      }
    }
    // Bridge fallback: rows written by an old process before the bootstrap
    // sweep converts them. Remove together with the plaintext pin column.
    const legacy = $app
      .dao()
      .findRecordsByFilter(
        "salespeople",
        "pin = {:pin} && active = true" + scope,
        "created",
        1,
        0,
        { pin: normalized, dealer: dealerId || "" },
      );
    if (!legacy || typeof legacy.length !== "number") {
      return { status: "unavailable", person: null };
    }
    if (legacy.length > 0) {
      return { status: "found", person: legacy[0] };
    }
    return { status: "not_found", person: null };
  } catch (_e) {
    return { status: "unavailable", person: null };
  }
}

/**
 * Ensure a pin is globally free (optionally excluding a record id). Inactive
 * records keep their credential reserved so reactivation cannot fail or cause
 * an identity collision later. Checks both the peppered hash and any
 * not-yet-converted plaintext rows; global (not per-dealer) uniqueness is kept
 * deliberately while stale client bundles may still log in with a PIN alone.
 */
function assertPersonPinAvailableWithDao(dao, pin, excludePersonId) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    throw new Error("Access code must be exactly 4 digits");
  }
  const pinHash = personPinHash(normalized);
  let filter = "(pin = {:pin} || pin_hash = {:hash})";
  const params = { pin: normalized, hash: pinHash };
  if (excludePersonId) {
    filter += " && id != {:excludeId}";
    params.excludeId = excludePersonId;
  }
  const matches = dao.findRecordsByFilter("salespeople", filter, "id", 2, 0, params);
  if (!matches || typeof matches.length !== "number") {
    throw new Error("Access-code availability could not be verified");
  }
  if (matches.length) throw new Error("Access code is already in use");
  return normalized;
}

/**
 * Reactivation-time variant for records that already store only a hash: proves
 * the stored credential still has no other claimant without needing plaintext.
 */
function assertStoredPersonCredentialAvailableWithDao(dao, person) {
  const pinHash = person.getString("pin_hash");
  const pin = person.getString("pin");
  let filter = "";
  const params = { excludeId: person.id };
  if (isValidPersonPinHash(pinHash)) {
    filter = "pin_hash = {:hash} && id != {:excludeId}";
    params.hash = pinHash;
  } else if (isValidPersonPin(pin)) {
    filter = "pin = {:pin} && id != {:excludeId}";
    params.pin = pin;
  } else {
    throw new Error("This person does not have a valid access code.");
  }
  const matches = dao.findRecordsByFilter("salespeople", filter, "id", 2, 0, params);
  if (!matches || typeof matches.length !== "number") {
    throw new Error("Access-code availability could not be verified");
  }
  if (matches.length) throw new Error("Access code is already in use");
}

function assertPersonPinAvailable(pin, excludePersonId) {
  return assertPersonPinAvailableWithDao($app.dao(), pin, excludePersonId);
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
    // Brand-consistent creative system (phase 1): the salesperson's own
    // session needs these defaults; they are settings, never credentials.
    managerScope: recordBool(record, "manager_scope"),
    signatureLine: record.getString("signature_line"),
    defaultCategory: record.getString("default_category"),
    playfulDefault: recordBool(record, "playful_default"),
  };
}

/** Manager roster DTO. Credential values are represented only by booleans. */
function serializePerson(record) {
  if (!record) return null;
  const pin = record.getString("pin");
  const managerUsername =
    record.getString("role") === "manager"
      ? normalizeManagerUsername(record.getString("manager_username"))
      : "";
  return {
    ...serializePersonSummary(record),
    created_at: record.getString("created_at"),
    hasPin: isValidPersonPin(pin) || isValidPersonPinHash(record.getString("pin_hash")),
    pinNeedsDistribution: recordBool(record, "pin_needs_distribution"),
    hasManagerLogin: isValidManagerUsername(managerUsername),
    managerUsername: isValidManagerUsername(managerUsername)
      ? managerUsername
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Person profile fields (brand-consistent creative system, phase 1)
// ---------------------------------------------------------------------------

const PERSON_TEXT_FIELD_LIMITS = {
  signature_line: 140,
  default_category: 40,
};
const PERSON_BOOL_FIELDS = ["playful_default"];
/** Session roles that may grant the sales-manager permission subset. */
const MANAGER_SCOPE_ROLES = ["dealer_admin", "super_admin"];

/** Collapse control characters and runs of whitespace into single spaces. */
function collapseWhitespace(value) {
  return (value === null || value === undefined ? "" : value)
    .toString()
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Allowlisted personal-profile fields on a salespeople record (spec §5
 * "Personal" rows plus the sales-manager scope flag). manager_scope is a
 * permission grant, so only a manager-or-above session may set it even if a
 * future self-service route reuses this helper; routes map the
 * MANAGER_SCOPE_FORBIDDEN error to 403 via personProfileErrorPayload.
 */
function personProfileMutationData(body, actorRole) {
  const source = body || {};
  const data = {};
  const textFields = Object.keys(PERSON_TEXT_FIELD_LIMITS);
  for (let i = 0; i < textFields.length; i++) {
    const field = textFields[i];
    if (source[field] === undefined) continue;
    const value = collapseWhitespace(source[field]);
    if (value.length > PERSON_TEXT_FIELD_LIMITS[field]) {
      throw new Error(
        field + " must be " + PERSON_TEXT_FIELD_LIMITS[field] + " characters or fewer",
      );
    }
    data[field] = value;
  }
  for (let i = 0; i < PERSON_BOOL_FIELDS.length; i++) {
    const field = PERSON_BOOL_FIELDS[i];
    if (source[field] === undefined) continue;
    data[field] = assertBooleanInput(field, source[field]);
  }
  if (source.manager_scope !== undefined) {
    if (MANAGER_SCOPE_ROLES.indexOf(actorRole) === -1) {
      throw new Error("MANAGER_SCOPE_FORBIDDEN");
    }
    data.manager_scope = assertBooleanInput("manager_scope", source.manager_scope);
  }
  return data;
}

/** Map a personProfileMutationData failure to a safe HTTP status + body. */
function personProfileErrorPayload(err) {
  const message = mutationErrorText(err);
  if (message === "MANAGER_SCOPE_FORBIDDEN") {
    return {
      status: 403,
      body: {
        error: "MANAGER_SCOPE_FORBIDDEN",
        code: "MANAGER_SCOPE_FORBIDDEN",
        message: "Only a manager can change manager scope.",
      },
    };
  }
  return {
    status: 400,
    body: {
      error: "PERSON_PROFILE_INVALID",
      code: "PERSON_PROFILE_INVALID",
      message: safeDealerMutationError(err),
    },
  };
}

/**
 * Mint a unique 4-digit pin for a new person. Retries on collision.
 */
function generateUniquePersonPinWithDao(dao) {
  const seed = secureRandomString(4, "0123456789");
  const start = parseInt(seed, 10);
  for (let offset = 0; offset < 10000; offset++) {
    const value = (start + offset) % 10000;
    const pin = String(10000 + value).slice(1);
    try {
      assertPersonPinAvailableWithDao(dao, pin, "");
      return pin;
    } catch (err) {
      // Only a genuine collision means "try the next code". A missing pepper
      // or database failure would otherwise burn 10k retries and surface as a
      // misleading "space exhausted" error.
      const message = err && err.message ? String(err.message) : String(err);
      if (message.indexOf("already in use") === -1) throw err;
    }
  }
  throw new Error("The four-digit access-code space is exhausted");
}

function generateUniquePersonPin() {
  return generateUniquePersonPinWithDao($app.dao());
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
function deleteSessionsWhereWithDao(dao, sql, params) {
  const result = dao.db().newQuery(sql).bind(params).execute();
  if (!result || typeof result.rowsAffected !== "function") {
    throw new Error("Session revocation did not return an affected-row count");
  }
  const affected = Number(result.rowsAffected());
  if (!Number.isFinite(affected) || affected < 0) {
    throw new Error("Session revocation returned an invalid affected-row count");
  }
  return affected;
}

function deleteSessionsWhere(sql, params) {
  return deleteSessionsWhereWithDao($app.dao(), sql, params);
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

function revokePersonSessionsWithDao(dao, personId) {
  if (!personId) return 0;
  return deleteSessionsWhereWithDao(
    dao,
    "DELETE FROM sessions WHERE person = {:person}",
    { person: personId.toString() },
  );
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
  // HTTP header names are case-insensitive and real clients send mixed case
  // ("X-Generation-Purpose"). Fall back to a case-insensitive scan so a header
  // is never silently dropped because its casing was not guessed above.
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i].toLowerCase().replace(/_/g, "-");
    if (key === normalized) {
      const value = headers[keys[i]];
      if (value !== undefined && value !== null) return value.toString().trim();
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

/**
 * `X-Generation-Purpose` names what the browser was doing with a request, so
 * a vision-QC review or a caption pack stops being counted as a caption in
 * the usage ledger. It is accounting metadata only: it never changes which
 * model, policy, rate limit, or body validation applies. Values outside the
 * kind's allowlist (or a missing header) fall back to the task kind.
 */
const GENERATION_PURPOSES_BY_KIND = {
  text: ["caption", "vision_review", "caption_pack", "website_draft"],
  image: ["image"],
  video: ["video"],
};
const GENERATION_PURPOSES = [
  "caption",
  "vision_review",
  "caption_pack",
  "website_draft",
  "image",
  "video",
];

function proxyGenerationPurpose(requestInfo, kind) {
  const allowed = GENERATION_PURPOSES_BY_KIND[kind] || GENERATION_PURPOSES_BY_KIND.text;
  // Header values arrive with incidental whitespace from some clients; trim
  // before matching so a valid label is never silently demoted to the default.
  const requested = proxyRequestHeader(requestInfo, "x-generation-purpose")
    .trim()
    .toLowerCase()
    .slice(0, 40);
  if (requested && allowed.indexOf(requested) !== -1) return requested;
  return allowed[0];
}

/**
 * A stale installed PWA keeps announcing the model-policy version it was
 * built against. Detecting that before body validation lets the proxy answer
 * with a distinct 409 so the app prompts for an update instead of the generic
 * "check your inputs" 400. Requests without the header are legacy clients and
 * keep their existing best-effort handling. The requested value is never
 * echoed back: only the current version is safe to disclose.
 */
function proxyPolicyVersionMismatch(requestInfo, policies) {
  const currentVersion = String(policies.geminiModelPolicySnapshot().version);
  const requested = proxyRequestHeader(requestInfo, "x-model-policy-version");
  return {
    mismatch: !!requested && requested !== currentVersion,
    currentVersion: currentVersion,
  };
}

const GENERATION_USAGE_MAX_TOKENS = 100000000;
const GENERATION_USAGE_MAX_LATENCY_MS = 60 * 60 * 1000;
const GENERATION_USAGE_MAX_VIDEO_SECONDS = 600;

function usageCounter(value, max) {
  const numeric = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(max, Math.floor(numeric));
}

function usageToken(value, max) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, max);
}

/**
 * Derive the usage ledger columns for one proxied generation. Everything is
 * optional and coerced: a malformed or missing provider body yields zeros and
 * empty tokens rather than an exception, because losing the base event over
 * accounting would hide the very failures the ledger exists to show. Only
 * counters and short enum-like tokens are extracted; no prompt, caption, or
 * media content is read.
 */
function proxyGenerationUsage(identity, requestInfo, responsePayload, usage) {
  const kind = identity && identity.kind ? identity.kind : "text";
  const payload =
    responsePayload &&
    typeof responsePayload === "object" &&
    !Array.isArray(responsePayload)
      ? responsePayload
      : {};
  const meta =
    payload.usageMetadata && typeof payload.usageMetadata === "object"
      ? payload.usageMetadata
      : {};
  const candidate =
    Array.isArray(payload.candidates) &&
    payload.candidates[0] &&
    typeof payload.candidates[0] === "object"
      ? payload.candidates[0]
      : {};
  const extra = usage && typeof usage === "object" ? usage : {};
  return {
    prompt_tokens: usageCounter(meta.promptTokenCount, GENERATION_USAGE_MAX_TOKENS),
    candidate_tokens: usageCounter(
      meta.candidatesTokenCount,
      GENERATION_USAGE_MAX_TOKENS,
    ),
    thoughts_tokens: usageCounter(meta.thoughtsTokenCount, GENERATION_USAGE_MAX_TOKENS),
    cached_tokens: usageCounter(
      meta.cachedContentTokenCount,
      GENERATION_USAGE_MAX_TOKENS,
    ),
    finish_reason: usageToken(candidate.finishReason, 40),
    latency_ms: usageCounter(extra.latencyMs, GENERATION_USAGE_MAX_LATENCY_MS),
    purpose: proxyGenerationPurpose(requestInfo, kind),
    image_size: kind === "image" ? usageToken(extra.imageSize, 8) : "",
    video_seconds:
      kind === "video"
        ? usageCounter(extra.videoSeconds, GENERATION_USAGE_MAX_VIDEO_SECONDS)
        : 0,
  };
}

const GENERATION_USAGE_SUMMARY_MAX_DEALERS = 50;
const GENERATION_USAGE_SUMMARY_MAX_SIZE_ROWS = 400;
const GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS = 5000;

function nearestRankPercentile(sortedAscending, fraction) {
  if (!sortedAscending.length) return 0;
  const rank = Math.ceil(fraction * sortedAscending.length) - 1;
  return sortedAscending[Math.min(sortedAscending.length - 1, Math.max(0, rank))];
}

/**
 * Per-dealer usage totals for the admin health view: event and token counts,
 * image counts by size, video seconds, and nearest-rank p50/p95 upstream
 * latency over the trailing window. Three bounded DAO queries; the latency
 * percentiles are computed in-process from at most
 * GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS samples, and `truncated` tells
 * the reader when a bound was hit. Callers wrap this in try/catch: health
 * must never fail because of accounting.
 */
function generationUsageSummary(windowDays) {
  const days = Math.max(1, Math.min(30, Number(windowDays) || 7));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const since = databaseTimestamp(sinceIso);
  const summary = { windowDays: days, since: sinceIso, dealers: [], truncated: false };
  const byDealer = {};

  const totals = arrayOf(
    new DynamicModel({
      dealer: "",
      name: "",
      events: 0,
      succeeded: 0,
      promptTokens: 0,
      candidateTokens: 0,
      thoughtsTokens: 0,
      cachedTokens: 0,
      videoSeconds: 0,
    }),
  );
  $app
    .dao()
    .db()
    .newQuery(
      "SELECT e.dealer AS dealer, COALESCE(d.name, '') AS name, COUNT(*) AS events, " +
        "COALESCE(SUM(CASE WHEN e.succeeded = 1 THEN 1 ELSE 0 END), 0) AS succeeded, " +
        "COALESCE(SUM(e.prompt_tokens), 0) AS promptTokens, " +
        "COALESCE(SUM(e.candidate_tokens), 0) AS candidateTokens, " +
        "COALESCE(SUM(e.thoughts_tokens), 0) AS thoughtsTokens, " +
        "COALESCE(SUM(e.cached_tokens), 0) AS cachedTokens, " +
        "COALESCE(SUM(e.video_seconds), 0) AS videoSeconds " +
        "FROM generation_events e LEFT JOIN dealers d ON d.id = e.dealer " +
        "WHERE e.occurred_at >= {:since} " +
        "GROUP BY e.dealer ORDER BY events DESC, e.dealer ASC LIMIT " +
        String(GENERATION_USAGE_SUMMARY_MAX_DEALERS + 1),
    )
    .bind({ since: since })
    .all(totals);
  if (totals.length > GENERATION_USAGE_SUMMARY_MAX_DEALERS) {
    summary.truncated = true;
    totals.length = GENERATION_USAGE_SUMMARY_MAX_DEALERS;
  }
  totals.forEach(function (row) {
    const dealerId = (row.dealer || "").toString();
    if (!dealerId) return;
    const prompt = Number(row.promptTokens) || 0;
    const candidate = Number(row.candidateTokens) || 0;
    const thoughts = Number(row.thoughtsTokens) || 0;
    const cached = Number(row.cachedTokens) || 0;
    const entry = {
      dealer: dealerId,
      name: (row.name || "").toString().slice(0, 120),
      events: Number(row.events) || 0,
      succeeded: Number(row.succeeded) || 0,
      tokens: {
        prompt: prompt,
        candidate: candidate,
        thoughts: thoughts,
        cached: cached,
        total: prompt + candidate + thoughts + cached,
      },
      images: {},
      videoSeconds: Number(row.videoSeconds) || 0,
      latencyMs: { p50: 0, p95: 0, samples: 0 },
    };
    byDealer[dealerId] = entry;
    summary.dealers.push(entry);
  });
  if (!summary.dealers.length) return summary;

  const sizes = arrayOf(new DynamicModel({ dealer: "", size: "", count: 0 }));
  $app
    .dao()
    .db()
    .newQuery(
      "SELECT dealer, image_size AS size, COUNT(*) AS count FROM generation_events " +
        "WHERE occurred_at >= {:since} AND image_size != '' " +
        "GROUP BY dealer, image_size ORDER BY dealer ASC, image_size ASC LIMIT " +
        String(GENERATION_USAGE_SUMMARY_MAX_SIZE_ROWS),
    )
    .bind({ since: since })
    .all(sizes);
  if (sizes.length >= GENERATION_USAGE_SUMMARY_MAX_SIZE_ROWS) summary.truncated = true;
  sizes.forEach(function (row) {
    const entry = byDealer[(row.dealer || "").toString()];
    const size = usageToken(row.size, 8);
    if (!entry || !size) return;
    entry.images[size] = (entry.images[size] || 0) + (Number(row.count) || 0);
  });

  const latencies = arrayOf(new DynamicModel({ dealer: "", latency: 0 }));
  $app
    .dao()
    .db()
    .newQuery(
      "SELECT dealer, latency_ms AS latency FROM generation_events " +
        "WHERE occurred_at >= {:since} AND latency_ms > 0 " +
        "ORDER BY dealer ASC, latency_ms ASC LIMIT " +
        String(GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS),
    )
    .bind({ since: since })
    .all(latencies);
  if (latencies.length >= GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS) {
    summary.truncated = true;
  }
  const samplesByDealer = {};
  latencies.forEach(function (row) {
    const dealerId = (row.dealer || "").toString();
    if (!byDealer[dealerId]) return;
    const latency = Number(row.latency);
    if (!Number.isFinite(latency) || latency <= 0) return;
    (samplesByDealer[dealerId] = samplesByDealer[dealerId] || []).push(latency);
  });
  Object.keys(samplesByDealer).forEach(function (dealerId) {
    const sorted = samplesByDealer[dealerId].sort(function (a, b) {
      return a - b;
    });
    byDealer[dealerId].latencyMs = {
      p50: nearestRankPercentile(sorted, 0.5),
      p95: nearestRankPercentile(sorted, 0.95),
      samples: sorted.length,
    };
  });
  return summary;
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
  usage,
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
    // Usage columns are best-effort: a malformed provider body or a proxy
    // that predates the accounting migration must still record the event.
    generationEventStage = "usage";
    let usageFields = null;
    try {
      usageFields = proxyGenerationUsage(identity, requestInfo, responsePayload, usage);
    } catch (_usageErr) {
      usageFields = null;
    }
    generationEventStage = "collection";
    const collection = $app.dao().findCollectionByNameOrId("generation_events");
    generationEventStage = "record";
    const record = new Record(collection, {
      ...(usageFields || {}),
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

function generationClaimResultCount(result) {
  if (!result || typeof result.rowsAffected !== "function") {
    throw new Error("Generation claim did not return an affected-row count");
  }
  const affected = Number(result.rowsAffected());
  if (!Number.isFinite(affected) || affected < 0) {
    throw new Error("Generation claim returned an invalid affected-row count");
  }
  return affected;
}

/**
 * Claim a verified set of prompt-free generation events before creating a
 * post. SQLite serializes each conditional update in this transaction, so two
 * concurrent submissions cannot both consume the same attempt.
 */
function claimGenerationEvents(eventIds, ownerSessionHash, dealerId, transactionDao) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return "";
  if (!ownerSessionHash || !dealerId) {
    throw new Error("Generation claim identity is required");
  }
  const seen = {};
  const ids = eventIds.map(function (value) {
    const id = (value || "").toString();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen[id]) {
      throw new Error("Generation claim event id is invalid");
    }
    seen[id] = true;
    return id;
  });
  const claimToken = "claim_" + secureRandomString(32, "0123456789abcdef");
  const updated = databaseTimestamp(new Date().toISOString());

  const write = function (txDao) {
    ids.forEach(function (id) {
      const result = txDao
        .db()
        .newQuery(
          "UPDATE generation_events SET consumed_post = {:claim}, updated = {:updated} " +
            "WHERE id = {:id} AND owner_session_hash = {:owner} AND dealer = {:dealer} " +
            "AND (consumed_post = '' OR consumed_post IS NULL)",
        )
        .bind({
          claim: claimToken,
          updated: updated,
          id: id,
          owner: ownerSessionHash,
          dealer: dealerId,
        })
        .execute();
      if (generationClaimResultCount(result) !== 1) {
        throw new Error("Generation attempt was already consumed");
      }
    });
  };
  if (transactionDao) write(transactionDao);
  else $app.dao().runInTransaction(write);
  return claimToken;
}

function finalizeGenerationEventClaims(
  claimToken,
  postId,
  ownerSessionHash,
  dealerId,
  expectedCount,
  transactionDao,
) {
  if (!claimToken) return 0;
  if (
    !/^claim_[a-f0-9]{32}$/.test(claimToken) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test((postId || "").toString())
  ) {
    throw new Error("Generation claim finalization is invalid");
  }
  let affected = 0;
  const write = function (txDao) {
    const result = txDao
      .db()
      .newQuery(
        "UPDATE generation_events SET consumed_post = {:post}, updated = {:updated} " +
          "WHERE consumed_post = {:claim} AND owner_session_hash = {:owner} " +
          "AND dealer = {:dealer}",
      )
      .bind({
        post: postId,
        updated: databaseTimestamp(new Date().toISOString()),
        claim: claimToken,
        owner: ownerSessionHash,
        dealer: dealerId,
      })
      .execute();
    affected = generationClaimResultCount(result);
    if (affected !== Number(expectedCount)) {
      throw new Error("Generation claim finalization count mismatch");
    }
  };
  if (transactionDao) write(transactionDao);
  else $app.dao().runInTransaction(write);
  return affected;
}

function releaseGenerationEventClaims(claimToken, ownerSessionHash, dealerId) {
  if (!/^claim_[a-f0-9]{32}$/.test((claimToken || "").toString())) return 0;
  const result = $app
    .dao()
    .db()
    .newQuery(
      "UPDATE generation_events SET consumed_post = '', updated = {:updated} " +
        "WHERE consumed_post = {:claim} AND owner_session_hash = {:owner} " +
        "AND dealer = {:dealer}",
    )
    .bind({
      updated: databaseTimestamp(new Date().toISOString()),
      claim: claimToken,
      owner: ownerSessionHash,
      dealer: dealerId,
    })
    .execute();
  return generationClaimResultCount(result);
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
  const body =
    plainBody && typeof plainBody === "object" && !Array.isArray(plainBody)
      ? plainBody
      : {};
  const rawName = (body.name || "client.error").toString().slice(0, 120);
  const name = redactTelemetryVinStrings(rawName.replace(/[^A-Za-z0-9._:-]/g, "_"));
  const payloadObject =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload
      : {};
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

const TELEMETRY_GLOBAL_PER_MINUTE = 120;
const TELEMETRY_TOTAL_ROW_CAP = 10000;
const TELEMETRY_COALESCE_SECONDS = 60;

/**
 * Persist one pre-login client error behind process-local and durable global
 * ceilings. The SQLite transaction makes distributed-IP requests compete for
 * the same quota, while duplicate safe envelopes coalesce for one minute.
 */
function persistBoundedTelemetryEvent(safeEnvelope, occurredAt) {
  const localGate = checkProxyRateLimit(
    "telemetry:global",
    TELEMETRY_GLOBAL_PER_MINUTE,
    60 * 1000,
  );
  if (!localGate.ok) return { stored: false, reason: "global_rate" };

  const now = occurredAt instanceof Date ? occurredAt : new Date();
  const nowIso = now.toISOString();
  const minuteCutoff = databaseTimestamp(
    new Date(now.getTime() - 60 * 1000).toISOString(),
  );
  const duplicateCutoff = databaseTimestamp(
    new Date(now.getTime() - TELEMETRY_COALESCE_SECONDS * 1000).toISOString(),
  );
  let result = { stored: false, reason: "unavailable" };

  $app.dao().runInTransaction(function (txDao) {
    const counts = new DynamicModel({
      recentTotal: 0,
      overallTotal: 0,
      duplicateTotal: 0,
    });
    txDao
      .db()
      .newQuery(
        "SELECT " +
          "(SELECT COUNT(*) FROM client_error_events " +
          "WHERE occurred_at >= {:minuteCutoff}) AS recentTotal, " +
          "(SELECT COUNT(*) FROM client_error_events) AS overallTotal, " +
          "(SELECT COUNT(*) FROM client_error_events " +
          "WHERE occurred_at >= {:duplicateCutoff} " +
          "AND name = {:name} AND payload = {:payload} " +
          "AND release_sha = {:releaseSha}) AS duplicateTotal",
      )
      .bind({
        minuteCutoff: minuteCutoff,
        duplicateCutoff: duplicateCutoff,
        name: safeEnvelope.name,
        payload: safeEnvelope.payload,
        releaseSha: safeEnvelope.releaseSha,
      })
      .one(counts);

    if (Number(counts.recentTotal) >= TELEMETRY_GLOBAL_PER_MINUTE) {
      result = { stored: false, reason: "global_rate" };
      return;
    }
    if (Number(counts.overallTotal) >= TELEMETRY_TOTAL_ROW_CAP) {
      result = { stored: false, reason: "row_cap" };
      return;
    }
    if (Number(counts.duplicateTotal) > 0) {
      result = { stored: false, reason: "coalesced" };
      return;
    }

    const collection = txDao.findCollectionByNameOrId("client_error_events");
    const record = new Record(collection, {
      name: safeEnvelope.name,
      payload: safeEnvelope.payload,
      release_sha: safeEnvelope.releaseSha,
      api_contract_version: safeEnvelope.apiContractVersion,
      occurred_at: nowIso,
    });
    txDao.saveRecord(record);
    result = { stored: true, reason: "stored" };
  });

  return result;
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

/**
 * Persist a noisy denial at most once per IP/kind/window, with a second global
 * cap for distributed traffic. The durable lookup is the cross-process
 * boundary; the bounded in-memory gates avoid querying SQLite for every repeat.
 *
 * A coalesced event is a successful logging outcome — callers must not turn a
 * deliberately sampled diagnostic into an application failure.
 */
function logCoalescedAuthEvent(kind, opts, windowSeconds, globalMaxPerWindow) {
  const options = opts || {};
  const seconds = Math.max(60, Math.min(24 * 60 * 60, Number(windowSeconds) || 900));
  const windowMs = seconds * 1000;
  const ip = (options.ip || "").toString().slice(0, 64);
  const localKey = "auth-sample:" + kind + ":" + (ip || "unknown");
  // ipKeyed: localKey embeds the client IP. The global sibling below is a
  // fixed key per kind and stays with the tenant buckets, so a flood cannot
  // evict the ceiling that bounds it.
  const localGate = checkProxyRateLimit(localKey, 1, windowMs, { ipKeyed: true });
  if (!localGate.ok) return true;

  const globalLimit = Math.max(1, Math.min(1000, Number(globalMaxPerWindow) || 30));
  const globalGate = checkProxyRateLimit(
    "auth-sample-global:" + kind,
    globalLimit,
    windowMs,
  );
  if (!globalGate.ok) return true;

  const since = databaseTimestamp(new Date(Date.now() - windowMs).toISOString());
  try {
    const existing = $app
      .dao()
      .findRecordsByFilter(
        "auth_events",
        "kind = {:kind} && ip = {:ip} && created >= {:since}",
        "-created",
        1,
        0,
        { kind: kind, ip: ip, since: since },
      );
    if (existing.length) return true;
  } catch (e) {
    console.error("[helpers.logCoalescedAuthEvent] lookup failed:", e);
    return false;
  }
  return logAuthEvent(kind, options);
}

/**
 * Run one privileged state transition and its audit row in the same SQLite
 * transaction. A failed audit insert rolls the mutation back. `kind` may be a
 * resolver so callers can choose the event from the committed transition; an
 * empty resolved kind records no audit row for a true no-op.
 */
function runAuditedTransaction(kind, opts, mutation) {
  if (typeof mutation !== "function") {
    throw new Error("Audited mutation callback is required");
  }
  let result;
  $app.dao().runInTransaction(function (txDao) {
    result = mutation(txDao);
    const resolvedKind = typeof kind === "function" ? kind(result) : kind;
    if (resolvedKind) saveAuthEvent(txDao, resolvedKind, opts || {});
  });
  return result;
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

  // In-flight comparisons count toward the same hard limit, but a burst of
  // valid users on dealership Wi-Fi should recheck promptly, not wait fifteen
  // minutes for reservations that are about to become successes. A reservation
  // older than 30 seconds is still treated as a failure (crashes fail closed).
  const recentReservations = records.filter(function (record) {
    const created = Date.parse(record.getString("created").replace(" ", "T"));
    return (
      record.getString("detail") === "credential comparison reserved" &&
      Number.isFinite(created) &&
      now - created >= 0 &&
      now - created < 30000
    );
  }).length;
  if (recentReservations > 0 && count - recentReservations < threshold) {
    return { count: count, locked: true, retryAfterSeconds: 2, unavailable: false };
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
  let configured = "";
  let flyRuntime = false;
  try {
    configured = ($os.getenv("TURNSTILE_ALLOWED_HOSTNAMES") || "").toString();
  } catch (_e) {}
  try {
    flyRuntime = !!($os.getenv("FLY_APP_NAME") || "").toString().trim();
  } catch (_e) {}

  // Local development stays convenient, but a Fly deployment must fail closed
  // and accept only the deployment-specific hostnames supplied at runtime.
  const defaults = flyRuntime ? [] : ["localhost", "127.0.0.1"];
  const values = defaults.concat(configured.split(","));
  const seen = {};
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const hostname = values[i].toString().trim().toLowerCase();
    if (!hostname || seen[hostname]) continue;
    if (
      flyRuntime &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]")
    ) {
      continue;
    }
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

  let flyRuntime = false;
  try {
    flyRuntime = !!($os.getenv("FLY_APP_NAME") || "").toString().trim();
  } catch (_e) {}
  const allowedHostnames = configuredTurnstileHostnames();
  if (flyRuntime && !allowedHostnames.length) {
    return { ok: false, unavailable: true };
  }

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
  if (!validatedTestResponse && allowedHostnames.indexOf(hostname) === -1) {
    return { ok: false, unavailable: false };
  }
  if (action !== TURNSTILE_ACTION && !validatedTestResponse) {
    return { ok: false, unavailable: false };
  }
  return { ok: true, unavailable: false };
}

// In-memory sliding windows remain a fast local guard in front of the durable
// provider/account controls. Keep the map bounded: unauthenticated telemetry
// keys include client IPs and must not become a process-memory exhaustion path.
const MAX_PROXY_RATE_BUCKETS = 2048;
const PROXY_RATE_EVICTION_BATCH = 128;
/**
 * Unauthenticated, IP-keyed buckets get their own table with its own ceiling.
 *
 * The bucket cap used to be per-VM, so a flood of source IPs could crowd out
 * one runtime's map and the other 24 kept counting normally. Sharing the table
 * across the pool made the cap pool-wide, and eviction sorts ascending by
 * resetAt and drops the lowest first — which is every 60-second bucket, i.e.
 * exactly the per-dealer proxy, OpenAI, Anthropic and image throttles. A
 * distributed flood against the unauthenticated telemetry endpoint could
 * therefore clear paying dealerships' per-minute limits as a side effect.
 *
 * Splitting the namespaces means a flood can only evict other flood buckets.
 * 512 is deliberately smaller than the tenant table: these keys are attacker-
 * controlled and exist only to bound abuse, not to protect a quota anyone paid
 * for.
 */
const MAX_PROXY_IP_RATE_BUCKETS = 512;
/**
 * PocketBase 0.22 serves each hook callback from a pooled JSVM runtime
 * (`--hooksPool`, default 25) and every runtime gets its own `require()`
 * instance of this file. Module-level counters are therefore PER-VM: a
 * "global" provider concurrency cap of 12 was really up to 12 x 25, and the
 * per-minute buckets were as many times too permissive. pb_hooks/walkarounds.js
 * already documents this for replay nonces and keeps them in `$app.store()`,
 * which is shared across the pool; rate counters do the same; provider concurrency uses atomic database leases.
 *
 * Check-then-set through the store is not atomic, so two perfectly simultaneous
 * requests can both pass a rate boundary. These remain a best-effort first
 * guard; durable login/write policies and atomic provider leases enforce the
 * security and resource boundaries.
 *
 * The module-level maps remain as the fallback when `$app.store()` is
 * unavailable (the unit-test harness, or a future runtime change). Falling back
 * to per-VM counting preserves today's behavior; it never fails open.
 */
const PROXY_RATE_STORE_PREFIX = "proxyRate:";
const PROXY_IP_RATE_STORE_PREFIX = "proxyIpRate:";
/**
 * One rate-limit table. `map` is the per-VM fallback used when $app.store() is
 * unavailable; `ops` paces the periodic sweep so it does not run on every
 * request. Which table a caller lands in is decided at the call site, not by
 * sniffing the key: a key-prefix rule would have put the fixed-cardinality
 * "telemetry:ingress" and "telemetry:global" ceilings in the attacker-
 * controlled table alongside "telemetry:<ip>", where a flood could evict the
 * very ceiling meant to contain it.
 */
function makeRateNamespace(prefix, cap) {
  return { prefix: prefix, cap: cap, map: Object.create(null), ops: 0 };
}
/** Keys derived from a tenant: dealer ids, action names, fixed ceilings. */
const TENANT_RATE_NS = makeRateNamespace(
  PROXY_RATE_STORE_PREFIX,
  MAX_PROXY_RATE_BUCKETS,
);
/** Keys derived from a client IP, so unbounded and attacker-chosen. */
const IP_RATE_NS = makeRateNamespace(
  PROXY_IP_RATE_STORE_PREFIX,
  MAX_PROXY_IP_RATE_BUCKETS,
);
const RATE_NAMESPACES = [TENANT_RATE_NS, IP_RATE_NS];
function sharedStore() {
  try {
    if (typeof $app === "undefined" || !$app || typeof $app.store !== "function") {
      return null;
    }
    const store = $app.store();
    return store && typeof store.get === "function" ? store : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Read a bucket from the pool-shared store, falling back to the per-VM map.
 * Values are JSON so the shape survives whatever the store does with objects.
 *
 * A store miss falls through to the per-VM map rather than returning
 * undefined. writeSharedBucket parks a value in that map when `store.set`
 * throws; if reads never looked there, a store that accepts reads but
 * rejects writes would make every rate limit and concurrency cap start a
 * fresh bucket on every request — fully open, with nothing logged. That is
 * the one asymmetry that contradicted the "never fails open" promise above.
 */
function readSharedBucket(prefix, localMap, key) {
  const store = sharedStore();
  if (!store) return localMap[key];
  try {
    const raw = store.get(prefix + key);
    if (!raw) return localMap[key];
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_e) {
    return localMap[key];
  }
}

function writeSharedBucket(prefix, localMap, key, value) {
  const store = sharedStore();
  if (!store) {
    localMap[key] = value;
    return;
  }
  try {
    store.set(prefix + key, JSON.stringify(value));
  } catch (_e) {
    localMap[key] = value;
  }
}

function deleteSharedBucket(prefix, localMap, key) {
  const store = sharedStore();
  delete localMap[key];
  if (!store) return;
  try {
    if (typeof store.remove === "function") store.remove(prefix + key);
  } catch (_e) {}
}

/** Keys currently held for one prefix, across the pool when the store is up. */
function sharedBucketKeys(prefix, localMap) {
  const store = sharedStore();
  if (!store || typeof store.getAll !== "function") return Object.keys(localMap);
  try {
    const all = store.getAll() || {};
    const keys = [];
    Object.keys(all).forEach(function (candidate) {
      if (candidate.indexOf(prefix) === 0) keys.push(candidate.slice(prefix.length));
    });
    return keys;
  } catch (_e) {
    return Object.keys(localMap);
  }
}

function readRateBucket(ns, key) {
  return readSharedBucket(ns.prefix, ns.map, key);
}

function pruneRateBuckets(ns, now, reserveSlot) {
  ns.ops += 1;
  let keys = sharedBucketKeys(ns.prefix, ns.map);
  if (keys.length < ns.cap && ns.ops % 128 !== 0) {
    return;
  }
  keys.forEach(function (key) {
    const bucket = readRateBucket(ns, key);
    if (!bucket || now >= bucket.resetAt) {
      deleteSharedBucket(ns.prefix, ns.map, key);
    }
  });
  keys = sharedBucketKeys(ns.prefix, ns.map);
  // When the map is full, evict a small batch rather than sorting the entire
  // map again for every new attacker-controlled key.
  const target = Math.max(0, ns.cap - (reserveSlot ? PROXY_RATE_EVICTION_BATCH : 0));
  if (keys.length <= target) return;
  const resetAtFor = {};
  keys.forEach(function (key) {
    const bucket = readRateBucket(ns, key);
    resetAtFor[key] = (bucket && bucket.resetAt) || 0;
  });
  keys.sort(function (left, right) {
    return resetAtFor[left] - resetAtFor[right];
  });
  for (let index = 0; index < keys.length - target; index++) {
    deleteSharedBucket(ns.prefix, ns.map, keys[index]);
  }
}

/**
 * `options.ipKeyed` marks a key whose cardinality is chosen by whoever is
 * calling — a client IP — so it is counted and evicted separately from tenant
 * keys. Pass it at every IP-keyed call site; __tests__/rateLimitAcrossVmPool
 * pins which those are.
 */
function checkProxyRateLimit(key, maxPerWindow, windowMs, options) {
  if (!key) return { ok: true };
  const ns = options && options.ipKeyed ? IP_RATE_NS : TENANT_RATE_NS;
  const now = Date.now();
  const normalizedKey = key.toString().slice(0, 256);
  pruneRateBuckets(ns, now, !readRateBucket(ns, normalizedKey));
  const bucket = readRateBucket(ns, normalizedKey) || {
    count: 0,
    resetAt: now + windowMs,
  };
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  writeSharedBucket(ns.prefix, ns.map, normalizedKey, bucket);
  if (bucket.count > maxPerWindow) {
    return {
      ok: false,
      retryAfterMs: bucket.resetAt - now,
      count: bucket.count,
    };
  }
  return { ok: true, count: bucket.count, resetAt: bucket.resetAt };
}

/** Both tables together: the number a memory ceiling has to reason about. */
function proxyRateLimitStateSize() {
  const now = Date.now();
  return RATE_NAMESPACES.reduce(function (total, ns) {
    pruneRateBuckets(ns, now, false);
    return total + sharedBucketKeys(ns.prefix, ns.map).length;
  }, 0);
}

/** Provider leases are atomic across JSVMs and expire after an interrupted call. */
function acquireProxyConcurrency(key, maxConcurrent) {
  try {
    return require(__hooks + "/providerCapacity.js").acquire(key, maxConcurrent);
  } catch (_e) {
    return { ok: false, retryAfterMs: 1000 };
  }
}

function upstreamContentLength(response) {
  if (!response || !response.headers) return null;
  const headers = response.headers;
  const keys = Object.keys(headers);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key.toLowerCase() !== "content-length") continue;
    const raw = Array.isArray(headers[key]) ? headers[key][0] : headers[key];
    const parsed = parseInt((raw || "").toString(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
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
  // Optional override of the FTC 16 CFR 255 team-member disclosure wording;
  // must match the max in migration 1751900000.
  employee_disclosure_text: 280,
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
  facebook_page_tag: 100,
  instagram_handle: 100,
  tiktok_handle: 100,
  x_handle: 100,
  linkedin_company_tag: 100,
  gbp_url: 500,
  default_hashtags: 1500,
  default_footer: 500,
  enabled_styles: 500,
  default_style: 60,
  enabled_fun_styles: 2000,
  custom_scenarios: 32000,
  default_tone: 40,
  playful_style: 80,
};

/**
 * Dealer text only a system administrator reads or writes. Kept out of
 * DEALER_TEXT_FIELD_LIMITS on purpose, so the admin-only rule is visible
 * where the limits live:
 *  - PATCH /api/app/dealers/:id drops these fields for every other role;
 *    POST /api/app/dealers is already system-admin only.
 *  - serializeDealer never returns them, so no login, session restore or
 *    impersonation payload carries them. Only GET /api/app/dealers (system
 *    admin only) adds them to its items.
 * Each limit must match the field's max in its migration.
 */
const DEALER_ADMIN_TEXT_FIELD_LIMITS = {
  // The administrator's own setup notes for a store (migration 1752400000).
  setup_notes: 4000,
};

const DEALER_SOCIAL_USERNAME_RULES = {
  instagram_handle: {
    label: "Instagram handle",
    maxLength: 30,
    pattern: /^[A-Za-z0-9._]+$/,
  },
  tiktok_handle: {
    label: "TikTok handle",
    maxLength: 24,
    pattern: /^[A-Za-z0-9._]+$/,
  },
  x_handle: {
    label: "X handle",
    maxLength: 15,
    pattern: /^[A-Za-z0-9_]+$/,
  },
};

/**
 * Persist social identities in one canonical form: no leading @, profile URL,
 * control character, or platform-invalid username. The client accepts pasted
 * profile links and extracts their identity before calling this boundary.
 */
function normalizeDealerSocialField(field, rawValue) {
  let value = (rawValue || "").toString().trim().replace(/^@+/, "");
  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    throw new Error("Social profiles must be saved as a Page name or handle");
  }

  // A Facebook @mention resolves only against the Page username, which never
  // contains spaces: storing the spaced display name rendered "@Bob Maxey Ford
  // of Howell" and linked to nothing. Close the value up here as well, so a
  // stale or non-browser client cannot persist a mention that cannot resolve.
  if (field === "facebook_page_tag") {
    value = value.replace(/[^A-Za-z0-9.]+/g, "").replace(/^\.+|\.+$/g, "");
    if (!value) return "";
    return assertString(value, DEALER_TEXT_FIELD_LIMITS[field]);
  }

  // LinkedIn keeps its spaced company display name: that composer resolves a
  // company from a typed suggestion rather than from a username.
  if (field === "linkedin_company_tag") {
    value = value
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return "";
    return assertString(value, DEALER_TEXT_FIELD_LIMITS[field]);
  }

  const rule = DEALER_SOCIAL_USERNAME_RULES[field];
  if (!rule) return value;
  if (value.length > rule.maxLength || !rule.pattern.test(value)) {
    throw new Error(
      rule.label +
        " may use only letters, numbers" +
        (field === "x_handle" ? ", and underscores" : ", periods, and underscores"),
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Dealer brand-consistency fields (spec 2026-09-02 §6; phase 1 ships dark)
// ---------------------------------------------------------------------------

const SIGNATURE_LOOK_VALUES = ["showroom", "hometown", "turbo"];
const IMAGE_QUALITY_TIER_VALUES = ["standard", "studio"];
/** The six Customer Hub categories the destination table (§4.4) keys off. */
const BRAND_CATEGORY_IDS = [
  "deliveries",
  "inventory",
  "service",
  "promotions",
  "community",
  "team",
];
/** Mirrors EXPORT_FORMATS ids in utils/multiFormatExport.ts. */
const EXPORT_FORMAT_IDS = [
  "story_vertical",
  "feed_portrait",
  "feed_square",
  "social_landscape",
  "marketplace",
  "gbp",
];
const MOTION_ASPECT_VALUES = ["9:16", "16:9"];
/** Mirrors VideoRequestOptions.soundtrack in types.ts. */
const MOTION_AUDIO_VALUES = ["none", "celebration", "cinematic", "anthemic", "funk"];
const LOGO_CORNER_VALUES = ["top_left", "top_right", "bottom_left", "bottom_right"];
const LOGO_SCALE_MIN = 0.04;
const LOGO_SCALE_MAX = 0.5;
const APPROVAL_POLICY_MODES = ["none", "first_n", "always", "per_category"];
const APPROVAL_FIRST_N_MAX = 100;
const FEATURE_PERMISSION_KEYS = ["playful", "video", "freeTextEdit"];
const FEATURE_PERMISSION_MAX_PEOPLE = 200;
const BRAND_VOICE_MAX_ITEMS = 3;
const BRAND_VOICE_MAX_CHARS = 60;

const DEALER_SELECT_FIELD_VALUES = {
  signature_look: SIGNATURE_LOOK_VALUES,
  alternate_look: SIGNATURE_LOOK_VALUES,
  image_quality_tier: IMAGE_QUALITY_TIER_VALUES,
};
/**
 * `creative_system_v2` is the phase-2 resolver flag (migration 1751800000).
 * It is written like any other dealer switch; while it is false the client
 * resolver keeps every pre-Look default, so flipping it is the only opt-in.
 */
const DEALER_BOOL_FIELDS = [
  "requires_approval",
  "required_hashtags_locked",
  "creative_system_v2",
  // Opt-OUT of the FTC team-member disclosure. Unset reads false in
  // PocketBase, which is the compliant side: the disclosure is applied.
  "employee_disclosure_disabled",
];
/** Byte caps; must match the json field maxSize in migration 1751500000. */
const DEALER_JSON_FIELD_LIMITS = {
  motion_signature: 2000,
  logo_placement: 1000,
  brand_voice_do: 1000,
  brand_voice_dont: 1000,
  category_destinations: 8000,
  approval_policy: 2000,
  feature_permissions: 8000,
};

function assertBooleanInput(field, value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(field + " must be true or false");
}

/** Empty clears a select; anything else must be one of the allowed ids. */
function assertSelectInput(field, value, allowed) {
  const normalized = collapseWhitespace(value);
  if (!normalized) return "";
  if (allowed.indexOf(normalized) === -1) {
    throw new Error(field + " must be one of " + allowed.join(", "));
  }
  return normalized;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accept a structured field as either a decoded value (JSON bodies) or its
 * JSON text (multipart bodies). null/empty clears the field.
 */
function parseJsonInput(field, value, maxSize) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw || raw === "null") return null;
    if (raw.length > maxSize) throw new Error(field + " is too large");
    try {
      return JSON.parse(raw);
    } catch (_e) {
      throw new Error(field + " must be valid JSON");
    }
  }
  if (typeof value !== "object") throw new Error(field + " must be valid JSON");
  return value;
}

/** Deduplicated list whose every entry comes from an allowlist. */
function allowedIdList(field, value, allowed) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(field + " must be a list");
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const item = collapseWhitespace(value[i]);
    if (allowed.indexOf(item) === -1) {
      throw new Error(field + " contains an unsupported value");
    }
    if (result.indexOf(item) === -1) result.push(item);
  }
  return result;
}

function validateBrandVoiceList(field, value) {
  if (!Array.isArray(value)) throw new Error(field + " must be a list of phrases");
  if (value.length > BRAND_VOICE_MAX_ITEMS) {
    throw new Error(field + " may list at most " + BRAND_VOICE_MAX_ITEMS + " phrases");
  }
  const result = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new Error(field + " must be a list of phrases");
    }
    const phrase = collapseWhitespace(value[i]);
    if (!phrase) continue;
    if (phrase.length > BRAND_VOICE_MAX_CHARS) {
      throw new Error(
        field + " phrases must be " + BRAND_VOICE_MAX_CHARS + " characters or fewer",
      );
    }
    result.push(phrase);
  }
  return result;
}

/** { style, aspects[], audio } — the fixed VideoRequestOptions for a Look. */
function validateMotionSignature(value) {
  if (!isPlainObject(value)) throw new Error("motion_signature has an invalid shape");
  const style = collapseWhitespace(value.style);
  if (!style || style.length > 40) {
    throw new Error("motion_signature style must be 1-40 characters");
  }
  const aspects = allowedIdList(
    "motion_signature aspects",
    value.aspects,
    MOTION_ASPECT_VALUES,
  );
  const audio = collapseWhitespace(value.audio) || "none";
  if (MOTION_AUDIO_VALUES.indexOf(audio) === -1) {
    throw new Error(
      "motion_signature audio must be one of " + MOTION_AUDIO_VALUES.join(", "),
    );
  }
  return { style: style, aspects: aspects, audio: audio };
}

/** { corner, scale } — logo anchor and width as a fraction of the canvas. */
function validateLogoPlacement(value) {
  if (!isPlainObject(value)) throw new Error("logo_placement has an invalid shape");
  const corner = collapseWhitespace(value.corner);
  if (LOGO_CORNER_VALUES.indexOf(corner) === -1) {
    throw new Error(
      "logo_placement corner must be one of " + LOGO_CORNER_VALUES.join(", "),
    );
  }
  const scale = typeof value.scale === "number" ? value.scale : Number(value.scale);
  if (!Number.isFinite(scale) || scale < LOGO_SCALE_MIN || scale > LOGO_SCALE_MAX) {
    throw new Error(
      "logo_placement scale must be between " +
        LOGO_SCALE_MIN +
        " and " +
        LOGO_SCALE_MAX,
    );
  }
  return { corner: corner, scale: Math.round(scale * 1000) / 1000 };
}

/** category → { platformIds[], formatIds[], video } (§4.4). */
function validateCategoryDestinations(value) {
  if (!isPlainObject(value)) {
    throw new Error("category_destinations has an invalid shape");
  }
  const result = {};
  const platformIds = allowedPostPlatformIds();
  const categories = Object.keys(value);
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    if (BRAND_CATEGORY_IDS.indexOf(category) === -1) {
      throw new Error("category_destinations contains an unknown category");
    }
    const entry = value[category];
    if (!isPlainObject(entry)) {
      throw new Error("category_destinations has an invalid shape");
    }
    result[category] = {
      platformIds: allowedIdList(
        "category_destinations platformIds",
        entry.platformIds,
        platformIds,
      ),
      formatIds: allowedIdList(
        "category_destinations formatIds",
        entry.formatIds,
        EXPORT_FORMAT_IDS,
      ),
      video:
        entry.video === undefined
          ? false
          : assertBooleanInput("category_destinations video", entry.video),
    };
  }
  return result;
}

/** { mode, firstN?, categories[]? } — extends dealers.requires_approval. */
function validateApprovalPolicy(value) {
  if (!isPlainObject(value)) throw new Error("approval_policy has an invalid shape");
  const mode = collapseWhitespace(value.mode);
  if (APPROVAL_POLICY_MODES.indexOf(mode) === -1) {
    throw new Error(
      "approval_policy mode must be one of " + APPROVAL_POLICY_MODES.join(", "),
    );
  }
  const result = { mode: mode };
  if (mode === "first_n") {
    const firstN =
      typeof value.firstN === "number" ? value.firstN : Number(value.firstN);
    if (!Number.isInteger(firstN) || firstN < 1 || firstN > APPROVAL_FIRST_N_MAX) {
      throw new Error(
        "approval_policy firstN must be a whole number from 1 to " +
          APPROVAL_FIRST_N_MAX,
      );
    }
    result.firstN = firstN;
  }
  if (mode === "per_category") {
    result.categories = allowedIdList(
      "approval_policy categories",
      value.categories,
      BRAND_CATEGORY_IDS,
    );
  }
  return result;
}

/** feature → { team, people: { [personId]: bool } } for playful/video/freeTextEdit. */
function validateFeaturePermissions(value) {
  if (!isPlainObject(value))
    throw new Error("feature_permissions has an invalid shape");
  const result = {};
  const features = Object.keys(value);
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (FEATURE_PERMISSION_KEYS.indexOf(feature) === -1) {
      throw new Error("feature_permissions contains an unknown feature");
    }
    const entry = value[feature];
    if (!isPlainObject(entry))
      throw new Error("feature_permissions has an invalid shape");
    const people = {};
    if (entry.people !== undefined && entry.people !== null) {
      if (!isPlainObject(entry.people)) {
        throw new Error("feature_permissions has an invalid shape");
      }
      const personIds = Object.keys(entry.people);
      if (personIds.length > FEATURE_PERMISSION_MAX_PEOPLE) {
        throw new Error("feature_permissions lists too many people");
      }
      for (let j = 0; j < personIds.length; j++) {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(personIds[j])) {
          throw new Error("feature_permissions has an invalid person id");
        }
        people[personIds[j]] = assertBooleanInput(
          "feature_permissions people",
          entry.people[personIds[j]],
        );
      }
    }
    result[feature] = {
      team:
        entry.team === undefined
          ? false
          : assertBooleanInput("feature_permissions team", entry.team),
      people: people,
    };
  }
  return result;
}

const DEALER_JSON_FIELD_VALIDATORS = {
  motion_signature: validateMotionSignature,
  logo_placement: validateLogoPlacement,
  brand_voice_do: function (value) {
    return validateBrandVoiceList("brand_voice_do", value);
  },
  brand_voice_dont: function (value) {
    return validateBrandVoiceList("brand_voice_dont", value);
  },
  category_destinations: validateCategoryDestinations,
  approval_policy: validateApprovalPolicy,
  feature_permissions: validateFeaturePermissions,
};

/**
 * Validate one structured dealer field and return the canonical JSON text to
 * store (PocketBase json fields accept raw JSON strings), or null to clear.
 */
function dealerJsonFieldValue(field, rawValue) {
  const limit = DEALER_JSON_FIELD_LIMITS[field];
  const validator = DEALER_JSON_FIELD_VALIDATORS[field];
  if (!limit || !validator) throw new Error("Unknown dealer field");
  const parsed = parseJsonInput(field, rawValue, limit);
  if (parsed === null) return null;
  const serialized = JSON.stringify(validator(parsed));
  if (serialized.length > limit) throw new Error(field + " is too large");
  return serialized;
}

/** Read a json field back as a decoded object, or null when unset/invalid. */
function readDealerJsonField(record, field) {
  let raw = "";
  try {
    raw = (record.getString(field) || "").toString().trim();
  } catch (_e) {
    return null;
  }
  if (!raw || raw === "null") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_e) {
    return null;
  }
}

/** Brand-voice chip lists always serialize as string arrays. */
function readDealerStringList(record, field) {
  const parsed = readDealerJsonField(record, field);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(function (item) {
    return typeof item === "string";
  });
}

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
    if (field === "name" || field === "default_tone" || field === "playful_style") {
      value = value.trim();
    }
    if (
      field === "facebook_page_tag" ||
      field === "instagram_handle" ||
      field === "tiktok_handle" ||
      field === "x_handle" ||
      field === "linkedin_company_tag"
    ) {
      value = normalizeDealerSocialField(field, value);
    }
    data[field] = assertString(value, DEALER_TEXT_FIELD_LIMITS[field]);
  }

  // System-administrator text. Validated here like any other text field; the
  // PATCH route removes it for every role except super_admin. Stored as typed
  // (no trim, newlines kept), except that the CRLF a browser writes for each
  // line break in multipart form data becomes LF, so the limit counts a line
  // break once, as the textarea that typed it did.
  const adminTextFields = Object.keys(DEALER_ADMIN_TEXT_FIELD_LIMITS);
  for (let i = 0; i < adminTextFields.length; i++) {
    const field = adminTextFields[i];
    if (body[field] === undefined) continue;
    // PocketBase 0.22 turns a multipart value that reads as a number or a
    // boolean into one ("0" -> 0, "false" -> false); keep its text instead of
    // letting `|| ""` erase it.
    const raw = body[field];
    const value = (raw === null ? "" : String(raw)).replace(/\r\n?/g, "\n");
    data[field] = assertString(value, DEALER_ADMIN_TEXT_FIELD_LIMITS[field]);
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

  for (let i = 0; i < DEALER_BOOL_FIELDS.length; i++) {
    const field = DEALER_BOOL_FIELDS[i];
    if (body[field] === undefined) continue;
    data[field] = assertBooleanInput(field, body[field]);
  }

  const selectFields = Object.keys(DEALER_SELECT_FIELD_VALUES);
  for (let i = 0; i < selectFields.length; i++) {
    const field = selectFields[i];
    if (body[field] === undefined) continue;
    data[field] = assertSelectInput(
      field,
      body[field],
      DEALER_SELECT_FIELD_VALUES[field],
    );
  }

  const jsonFields = Object.keys(DEALER_JSON_FIELD_LIMITS);
  for (let i = 0; i < jsonFields.length; i++) {
    const field = jsonFields[i];
    if (body[field] === undefined) continue;
    data[field] = dealerJsonFieldValue(field, body[field]);
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

const SAFE_FIELD_MESSAGE_PREFIXES = Object.keys(DEALER_SELECT_FIELD_VALUES)
  .concat(DEALER_BOOL_FIELDS)
  .concat(Object.keys(DEALER_JSON_FIELD_LIMITS))
  .concat(Object.keys(PERSON_TEXT_FIELD_LIMITS))
  .concat(PERSON_BOOL_FIELDS)
  .concat(["manager_scope"]);

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
    "Social profiles must be saved as a Page name or handle",
    "Instagram handle may use only letters, numbers, periods, and underscores",
    "TikTok handle may use only letters, numbers, periods, and underscores",
    "X handle may use only letters, numbers, and underscores",
  ];
  for (let i = 0; i < known.length; i++) {
    if (message.indexOf(known[i]) !== -1) return known[i];
  }
  // Brand-consistency validators emit "<field> <reason>" messages that never
  // echo client input, so they are safe to surface verbatim.
  for (let i = 0; i < SAFE_FIELD_MESSAGE_PREFIXES.length; i++) {
    if (message.indexOf(SAFE_FIELD_MESSAGE_PREFIXES[i] + " ") === 0) return message;
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
    } catch (e) {
      console.warn("[provider-resources] expired-claim delete failed: " + e);
    }
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
  // A stored file name gets the file route; only an absolute URL is left as
  // is. A plain prefix test sent an uploaded "https-logo_x1.png" nowhere.
  if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
    logoUrl = `/api/files/dealers/${record.id}/${logoUrl}`;
  }

  // This object is the session payload: login, session restore and
  // impersonation all send it. Never add `setup_notes` (or any other
  // DEALER_ADMIN_TEXT_FIELD_LIMITS field) here: the notes are the system
  // administrator's alone, and a manager, a salesperson, or an administrator
  // opened as a manager must not receive them. GET /api/app/dealers adds the
  // notes to its own items instead.
  return {
    id: record.id,
    name: record.getString("name"),
    is_system: recordBool(record, "is_system"),
    invitation_required: recordBool(record, "invitation_required"),
    has_invitation: !!record.getString("invitation_hash"),
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
    facebook_page_tag: record.getString("facebook_page_tag"),
    instagram_handle: record.getString("instagram_handle"),
    tiktok_handle: record.getString("tiktok_handle"),
    x_handle: record.getString("x_handle"),
    linkedin_company_tag: record.getString("linkedin_company_tag"),
    gbp_url: record.getString("gbp_url"),
    default_hashtags: record.getString("default_hashtags"),
    default_footer: record.getString("default_footer"),
    enabled_styles: record.getString("enabled_styles"),
    default_style: record.getString("default_style"),
    enabled_fun_styles: record.getString("enabled_fun_styles"),
    custom_scenarios: record.getString("custom_scenarios"),
    // Brand-consistent creative system (phase 1). Structured fields arrive
    // decoded so the client never parses JSON text out of the session.
    signature_look: record.getString("signature_look"),
    alternate_look: record.getString("alternate_look"),
    default_tone: record.getString("default_tone"),
    playful_style: record.getString("playful_style"),
    motion_signature: readDealerJsonField(record, "motion_signature"),
    logo_placement: readDealerJsonField(record, "logo_placement"),
    brand_voice_do: readDealerStringList(record, "brand_voice_do"),
    brand_voice_dont: readDealerStringList(record, "brand_voice_dont"),
    required_hashtags_locked: recordBool(record, "required_hashtags_locked"),
    category_destinations: readDealerJsonField(record, "category_destinations"),
    approval_policy: readDealerJsonField(record, "approval_policy"),
    feature_permissions: readDealerJsonField(record, "feature_permissions"),
    image_quality_tier: record.getString("image_quality_tier"),
    // Phase 2 resolver flag. False/unset keeps every legacy creative default.
    creative_system_v2: recordBool(record, "creative_system_v2"),
    employee_disclosure_text: record.getString("employee_disclosure_text"),
    employee_disclosure_disabled: recordBool(record, "employee_disclosure_disabled"),
  };
}

const BUILT_IN_POST_SCENARIOS = {
  customer_delivery: true,
  preowned_spotlight: false,
  new_arrival: false,
  trade_in_spotlight: false,
  service_promotion: false,
  recall_complete: true,
  customer_testimonial: true,
  sold_by_salesperson: true,
  model_year_end: false,
  community_event: false,
  team_anniversary: false,
  test_drive_invite: false,
};

/**
 * Resolve a scenario only from the server-owned catalog or the dealer's
 * validated custom-scenario record. Unknown ids fail closed instead of
 * allowing a modified client to bypass customer-release enforcement.
 */
function resolvePostScenarioPolicy(scenarioId, customScenariosJson, customerName) {
  const id = (scenarioId || "").toString();
  const hasCustomer = normalizeReleaseIdentity(customerName).length > 0;
  if (!id) {
    // The product's canonical/default scenario is customer delivery. Legacy
    // or tampered clients that omit both fields therefore fail closed instead
    // of bypassing consent for an unidentified customer photo.
    return { ok: true, releaseRequired: true };
  }
  if (Object.prototype.hasOwnProperty.call(BUILT_IN_POST_SCENARIOS, id)) {
    return {
      ok: true,
      releaseRequired: hasCustomer || BUILT_IN_POST_SCENARIOS[id] === true,
    };
  }

  try {
    const customScenarios = JSON.parse((customScenariosJson || "[]").toString());
    if (Array.isArray(customScenarios)) {
      for (let i = 0; i < customScenarios.length; i++) {
        const scenario = customScenarios[i];
        if (scenario && scenario.id === id) {
          return {
            ok: true,
            // Website publishing classifies custom Delivery scenarios as
            // customer stories. Consent must follow that server-owned content
            // classification even if a malformed/custom UI flag says false.
            releaseRequired:
              hasCustomer ||
              scenario.requiresCustomer === true ||
              scenario.category === "delivery",
          };
        }
      }
    }
  } catch (_e) {}
  return { ok: false, releaseRequired: true };
}

function normalizeReleaseIdentity(value) {
  return (value || "").toString().trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeReleaseVin(value) {
  return (value || "").toString().trim().toUpperCase();
}

/**
 * PocketBase serializes each route callback into an isolated JSVM program.
 * Keep this allowlist behind a required helper instead of relying on a
 * main.pb.js module-scope binding that disappears at the callback boundary.
 */
function allowedPostPlatformIds() {
  return [
    "instagram_feed",
    "instagram_reel",
    "instagram_story",
    "facebook_feed",
    "tiktok",
    "gbp",
    "marketplace",
    "linkedin",
    "x_twitter",
    "native_share",
  ];
}

/**
 * Parse a platform-caption map under the same destination allowlist used for
 * post sizing. Captions may only exist for selected destinations and remain
 * within the persisted field's aggregate and per-caption bounds.
 */
function parsePostPlatformCaptions(rawValue, allowedPlatformIds, selectedPlatformIds) {
  const raw = (rawValue || "").toString();
  if (!raw) return { ok: true, value: {}, serialized: "{}" };
  if (raw.length > 60000) {
    return { ok: false, error: "Platform captions are too large" };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return { ok: false, error: "Invalid platform captions" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Invalid platform captions" };
  }

  const result = {};
  const keys = Object.keys(parsed);
  if (keys.length > allowedPlatformIds.length) {
    return { ok: false, error: "Too many platform captions" };
  }
  for (let i = 0; i < keys.length; i++) {
    const platformId = keys[i];
    if (
      allowedPlatformIds.indexOf(platformId) === -1 ||
      selectedPlatformIds.indexOf(platformId) === -1
    ) {
      return { ok: false, error: "Invalid platform caption destination" };
    }
    if (typeof parsed[platformId] !== "string") {
      return { ok: false, error: "Invalid platform caption" };
    }
    const caption = parsed[platformId].trim();
    if (caption.length > 12000) {
      return { ok: false, error: "Platform caption is too long" };
    }
    if (caption) result[platformId] = caption;
  }

  const serialized = JSON.stringify(result);
  if (serialized.length > 60000) {
    return { ok: false, error: "Platform captions are too large" };
  }
  return { ok: true, value: result, serialized: serialized };
}

function purgeExpiredSessionsAndOldEvents() {
  const nowStr = databaseTimestamp(new Date().toISOString());
  try {
    const expiredSessions = $app
      .dao()
      .findRecordsByFilter("sessions", "expires_at <= {:now}", "id", 500, 0, {
        now: nowStr,
      });
    for (let i = 0; i < expiredSessions.length; i++) {
      try {
        $app.dao().deleteRecord(expiredSessions[i]);
      } catch (e) {
        // Tolerate one bad row, but keep a systematically failing GC visible.
        console.warn("[session-gc] expired-session delete failed: " + e);
      }
    }

    const ninetyDaysAgo = databaseTimestamp(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const oldEvents = $app
      .dao()
      .findRecordsByFilter("auth_events", "created < {:ago}", "id", 500, 0, {
        ago: ninetyDaysAgo,
      });
    for (let i = 0; i < oldEvents.length; i++) {
      try {
        $app.dao().deleteRecord(oldEvents[i]);
      } catch (e) {
        console.warn("[session-gc] auth-event prune failed: " + e);
      }
    }
  } catch (err) {
    console.error("[purgeExpiredSessionsAndOldEvents] error", err);
  }
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
  adminAuthFingerprint,
  findActiveAdminLogin,
  findAdminPasswordVerificationAccount,
  ensureAdminAccountProvisioned,
  personPinFingerprint,
  managerAuthFingerprint,
  // Token lifecycle
  secureRandomString,
  mintSessionToken,
  hashSessionToken,
  createSession,
  createSessionWithDao,
  replaceImpersonationSession,
  refreshSession,
  revokeSession,
  revokeDealerSessions,
  revokePersonSessions,
  revokePersonSessionsWithDao,
  buildSessionCookie,
  buildClearCookie,
  databaseTimestamp,
  purgeExpiredSessionsAndOldEvents,
  // Request metadata
  clientIP,
  trustedVercelProxyRequest,
  userAgent,
  legacyClientCompatibilityEnabled,
  recordProxyGenerationEvent,
  proxyGenerationIdentity,
  proxyGenerationPurpose,
  proxyGenerationUsage,
  proxyPolicyVersionMismatch,
  generationUsageSummary,
  GENERATION_PURPOSES,
  proxyGenerationResponseSucceeded,
  claimGenerationEvents,
  finalizeGenerationEventClaims,
  releaseGenerationEventClaims,
  buildSafeTelemetryEnvelope,
  persistBoundedTelemetryEvent,
  // Audit + rate limit
  logAuthEvent,
  logCoalescedAuthEvent,
  runAuditedTransaction,
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
  proxyRateLimitStateSize,
  acquireProxyConcurrency,
  upstreamContentLength,
  // Constants
  SESSION_TTL_SECONDS,
  PROVIDER_RESOURCE_TTL_SECONDS,
  TURNSTILE_ACTION,
  API_CONTRACT_VERSION,
  PROXY_CAPABILITIES,
  // Validation
  assertString,
  assertEnum,
  normalizeDealerSocialField,
  dealerMutationData,
  dealerJsonFieldValue,
  SIGNATURE_LOOK_VALUES,
  IMAGE_QUALITY_TIER_VALUES,
  BRAND_CATEGORY_IDS,
  DEALER_JSON_FIELD_LIMITS,
  DEALER_ADMIN_TEXT_FIELD_LIMITS,
  restrictDealerLogoSchema,
  dealerLogoFile,
  assertDealerCredentialAvailable,
  safeDealerMutationError,
  safePhotoReleaseError,
  isValidPersonPin,
  personPinHash,
  salespersonPinPepper,
  backfillSalespersonPinHashes,
  normalizePersonPin,
  normalizeManagerUsername,
  isValidManagerUsername,
  isManagerLoginPasswordShape,
  isStrongManagerPassword,
  findActivePersonByPin,
  findActiveManagerLogin,
  findManagerPasswordVerificationAccount,
  findManagerAccountByPersonWithDao,
  assertManagerUsernameAvailableWithDao,
  assertPersonPinAvailableWithDao,
  assertPersonPinAvailable,
  assertStoredPersonCredentialAvailableWithDao,
  personRoleToSessionRole,
  serializePerson,
  serializePersonSummary,
  personProfileMutationData,
  personProfileErrorPayload,
  isAuthoritativePostPerson,
  generateUniquePersonPin,
  generateUniquePersonPinWithDao,
  resolvePostScenarioPolicy,
  normalizeReleaseIdentity,
  normalizeReleaseVin,
  allowedPostPlatformIds,
  parsePostPlatformCaptions,
  safeProviderTransportDiagnostic,
  // Provider resource ownership
  claimProviderResource,
  claimProviderResources,
  dealerOwnsProviderResource,
  // Serialization
  serializeDealer,
};
