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
    const record = $app
      .dao()
      .findFirstRecordByFilter("sessions", "token_hash = {:h}", {
        h: tokenHash,
      });
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

    // Super-admin authority is bound to the *current* deployment secret, not
    // merely to a role captured when the cookie was minted. Rotating or
    // removing ADMIN_DEALER_CODE therefore kills every older admin cookie on
    // its next use, even if the session row has not reached its normal TTL.
    if (record.getString("role") === "super_admin") {
      const configuredAdminCode = (
        $os.getenv("ADMIN_DEALER_CODE") || ""
      ).trim();
      let currentAdminDealer = null;
      if (/^[A-Za-z0-9]{6,12}$/.test(configuredAdminCode)) {
        try {
          currentAdminDealer = $app
            .dao()
            .findRecordById("dealers", record.getString("dealer"));
        } catch (_e) {}
      }

      if (
        !currentAdminDealer ||
        currentAdminDealer.getString("code") !== configuredAdminCode
      ) {
        try {
          $app.dao().deleteRecord(record);
        } catch (_e) {
          /* reject even if cleanup fails */
        }
        return null;
      }
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
    if (
      typeof $security !== "undefined" &&
      $security.randomStringWithAlphabet
    ) {
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
 * @param {{ personId?: string, isImpersonation?: boolean, impersonatorSessionId?: string }} [opts]
 */
function createSession(dealerId, role, ip, userAgent, opts) {
  const sessions = $app.dao().findCollectionByNameOrId("sessions");
  if (!sessions) throw new Error("sessions collection missing");

  const token = mintSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const options = opts || {};

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
  if (options.personId) payload.person = options.personId;
  if (options.impersonatorSessionId) {
    payload.impersonator_session = String(options.impersonatorSessionId).slice(
      0,
      64,
    );
  }

  const record = new Record(sessions, payload);
  $app.dao().saveRecord(record);
  return { token: token, expiresAt: expires, sessionId: record.id };
}

/** Exactly 4 digits — personal access codes for managers and salespeople. */
function isValidPersonPin(value) {
  return typeof value === "string" && /^[0-9]{4}$/.test(value);
}

function normalizePersonPin(value) {
  return (value || "").toString().trim();
}

/**
 * Find an active person by personal 4-digit pin.
 * Returns null when not found or inactive.
 */
function findActivePersonByPin(pin) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) return null;
  try {
    return $app.dao().findFirstRecordByFilter(
      "salespeople",
      "pin = {:pin} && active = true",
      { pin: normalized },
    );
  } catch (_e) {
    return null;
  }
}

/**
 * Ensure pin is free among active people (optionally excluding a record id).
 */
function assertPersonPinAvailable(pin, excludePersonId) {
  const normalized = normalizePersonPin(pin);
  if (!isValidPersonPin(normalized)) {
    throw new Error("Access code must be exactly 4 digits");
  }
  let match = null;
  try {
    let filter = "pin = {:pin} && active = true";
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
  return "salesperson";
}

function serializePerson(record) {
  if (!record) return null;
  return {
    id: record.id,
    dealer: record.getString("dealer"),
    name: record.getString("name"),
    pin: record.getString("pin"),
    role: record.getString("role") || "salesperson",
    active: record.getBool ? record.getBool("active") : !!record.get("active"),
    created_at: record.getString("created_at"),
  };
}

/**
 * Mint a unique 4-digit pin for a new person. Retries on collision.
 */
function generateUniquePersonPin() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pin = secureRandomString(4, "0123456789");
    try {
      assertPersonPinAvailable(pin, "");
      return pin;
    } catch (_e) {
      /* try again */
    }
  }
  throw new Error("Could not allocate a unique access code");
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
  if (!token) return;
  try {
    const tokenHash = hashSessionToken(token);
    const record = $app
      .dao()
      .findFirstRecordByFilter("sessions", "token_hash = {:h}", {
        h: tokenHash,
      });
    if (record) $app.dao().deleteRecord(record);
  } catch (_e) {
    /* already gone */
  }
}

/**
 * Revoke every opaque session for a dealership after either login credential
 * changes. The caller may preserve its own token when a super-admin rotates
 * the credential on the dealer record backing the active admin session.
 */
function revokeDealerSessions(dealerId, preserveToken) {
  const preserveHash = preserveToken ? hashSessionToken(preserveToken) : "";
  const records = $app
    .dao()
    .findRecordsByFilter(
      "sessions",
      "dealer = {:dealer}",
      "created",
      10000,
      0,
      { dealer: dealerId },
    );
  let revoked = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (preserveHash && record.getString("token_hash") === preserveHash) {
      continue;
    }
    $app.dao().deleteRecord(record);
    revoked++;
  }
  return revoked;
}

/**
 * End every session tied to a person (pin rotate / deactivate).
 * Next sign-in must use the current access code.
 */
function revokePersonSessions(personId) {
  if (!personId) return 0;
  let records = [];
  try {
    records = $app.dao().findRecordsByFilter(
      "sessions",
      "person = {:person}",
      "created",
      10000,
      0,
      { person: personId },
    );
  } catch (_e) {
    return 0;
  }
  let revoked = 0;
  for (let i = 0; i < records.length; i++) {
    try {
      $app.dao().deleteRecord(records[i]);
      revoked++;
    } catch (_e) {
      /* continue */
    }
  }
  return revoked;
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
      // Never persist the attempted credential. Presence is enough for abuse
      // diagnostics without turning the audit table into a credential dump.
      credential_present: !!(opts && opts.credentialPresent),
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
        { k: kind, i: ip || "", s: since },
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

  // Login no longer uses dealers.code / admin_code for store access. Super-admin
  // may still set them for legacy/bootstrap (SYSTEM ADMIN code = ADMIN_DEALER_CODE).
  if (allowCode && body.code !== undefined) {
    const code = assertString((body.code || "").toString().trim(), 12);
    if (code && !/^[A-Za-z0-9]{4,12}$/.test(code)) {
      throw new Error("Dealer code must be 4-12 alphanumeric characters");
    }
    data.code = code;
  }

  if (allowAdminCode && body.admin_code !== undefined) {
    const adminCode = assertString(
      (body.admin_code || "").toString().trim(),
      12,
    );
    if (adminCode && !/^[A-Za-z0-9]{4,12}$/.test(adminCode)) {
      throw new Error("Manager code must be 4-12 alphanumeric characters");
    }
    data.admin_code = adminCode;
  }

  if (body.requires_approval !== undefined) {
    if (body.requires_approval === true || body.requires_approval === "true") {
      data.requires_approval = true;
    } else if (
      body.requires_approval === false ||
      body.requires_approval === "false"
    ) {
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
  const expiresAt = new Date(
    now.getTime() + PROVIDER_RESOURCE_TTL_SECONDS * 1000,
  );

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
  readSessionToken,
  findSessionByToken,
  // Token lifecycle
  secureRandomString,
  mintSessionToken,
  hashSessionToken,
  createSession,
  refreshSession,
  revokeSession,
  revokeDealerSessions,
  revokePersonSessions,
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
  PROVIDER_RESOURCE_TTL_SECONDS,
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
  generateUniquePersonPin,
  // Provider resource ownership
  claimProviderResource,
  claimProviderResources,
  dealerOwnsProviderResource,
  // Serialization
  serializeDealer,
};
