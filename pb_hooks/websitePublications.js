/**
 * Customer Hub private-draft delivery.
 *
 * This module intentionally owns no route callbacks. PocketBase serializes
 * each callback into an isolated JSVM program, so routes/cron jobs require the
 * module inside their own callback and call these exported functions.
 */

/**
 * PocketBase persists datetimes as `YYYY-MM-DD HH:MM:SS.mmmZ` (space, not "T"),
 * and SQLite compares them as text. A raw `toISOString()` parameter therefore
 * sorts AFTER every stored value from the same UTC day, because ' ' (0x20)
 * precedes 'T' (0x54) at index 10 — verified in SQLite:
 * `'2026-09-10 23:00:00.000Z' <= '2026-09-10T00:30:00.000Z'` is TRUE.
 *
 * The consequence: `next_attempt_at <= {:now}` matched rows scheduled up to a
 * day in the future, so the one-minute cron retried a failing delivery every
 * minute instead of backing off, burning all 8 attempts in ~8 minutes and
 * parking the draft as failed.
 *
 * Use this for every comparison parameter AND for raw-SQL SET values, which
 * bypass the normalisation that record.set()/saveRecord applies.
 * Mirrors databaseTimestamp() in helpers.js.
 */
const dbTimestamp = (value) => (value || "").toString().replace("T", " ");

const WEBSITE_DRAFT_SCHEMA_VERSION = 1;
const WEBSITE_PAYLOAD_SCHEMA_VERSION = 1;
const WEBSITE_DESTINATION_LABEL = "Joe Gallant Customer Hub";
const WEBSITE_DESTINATION_MODE = "private_draft";
const WEBSITE_INTAKE_PATH = "/api/integrations/dealer-social/content";
const WEBSITE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const WEBSITE_DELIVERY_MAX_ATTEMPTS = 8;
const WEBSITE_STATUS_REFRESH_MS = 15 * 60 * 1000;
const WEBSITE_BODY_LIMITS = {
  customer_story: 280,
  site_update: 900,
};
const WEBSITE_PRIVACY_FLAGS = [
  "faces_visible",
  "license_plate_visible",
  "personal_information_visible",
  "minor_may_be_visible",
  "review_visual_privacy",
];
const WEBSITE_CATEGORY_MAP = {
  delivery: "deliveries",
  inventory: "inventory",
  service: "service",
  promo: "promotions",
  community: "community",
  team: "team",
};
// Customer surnames can also be real vehicle makes. Bare make names remain
// valid in grounded vehicle/dealer copy, while possessive and family-name uses
// are still treated as customer references.
const AUTOMOTIVE_BRAND_TOKENS = {
  acura: true,
  audi: true,
  bmw: true,
  buick: true,
  cadillac: true,
  chevrolet: true,
  chevy: true,
  chrysler: true,
  dodge: true,
  ford: true,
  genesis: true,
  gmc: true,
  honda: true,
  hyundai: true,
  infiniti: true,
  jaguar: true,
  jeep: true,
  kia: true,
  landrover: true,
  lexus: true,
  lincoln: true,
  mazda: true,
  mercedes: true,
  mercedesbenz: true,
  mini: true,
  mitsubishi: true,
  nissan: true,
  porsche: true,
  ram: true,
  rivian: true,
  rover: true,
  subaru: true,
  tesla: true,
  toyota: true,
  volkswagen: true,
  volvo: true,
};
const BUILT_IN_WEBSITE_MAPPINGS = {
  customer_delivery: { kind: "customer_story", category: "deliveries" },
  preowned_spotlight: { kind: "site_update", category: "inventory" },
  new_arrival: { kind: "site_update", category: "inventory" },
  trade_in_spotlight: { kind: "site_update", category: "inventory" },
  service_promotion: { kind: "site_update", category: "service" },
  recall_complete: { kind: "site_update", category: "service" },
  customer_testimonial: { kind: "customer_story", category: "deliveries" },
  sold_by_salesperson: { kind: "customer_story", category: "team" },
  model_year_end: { kind: "site_update", category: "promotions" },
  community_event: { kind: "site_update", category: "community" },
  team_anniversary: { kind: "site_update", category: "team" },
  test_drive_invite: { kind: "site_update", category: "promotions" },
};
const WEBSITE_STATUSES = [
  "waiting_approval",
  "queued",
  "delivering",
  "draft_ready",
  "retrying",
  "failed",
  "published",
  "withdrawn",
];

function assertBoundedString(value, max, options) {
  const settings = options || {};
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!settings.multiline && /[\n\r]/.test(text)) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  if (text.length > max) return null;
  if (settings.required && !text) return null;
  return text;
}

function parseWebsiteDraft(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: null, serialized: "" };
  }

  let raw = rawValue;
  if (typeof rawValue === "string") {
    if (rawValue.length > 16000) {
      return { ok: false, error: "Website draft is too large" };
    }
    try {
      raw = JSON.parse(rawValue);
    } catch (_e) {
      return { ok: false, error: "Invalid website draft" };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid website draft" };
  }
  if (
    raw.schemaVersion !== WEBSITE_DRAFT_SCHEMA_VERSION ||
    typeof raw.enabled !== "boolean"
  ) {
    return { ok: false, error: "Unsupported website draft" };
  }
  if (!raw.enabled) {
    const disabled = { schemaVersion: WEBSITE_DRAFT_SCHEMA_VERSION, enabled: false };
    return { ok: true, value: disabled, serialized: JSON.stringify(disabled) };
  }

  if (raw.kind !== "customer_story" && raw.kind !== "site_update") {
    return { ok: false, error: "Invalid website content type" };
  }
  const category = assertBoundedString(raw.category, 40, { required: true });
  if (!category || !/^[a-z0-9][a-z0-9_-]*$/.test(category)) {
    return { ok: false, error: "Invalid website category" };
  }
  const title = assertBoundedString(raw.title, 100, { required: true });
  const body = assertBoundedString(raw.body, WEBSITE_BODY_LIMITS[raw.kind], {
    required: true,
    multiline: true,
  });
  const altText = assertBoundedString(raw.altText, 180, { required: true });
  if (title === null || body === null || altText === null) {
    return { ok: false, error: "Website copy exceeds destination limits" };
  }

  let customerDisplayName = "";
  if (raw.customerDisplayName !== undefined && raw.customerDisplayName !== null) {
    customerDisplayName = assertBoundedString(raw.customerDisplayName, 60, {});
    if (customerDisplayName === null || /[@\d]/.test(customerDisplayName)) {
      return { ok: false, error: "Invalid public customer label" };
    }
  }
  let vehicleDescription = "";
  if (raw.vehicleDescription !== undefined && raw.vehicleDescription !== null) {
    vehicleDescription = assertBoundedString(raw.vehicleDescription, 90, {});
    if (vehicleDescription === null) {
      return { ok: false, error: "Invalid public vehicle label" };
    }
  }

  const privacyFlags = [];
  if (raw.privacyFlags !== undefined && raw.privacyFlags !== null) {
    if (!Array.isArray(raw.privacyFlags) || raw.privacyFlags.length > 5) {
      return { ok: false, error: "Invalid website privacy review" };
    }
    for (let i = 0; i < raw.privacyFlags.length; i++) {
      const flag = assertBoundedString(raw.privacyFlags[i], 80, {});
      if (flag === null || WEBSITE_PRIVACY_FLAGS.indexOf(flag) === -1) {
        return { ok: false, error: "Invalid website privacy review" };
      }
      if (flag && privacyFlags.indexOf(flag) === -1) privacyFlags.push(flag);
    }
  }

  const normalized = {
    schemaVersion: WEBSITE_DRAFT_SCHEMA_VERSION,
    enabled: true,
    kind: raw.kind,
    category: category,
    title: title,
    body: body,
    altText: altText,
  };
  if (customerDisplayName) normalized.customerDisplayName = customerDisplayName;
  if (vehicleDescription) normalized.vehicleDescription = vehicleDescription;
  if (privacyFlags.length) normalized.privacyFlags = privacyFlags;
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 16000) {
    return { ok: false, error: "Website draft is too large" };
  }
  return { ok: true, value: normalized, serialized: serialized };
}

/**
 * Resolve POST TYPE -> Customer Hub routing only from the server-owned catalog
 * or the dealer's stored custom-scenario configuration. The browser may
 * propose copy, but it cannot change the destination content lane.
 */
function resolveWebsiteMapping(scenarioId, customScenariosJson) {
  const id = (scenarioId || "").toString().trim() || "customer_delivery";
  if (Object.prototype.hasOwnProperty.call(BUILT_IN_WEBSITE_MAPPINGS, id)) {
    const builtIn = BUILT_IN_WEBSITE_MAPPINGS[id];
    return { scenarioId: id, kind: builtIn.kind, category: builtIn.category };
  }

  try {
    const customScenarios = JSON.parse((customScenariosJson || "[]").toString());
    if (!Array.isArray(customScenarios)) return null;
    for (let i = 0; i < customScenarios.length; i++) {
      const scenario = customScenarios[i];
      if (!scenario || scenario.id !== id) continue;
      if (
        typeof scenario.id !== "string" ||
        typeof scenario.label !== "string" ||
        typeof scenario.promptAdditions !== "string"
      ) {
        return null;
      }
      const sourceCategory = scenario.category || "promo";
      if (
        typeof sourceCategory !== "string" ||
        !Object.prototype.hasOwnProperty.call(WEBSITE_CATEGORY_MAP, sourceCategory)
      ) {
        return null;
      }
      return {
        scenarioId: id,
        kind:
          scenario.requiresCustomer === true || sourceCategory === "delivery"
            ? "customer_story"
            : "site_update",
        category: WEBSITE_CATEGORY_MAP[sourceCategory],
      };
    }
  } catch (_e) {}
  return null;
}

function websiteDraftMatchesScenario(scenarioId, customScenariosJson, draft) {
  if (!draft || draft.enabled !== true) return true;
  const mapping = resolveWebsiteMapping(scenarioId, customScenariosJson);
  return !!(
    mapping &&
    draft.kind === mapping.kind &&
    draft.category === mapping.category
  );
}

function readEnvironment(name) {
  try {
    return ($os.getenv(name) || "").toString();
  } catch (_e) {
    return "";
  }
}

function normalizeSiteUrl(value) {
  const raw = (value || "").toString();
  if (!raw || raw !== raw.trim() || raw.length > 500) return "";
  const withoutSlash = raw.replace(/\/+$/, "");
  const match = withoutSlash.match(
    /^(https?):\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/i,
  );
  if (!match) return "";
  const protocol = match[1].toLowerCase();
  const host = match[2].toLowerCase();
  const port = match[3] ? parseInt(match[3], 10) : 0;
  if (port > 65535) return "";
  if (
    protocol !== "https" &&
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "::1"
  ) {
    return "";
  }
  return protocol + "://" + host + (match[3] ? ":" + match[3] : "");
}

function destinationConfiguration(dealerId) {
  // All production reads share the encrypted resolver, including fail-closed
  // managed records. The no-hooks branch supports deterministic Node contracts.
  const snapshot =
    typeof __hooks !== "undefined"
      ? require(__hooks + "/connectionConfig.js").runtimeSnapshot("website", dealerId)
      : null;
  const canaryDealerId = readEnvironment("CUSTOMER_HUB_CANARY_DEALER_ID");
  const realDealerId = readEnvironment("CUSTOMER_HUB_DEALER_ID");
  const canary =
    /^[A-Za-z0-9_-]{1,64}$/.test(canaryDealerId.trim()) &&
    dealerId === canaryDealerId.trim() &&
    dealerId !== realDealerId;
  const value = (name) => {
    if (snapshot) return snapshot.values[name] || "";
    if (canary && name === "CUSTOMER_HUB_DEALER_ID") return canaryDealerId;
    if (canary && name === "CUSTOMER_HUB_SECRET")
      return readEnvironment("CUSTOMER_HUB_CANARY_SECRET");
    return readEnvironment(name);
  };
  const siteUrl = normalizeSiteUrl(value("CUSTOMER_HUB_URL"));
  const secret = value("CUSTOMER_HUB_SECRET");
  const destinationId = value("CUSTOMER_HUB_DESTINATION_ID");
  const allowedDealerId = value("CUSTOMER_HUB_DEALER_ID");
  const destinationIdValid =
    destinationId === destinationId.trim() &&
    /^[a-z0-9][a-z0-9_-]{0,79}$/.test(destinationId);
  const secretValid =
    secret === secret.trim() && secret.length >= 32 && secret.length <= 512;
  const guardValid =
    !!allowedDealerId &&
    allowedDealerId === allowedDealerId.trim() &&
    /^[A-Za-z0-9_-]{1,64}$/.test(allowedDealerId);
  const canaryValid =
    !canary ||
    (canaryDealerId === dealerId &&
      /^[A-Za-z0-9_-]{1,64}$/.test(realDealerId) &&
      secret !== readEnvironment("CUSTOMER_HUB_SECRET") &&
      /^[\x21-\x7e]{32,512}$/.test(secret));
  const enabled =
    canaryValid &&
    (!snapshot || snapshot.enabled) &&
    !!siteUrl &&
    secretValid &&
    destinationIdValid &&
    guardValid &&
    !!dealerId &&
    dealerId === allowedDealerId;

  return {
    id: destinationIdValid ? destinationId : "joe_customer_hub",
    label: WEBSITE_DESTINATION_LABEL,
    siteUrl: siteUrl,
    endpointUrl: siteUrl ? siteUrl + WEBSITE_INTAKE_PATH : "",
    secret: secretValid ? secret : "",
    allowedDealerId: guardValid ? allowedDealerId : "",
    enabled: enabled,
    mode: WEBSITE_DESTINATION_MODE,
    revision: snapshot ? snapshot.revision : 0,
    identity: snapshot
      ? snapshot.identity
      : canary && typeof $security !== "undefined"
        ? $security.sha256(
            JSON.stringify([
              "synthetic_canary",
              canaryDealerId,
              realDealerId,
              siteUrl,
              destinationId,
              secret,
            ]),
          )
        : "",
    managed: !!snapshot && snapshot.source === "managed",
    canary: canary,
  };
}

function publicDestinationConfiguration(dealerId) {
  const config = destinationConfiguration(dealerId);
  return {
    id: config.id,
    label: config.label,
    siteUrl: config.siteUrl,
    enabled: config.enabled,
    mode: config.mode,
    readiness: config.enabled ? "configured" : "configuration_hold",
    ...(config.canary
      ? { namespace: "synthetic_canary", dealerId: config.allowedDealerId }
      : {}),
  };
}

function recordString(record, field) {
  if (!record) return "";
  try {
    return record.getString(field);
  } catch (_e) {
    try {
      return (record[field] || "").toString();
    } catch (_ignored) {
      return "";
    }
  }
}

function recordBool(record, field) {
  if (!record) return false;
  try {
    return record.getBool ? !!record.getBool(field) : !!record.get(field);
  } catch (_e) {
    return !!record[field];
  }
}

function recordInt(record, field) {
  if (!record) return 0;
  try {
    return record.getInt
      ? Number(record.getInt(field)) || 0
      : Number(record.get(field)) || 0;
  } catch (_e) {
    return Number(record[field]) || 0;
  }
}

function publicationSummary(record) {
  if (!record) {
    return {
      status: "not_requested",
      attempts: 0,
      reviewUrl: "",
      lastError: "",
      updatedAt: "",
    };
  }
  const rawStatus = recordString(record, "status");
  return {
    status: WEBSITE_STATUSES.indexOf(rawStatus) !== -1 ? rawStatus : "failed",
    attempts: recordInt(record, "attempts"),
    reviewUrl: recordString(record, "review_url"),
    lastError: recordString(record, "last_error"),
    updatedAt: recordString(record, "updated"),
  };
}

function publicationSummaryForPost(post, record) {
  if (record) {
    const summary = publicationSummary(record);
    const identity = publicationCanaryIdentity(post, record);
    if (identity) {
      summary.canaryIdentity = identity.identity;
      summary.canaryMediaBase64Sha256 = identity.mediaBase64Sha256;
    }
    return summary;
  }
  const parsed = parseWebsiteDraft(recordString(post, "website_draft"));
  if (parsed.ok && parsed.value && parsed.value.enabled) {
    return {
      // Website selection prepares editable private copy only. Delivery does
      // not begin until the salesperson explicitly sends the final revision.
      status: "not_requested",
      attempts: 0,
      reviewUrl: "",
      lastError: "",
      updatedAt: recordString(post, "updated"),
    };
  }
  return publicationSummary(null);
}

function findPublicationForPostWithDaoStrict(dao, postId, destinationId) {
  if (!postId) return null;
  const params = { post: postId };
  let filter = "post = {:post}";
  if (destinationId) {
    filter += " && destination_id = {:destination}";
    params.destination = destinationId;
  }
  const rows = dao.findRecordsByFilter(
    "website_publications",
    filter,
    "-source_revision,-created",
    1,
    0,
    params,
  );
  return rows.length ? rows[0] : null;
}

function findPublicationForPostWithDao(dao, postId, destinationId) {
  try {
    return findPublicationForPostWithDaoStrict(dao, postId, destinationId);
  } catch (_e) {
    return null;
  }
}

function findPublicationForPost(postId, destinationId) {
  return findPublicationForPostWithDao($app.dao(), postId, destinationId);
}

function publicationSummariesForDealer(dealerId) {
  const result = {};
  if (!dealerId) return result;
  try {
    const rows = $app
      .dao()
      .findRecordsByFilter(
        "website_publications",
        "dealer = {:dealer}",
        "-source_revision,-created",
        2000,
        0,
        { dealer: dealerId },
      );
    for (let i = 0; i < rows.length; i++) {
      const postId = recordString(rows[i], "post");
      if (postId && !result[postId]) result[postId] = publicationSummary(rows[i]);
    }
  } catch (_e) {}
  return result;
}

function hasValidLinkedReleaseWithDao(dao, post) {
  if (!recordBool(post, "release_required")) return true;
  if (
    !recordBool(post, "has_release") ||
    recordString(post, "release_status") !== "saved"
  ) {
    return false;
  }
  try {
    const rows = dao.findRecordsByFilter(
      "photo_releases",
      "post_id = {:post} && dealer = {:dealer} && signature_png != '' && signed_at != ''",
      "-signed_at",
      1,
      0,
      { post: post.id, dealer: recordString(post, "dealer") },
    );
    if (rows.length !== 1) return false;
    const releaseCustomerIdentity = recordString(rows[0], "customer_name")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const postCustomerIdentity = recordString(post, "customer_name")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (
      !releaseCustomerIdentity ||
      !postCustomerIdentity ||
      releaseCustomerIdentity !== postCustomerIdentity
    ) {
      return false;
    }
    const signature = recordString(rows[0], "signature_png");
    if (!signature) return false;
    const fsys = $app.newFilesystem();
    try {
      return fsys.exists(rows[0].baseFilesPath() + "/" + signature);
    } finally {
      fsys.close();
    }
  } catch (_e) {
    return false;
  }
}

function hasValidLinkedRelease(post) {
  return hasValidLinkedReleaseWithDao($app.dao(), post);
}

function resolveWebsiteMappingForPostWithDao(dao, post) {
  const scenarioId = recordString(post, "scenario_id") || "customer_delivery";
  if (Object.prototype.hasOwnProperty.call(BUILT_IN_WEBSITE_MAPPINGS, scenarioId)) {
    return resolveWebsiteMapping(scenarioId, "");
  }

  const dealerId = recordString(post, "dealer");
  if (!dealerId) return null;
  try {
    const dealer = dao.findRecordById("dealers", dealerId);
    return resolveWebsiteMapping(scenarioId, recordString(dealer, "custom_scenarios"));
  } catch (_e) {
    return null;
  }
}

function resolveWebsiteMappingForPost(post) {
  const scenarioId = recordString(post, "scenario_id") || "customer_delivery";
  if (Object.prototype.hasOwnProperty.call(BUILT_IN_WEBSITE_MAPPINGS, scenarioId)) {
    return resolveWebsiteMapping(scenarioId, "");
  }
  return resolveWebsiteMappingForPostWithDao($app.dao(), post);
}

/**
 * The interactive routes gate this through requestPolicies directly. The
 * outbox repeats the same current-policy check so a pre-policy queued item
 * cannot slip through after a deploy. `__hooks` is absent only in the pure
 * Node harness used for this module's deterministic contract tests.
 */
function postNeedsCurrentImageReview(post) {
  if (typeof __hooks === "undefined") return false;
  try {
    const policies = require(__hooks + "/requestPolicies.js");
    return policies.postImageReviewRequired(post, policies.geminiModelPolicySnapshot());
  } catch (_e) {
    // A runtime policy lookup failure must stop new outbound media delivery.
    return true;
  }
}

function postReadinessWithDao(dao, post) {
  const parsedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
  if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) {
    return { ready: false, terminal: true, code: "website_request_withdrawn" };
  }
  const mapping = resolveWebsiteMappingForPostWithDao(dao, post);
  if (
    !mapping ||
    parsedDraft.value.kind !== mapping.kind ||
    parsedDraft.value.category !== mapping.category
  ) {
    return { ready: false, terminal: true, code: "website_mapping_conflict" };
  }
  const approval = recordString(post, "approval_status");
  if (approval === "rejected") {
    return { ready: false, terminal: true, code: "approval_rejected" };
  }
  if (approval !== "approved" && approval !== "n_a") {
    return { ready: false, terminal: false, code: "approval_pending" };
  }
  if (!hasValidLinkedReleaseWithDao(dao, post)) {
    return { ready: false, terminal: false, code: "release_pending" };
  }
  if (!recordString(post, "creative_image")) {
    return { ready: false, terminal: false, code: "creative_pending" };
  }
  if (postNeedsCurrentImageReview(post)) {
    return { ready: false, terminal: true, code: "image_review_required" };
  }
  return { ready: true, terminal: false, code: "ready" };
}

function postReadiness(post) {
  return postReadinessWithDao($app.dao(), post);
}

function savePublicationState(record, values) {
  const keys = Object.keys(values || {});
  for (let i = 0; i < keys.length; i++) record.set(keys[i], values[keys[i]]);
  $app.dao().saveRecord(record);
  return record;
}

function payloadSentAtForFirstQueue(publication, now) {
  if (
    recordInt(publication, "attempts") === 0 &&
    !recordString(publication, "payload_hash") &&
    !recordString(publication, "last_attempt_at")
  ) {
    return now;
  }
  return recordString(publication, "payload_sent_at");
}

function publicationRevisionDigest(postId, postRevision, securityApi) {
  const id = (postId || "").toString();
  const revision = assertBoundedString(postRevision, 80, { required: true });
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !revision) {
    throw new Error("website_post_revision_invalid");
  }
  const crypto = securityApi || $security;
  const digest = (crypto.sha256(id + "\n" + revision) || "").toString().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("website_post_revision_invalid");
  }
  return digest;
}

function publicationEventIdForPostRevision(
  postId,
  postRevision,
  sourceSnapshotHash,
  securityApi,
) {
  const snapshotHash = (sourceSnapshotHash || "").toString().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(snapshotHash)) {
    throw new Error("website_source_snapshot_invalid");
  }
  const revisionDigest = publicationRevisionDigest(postId, postRevision, securityApi);
  // The durable event identity binds both the exact client-observed post
  // revision (128 bits) and the canonical final copy/media snapshot (160
  // bits). It remains below the collection's 80-character event-id limit.
  return "wp_s_" + revisionDigest.slice(0, 32) + "_" + snapshotHash.slice(0, 40);
}

function publicationEventRevisionMatches(eventId, postId, postRevision, securityApi) {
  const match = (eventId || "")
    .toString()
    .toLowerCase()
    .match(/^wp_s_([a-f0-9]{32})_[a-f0-9]{40}$/);
  // Rows created before source-snapshot binding retain their original exact-
  // draft retry behavior. All new handoffs use the revision-bound identity.
  if (!match) return null;
  return (
    match[1] ===
    publicationRevisionDigest(postId, postRevision, securityApi).slice(0, 32)
  );
}

function createPublicationForPostWithDao(dao, post, config, eventId) {
  const parsedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
  if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) return null;
  const destination = config || destinationConfiguration(recordString(post, "dealer"));
  if (!destination.enabled) throw new Error("destination_unavailable");
  const existing = findPublicationForPostWithDaoStrict(dao, post.id, destination.id);
  if (existing) return existing;

  const readiness = postReadinessWithDao(dao, post);
  const now = new Date().toISOString();
  const status = readiness.terminal
    ? "withdrawn"
    : readiness.ready
      ? "queued"
      : "waiting_approval";
  const collection = dao.findCollectionByNameOrId("website_publications");
  const publicationEventId = (eventId || "").toString().toLowerCase();
  if (!/^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/.test(publicationEventId)) {
    throw new Error("website_source_snapshot_invalid");
  }
  const record = new Record(collection, {
    post: post.id,
    dealer: recordString(post, "dealer"),
    destination_id: destination.id,
    config_revision: destination.revision || 0,
    destination_identity: destination.identity || "",
    event_id: publicationEventId,
    source_revision: 1,
    // Frozen logical-payload time: retries rebuild byte-identical JSON.
    payload_sent_at: now,
    payload_hash: "",
    status: status,
    attempts: 0,
    next_attempt_at: status === "queued" ? now : "",
    last_attempt_at: "",
    delivered_at: "",
    remote_draft_id: "",
    review_url: "",
    last_error: status === "waiting_approval" ? readiness.code : "",
  });
  dao.saveRecord(record);
  return record;
}

function transactionAffectedExactlyOne(result) {
  return !!(
    result &&
    typeof result.rowsAffected === "function" &&
    Number(result.rowsAffected()) === 1
  );
}

function acquirePostWriteFence(dao, postId) {
  const result = dao
    .db()
    .newQuery("UPDATE posts SET updated = updated WHERE id = {:post}")
    .bind({ post: postId })
    .execute();
  if (!transactionAffectedExactlyOne(result)) {
    throw new Error("source_post_missing");
  }
}

/**
 * Atomically freeze the final website copy and media revision and create its
 * single outbox row. The write fence is deliberately the first transaction
 * statement: SQLite serializes competing sends before either request reads
 * the current post/publication pair.
 */
function claimPublicationForPost(
  postId,
  requestedDraft,
  expectedPostRevision,
  expectedDealerId,
) {
  const parsedDraft = parseWebsiteDraft(requestedDraft);
  if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) {
    throw new Error("website_request_withdrawn");
  }
  const expectedRevision = assertBoundedString(expectedPostRevision, 80, {
    required: true,
  });
  if (!expectedRevision) throw new Error("website_post_revision_required");

  let outcome = null;
  $app.dao().runInTransaction(function (txDao) {
    acquirePostWriteFence(txDao, postId);
    const post = txDao.findRecordById("posts", postId);
    const dealerId = recordString(post, "dealer");
    if (expectedDealerId && dealerId !== expectedDealerId) {
      throw new Error("website_dealer_conflict");
    }
    const config = destinationConfiguration(dealerId);
    if (!config.enabled) throw new Error("destination_unavailable");

    const existing = findPublicationForPostWithDaoStrict(txDao, post.id, "");
    const storedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
    if (existing) {
      if (!publicationDestinationMatches(existing, config, dealerId))
        throw new Error("destination_configuration_changed");
      if (!storedDraft.ok || storedDraft.serialized !== parsedDraft.serialized) {
        throw new Error("website_draft_already_sent");
      }
      const revisionMatches = publicationEventRevisionMatches(
        recordString(existing, "event_id"),
        post.id,
        expectedRevision,
        $security,
      );
      if (revisionMatches === false) {
        throw new Error("website_draft_already_sent");
      }
      // New rows also bind the exact canonical source/media bytes. Re-read and
      // verify them before reporting an idempotent success. Legacy rows do not
      // have a snapshot marker and preserve their prior exact-draft behavior.
      if (
        /^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/.test(
          recordString(existing, "event_id").toLowerCase(),
        )
      ) {
        const media = readPostCreative(post);
        verifyPublicationSourceSnapshot(
          existing,
          post,
          parsedDraft.value,
          media,
          $security,
          txDao,
        );
      }
      outcome = {
        post: post,
        publication: existing,
        idempotentReplay: true,
        postRevision: recordString(post, "updated"),
      };
      return;
    }

    if (recordString(post, "updated") !== expectedRevision) {
      throw new Error("website_post_revision_conflict");
    }
    const dealer = txDao.findRecordById("dealers", dealerId);
    if (
      !websiteDraftMatchesScenario(
        recordString(post, "scenario_id"),
        recordString(dealer, "custom_scenarios"),
        parsedDraft.value,
      )
    ) {
      throw new Error("website_mapping_conflict");
    }

    post.set("website_draft", parsedDraft.serialized);
    txDao.saveRecord(post);
    const frozenPost = txDao.findRecordById("posts", post.id);

    // Reading the creative and canonicalizing destination content inside the
    // same transaction freezes exactly what the sender reviewed. The compact
    // source hash is stored in the event id and revalidated before delivery.
    const media = readPostCreative(frozenPost);
    const sourceSnapshotHash = publicationSourceSnapshotHash(
      frozenPost,
      parsedDraft.value,
      media,
      $security,
      txDao,
      { identity: config.identity, revision: config.revision },
    );
    const eventId = publicationEventIdForPostRevision(
      frozenPost.id,
      expectedRevision,
      sourceSnapshotHash,
      $security,
    );
    const publication = createPublicationForPostWithDao(
      txDao,
      frozenPost,
      config,
      eventId,
    );
    if (!publication) throw new Error("website_request_withdrawn");
    outcome = {
      post: frozenPost,
      publication: publication,
      idempotentReplay: false,
      postRevision: recordString(frozenPost, "updated"),
    };
  });

  if (!outcome) throw new Error("website_publication_claim_failed");
  return outcome;
}

function reconcilePublicationForPost(postId) {
  const publication = findPublicationForPost(postId, "");
  if (!publication) return null;
  const currentStatus = recordString(publication, "status");
  if (
    currentStatus === "draft_ready" ||
    currentStatus === "published" ||
    currentStatus === "withdrawn" ||
    currentStatus === "delivering"
  ) {
    return publication;
  }
  let post = null;
  try {
    post = $app.dao().findRecordById("posts", postId);
  } catch (_e) {
    return savePublicationState(publication, {
      status: "withdrawn",
      next_attempt_at: "",
      last_error: "source_post_missing",
    });
  }
  const readiness = postReadiness(post);
  if (readiness.terminal) {
    return savePublicationState(publication, {
      status: "withdrawn",
      next_attempt_at: "",
      last_error: readiness.code,
    });
  }
  if (!readiness.ready) {
    return savePublicationState(publication, {
      status: "waiting_approval",
      next_attempt_at: "",
      last_error: readiness.code,
    });
  }
  if (currentStatus === "waiting_approval") {
    const now = new Date().toISOString();
    return savePublicationState(publication, {
      status: "queued",
      // A consent/approval wait may last longer than the destination's replay
      // window. Refresh only before the first attempted payload, then freeze.
      payload_sent_at: payloadSentAtForFirstQueue(publication, now),
      next_attempt_at: now,
      last_error: "",
    });
  }
  return publication;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectedNonFirstNameTokens(protectedName) {
  const normalized = (protectedName || "").toString().trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const rawTokens = normalized.split(" ").slice(1);
  const result = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i].replace(
      /[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF'’-]/g,
      "",
    );
    if (!token) continue;
    let exists = false;
    for (let j = 0; j < result.length; j++) {
      if (result[j].toLowerCase() === token.toLowerCase()) exists = true;
    }
    if (!exists) result.push(token);
  }
  return result;
}

function protectedNameTokenPattern(token, global) {
  return new RegExp(
    "(^|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF])" +
      escapeRegExp(token) +
      "(['’]s)?(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF])",
    global ? "gi" : "i",
  );
}

function isAutomotiveBrandToken(token) {
  return !!AUTOMOTIVE_BRAND_TOKENS[
    (token || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z]/g, "")
  ];
}

function publicCustomerLabel(value) {
  let normalized = (value || "")
    .toString()
    .normalize("NFKC")
    .replace(/[’‘ʼ]/g, "'")
    .trim()
    .replace(/[\r\n<>]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (!normalized) return "";
  if (/\bfamil(?:y|ies)$/i.test(normalized) || /^our\b/i.test(normalized)) {
    return normalized;
  }
  if (/\s(?:&|and)\s/i.test(normalized)) return "our customers";
  const tokens = normalized.split(" ").filter(Boolean);
  const honorifics = { mr: true, mrs: true, ms: true, miss: true, dr: true, mx: true };
  while (
    tokens.length > 1 &&
    honorifics[(tokens[0] || "").replace(/\./g, "").toLowerCase()]
  ) {
    tokens.shift();
  }
  // The label is the first token that has letters, with stray punctuation
  // ("Sarah.", "\"Sarah\"") folded away. Mirrors toPublicCustomerLabel() in
  // utils/customerIdentity.ts.
  const cleanPattern = new RegExp("[^" + IDENTITY_LETTER + "\u0300-\u036F'-]", "g");
  for (let i = 0; i < tokens.length; i++) {
    const clean = tokens[i]
      .replace(cleanPattern, "")
      .replace(/^['-]+|['-]+$/g, "")
      .slice(0, 40);
    if (clean) return clean;
  }
  return "Customer";
}

// The substituted label is tagged with a control character so the glued-on
// surname check ("Customer Smith") only ever fires on a real substitution,
// never on the literal word in "Customer Appreciation Day" or a split
// "#HappyCustomer". The tag is stripped before any pattern runs. Mirrors
// IDENTITY_PLACEHOLDER in utils/captionQuality.ts.
function replaceAllowedCustomerPhrase(text, phrase) {
  const normalized = (phrase || "")
    .toString()
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return text;
  return text.replace(
    new RegExp(
      "(^|[^" +
        IDENTITY_LETTER +
        "0-9])" +
        escapeRegExp(normalized).replace(/ /g, "\\s+") +
        "(?=$|[^" +
        IDENTITY_LETTER +
        "0-9])",
      "gi",
    ),
    "$1 \u0001Customer ",
  );
}

/**
 * Mark an allowed phrase as grounded business identity (the dealership's
 * configured name, the OEM it sells, a VIN-decoded vehicle description). Every
 * WORD of a grounded phrase may stand alone in customer-name grammar ("Ford is
 * proud", "Congrats, Ford family!", "Welcome to the family, Howell!") as long
 * as no unrelated capitalized word is attached to it. A plain string entry
 * (the salesperson's name) is only ever masked as a whole phrase, and only
 * outside the deliberate "Congratulations to X" patterns — a salesperson must
 * never be accepted as the celebrated customer. Mirrors
 * utils/captionQuality.ts on the client; the two are parity-tested.
 */
function groundedIdentityPhrase(phrase) {
  return { phrase: (phrase || "").toString(), grounded: true };
}

const ALLOWED_PHRASE_STOPWORDS = {
  of: true,
  the: true,
  and: true,
  at: true,
  in: true,
  a: true,
  an: true,
  inc: true,
  llc: true,
  co: true,
  corp: true,
};

// Kept identical to NON_CUSTOMER_CONTEXT_WORDS in utils/captionQuality.ts.
const IDENTITY_NON_CUSTOMER_WORDS = {};
[
  "customer",
  "customers",
  "family",
  "families",
  "they",
  "we",
  "he",
  "she",
  "it",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "now",
  "then",
  "everyone",
  "someone",
  "nobody",
  "who",
  "what",
  "how",
  "when",
  "where",
  "why",
  "which",
  "everything",
  "everybody",
  "anyone",
  "anybody",
  "anything",
  "something",
  "somebody",
  "nothing",
  "none",
  "all",
  "more",
  "big",
  "huge",
  "ready",
  "yes",
  "well",
  "hello",
  "hi",
  "hey",
  "home",
  "congratulations",
  "congrats",
  "thanks",
  "cheers",
  "kudos",
  "today",
  "tonight",
  "tomorrow",
  "yesterday",
  "day",
  "days",
  "night",
  "morning",
  "afternoon",
  "evening",
  "week",
  "month",
  "year",
  "season",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "spring",
  "summer",
  "fall",
  "autumn",
  "winter",
  "weekend",
  "christmas",
  "thanksgiving",
  "halloween",
  "easter",
  "holiday",
  "holidays",
  "keys",
  "delivery",
  "adventure",
  "owner",
  "owners",
  "team",
  "crew",
  "staff",
  "nation",
  "fans",
  "community",
  "dealership",
  "store",
  "showroom",
  "department",
  "sales",
  "parts",
  "finance",
  "inventory",
  "lot",
  "safety",
  "trust",
  "happiness",
  "paperwork",
  "sunshine",
  "service",
  "time",
  "another",
  "enjoy",
  "welcome",
  "smiles",
  "life",
  "road",
  "ride",
  "drivers",
  "michigan",
  "ohio",
  "illinois",
  "wisconsin",
  "minnesota",
  "iowa",
  "missouri",
  "kansas",
  "nebraska",
  "oklahoma",
  "texas",
  "arkansas",
  "louisiana",
  "mississippi",
  "alabama",
  "florida",
  "kentucky",
  "tennessee",
  "pennsylvania",
  "delaware",
  "maryland",
  "connecticut",
  "massachusetts",
  "vermont",
  "hampshire",
  "idaho",
  "utah",
  "wyoming",
  "colorado",
  "arizona",
  "mexico",
  "california",
  "oregon",
  "alaska",
  "hawaii",
  "midwest",
  "american",
  "usa",
  "county",
  "township",
  "city",
  "village",
  "town",
  "school",
  "schools",
  "high",
  "elementary",
  "middle",
  "academy",
  "district",
  "college",
  "university",
  "hospital",
  "library",
  "chamber",
  "commerce",
  "police",
  "fire",
  "sheriff",
  "rescue",
  "foundation",
  "festival",
  "fair",
  "parade",
  "market",
  "league",
  "club",
  "park",
  "parks",
  "athletics",
  "boosters",
  "band",
  "choir",
  "rotary",
  "lions",
  "tigers",
  "pistons",
  "wings",
  "wolverines",
  "spartans",
  "football",
  "hockey",
  "basketball",
  "baseball",
  "soccer",
  "wrestling",
  "swim",
  "swimming",
  "track",
  "golf",
  "tennis",
  "volleyball",
  "softball",
  "lacrosse",
  "bowling",
  "rugby",
  "cross",
  "country",
  "esports",
  "chess",
  "debate",
  "robotics",
  "stem",
  "science",
  "math",
  "arts",
  "music",
  "theater",
  "theatre",
  "drama",
  "orchestra",
  "cheer",
  "dance",
  "ems",
  "paramedics",
  "responders",
  "recreation",
  "rec",
  "state",
  "valley",
  "bulldogs",
  "highlanders",
  "eagles",
  "wolves",
  "panthers",
  "knights",
  "warriors",
  "wildcats",
  "pirates",
  "vikings",
  "raiders",
  "hornets",
  "falcons",
  "cougars",
  "bears",
  "rams",
  "colts",
  "chiefs",
  "braves",
  "cardinals",
  "orioles",
  "hawks",
  "jets",
  "giants",
  "patriots",
  "packers",
  "bucks",
  "bruins",
  "blackhawks",
  "cubs",
  "sox",
  "yankees",
  "mets",
  "dodgers",
  "steelers",
  "browns",
  "bengals",
  "seahawks",
  "cowboys",
  "broncos",
  "titans",
  "saints",
  "bills",
  "dolphins",
  "chargers",
  "raptors",
  "celtics",
  "lakers",
  "heat",
  "magic",
  "thunder",
  "suns",
  "kings",
  "blues",
  "flames",
  "oilers",
  "canucks",
  "sabres",
  "predators",
  "sharks",
  "spotlight",
  "birthday",
  "anniversary",
  "retirement",
  "graduation",
  "arrival",
  "arrivals",
  "news",
  "price",
  "drop",
  "top",
  "zero",
  "down",
  "less",
  "double",
  "triple",
  "half",
  "full",
  "giant",
  "mega",
  "super",
  "instant",
  "easy",
  "fast",
  "smart",
  "safe",
  "secure",
  "guaranteed",
  "quality",
  "premium",
  "elite",
  "platinum",
  "value",
  "pricing",
  "interest",
  "apr",
  "cash",
  "cashback",
  "trade",
  "trade-in",
  "trade-ins",
  "upgrade",
  "upgrades",
  "roads",
  "trails",
  "miles",
  "memories",
  "moments",
  "vibes",
  "mode",
  "style",
  "living",
  "power",
  "torque",
  "horsepower",
  "speed",
  "luxury",
  "comfort",
  "capability",
  "reliability",
  "efficiency",
  "mpg",
  "range",
  "ev",
  "evs",
  "toys",
  "tots",
  "master",
  "senior",
  "junior",
  "expert",
  "experts",
  "pros",
  "ace",
  "apprentice",
  "rookie",
  "rookies",
  "intern",
  "interns",
  "perks",
  "benefits",
  "loyalty",
  "program",
  "programs",
  "portal",
  "app",
  "account",
  "accounts",
  "support",
  "care",
  "around",
  "lane",
  "photo",
  "featured",
  "pictured",
  "hire",
  "host",
  "hosted",
  "name",
  "names",
  "badlands",
  "everglades",
  "raptor",
  "tremor",
  "lariat",
  "lightning",
  "heritage",
  "wildtrak",
  "sasquatch",
  "timberline",
  "titanium",
  "xlt",
  "xl",
  "stx",
  "sel",
  "mach",
  "king",
  "ranch",
  "detroit",
  "lansing",
  "flint",
  "brighton",
  "fenton",
  "hartland",
  "pinckney",
  "milford",
  "novi",
  "livonia",
  "southfield",
  "dearborn",
  "wixom",
  "plymouth",
  "canton",
  "northville",
  "okemos",
  "fowlerville",
  "kalamazoo",
  "saginaw",
  "muskegon",
  "midland",
  "quick",
  "fordpass",
  "speaker",
  "speakers",
  "manual",
  "manuals",
  "dealer",
  "dealers",
  "heads",
  "tip",
  "tips",
  "fact",
  "facts",
  "humanity",
  "habitat",
  "meals",
  "wheels",
  "wish",
  "gleaners",
  "salvation",
  "army",
  "united",
  "way",
  "olympics",
  "wounded",
  "warrior",
  "project",
  "relay",
  "bank",
  "food",
  "pantry",
  "shelter",
  "mission",
  "hospice",
  "cancer",
  "society",
  "association",
  "alliance",
  "network",
  "initiative",
  "fund",
  "coalition",
  "council",
  "committee",
  "board",
  "unit",
  "corps",
  "guard",
  "legion",
  "vfw",
  "kiwanis",
  "elks",
  "moose",
  "shriners",
  "scouts",
  "troop",
  "pack",
  "ffa",
  "pta",
  "pto",
  "homecoming",
  "prom",
  "court",
  "marching",
  "melon",
  "fest",
  "expo",
  "show",
  "showcase",
  "gala",
  "benefit",
  "walk",
  "run",
  "marathon",
  "tournament",
  "tourney",
  "classic",
  "invitational",
  "championship",
  "championships",
  "playoffs",
  "finals",
  "semifinals",
  "quarterfinals",
  "regionals",
  "districts",
  "states",
  "nationals",
  "conference",
  "varsity",
  "jv",
  "freshman",
  "sophomore",
  "alumni",
  "reunion",
  "award",
  "awards",
  "athlete",
  "player",
  "citizen",
  "business",
  "general",
  "national",
  "pure",
  "fourth",
  "oval",
  "crown",
  "percent",
  "co",
  "inc",
  "llc",
  "corp",
  "motor",
  "motors",
  "company",
  "year-end",
  "model",
  "queen",
  "prince",
  "princess",
  "colors",
  "colours",
  "skies",
  "central",
  "gt",
  "area",
  "student",
  "students",
  "grand",
  "detail",
  "detailing",
  "body",
  "shop",
  "collision",
  "center",
  "centre",
  "management",
  "bdc",
  "internet",
  "express",
  "tire",
  "tires",
  "accessories",
  "reception",
  "office",
  "leadership",
  "wash",
  "warranty",
  "rental",
  "rentals",
  "shuttle",
  "fleet",
  "commercial",
  "truck",
  "trucks",
  "used",
  "preowned",
  "certified",
  "digital",
  "marketing",
  "media",
  "admin",
  "title",
  "billing",
  "accounting",
  "group",
  "division",
  "floor",
  "drive",
  "counter",
  "desk",
  "mobile",
  "loaner",
  "loaners",
  "oil",
  "brake",
  "brakes",
  "battery",
  "batteries",
  "alignment",
  "inspection",
  "inspections",
  "recall",
  "recalls",
  "maintenance",
  "repair",
  "repairs",
  "wheel",
  "dept",
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "leads",
  "rep",
  "reps",
  "salesperson",
  "salespeople",
  "porter",
  "porters",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "ambassadors",
  "veteran",
  "veterans",
  "hero",
  "heroes",
  "hands",
  "guest",
  "guests",
  "neighbor",
  "neighbors",
  "kids",
  "teacher",
  "teachers",
  "nurse",
  "nurses",
  "doctor",
  "doctors",
  "graduate",
  "graduates",
  "grads",
  "seniors",
  "troops",
  "volunteer",
  "volunteers",
  "worker",
  "workers",
  "visitor",
  "visitors",
  "rider",
  "riders",
  "member",
  "members",
  "client",
  "clients",
  "shopper",
  "shoppers",
  "sponsor",
  "sponsors",
  "supporter",
  "supporters",
  "follower",
  "followers",
  "donor",
  "donors",
  "moms",
  "dads",
  "ladies",
  "gentlemen",
  "folks",
  "people",
  "buddies",
  "partners",
  "parents",
  "grandparents",
  "newlyweds",
  "couple",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "ahead",
  "again",
  "always",
  "forever",
  "soon",
  "also",
  "plus",
  "honestly",
  "seriously",
  "okay",
  "ok",
  "no",
  "oh",
  "psst",
  "bonus",
  "fun",
  "pro",
  "spoiler",
  "question",
  "disclaimer",
  "note",
  "reminder",
  "update",
  "attention",
  "alert",
  "psa",
  "surprise",
  "wow",
  "boom",
  "perfection",
  "whoa",
  "finally",
  "officially",
  "done",
  "employee",
  "employees",
  "weather",
  "savings",
  "prices",
  "rates",
  "payments",
  "financing",
  "incentives",
  "rebates",
  "discounts",
  "winner",
  "winners",
  "faculty",
  "credit",
  "performance",
  "racing",
  "corporation",
  "pass",
  "rewards",
  "protect",
  "advantage",
  "class",
  "mom",
  "dad",
  "mother",
  "father",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "aunt",
  "uncle",
  "cousin",
  "over",
  "off",
  "up",
  "back",
  "away",
  "ourselves",
  "yourself",
  "myself",
  "themselves",
  "himself",
  "herself",
  "built",
  "public",
  "choosing",
  "trusting",
  "visiting",
  "stopping",
  "coming",
  "being",
  "making",
  "joining",
  "shopping",
  "buying",
  "supporting",
  "sharing",
  "following",
  "reading",
  "watching",
  "letting",
  "having",
  "giving",
  "taking",
  "bringing",
  "riding",
  "going",
  "getting",
  "keeping",
  "looking",
  "seeing",
  "saying",
  "telling",
  "finding",
  "showing",
  "working",
  "loving",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundred",
  "thousand",
  "million",
  "appreciation",
  "event",
  "events",
  "nights",
  "special",
  "specials",
  "deal",
  "deals",
  "offer",
  "offers",
  "clearance",
  "blowout",
  "bonanza",
  "party",
  "celebration",
  "giveaway",
  "raffle",
  "contest",
  "drawing",
  "fundraiser",
  "cookout",
  "bbq",
  "picnic",
  "open",
  "house",
  "tent",
  "sale",
  "by",
  "of",
  "the",
  "and",
  "at",
  "in",
  "to",
  "for",
  "with",
  "from",
  "on",
  "a",
  "an",
  "new",
  "car",
  "your",
  "our",
  "my",
  "out",
  "us",
  "you",
  "me",
  "them",
  "are",
  "is",
  "was",
  "were",
].forEach(function (word) {
  IDENTITY_NON_CUSTOMER_WORDS[word] = true;
});

const IDENTITY_COLLECTIVE_FOLLOWERS = {};
[
  "family",
  "families",
  "team",
  "crew",
  "staff",
  "nation",
  "fans",
  "community",
  "dealership",
  "store",
  "showroom",
  "customers",
  "drivers",
  "owners",
].forEach(function (word) {
  IDENTITY_COLLECTIVE_FOLLOWERS[word] = true;
});

// Kept identical to ORGANISATION_FOLLOWERS in utils/captionQuality.ts: the
// word before one of these is a place or organisation, never a person.
const IDENTITY_ORGANISATION_FOLLOWERS = {};
[
  "county",
  "township",
  "city",
  "village",
  "town",
  "school",
  "schools",
  "high",
  "elementary",
  "middle",
  "academy",
  "district",
  "college",
  "university",
  "hospital",
  "library",
  "chamber",
  "commerce",
  "police",
  "fire",
  "sheriff",
  "rescue",
  "foundation",
  "festival",
  "fair",
  "parade",
  "market",
  "league",
  "club",
  "park",
  "parks",
  "athletics",
  "boosters",
  "band",
  "choir",
  "rotary",
  "lions",
  "tigers",
  "pistons",
  "wings",
  "wolverines",
  "spartans",
  "football",
  "hockey",
  "basketball",
  "baseball",
  "soccer",
  "wrestling",
  "swim",
  "swimming",
  "track",
  "golf",
  "tennis",
  "volleyball",
  "softball",
  "lacrosse",
  "bowling",
  "rugby",
  "cross",
  "country",
  "esports",
  "chess",
  "debate",
  "robotics",
  "stem",
  "science",
  "math",
  "arts",
  "music",
  "theater",
  "theatre",
  "drama",
  "orchestra",
  "cheer",
  "dance",
  "ems",
  "paramedics",
  "responders",
  "recreation",
  "rec",
  "state",
  "valley",
  "michigan",
  "bulldogs",
  "highlanders",
  "eagles",
  "wolves",
  "panthers",
  "knights",
  "warriors",
  "wildcats",
  "pirates",
  "vikings",
  "raiders",
  "hornets",
  "falcons",
  "cougars",
  "bears",
  "rams",
  "colts",
  "chiefs",
  "braves",
  "cardinals",
  "orioles",
  "hawks",
  "jets",
  "giants",
  "patriots",
  "packers",
  "bucks",
  "bruins",
  "blackhawks",
  "cubs",
  "sox",
  "yankees",
  "mets",
  "dodgers",
  "steelers",
  "browns",
  "bengals",
  "seahawks",
  "cowboys",
  "broncos",
  "titans",
  "saints",
  "bills",
  "dolphins",
  "chargers",
  "raptors",
  "celtics",
  "lakers",
  "heat",
  "magic",
  "thunder",
  "suns",
  "kings",
  "blues",
  "flames",
  "oilers",
  "canucks",
  "sabres",
  "predators",
  "sharks",
].forEach(function (word) {
  IDENTITY_ORGANISATION_FOLLOWERS[word] = true;
});
// Kept identical to AMBIGUOUS_NAME_WORDS in utils/captionQuality.ts.
const IDENTITY_AMBIGUOUS_NAME_WORDS = {};
[
  "april",
  "may",
  "june",
  "august",
  "january",
  "summer",
  "autumn",
  "winter",
  "lucky",
  "happy",
  "sweet",
  "proud",
  "dear",
  "porter",
  "parks",
  "park",
  "sharp",
  "best",
  "good",
  "day",
  "house",
  "guest",
  "rider",
  "fair",
  "keys",
  "holiday",
  "brand",
  "will",
  "pearl",
  "gray",
  "grey",
  "gold",
  "silver",
  "red",
  "white",
  "blue",
  "green",
  "sunny",
  "star",
  "chip",
  "art",
  "rich",
  "guy",
  "bill",
  "lane",
  "long",
  "little",
  "free",
  "porters",
  "days",
  "houses",
  "guests",
  "riders",
  "fairs",
  "holidays",
  "brands",
  "pearls",
  "grays",
  "greys",
  "golds",
  "silvers",
  "reds",
  "whites",
  "blues",
  "greens",
  "stars",
  "chips",
  "bills",
  "lanes",
  "longs",
  "sharps",
  "bests",
  "goods",
  "sweets",
  "summers",
  "winters",
  "mays",
  "junes",
  "springs",
  "spring",
  "march",
  "christmas",
  "quick",
  "coach",
  "deal",
  "young",
  "small",
  "strong",
  "master",
  "senior",
  "junior",
  "major",
  "king",
  "night",
  "field",
  "fields",
  "hill",
  "wood",
  "woods",
  "stone",
  "lake",
  "rose",
  "hope",
  "grace",
  "joy",
  "dawn",
  "chase",
  "hunter",
  "dean",
  "cash",
  "snow",
  "storm",
  "fox",
  "wolf",
  "bear",
  "banks",
  "bell",
  "sky",
  "cross",
  "country",
  "track",
  "north",
  "south",
  "east",
  "west",
].forEach(function (word) {
  IDENTITY_AMBIGUOUS_NAME_WORDS[word] = true;
});
// Kept identical to TIME_FOLLOWERS in utils/captionQuality.ts.
const IDENTITY_TIME_FOLLOWERS = {};
[
  "day",
  "days",
  "month",
  "months",
  "week",
  "weeks",
  "weekend",
  "weekends",
  "night",
  "nights",
  "season",
  "seasons",
  "morning",
  "afternoon",
  "evening",
  "eve",
  "hour",
  "hours",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weather",
].forEach(function (word) {
  IDENTITY_TIME_FOLLOWERS[word] = true;
});
// Kept identical to LEAD_IN_NOUN_WORDS in utils/captionQuality.ts.
const IDENTITY_LEAD_IN_NOUN_SET = {};
[
  "county",
  "township",
  "city",
  "village",
  "town",
  "school",
  "schools",
  "high",
  "elementary",
  "middle",
  "academy",
  "district",
  "college",
  "university",
  "hospital",
  "library",
  "chamber",
  "commerce",
  "police",
  "fire",
  "sheriff",
  "rescue",
  "foundation",
  "festival",
  "fair",
  "parade",
  "market",
  "league",
  "club",
  "park",
  "parks",
  "athletics",
  "boosters",
  "band",
  "choir",
  "rotary",
  "lions",
  "tigers",
  "pistons",
  "wings",
  "wolverines",
  "spartans",
  "football",
  "hockey",
  "basketball",
  "baseball",
  "soccer",
  "wrestling",
  "swim",
  "swimming",
  "track",
  "golf",
  "tennis",
  "volleyball",
  "softball",
  "lacrosse",
  "bowling",
  "rugby",
  "cross",
  "country",
  "esports",
  "chess",
  "debate",
  "robotics",
  "stem",
  "science",
  "math",
  "arts",
  "music",
  "theater",
  "theatre",
  "drama",
  "orchestra",
  "cheer",
  "dance",
  "ems",
  "paramedics",
  "responders",
  "recreation",
  "rec",
  "state",
  "valley",
  "michigan",
  "bulldogs",
  "highlanders",
  "eagles",
  "wolves",
  "panthers",
  "knights",
  "warriors",
  "wildcats",
  "pirates",
  "vikings",
  "raiders",
  "hornets",
  "falcons",
  "cougars",
  "bears",
  "rams",
  "colts",
  "chiefs",
  "braves",
  "cardinals",
  "orioles",
  "hawks",
  "jets",
  "giants",
  "patriots",
  "packers",
  "bucks",
  "bruins",
  "blackhawks",
  "cubs",
  "sox",
  "yankees",
  "mets",
  "dodgers",
  "steelers",
  "browns",
  "bengals",
  "seahawks",
  "cowboys",
  "broncos",
  "titans",
  "saints",
  "bills",
  "dolphins",
  "chargers",
  "raptors",
  "celtics",
  "lakers",
  "heat",
  "magic",
  "thunder",
  "suns",
  "kings",
  "blues",
  "flames",
  "oilers",
  "canucks",
  "sabres",
  "predators",
  "sharks",
  "spotlight",
  "birthday",
  "anniversary",
  "retirement",
  "graduation",
  "arrival",
  "arrivals",
  "news",
  "price",
  "drop",
  "top",
  "zero",
  "down",
  "less",
  "double",
  "triple",
  "half",
  "full",
  "giant",
  "mega",
  "super",
  "instant",
  "easy",
  "fast",
  "smart",
  "safe",
  "secure",
  "guaranteed",
  "quality",
  "premium",
  "elite",
  "platinum",
  "value",
  "pricing",
  "interest",
  "apr",
  "cash",
  "cashback",
  "trade",
  "trade-in",
  "trade-ins",
  "upgrade",
  "upgrades",
  "roads",
  "trails",
  "miles",
  "memories",
  "moments",
  "vibes",
  "mode",
  "style",
  "living",
  "power",
  "torque",
  "horsepower",
  "speed",
  "luxury",
  "comfort",
  "capability",
  "reliability",
  "efficiency",
  "mpg",
  "range",
  "ev",
  "evs",
  "toys",
  "tots",
  "master",
  "senior",
  "junior",
  "expert",
  "experts",
  "pros",
  "ace",
  "apprentice",
  "rookie",
  "rookies",
  "intern",
  "interns",
  "perks",
  "benefits",
  "loyalty",
  "program",
  "programs",
  "portal",
  "app",
  "account",
  "accounts",
  "support",
  "care",
  "around",
  "lane",
  "photo",
  "featured",
  "pictured",
  "hire",
  "host",
  "hosted",
  "name",
  "names",
  "badlands",
  "everglades",
  "raptor",
  "tremor",
  "lariat",
  "lightning",
  "heritage",
  "wildtrak",
  "sasquatch",
  "timberline",
  "titanium",
  "xlt",
  "xl",
  "stx",
  "sel",
  "mach",
  "king",
  "ranch",
  "detroit",
  "lansing",
  "flint",
  "brighton",
  "fenton",
  "hartland",
  "pinckney",
  "milford",
  "novi",
  "livonia",
  "southfield",
  "dearborn",
  "wixom",
  "plymouth",
  "canton",
  "northville",
  "okemos",
  "fowlerville",
  "kalamazoo",
  "saginaw",
  "muskegon",
  "midland",
  "quick",
  "fordpass",
  "speaker",
  "speakers",
  "manual",
  "manuals",
  "dealer",
  "dealers",
  "heads",
  "tip",
  "tips",
  "fact",
  "facts",
  "humanity",
  "habitat",
  "meals",
  "wheels",
  "wish",
  "gleaners",
  "salvation",
  "army",
  "united",
  "way",
  "olympics",
  "wounded",
  "warrior",
  "project",
  "relay",
  "bank",
  "food",
  "pantry",
  "shelter",
  "mission",
  "hospice",
  "cancer",
  "society",
  "association",
  "alliance",
  "network",
  "initiative",
  "fund",
  "coalition",
  "council",
  "committee",
  "board",
  "unit",
  "corps",
  "guard",
  "legion",
  "vfw",
  "kiwanis",
  "elks",
  "moose",
  "shriners",
  "scouts",
  "troop",
  "pack",
  "ffa",
  "pta",
  "pto",
  "homecoming",
  "prom",
  "court",
  "marching",
  "melon",
  "fest",
  "expo",
  "show",
  "showcase",
  "gala",
  "benefit",
  "walk",
  "run",
  "marathon",
  "tournament",
  "tourney",
  "classic",
  "invitational",
  "championship",
  "championships",
  "playoffs",
  "finals",
  "semifinals",
  "quarterfinals",
  "regionals",
  "districts",
  "states",
  "nationals",
  "conference",
  "varsity",
  "jv",
  "freshman",
  "sophomore",
  "alumni",
  "reunion",
  "award",
  "awards",
  "athlete",
  "player",
  "citizen",
  "business",
  "general",
  "national",
  "pure",
  "fourth",
  "oval",
  "crown",
  "percent",
  "co",
  "inc",
  "llc",
  "corp",
  "motor",
  "motors",
  "company",
  "year-end",
  "model",
  "queen",
  "prince",
  "princess",
  "colors",
  "colours",
  "skies",
  "central",
  "gt",
  "area",
  "student",
  "students",
  "grand",
  "usa",
  "detail",
  "detailing",
  "body",
  "shop",
  "collision",
  "center",
  "centre",
  "management",
  "bdc",
  "internet",
  "express",
  "tire",
  "tires",
  "accessories",
  "reception",
  "office",
  "leadership",
  "wash",
  "warranty",
  "rental",
  "rentals",
  "shuttle",
  "fleet",
  "commercial",
  "truck",
  "trucks",
  "used",
  "preowned",
  "certified",
  "digital",
  "marketing",
  "media",
  "admin",
  "title",
  "billing",
  "accounting",
  "group",
  "division",
  "floor",
  "drive",
  "counter",
  "desk",
  "mobile",
  "loaner",
  "loaners",
  "oil",
  "brake",
  "brakes",
  "battery",
  "batteries",
  "alignment",
  "inspection",
  "inspections",
  "recall",
  "recalls",
  "maintenance",
  "repair",
  "repairs",
  "wheel",
  "dept",
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "leads",
  "rep",
  "reps",
  "salesperson",
  "salespeople",
  "porter",
  "porters",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "ambassadors",
  "veteran",
  "veterans",
  "hero",
  "heroes",
  "hands",
  "guest",
  "guests",
  "neighbor",
  "neighbors",
  "kids",
  "teacher",
  "teachers",
  "nurse",
  "nurses",
  "doctor",
  "doctors",
  "graduate",
  "graduates",
  "grads",
  "seniors",
  "troops",
  "volunteer",
  "volunteers",
  "worker",
  "workers",
  "visitor",
  "visitors",
  "rider",
  "riders",
  "member",
  "members",
  "client",
  "clients",
  "shopper",
  "shoppers",
  "sponsor",
  "sponsors",
  "supporter",
  "supporters",
  "follower",
  "followers",
  "donor",
  "donors",
  "moms",
  "dads",
  "ladies",
  "gentlemen",
  "folks",
  "people",
  "buddies",
  "partners",
  "parents",
  "grandparents",
  "newlyweds",
  "couple",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "ahead",
  "tonight",
  "again",
  "always",
  "forever",
  "soon",
  "also",
  "plus",
  "honestly",
  "seriously",
  "okay",
  "ok",
  "no",
  "oh",
  "psst",
  "bonus",
  "fun",
  "pro",
  "spoiler",
  "question",
  "disclaimer",
  "note",
  "reminder",
  "update",
  "attention",
  "alert",
  "psa",
  "surprise",
  "wow",
  "boom",
  "perfection",
  "whoa",
  "yes",
  "finally",
  "officially",
  "done",
  "employee",
  "employees",
  "weather",
  "savings",
  "prices",
  "rates",
  "payments",
  "financing",
  "incentives",
  "rebates",
  "discounts",
  "winner",
  "winners",
  "faculty",
  "credit",
  "performance",
  "racing",
  "corporation",
  "pass",
  "rewards",
  "protect",
  "advantage",
  "class",
  "mom",
  "dad",
  "mother",
  "father",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "aunt",
  "uncle",
  "cousin",
  "over",
  "off",
  "up",
  "back",
  "away",
  "ourselves",
  "yourself",
  "myself",
  "themselves",
  "himself",
  "herself",
  "built",
  "public",
  "choosing",
  "trusting",
  "visiting",
  "stopping",
  "coming",
  "being",
  "making",
  "joining",
  "shopping",
  "buying",
  "supporting",
  "sharing",
  "following",
  "reading",
  "watching",
  "letting",
  "having",
  "giving",
  "taking",
  "bringing",
  "riding",
  "going",
  "getting",
  "keeping",
  "looking",
  "seeing",
  "saying",
  "telling",
  "finding",
  "showing",
  "working",
  "loving",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundred",
  "thousand",
  "million",
  "appreciation",
  "event",
  "events",
  "night",
  "nights",
  "special",
  "specials",
  "deal",
  "deals",
  "offer",
  "offers",
  "clearance",
  "blowout",
  "bonanza",
  "party",
  "celebration",
  "giveaway",
  "raffle",
  "contest",
  "drawing",
  "fundraiser",
  "cookout",
  "bbq",
  "picnic",
  "open",
  "house",
  "tent",
  "sale",
].forEach(function (word) {
  IDENTITY_LEAD_IN_NOUN_SET[word] = true;
});
const IDENTITY_FAMILY_NOUNS = ["family", "families", "household", "clan"];
// Kept identical to FAMILY_FOLLOWERS in utils/captionQuality.ts.
const IDENTITY_FAMILY_FOLLOWERS = {};
[
  "family",
  "families",
  "household",
  "clan",
  "crew",
  "kids",
  "twins",
  "sisters",
  "brothers",
  "boys",
  "girls",
  "couple",
  "gang",
  "bunch",
  "tribe",
  "squad",
].forEach(function (word) {
  IDENTITY_FAMILY_FOLLOWERS[word] = true;
});
// Kept identical to TITLE_HEAD_NOUNS in utils/captionQuality.ts.
const IDENTITY_TITLE_HEAD_NOUNS = {};
[
  "mr",
  "mrs",
  "ms",
  "mx",
  "miss",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "nurse",
  "doctor",
  "aunt",
  "uncle",
  "cousin",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mom",
  "dad",
  "mother",
  "father",
  "sir",
  "reverend",
  "rev",
  "judge",
  "sergeant",
  "sgt",
  "deputy",
  "senator",
].forEach(function (word) {
  IDENTITY_TITLE_HEAD_NOUNS[word] = true;
});
// Kept identical to RELATIVE_NOUNS in utils/captionQuality.ts.
const IDENTITY_RELATIVE_NOUN_SET = {};
[
  "wife",
  "husband",
  "spouse",
  "partner",
  "son",
  "daughter",
  "mom",
  "mother",
  "dad",
  "father",
  "friend",
  "brother",
  "sister",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "neighbor",
  "neighbour",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
].forEach(function (word) {
  IDENTITY_RELATIVE_NOUN_SET[word] = true;
});
const IDENTITY_RELATIVE_NOUNS = [
  "wife",
  "husband",
  "spouse",
  "partner",
  "son",
  "daughter",
  "mom",
  "mother",
  "dad",
  "father",
  "friend",
  "brother",
  "sister",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "neighbor",
  "neighbour",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
];
const IDENTITY_PHOTO_PARTICIPLE_WORDS = [
  "picking",
  "taking",
  "checking",
  "showing",
  "getting",
  "receiving",
  "holding",
  "celebrating",
  "enjoying",
  "loving",
  "rocking",
  "cruising",
  "driving",
  "smiling",
  "grinning",
  "beaming",
  "heading",
  "rolling",
  "sporting",
  "posing",
  "standing",
  "leaving",
  "signing",
  "grabbing",
  "testing",
  "pulling",
  "hitting",
  "scoring",
  "snagging",
  "riding",
  "kicking",
  "starting",
  "hopping",
  "jumping",
  "sliding",
  "stepping",
  "climbing",
  "walking",
  "strolling",
  "shopping",
  "browsing",
  "visiting",
  "stopping",
  "waiting",
  "waving",
  "cheering",
  "laughing",
  "hugging",
  "trading",
  "upgrading",
  "buying",
  "financing",
  "leasing",
  "collecting",
];

const IDENTITY_HANDOFF_CONNECTORS = {};
[
  "to",
  "for",
  "own",
  "owner",
  "owners",
  "customer",
  "customers",
  "buyer",
  "buyers",
  "driver",
  "drivers",
  "member",
  "members",
  "wife",
  "husband",
  "spouse",
  "partner",
  "son",
  "daughter",
  "mom",
  "mother",
  "dad",
  "father",
  "friend",
  "brother",
  "sister",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "kids",
  "parents",
  "grandparents",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
].forEach(function (word) {
  IDENTITY_HANDOFF_CONNECTORS[word] = true;
});

const IDENTITY_TRIGGER_WORDS = {};
[
  "congratulations",
  "congrats",
  "cheers",
  "shout",
  "shoutout",
  "shout-out",
  "thanks",
  "thank",
  "kudos",
  "meet",
  "welcoming",
  "welcome",
  "celebrate",
  "helping",
  "thanking",
  "congratulating",
  "for",
  "with",
  "from",
  "delivered",
  "sold",
].forEach(function (word) {
  IDENTITY_TRIGGER_WORDS[word] = true;
});

const IDENTITY_NOUN_DETERMINERS = {};
[
  "this",
  "these",
  "those",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "my",
  "a",
  "an",
  "another",
  "every",
  "each",
].forEach(function (word) {
  IDENTITY_NOUN_DETERMINERS[word] = true;
});

const IDENTITY_OWN_PERSON_DETERMINERS = { our: true, my: true };
// Words a capitalized lead-in may consist of before the person it introduces
// ("Congrats to The Johnsons", "Meet Our Newest Customer Michelle", "Sold
// To The Smiths", "— New Owner Michelle"). Deliberately NOT prepositions
// such as "by"/"at" — "Sold By Joe" hands off to nobody.
// Non-customer words that END a lead-in hop: "Thanks For Choosing Us",
// "Sold By Joe" hand off to nobody.
// Kept identical to HOP_STOP_WORDS in utils/captionQuality.ts: prepositions,
// pronouns, verbs and conjunctions end the noun phrase a lead-in opened.
const IDENTITY_HOP_STOP_WORDS = {};
[
  "by",
  "of",
  "for",
  "from",
  "at",
  "in",
  "on",
  "who",
  "whom",
  "whose",
  "that",
  "which",
  "what",
  "when",
  "where",
  "why",
  "how",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "us",
  "me",
  "them",
  "him",
  "are",
  "is",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "must",
  "if",
  "and",
  "or",
  "but",
  "so",
  "as",
  "than",
  "everyone",
  "everybody",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "nobody",
  "everything",
  "something",
  "anything",
  "nothing",
  "here",
  "there",
  "now",
  "then",
].forEach(function (word) {
  IDENTITY_HOP_STOP_WORDS[word] = true;
});
// Where a lead-in phrase starts (LEAD_IN_BOUNDARY_WORDS on the client).
const IDENTITY_LEAD_IN_BOUNDARY_WORDS = {};
[
  "by",
  "of",
  "for",
  "from",
  "at",
  "in",
  "on",
  "who",
  "whom",
  "whose",
  "that",
  "which",
  "what",
  "when",
  "where",
  "why",
  "how",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "us",
  "me",
  "them",
  "him",
  "are",
  "is",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "must",
  "if",
  "and",
  "or",
  "but",
  "so",
  "as",
  "than",
  "everyone",
  "everybody",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "nobody",
  "everything",
  "something",
  "anything",
  "nothing",
  "here",
  "there",
  "now",
  "then",
  "to",
  "with",
].forEach(function (word) {
  IDENTITY_LEAD_IN_BOUNDARY_WORDS[word] = true;
});
// Praise words that introduce a PERSON (PERSON_ADJECTIVES on the client).
const IDENTITY_PERSON_ADJECTIVES = {};
[
  "amazing",
  "wonderful",
  "awesome",
  "incredible",
  "fantastic",
  "fabulous",
  "lovely",
  "dear",
  "lucky",
  "proud",
  "happy",
  "loyal",
  "valued",
  "beloved",
  "favorite",
  "longtime",
  "long-time",
  "repeat",
  "returning",
  "esteemed",
  "hardworking",
  "hard-working",
  "deserving",
  "sweet",
  "kind",
  "generous",
  "thrilled",
  "excited",
  "smiling",
  "radiant",
  "glowing",
  "very",
  "own",
].forEach(function (word) {
  IDENTITY_PERSON_ADJECTIVES[word] = true;
});
// Kept identical to HOP_LEAD_IN_WORDS in utils/captionQuality.ts.
const IDENTITY_HOP_LEAD_IN_WORDS = {};
[
  "the",
  "our",
  "my",
  "your",
  "their",
  "his",
  "her",
  "a",
  "an",
  "to",
  "new",
  "newest",
  "brand",
  "first",
  "latest",
  "amazing",
  "wonderful",
  "awesome",
  "incredible",
  "fantastic",
  "fabulous",
  "lovely",
  "dear",
  "lucky",
  "proud",
  "happy",
  "loyal",
  "valued",
  "beloved",
  "favorite",
  "longtime",
  "long-time",
  "repeat",
  "returning",
  "esteemed",
  "hardworking",
  "hard-working",
  "deserving",
  "sweet",
  "kind",
  "generous",
  "thrilled",
  "excited",
  "smiling",
  "radiant",
  "glowing",
  "very",
  "own",
  "county",
  "township",
  "city",
  "village",
  "town",
  "school",
  "schools",
  "high",
  "elementary",
  "middle",
  "academy",
  "district",
  "college",
  "university",
  "hospital",
  "library",
  "chamber",
  "commerce",
  "police",
  "fire",
  "sheriff",
  "rescue",
  "foundation",
  "festival",
  "fair",
  "parade",
  "market",
  "league",
  "club",
  "park",
  "parks",
  "athletics",
  "boosters",
  "band",
  "choir",
  "rotary",
  "lions",
  "tigers",
  "pistons",
  "wings",
  "wolverines",
  "spartans",
  "football",
  "hockey",
  "basketball",
  "baseball",
  "soccer",
  "wrestling",
  "swim",
  "swimming",
  "track",
  "golf",
  "tennis",
  "volleyball",
  "softball",
  "lacrosse",
  "bowling",
  "rugby",
  "cross",
  "country",
  "esports",
  "chess",
  "debate",
  "robotics",
  "stem",
  "science",
  "math",
  "arts",
  "music",
  "theater",
  "theatre",
  "drama",
  "orchestra",
  "cheer",
  "dance",
  "ems",
  "paramedics",
  "responders",
  "recreation",
  "rec",
  "state",
  "valley",
  "michigan",
  "bulldogs",
  "highlanders",
  "eagles",
  "wolves",
  "panthers",
  "knights",
  "warriors",
  "wildcats",
  "pirates",
  "vikings",
  "raiders",
  "hornets",
  "falcons",
  "cougars",
  "bears",
  "rams",
  "colts",
  "chiefs",
  "braves",
  "cardinals",
  "orioles",
  "hawks",
  "jets",
  "giants",
  "patriots",
  "packers",
  "bucks",
  "bruins",
  "blackhawks",
  "cubs",
  "sox",
  "yankees",
  "mets",
  "dodgers",
  "steelers",
  "browns",
  "bengals",
  "seahawks",
  "cowboys",
  "broncos",
  "titans",
  "saints",
  "bills",
  "dolphins",
  "chargers",
  "raptors",
  "celtics",
  "lakers",
  "heat",
  "magic",
  "thunder",
  "suns",
  "kings",
  "blues",
  "flames",
  "oilers",
  "canucks",
  "sabres",
  "predators",
  "sharks",
  "spotlight",
  "birthday",
  "anniversary",
  "retirement",
  "graduation",
  "arrival",
  "arrivals",
  "news",
  "price",
  "drop",
  "top",
  "zero",
  "down",
  "less",
  "double",
  "triple",
  "half",
  "full",
  "giant",
  "mega",
  "super",
  "instant",
  "easy",
  "fast",
  "smart",
  "safe",
  "secure",
  "guaranteed",
  "quality",
  "premium",
  "elite",
  "platinum",
  "value",
  "pricing",
  "interest",
  "apr",
  "cash",
  "cashback",
  "trade",
  "trade-in",
  "trade-ins",
  "upgrade",
  "upgrades",
  "roads",
  "trails",
  "miles",
  "memories",
  "moments",
  "vibes",
  "mode",
  "style",
  "living",
  "power",
  "torque",
  "horsepower",
  "speed",
  "luxury",
  "comfort",
  "capability",
  "reliability",
  "efficiency",
  "mpg",
  "range",
  "ev",
  "evs",
  "toys",
  "tots",
  "master",
  "senior",
  "junior",
  "expert",
  "experts",
  "pros",
  "ace",
  "apprentice",
  "rookie",
  "rookies",
  "intern",
  "interns",
  "perks",
  "benefits",
  "loyalty",
  "program",
  "programs",
  "portal",
  "app",
  "account",
  "accounts",
  "support",
  "care",
  "around",
  "lane",
  "photo",
  "featured",
  "pictured",
  "hire",
  "host",
  "hosted",
  "name",
  "names",
  "badlands",
  "everglades",
  "raptor",
  "tremor",
  "lariat",
  "lightning",
  "heritage",
  "wildtrak",
  "sasquatch",
  "timberline",
  "titanium",
  "xlt",
  "xl",
  "stx",
  "sel",
  "mach",
  "king",
  "ranch",
  "detroit",
  "lansing",
  "flint",
  "brighton",
  "fenton",
  "hartland",
  "pinckney",
  "milford",
  "novi",
  "livonia",
  "southfield",
  "dearborn",
  "wixom",
  "plymouth",
  "canton",
  "northville",
  "okemos",
  "fowlerville",
  "kalamazoo",
  "saginaw",
  "muskegon",
  "midland",
  "quick",
  "fordpass",
  "speaker",
  "speakers",
  "manual",
  "manuals",
  "dealer",
  "dealers",
  "heads",
  "tip",
  "tips",
  "fact",
  "facts",
  "humanity",
  "habitat",
  "meals",
  "wheels",
  "wish",
  "gleaners",
  "salvation",
  "army",
  "united",
  "way",
  "olympics",
  "wounded",
  "warrior",
  "project",
  "relay",
  "bank",
  "food",
  "pantry",
  "shelter",
  "mission",
  "hospice",
  "cancer",
  "society",
  "association",
  "alliance",
  "network",
  "initiative",
  "fund",
  "coalition",
  "council",
  "committee",
  "board",
  "unit",
  "corps",
  "guard",
  "legion",
  "vfw",
  "kiwanis",
  "elks",
  "moose",
  "shriners",
  "scouts",
  "troop",
  "pack",
  "ffa",
  "pta",
  "pto",
  "homecoming",
  "prom",
  "court",
  "marching",
  "melon",
  "fest",
  "expo",
  "show",
  "showcase",
  "gala",
  "benefit",
  "walk",
  "run",
  "marathon",
  "tournament",
  "tourney",
  "classic",
  "invitational",
  "championship",
  "championships",
  "playoffs",
  "finals",
  "semifinals",
  "quarterfinals",
  "regionals",
  "districts",
  "states",
  "nationals",
  "conference",
  "varsity",
  "jv",
  "freshman",
  "sophomore",
  "alumni",
  "reunion",
  "award",
  "awards",
  "athlete",
  "player",
  "citizen",
  "business",
  "general",
  "national",
  "pure",
  "fourth",
  "oval",
  "crown",
  "percent",
  "co",
  "inc",
  "llc",
  "corp",
  "motor",
  "motors",
  "company",
  "year-end",
  "model",
  "queen",
  "prince",
  "princess",
  "colors",
  "colours",
  "skies",
  "central",
  "gt",
  "area",
  "student",
  "students",
  "grand",
  "usa",
  "detail",
  "detailing",
  "body",
  "shop",
  "collision",
  "center",
  "centre",
  "management",
  "bdc",
  "internet",
  "express",
  "tire",
  "tires",
  "accessories",
  "reception",
  "office",
  "leadership",
  "wash",
  "warranty",
  "rental",
  "rentals",
  "shuttle",
  "fleet",
  "commercial",
  "truck",
  "trucks",
  "used",
  "preowned",
  "certified",
  "digital",
  "marketing",
  "media",
  "admin",
  "title",
  "billing",
  "accounting",
  "group",
  "division",
  "floor",
  "drive",
  "counter",
  "desk",
  "mobile",
  "loaner",
  "loaners",
  "oil",
  "brake",
  "brakes",
  "battery",
  "batteries",
  "alignment",
  "inspection",
  "inspections",
  "recall",
  "recalls",
  "maintenance",
  "repair",
  "repairs",
  "wheel",
  "dept",
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "leads",
  "rep",
  "reps",
  "salesperson",
  "salespeople",
  "porter",
  "porters",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "ambassadors",
  "veteran",
  "veterans",
  "hero",
  "heroes",
  "hands",
  "guest",
  "guests",
  "neighbor",
  "neighbors",
  "kids",
  "teacher",
  "teachers",
  "nurse",
  "nurses",
  "doctor",
  "doctors",
  "graduate",
  "graduates",
  "grads",
  "seniors",
  "troops",
  "volunteer",
  "volunteers",
  "worker",
  "workers",
  "visitor",
  "visitors",
  "rider",
  "riders",
  "member",
  "members",
  "client",
  "clients",
  "shopper",
  "shoppers",
  "sponsor",
  "sponsors",
  "supporter",
  "supporters",
  "follower",
  "followers",
  "donor",
  "donors",
  "moms",
  "dads",
  "ladies",
  "gentlemen",
  "folks",
  "people",
  "buddies",
  "partners",
  "parents",
  "grandparents",
  "newlyweds",
  "couple",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "ahead",
  "tonight",
  "again",
  "always",
  "forever",
  "soon",
  "also",
  "plus",
  "honestly",
  "seriously",
  "okay",
  "ok",
  "no",
  "oh",
  "psst",
  "bonus",
  "fun",
  "pro",
  "spoiler",
  "question",
  "disclaimer",
  "note",
  "reminder",
  "update",
  "attention",
  "alert",
  "psa",
  "surprise",
  "wow",
  "boom",
  "perfection",
  "whoa",
  "yes",
  "finally",
  "officially",
  "done",
  "employee",
  "employees",
  "weather",
  "savings",
  "prices",
  "rates",
  "payments",
  "financing",
  "incentives",
  "rebates",
  "discounts",
  "winner",
  "winners",
  "faculty",
  "credit",
  "performance",
  "racing",
  "corporation",
  "pass",
  "rewards",
  "protect",
  "advantage",
  "class",
  "mom",
  "dad",
  "mother",
  "father",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "aunt",
  "uncle",
  "cousin",
  "over",
  "off",
  "up",
  "back",
  "away",
  "ourselves",
  "yourself",
  "myself",
  "themselves",
  "himself",
  "herself",
  "built",
  "public",
  "choosing",
  "trusting",
  "visiting",
  "stopping",
  "coming",
  "being",
  "making",
  "joining",
  "shopping",
  "buying",
  "supporting",
  "sharing",
  "following",
  "reading",
  "watching",
  "letting",
  "having",
  "giving",
  "taking",
  "bringing",
  "riding",
  "going",
  "getting",
  "keeping",
  "looking",
  "seeing",
  "saying",
  "telling",
  "finding",
  "showing",
  "working",
  "loving",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundred",
  "thousand",
  "million",
  "appreciation",
  "event",
  "events",
  "night",
  "nights",
  "special",
  "specials",
  "deal",
  "deals",
  "offer",
  "offers",
  "clearance",
  "blowout",
  "bonanza",
  "party",
  "celebration",
  "giveaway",
  "raffle",
  "contest",
  "drawing",
  "fundraiser",
  "cookout",
  "bbq",
  "picnic",
  "open",
  "house",
  "tent",
  "sale",
  "team",
  "crew",
  "staff",
  "family",
  "families",
  "community",
  "nation",
  "fans",
  "dealership",
  "store",
  "showroom",
  "department",
  "sales",
  "parts",
  "finance",
  "service",
  "inventory",
  "delivery",
  "shiny",
  "stunning",
  "beautiful",
  "gorgeous",
  "sleek",
  "gleaming",
  "sparkling",
  "next",
  "dream",
  "perfect",
  "fresh",
  "bold",
  "loaded",
  "custom",
  "sporty",
  "rugged",
  "everyday",
  "electric",
  "hybrid",
  "lifted",
  "spotless",
  "immaculate",
  "clean",
  "sharp",
  "capable",
  "tough",
  "fully",
  "gently",
  "redesigned",
  "upgraded",
  "great",
  "good",
  "best",
  "finest",
  "whole",
  "entire",
  "massive",
  "lower",
  "low",
  "better",
  "bigger",
  "biggest",
  "endless",
  "free",
  "long",
  "extra",
  "unbeatable",
  "exclusive",
  "limited",
  "little",
  "extended",
  "growing",
  "customer",
  "customers",
  "owner",
  "owners",
  "driver",
  "drivers",
  "buyer",
  "buyers",
  "friend",
  "friends",
  "home",
  "welcome",
  "delivered",
  "sold",
  "aboard",
  "day",
  "car",
  "out",
  "you",
  "with",
].forEach(function (word) {
  IDENTITY_HOP_LEAD_IN_WORDS[word] = true;
});
// Nouns that hand the sentence to the person named right after them
// (PERSON_HEAD_NOUNS on the client).
const IDENTITY_PERSON_HEAD_NOUNS = {};
[
  "to",
  "for",
  "own",
  "owner",
  "owners",
  "customer",
  "customers",
  "buyer",
  "buyers",
  "driver",
  "drivers",
  "member",
  "members",
  "wife",
  "husband",
  "spouse",
  "partner",
  "son",
  "daughter",
  "mom",
  "mother",
  "dad",
  "father",
  "friend",
  "brother",
  "sister",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "kids",
  "parents",
  "grandparents",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
  "family",
  "families",
  "team",
  "crew",
  "staff",
  "nation",
  "fans",
  "community",
  "dealership",
  "store",
  "showroom",
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "rep",
  "salesperson",
  "porter",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "veteran",
  "nurse",
  "doctor",
  "graduate",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "newlyweds",
  "couple",
].forEach(function (word) {
  IDENTITY_PERSON_HEAD_NOUNS[word] = true;
});
const IDENTITY_PERSON_CAPABLE_DETERMINERS = {
  our: true,
  their: true,
  his: true,
  her: true,
  its: true,
  my: true,
};

// Kept identical to DETERMINER_ADJECTIVES in utils/captionQuality.ts: words
// that describe THINGS. Words that praise people ("our very own Sarah") are
// deliberately absent.
const IDENTITY_DETERMINER_ADJECTIVES = {};
[
  "whole",
  "entire",
  "extended",
  "growing",
  "massive",
  "lower",
  "low",
  "better",
  "bigger",
  "biggest",
  "endless",
  "free",
  "long",
  "extra",
  "unbeatable",
  "exclusive",
  "limited",
  "little",
  "new",
  "brand",
  "shiny",
  "stunning",
  "beautiful",
  "gorgeous",
  "sleek",
  "gleaming",
  "sparkling",
  "first",
  "next",
  "dream",
  "perfect",
  "fresh",
  "latest",
  "newest",
  "bold",
  "loaded",
  "certified",
  "preowned",
  "used",
  "custom",
  "black",
  "white",
  "blue",
  "red",
  "silver",
  "gray",
  "grey",
  "green",
  "orange",
  "yellow",
  "bronze",
  "gold",
  "copper",
  "pearl",
  "metallic",
  "sporty",
  "rugged",
  "everyday",
  "electric",
  "hybrid",
  "lifted",
  "spotless",
  "immaculate",
  "clean",
  "sharp",
  "capable",
  "tough",
  "fully",
  "gently",
  "redesigned",
  "upgraded",
  "great",
  "good",
  "best",
  "finest",
].forEach(function (word) {
  IDENTITY_DETERMINER_ADJECTIVES[word] = true;
});

// Latin-1 plus Latin Extended-A/B so "Łukasz" and "Zoë Ångström" are names on
// the server exactly as they are on the client (which uses \p{L}). The
// extended block interleaves cases, so it sits in UPPER as well — a
// lowercase extended letter reads as capitalized, which is the safe
// direction (a possible name, never a forgiven vehicle word).
// Latin-1 plus Latin Extended-A/B and Extended Additional (Łukasz, Żaneta,
// Nguyễn), so a name is a name on the server exactly as it is on the client
// (which uses \p{L}/\p{Lu}). Goja has no \p{Lu}, so the uppercase class is
// the enumerated uppercase code points of those blocks — "ł" must NOT read
// as a capital or "#CongratsMichał" splits inside the name.
// Greek and Cyrillic capitals, generated from the Unicode tables.
// Every letter, capital and small letter of the Basic Multilingual Plane
// (generated from the Unicode 15.1.0 tables), so a name is a name on the
// server exactly as it is on the client (which uses \p{L}/\p{Lu}/\p{Ll}).
const IDENTITY_LETTER =
  "\u0041-\u005A\u0061-\u007A\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376-\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0560-\u0588\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4-\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u0870-\u0887\u0889-\u088E\u08A0-\u08C9\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F-\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC-\u09DD\u09DF-\u09E1\u09F0-\u09F1\u09FC\u0A05-\u0A0A\u0A0F-\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32-\u0A33\u0A35-\u0A36\u0A38-\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2-\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0-\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F-\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32-\u0B33\u0B35-\u0B39\u0B3D\u0B5C-\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99-\u0B9A\u0B9C\u0B9E-\u0B9F\u0BA3-\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C5D\u0C60-\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDD-\u0CDE\u0CE0-\u0CE1\u0CF1-\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32-\u0E33\u0E40-\u0E46\u0E81-\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2-\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065-\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16F1-\u16F8\u1700-\u1711\u171F-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u1884\u1887-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4C\u1B83-\u1BA0\u1BAE-\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C88\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5-\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2183-\u2184\u2C00-\u2CE4\u2CEB-\u2CEE\u2CF2-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3006\u3031-\u3035\u303B-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A-\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6E5\uA717-\uA71F\uA722-\uA788\uA78B-\uA7CA\uA7D0-\uA7D1\uA7D3\uA7D5-\uA7D9\uA7F2-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD-\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5-\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40-\uFB41\uFB43-\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC";
const IDENTITY_UPPER =
  "\u0041-\u005A\u00C0-\u00D6\u00D8-\u00DE\u0100\u0102\u0104\u0106\u0108\u010A\u010C\u010E\u0110\u0112\u0114\u0116\u0118\u011A\u011C\u011E\u0120\u0122\u0124\u0126\u0128\u012A\u012C\u012E\u0130\u0132\u0134\u0136\u0139\u013B\u013D\u013F\u0141\u0143\u0145\u0147\u014A\u014C\u014E\u0150\u0152\u0154\u0156\u0158\u015A\u015C\u015E\u0160\u0162\u0164\u0166\u0168\u016A\u016C\u016E\u0170\u0172\u0174\u0176\u0178-\u0179\u017B\u017D\u0181-\u0182\u0184\u0186-\u0187\u0189-\u018B\u018E-\u0191\u0193-\u0194\u0196-\u0198\u019C-\u019D\u019F-\u01A0\u01A2\u01A4\u01A6-\u01A7\u01A9\u01AC\u01AE-\u01AF\u01B1-\u01B3\u01B5\u01B7-\u01B8\u01BC\u01C4-\u01C5\u01C7-\u01C8\u01CA-\u01CB\u01CD\u01CF\u01D1\u01D3\u01D5\u01D7\u01D9\u01DB\u01DE\u01E0\u01E2\u01E4\u01E6\u01E8\u01EA\u01EC\u01EE\u01F1-\u01F2\u01F4\u01F6-\u01F8\u01FA\u01FC\u01FE\u0200\u0202\u0204\u0206\u0208\u020A\u020C\u020E\u0210\u0212\u0214\u0216\u0218\u021A\u021C\u021E\u0220\u0222\u0224\u0226\u0228\u022A\u022C\u022E\u0230\u0232\u023A-\u023B\u023D-\u023E\u0241\u0243-\u0246\u0248\u024A\u024C\u024E\u0370\u0372\u0376\u037F\u0386\u0388-\u038A\u038C\u038E-\u038F\u0391-\u03A1\u03A3-\u03AB\u03CF\u03D2-\u03D4\u03D8\u03DA\u03DC\u03DE\u03E0\u03E2\u03E4\u03E6\u03E8\u03EA\u03EC\u03EE\u03F4\u03F7\u03F9-\u03FA\u03FD-\u042F\u0460\u0462\u0464\u0466\u0468\u046A\u046C\u046E\u0470\u0472\u0474\u0476\u0478\u047A\u047C\u047E\u0480\u048A\u048C\u048E\u0490\u0492\u0494\u0496\u0498\u049A\u049C\u049E\u04A0\u04A2\u04A4\u04A6\u04A8\u04AA\u04AC\u04AE\u04B0\u04B2\u04B4\u04B6\u04B8\u04BA\u04BC\u04BE\u04C0-\u04C1\u04C3\u04C5\u04C7\u04C9\u04CB\u04CD\u04D0\u04D2\u04D4\u04D6\u04D8\u04DA\u04DC\u04DE\u04E0\u04E2\u04E4\u04E6\u04E8\u04EA\u04EC\u04EE\u04F0\u04F2\u04F4\u04F6\u04F8\u04FA\u04FC\u04FE\u0500\u0502\u0504\u0506\u0508\u050A\u050C\u050E\u0510\u0512\u0514\u0516\u0518\u051A\u051C\u051E\u0520\u0522\u0524\u0526\u0528\u052A\u052C\u052E\u0531-\u0556\u10A0-\u10C5\u10C7\u10CD\u13A0-\u13F5\u1C90-\u1CBA\u1CBD-\u1CBF\u1E00\u1E02\u1E04\u1E06\u1E08\u1E0A\u1E0C\u1E0E\u1E10\u1E12\u1E14\u1E16\u1E18\u1E1A\u1E1C\u1E1E\u1E20\u1E22\u1E24\u1E26\u1E28\u1E2A\u1E2C\u1E2E\u1E30\u1E32\u1E34\u1E36\u1E38\u1E3A\u1E3C\u1E3E\u1E40\u1E42\u1E44\u1E46\u1E48\u1E4A\u1E4C\u1E4E\u1E50\u1E52\u1E54\u1E56\u1E58\u1E5A\u1E5C\u1E5E\u1E60\u1E62\u1E64\u1E66\u1E68\u1E6A\u1E6C\u1E6E\u1E70\u1E72\u1E74\u1E76\u1E78\u1E7A\u1E7C\u1E7E\u1E80\u1E82\u1E84\u1E86\u1E88\u1E8A\u1E8C\u1E8E\u1E90\u1E92\u1E94\u1E9E\u1EA0\u1EA2\u1EA4\u1EA6\u1EA8\u1EAA\u1EAC\u1EAE\u1EB0\u1EB2\u1EB4\u1EB6\u1EB8\u1EBA\u1EBC\u1EBE\u1EC0\u1EC2\u1EC4\u1EC6\u1EC8\u1ECA\u1ECC\u1ECE\u1ED0\u1ED2\u1ED4\u1ED6\u1ED8\u1EDA\u1EDC\u1EDE\u1EE0\u1EE2\u1EE4\u1EE6\u1EE8\u1EEA\u1EEC\u1EEE\u1EF0\u1EF2\u1EF4\u1EF6\u1EF8\u1EFA\u1EFC\u1EFE\u1F08-\u1F0F\u1F18-\u1F1D\u1F28-\u1F2F\u1F38-\u1F3F\u1F48-\u1F4D\u1F59\u1F5B\u1F5D\u1F5F\u1F68-\u1F6F\u1F88-\u1F8F\u1F98-\u1F9F\u1FA8-\u1FAF\u1FB8-\u1FBC\u1FC8-\u1FCC\u1FD8-\u1FDB\u1FE8-\u1FEC\u1FF8-\u1FFC\u2102\u2107\u210B-\u210D\u2110-\u2112\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u2130-\u2133\u213E-\u213F\u2145\u2183\u2C00-\u2C2F\u2C60\u2C62-\u2C64\u2C67\u2C69\u2C6B\u2C6D-\u2C70\u2C72\u2C75\u2C7E-\u2C80\u2C82\u2C84\u2C86\u2C88\u2C8A\u2C8C\u2C8E\u2C90\u2C92\u2C94\u2C96\u2C98\u2C9A\u2C9C\u2C9E\u2CA0\u2CA2\u2CA4\u2CA6\u2CA8\u2CAA\u2CAC\u2CAE\u2CB0\u2CB2\u2CB4\u2CB6\u2CB8\u2CBA\u2CBC\u2CBE\u2CC0\u2CC2\u2CC4\u2CC6\u2CC8\u2CCA\u2CCC\u2CCE\u2CD0\u2CD2\u2CD4\u2CD6\u2CD8\u2CDA\u2CDC\u2CDE\u2CE0\u2CE2\u2CEB\u2CED\u2CF2\uA640\uA642\uA644\uA646\uA648\uA64A\uA64C\uA64E\uA650\uA652\uA654\uA656\uA658\uA65A\uA65C\uA65E\uA660\uA662\uA664\uA666\uA668\uA66A\uA66C\uA680\uA682\uA684\uA686\uA688\uA68A\uA68C\uA68E\uA690\uA692\uA694\uA696\uA698\uA69A\uA722\uA724\uA726\uA728\uA72A\uA72C\uA72E\uA732\uA734\uA736\uA738\uA73A\uA73C\uA73E\uA740\uA742\uA744\uA746\uA748\uA74A\uA74C\uA74E\uA750\uA752\uA754\uA756\uA758\uA75A\uA75C\uA75E\uA760\uA762\uA764\uA766\uA768\uA76A\uA76C\uA76E\uA779\uA77B\uA77D-\uA77E\uA780\uA782\uA784\uA786\uA78B\uA78D\uA790\uA792\uA796\uA798\uA79A\uA79C\uA79E\uA7A0\uA7A2\uA7A4\uA7A6\uA7A8\uA7AA-\uA7AE\uA7B0-\uA7B4\uA7B6\uA7B8\uA7BA\uA7BC\uA7BE\uA7C0\uA7C2\uA7C4-\uA7C7\uA7C9\uA7D0\uA7D6\uA7D8\uA7F5\uFF21-\uFF3A";
const IDENTITY_LOWER =
  "\u0061-\u007A\u00B5\u00DF-\u00F6\u00F8-\u00FF\u0101\u0103\u0105\u0107\u0109\u010B\u010D\u010F\u0111\u0113\u0115\u0117\u0119\u011B\u011D\u011F\u0121\u0123\u0125\u0127\u0129\u012B\u012D\u012F\u0131\u0133\u0135\u0137-\u0138\u013A\u013C\u013E\u0140\u0142\u0144\u0146\u0148-\u0149\u014B\u014D\u014F\u0151\u0153\u0155\u0157\u0159\u015B\u015D\u015F\u0161\u0163\u0165\u0167\u0169\u016B\u016D\u016F\u0171\u0173\u0175\u0177\u017A\u017C\u017E-\u0180\u0183\u0185\u0188\u018C-\u018D\u0192\u0195\u0199-\u019B\u019E\u01A1\u01A3\u01A5\u01A8\u01AA-\u01AB\u01AD\u01B0\u01B4\u01B6\u01B9-\u01BA\u01BD-\u01BF\u01C6\u01C9\u01CC\u01CE\u01D0\u01D2\u01D4\u01D6\u01D8\u01DA\u01DC-\u01DD\u01DF\u01E1\u01E3\u01E5\u01E7\u01E9\u01EB\u01ED\u01EF-\u01F0\u01F3\u01F5\u01F9\u01FB\u01FD\u01FF\u0201\u0203\u0205\u0207\u0209\u020B\u020D\u020F\u0211\u0213\u0215\u0217\u0219\u021B\u021D\u021F\u0221\u0223\u0225\u0227\u0229\u022B\u022D\u022F\u0231\u0233-\u0239\u023C\u023F-\u0240\u0242\u0247\u0249\u024B\u024D\u024F-\u0293\u0295-\u02AF\u0371\u0373\u0377\u037B-\u037D\u0390\u03AC-\u03CE\u03D0-\u03D1\u03D5-\u03D7\u03D9\u03DB\u03DD\u03DF\u03E1\u03E3\u03E5\u03E7\u03E9\u03EB\u03ED\u03EF-\u03F3\u03F5\u03F8\u03FB-\u03FC\u0430-\u045F\u0461\u0463\u0465\u0467\u0469\u046B\u046D\u046F\u0471\u0473\u0475\u0477\u0479\u047B\u047D\u047F\u0481\u048B\u048D\u048F\u0491\u0493\u0495\u0497\u0499\u049B\u049D\u049F\u04A1\u04A3\u04A5\u04A7\u04A9\u04AB\u04AD\u04AF\u04B1\u04B3\u04B5\u04B7\u04B9\u04BB\u04BD\u04BF\u04C2\u04C4\u04C6\u04C8\u04CA\u04CC\u04CE-\u04CF\u04D1\u04D3\u04D5\u04D7\u04D9\u04DB\u04DD\u04DF\u04E1\u04E3\u04E5\u04E7\u04E9\u04EB\u04ED\u04EF\u04F1\u04F3\u04F5\u04F7\u04F9\u04FB\u04FD\u04FF\u0501\u0503\u0505\u0507\u0509\u050B\u050D\u050F\u0511\u0513\u0515\u0517\u0519\u051B\u051D\u051F\u0521\u0523\u0525\u0527\u0529\u052B\u052D\u052F\u0560-\u0588\u10D0-\u10FA\u10FD-\u10FF\u13F8-\u13FD\u1C80-\u1C88\u1D00-\u1D2B\u1D6B-\u1D77\u1D79-\u1D9A\u1E01\u1E03\u1E05\u1E07\u1E09\u1E0B\u1E0D\u1E0F\u1E11\u1E13\u1E15\u1E17\u1E19\u1E1B\u1E1D\u1E1F\u1E21\u1E23\u1E25\u1E27\u1E29\u1E2B\u1E2D\u1E2F\u1E31\u1E33\u1E35\u1E37\u1E39\u1E3B\u1E3D\u1E3F\u1E41\u1E43\u1E45\u1E47\u1E49\u1E4B\u1E4D\u1E4F\u1E51\u1E53\u1E55\u1E57\u1E59\u1E5B\u1E5D\u1E5F\u1E61\u1E63\u1E65\u1E67\u1E69\u1E6B\u1E6D\u1E6F\u1E71\u1E73\u1E75\u1E77\u1E79\u1E7B\u1E7D\u1E7F\u1E81\u1E83\u1E85\u1E87\u1E89\u1E8B\u1E8D\u1E8F\u1E91\u1E93\u1E95-\u1E9D\u1E9F\u1EA1\u1EA3\u1EA5\u1EA7\u1EA9\u1EAB\u1EAD\u1EAF\u1EB1\u1EB3\u1EB5\u1EB7\u1EB9\u1EBB\u1EBD\u1EBF\u1EC1\u1EC3\u1EC5\u1EC7\u1EC9\u1ECB\u1ECD\u1ECF\u1ED1\u1ED3\u1ED5\u1ED7\u1ED9\u1EDB\u1EDD\u1EDF\u1EE1\u1EE3\u1EE5\u1EE7\u1EE9\u1EEB\u1EED\u1EEF\u1EF1\u1EF3\u1EF5\u1EF7\u1EF9\u1EFB\u1EFD\u1EFF-\u1F07\u1F10-\u1F15\u1F20-\u1F27\u1F30-\u1F37\u1F40-\u1F45\u1F50-\u1F57\u1F60-\u1F67\u1F70-\u1F7D\u1F80-\u1F87\u1F90-\u1F97\u1FA0-\u1FA7\u1FB0-\u1FB4\u1FB6-\u1FB7\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FC7\u1FD0-\u1FD3\u1FD6-\u1FD7\u1FE0-\u1FE7\u1FF2-\u1FF4\u1FF6-\u1FF7\u210A\u210E-\u210F\u2113\u212F\u2134\u2139\u213C-\u213D\u2146-\u2149\u214E\u2184\u2C30-\u2C5F\u2C61\u2C65-\u2C66\u2C68\u2C6A\u2C6C\u2C71\u2C73-\u2C74\u2C76-\u2C7B\u2C81\u2C83\u2C85\u2C87\u2C89\u2C8B\u2C8D\u2C8F\u2C91\u2C93\u2C95\u2C97\u2C99\u2C9B\u2C9D\u2C9F\u2CA1\u2CA3\u2CA5\u2CA7\u2CA9\u2CAB\u2CAD\u2CAF\u2CB1\u2CB3\u2CB5\u2CB7\u2CB9\u2CBB\u2CBD\u2CBF\u2CC1\u2CC3\u2CC5\u2CC7\u2CC9\u2CCB\u2CCD\u2CCF\u2CD1\u2CD3\u2CD5\u2CD7\u2CD9\u2CDB\u2CDD\u2CDF\u2CE1\u2CE3-\u2CE4\u2CEC\u2CEE\u2CF3\u2D00-\u2D25\u2D27\u2D2D\uA641\uA643\uA645\uA647\uA649\uA64B\uA64D\uA64F\uA651\uA653\uA655\uA657\uA659\uA65B\uA65D\uA65F\uA661\uA663\uA665\uA667\uA669\uA66B\uA66D\uA681\uA683\uA685\uA687\uA689\uA68B\uA68D\uA68F\uA691\uA693\uA695\uA697\uA699\uA69B\uA723\uA725\uA727\uA729\uA72B\uA72D\uA72F-\uA731\uA733\uA735\uA737\uA739\uA73B\uA73D\uA73F\uA741\uA743\uA745\uA747\uA749\uA74B\uA74D\uA74F\uA751\uA753\uA755\uA757\uA759\uA75B\uA75D\uA75F\uA761\uA763\uA765\uA767\uA769\uA76B\uA76D\uA76F\uA771-\uA778\uA77A\uA77C\uA77F\uA781\uA783\uA785\uA787\uA78C\uA78E\uA791\uA793-\uA795\uA797\uA799\uA79B\uA79D\uA79F\uA7A1\uA7A3\uA7A5\uA7A7\uA7A9\uA7AF\uA7B5\uA7B7\uA7B9\uA7BB\uA7BD\uA7BF\uA7C1\uA7C3\uA7C8\uA7CA\uA7D1\uA7D3\uA7D5\uA7D7\uA7D9\uA7F6\uA7FA\uAB30-\uAB5A\uAB60-\uAB68\uAB70-\uABBF\uFB00-\uFB06\uFB13-\uFB17\uFF41-\uFF5A";
// Case-insensitive keyword source without the `i` flag (the name token in the
// same pattern must stay case-sensitive, and Goja has no inline modifiers).
// Mirrors ci()/ciAlt() in utils/captionQuality.ts.
function identityCi(keyword) {
  let out = "";
  for (let i = 0; i < keyword.length; i++) {
    const ch = keyword.charAt(i);
    out += /[a-z]/i.test(ch) ? "[" + ch.toUpperCase() + ch.toLowerCase() + "]" : ch;
  }
  return out;
}
function identityCiAlt(keywords) {
  return keywords.map(identityCi).join("|");
}
const IDENTITY_TO = identityCi("to");
const IDENTITY_THE = identityCi("the");
const IDENTITY_PREPOSITION_OPENERS = "[Ff]or|[Ww]ith|[Ff]rom";
const IDENTITY_FROM_OPENER = new RegExp(
  "\\b[Ff]rom(?:\\s+[" + IDENTITY_LOWER + "][" + IDENTITY_LOWER + "'’-]*)*\\s+$",
);
const IDENTITY_TITLE_ABBREVIATIONS = /\b(Mr|Mrs|Ms|Mx|Dr|Jr|Sr|St)\.(?=\s)/g;
// The opener reached the candidate through a lowercase lead-in word ("to",
// "the", "our newest", "the all-new") rather than naming it outright.
const IDENTITY_LEAD_IN_OPENER = new RegExp(
  "(?:^|\\s)(?:[" +
    IDENTITY_LOWER +
    "][" +
    IDENTITY_LOWER +
    "'’-]*|[" +
    IDENTITY_LETTER +
    "0-9-]*[0-9][" +
    IDENTITY_LETTER +
    "0-9'’-]*)\\s+$",
);
// A personal-name token is never directly followed by a digit or a hyphen
// into a digit ("F-150", "Model 3").
const IDENTITY_NAME_TOKEN =
  "[" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "'’-]{1,39}(?![0-9-])";
const IDENTITY_STOPWORD_GROUP = "of|the|and|at|in|a|an|inc|llc|co|corp";
const IDENTITY_CHAIN_WORD = new RegExp(
  "(?:^|[^" +
    IDENTITY_LETTER +
    "0-9])(" +
    IDENTITY_NAME_TOKEN +
    ")(?:\\s+(" +
    IDENTITY_STOPWORD_GROUP +
    "))?[,:!\\s–—-]*$",
);
const IDENTITY_NEXT_WORD = new RegExp(
  "^\\s+(?:(" + IDENTITY_STOPWORD_GROUP + ")\\s+)?(" + IDENTITY_NAME_TOKEN + ")",
);
const IDENTITY_PREVIOUS_WORD = new RegExp(
  "(?:^|[^" +
    IDENTITY_LETTER +
    "0-9'’-])([" +
    IDENTITY_LETTER +
    "0-9][" +
    IDENTITY_LETTER +
    "0-9'’-]*)(?:\\s+['’]s)?[^\\S\\n]+$",
);
const IDENTITY_FOLLOWING_WORD = new RegExp(
  "^\\s+([" + IDENTITY_LETTER + "][" + IDENTITY_LETTER + "'’-]*)",
);
const IDENTITY_HANDOFF_WORD = new RegExp(
  "^[\\s,:;–—-]+([" + IDENTITY_LETTER + "0-9][" + IDENTITY_LETTER + "0-9'’-]*)",
);
const IDENTITY_COLLECTIVE_POSSESSIVE = new RegExp(
  "^\\s+([" + IDENTITY_LETTER + "]+)(['’]s?)",
);
const IDENTITY_HOP_WORD = new RegExp(
  "^[\\s,]*(?:['’][Ss])?[\\s,]+(&|[" +
    IDENTITY_LETTER +
    "0-9][" +
    IDENTITY_LETTER +
    "0-9'’-]*)",
);
// "Meet us at Brighton…", "everyone in Howell…": the word after is a place.
const IDENTITY_LOCATION_BEFORE = new RegExp(
  "\\b(?:[Aa][Tt]|[Ii][Nn]|[Oo][Nn]|[Nn][Ee][Aa][Rr]|[Aa][Rr][Oo][Uu][Nn][Dd]|[Ii][Nn][Ss][Ii][Dd][Ee])\\s+(?:[" +
    IDENTITY_LETTER +
    "0-9'’-]+\\s*(?:[Aa][Nn][Dd]|&)\\s+)*$",
);
const IDENTITY_FOLLOWING_CAPITAL = new RegExp(
  "^\\s+([" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "'’-]*)",
);
const IDENTITY_HEADLINE_TAIL = new RegExp(
  "^\\s*[,:–—-]+\\s*(?:[Tt][Hh][Ee]\\s+)?([" +
    IDENTITY_UPPER +
    "][" +
    IDENTITY_LETTER +
    "'’-]*)",
);
const IDENTITY_CAPITAL = new RegExp("^[" + IDENTITY_UPPER + "]");
const IDENTITY_DIGIT = /[0-9]/;
// Up to five lowercase words may sit between "to" and the person.
// A lead-in word is lowercase or a model code / year ("our newest F-150 owner").
const IDENTITY_OPENER_LEAD_IN_WORD =
  "(?:[" +
  IDENTITY_LOWER +
  "][" +
  IDENTITY_LOWER +
  "'’-]*|[" +
  IDENTITY_LETTER +
  "0-9-]*[0-9][" +
  IDENTITY_LETTER +
  "0-9'’-]*|[" +
  IDENTITY_UPPER +
  "]\\.)";
const IDENTITY_OPENER_LEAD_IN_WORDS =
  "(?:\\s+" + IDENTITY_OPENER_LEAD_IN_WORD + "){0,5}?";
const IDENTITY_OPENER_LEAD_IN =
  "(?:(?:\\s+" + IDENTITY_OPENER_LEAD_IN_WORD + "|[,:]){0,7}?)";
const IDENTITY_HEADLINE_OPENERS = [
  identityCi("welcome") + "\\s+" + identityCi("home"),
  identityCi("welcome") +
    "\\s+" +
    identityCi("to") +
    "\\s+" +
    identityCi("the") +
    "\\s+" +
    identityCi("family"),
  identityCi("new") + "\\s+" + identityCi("car") + "\\s+" + identityCi("day"),
  identityCi("delivered"),
  identityCi("sold"),
].join("|");
// A congratulation opener still governing the clause just before a match.
const IDENTITY_CONGRATULATION_OPENER = new RegExp(
  "\\b(?:" +
    identityCiAlt([
      "congratulations",
      "congrats",
      "cheers",
      "kudos",
      "thanks",
      "meet",
      "welcome",
    ]) +
    "|" +
    identityCi("shout") +
    "(?:-?" +
    identityCi("out") +
    ")?|" +
    identityCi("thank") +
    "\\s+" +
    identityCi("you") +
    ")\\b[^.!?\\n]*$",
);
// "Delivered: Ford Bronco Sport" is a vehicle slot; "Sold to Bob!" is not —
// the "to <person>" alternative always addresses someone.
const IDENTITY_VEHICLE_HEADLINE_OPENER = new RegExp(
  "^(?:" +
    identityCi("delivered") +
    "|" +
    identityCi("new") +
    "\\s+" +
    identityCi("car") +
    "\\s+" +
    identityCi("day") +
    "|" +
    identityCi("sold") +
    ")(?!\\s+" +
    IDENTITY_TO +
    "\\b)",
);

const IDENTITY_BARE_ACTION_INDEX = 2;
const IDENTITY_PROSE_INDEXES = [3, 5, 9, 11, 12, 13, 14, 15, 17];
const IDENTITY_POSSESSIVE_INDEX = 9;
const IDENTITY_LEADING_VOCATIVE_INDEX = 10;
const IDENTITY_HEAD_LABEL_INDEX = 13;
const IDENTITY_PHOTO_CAPTION_INDEX = 14;
const IDENTITY_TRAILING_VOCATIVE_INDEX = 8;
const IDENTITY_FAMILY_POSSESSIVE_INDEX = 17;
const IDENTITY_NAME_PARTICLES =
  "(?:(?:de|la|del|della|di|da|du|van|von|der|den|le|el|al|bin|ibn|mac|mc)\\s+)*";
// Mirror of PERSON_SLOT_OPENER on the client.
const IDENTITY_PERSON_SLOT_OPENER = new RegExp(
  "^(?:(?:" +
    identityCiAlt(["big", "huge", "special", "massive", "major"]) +
    ")\\s+)?(?:" +
    identityCiAlt([
      "congratulations",
      "congrats",
      "kudos",
      "meet",
      "welcoming",
      "welcome",
      "happy",
      "say",
      "hats",
      "props",
      "way",
      "well",
      "enjoy",
      "good",
      "nice",
      "great",
      "sold",
      "delivered",
      "new",
      "spotlight",
    ]) +
    "|(?:" +
    identityCi("so") +
    "\\s+)?" +
    identityCi("proud") +
    ")\\b",
);
// Mirror of clauseOwnsPerson(): the clause goes on about a single person.
function identityClauseOwnsPerson(scan, tokenEnd) {
  return /^(?:\s+[^\s.!?;:\n—–]+){0,7}?\s+(?:[Hh][Ee][Rr]|[Hh][Ii][Ss])\b/.test(
    scan.slice(tokenEnd),
  );
}
// Mirror of followedByUnknownCapital(): the next word is an unknown
// capitalized word — the shape of a surname or a second person.
const IDENTITY_FOLLOWING_UNKNOWN = new RegExp(
  "^\\s+([" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "'’-]*)(?![0-9-])",
);
function identityIsVocabulary(lower) {
  return !!(
    IDENTITY_NON_CUSTOMER_WORDS[lower] ||
    IDENTITY_LEAD_IN_NOUN_SET[lower] ||
    IDENTITY_HOP_LEAD_IN_WORDS[lower] ||
    IDENTITY_DETERMINER_ADJECTIVES[lower] ||
    IDENTITY_PERSON_ADJECTIVES[lower] ||
    IDENTITY_TRIGGER_WORDS[lower] ||
    IDENTITY_NOUN_DETERMINERS[lower] ||
    IDENTITY_HOP_STOP_WORDS[lower] ||
    IDENTITY_LEAD_IN_BOUNDARY_WORDS[lower] ||
    IDENTITY_TIME_FOLLOWERS[lower] ||
    IDENTITY_ORGANISATION_FOLLOWERS[lower] ||
    IDENTITY_COLLECTIVE_FOLLOWERS[lower] ||
    IDENTITY_HANDOFF_CONNECTORS[lower] ||
    IDENTITY_AMBIGUOUS_NAME_WORDS[lower]
  );
}
function identityFollowedByUnknownCapital(scan, tokenEnd, grounding, actionWords) {
  const following = IDENTITY_FOLLOWING_UNKNOWN.exec(scan.slice(tokenEnd));
  if (!following) return null;
  const word = following[1];
  const lower = identityLower(word);
  if (
    identityHasDigit(word) ||
    grounding.words[lower] ||
    isAutomotiveBrandToken(word) ||
    identityIsVocabulary(lower) ||
    actionWords[lower]
  ) {
    return null;
  }
  return word;
}
// Mirror of precededByUnknownCapital(): a given name before a surname.
function identityPrecededByUnknownCapital(scan, tokenStart, grounding, actionWords) {
  const before = IDENTITY_PREVIOUS_WORD.exec(scan.slice(0, tokenStart));
  if (!before) return null;
  const word = before[1];
  const lower = identityLower(word);
  if (
    !IDENTITY_CAPITAL.test(word) ||
    identityHasDigit(word) ||
    /['’]/.test(word) ||
    grounding.words[lower] ||
    isAutomotiveBrandToken(word) ||
    IDENTITY_NON_CUSTOMER_WORDS[lower] ||
    IDENTITY_LEAD_IN_NOUN_SET[lower] ||
    IDENTITY_HOP_LEAD_IN_WORDS[lower] ||
    IDENTITY_DETERMINER_ADJECTIVES[lower] ||
    IDENTITY_PERSON_ADJECTIVES[lower] ||
    IDENTITY_TRIGGER_WORDS[lower] ||
    actionWords[lower] ||
    IDENTITY_NOUN_DETERMINERS[lower] ||
    lower === "the" ||
    IDENTITY_HOP_STOP_WORDS[lower] ||
    IDENTITY_LEAD_IN_BOUNDARY_WORDS[lower] ||
    IDENTITY_AMBIGUOUS_NAME_WORDS[lower]
  ) {
    return null;
  }
  return word;
}
// Mirror of precededByPersonNoun(): "Mr. Ford", "her son Ford".
function identityPrecededByPersonNoun(scan, tokenStart) {
  const before = IDENTITY_PREVIOUS_WORD.exec(scan.slice(0, tokenStart));
  if (!before) return false;
  const lower = identityLower(before[1]);
  return !!IDENTITY_TITLE_HEAD_NOUNS[lower] || !!IDENTITY_RELATIVE_NOUN_SET[lower];
}
// Mirror of trailingVocativeIsList(): ", Expedition" closing a list.
const IDENTITY_LIST_ITEM = new RegExp(
  "(?:^|\\n|([:,]))\\s*([" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "0-9'’-]*)$",
);
function identityTrailingVocativeIsList(scan, tokenStart) {
  let text = scan.slice(0, tokenStart).replace(/\s+$/, "");
  if (text.charAt(text.length - 1) !== ",") return false;
  text = text.slice(0, -1).replace(/\s+$/, "");
  for (let items = 0; items < 12; items++) {
    const item = IDENTITY_LIST_ITEM.exec(text);
    if (!item) return false;
    if (!item[1] || item[1] === ":") return true;
    text = text.slice(0, text.length - item[0].length).replace(/\s+$/, "");
  }
  return false;
}
// Mirror of personContinuation() / ambiguousWordCompletesPhrase().
function identityPersonContinuation(
  scan,
  tokenEnd,
  token,
  grounding,
  strongOnly,
  actionWords,
) {
  const rest = scan.slice(tokenEnd);
  if (
    /^\s+(?:[Oo][Nn]|[Ww][Ii][Tt][Hh]|[Aa][Nn][Dd]|&)\s+(?:[Hh][Ee][Rr]|[Hh][Ii][Ss]|[Tt][Hh][Ee][Ii][Rr])\b/.test(
      rest,
    )
  ) {
    return true;
  }
  if (
    /^\s+for\s+(?:choosing|trusting|visiting|stopping|coming|being|joining|shopping|buying|supporting|sharing|letting|picking|making|bringing|referring|recommending)\b/i.test(
      rest,
    )
  ) {
    return true;
  }
  const surname = identityFollowedByUnknownCapital(
    scan,
    tokenEnd,
    grounding,
    actionWords,
  );
  if (surname) {
    if (!strongOnly) return true;
    const lower = identityLower(token);
    const afterSurname = rest.replace(
      new RegExp("^\\s+[" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "'’-]*"),
      "",
    );
    if (
      !IDENTITY_HOP_LEAD_IN_WORDS[lower] &&
      !IDENTITY_LEAD_IN_NOUN_SET[lower] &&
      !IDENTITY_DETERMINER_ADJECTIVES[lower] &&
      !IDENTITY_PERSON_ADJECTIVES[lower] &&
      !identityLooksPlural(surname) &&
      /^\s*(?:[!.?,;]|$|\n)/.test(afterSurname)
    ) {
      return true;
    }
  }
  if (
    !IDENTITY_PERSON_ADJECTIVES[identityLower(token)] &&
    /^\s+(?:[Ff][Aa][Mm][Ii][Ll][Yy]|[Ff][Aa][Mm][Ii][Ll][Ii][Ee][Ss])\b/.test(rest)
  ) {
    return true;
  }
  if (strongOnly) return false;
  return /^\s*(?:[!.?,;]|$|\n)/.test(rest);
}
function identityAmbiguousWordCompletesPhrase(scan, tokenStart) {
  const before = IDENTITY_PREVIOUS_WORD.exec(scan.slice(0, tokenStart));
  if (!before) return false;
  const lower = identityLower(before[1]);
  return (
    (!!IDENTITY_NON_CUSTOMER_WORDS[lower] || !!IDENTITY_LEAD_IN_NOUN_SET[lower]) &&
    !IDENTITY_PERSON_HEAD_NOUNS[lower] &&
    !IDENTITY_NOUN_DETERMINERS[lower] &&
    lower !== "the" &&
    !IDENTITY_HOP_STOP_WORDS[lower] &&
    !IDENTITY_LEAD_IN_BOUNDARY_WORDS[lower]
  );
}
function identityFollowedByTimeNoun(scan, tokenEnd) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  return !!following && !!IDENTITY_TIME_FOLLOWERS[identityLower(following[1])];
}

function stripIdentityPossessive(token) {
  return (token || "").toString().replace(/['’]s?$/, "");
}

function identityLower(token) {
  return stripIdentityPossessive(token).normalize("NFKC").toLowerCase();
}

function identityHasDigit(token) {
  return IDENTITY_DIGIT.test(token || "");
}

function normalizeAllowedIdentityPhrases(allowedPhrases) {
  const list = Array.isArray(allowedPhrases) ? allowedPhrases : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const isObject = entry && typeof entry === "object";
    const raw = isObject ? entry.phrase : entry === null ? "" : entry;
    const phrase = (raw || "").toString().trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    // A plain string is a MASK (the salesperson): legitimate in prose, never
    // the celebrated customer. Only an explicit groundedIdentityPhrase() is
    // business identity — inferring it from a brand token inside the string
    // re-grounded "Joe Ford" and forgave "Congrats to <salesperson>".
    out.push({ phrase: phrase, grounded: !!(isObject && entry.grounded) });
  }
  return out;
}

function identityPhraseTokens(phrase) {
  const words = (phrase || "").toString().trim().split(/\s+/);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > 1 && !ALLOWED_PHRASE_STOPWORDS[word.toLowerCase()]) {
      out.push(word);
    }
  }
  return out;
}

function buildIdentityGrounding(allowed) {
  const words = {};
  const pairs = {};
  const modelWords = {};
  for (let i = 0; i < allowed.length; i++) {
    if (!allowed[i].grounded) continue;
    const tokens = identityPhraseTokens(allowed[i].phrase);
    for (let j = 0; j < tokens.length; j++) {
      const lower = identityLower(tokens[j]);
      words[lower] = true;
      if (j > 0) pairs[identityLower(tokens[j - 1]) + ">" + lower] = true;
    }
    // Model words walk the RAW tokens so the phrase's own stopword breaks the
    // run: "2025 Ford Bronco Big Bend" yields bronco/big/bend, but "Bob Maxey
    // Ford of Howell" yields nothing — the town after "of" is not a model.
    const raws = allowed[i].phrase.trim().split(/\s+/);
    let afterBrand = false;
    for (let j = 0; j < raws.length; j++) {
      if (!raws[j]) continue;
      if (ALLOWED_PHRASE_STOPWORDS[raws[j].toLowerCase()]) afterBrand = false;
      else if (isAutomotiveBrandToken(raws[j])) afterBrand = true;
      else if (afterBrand) modelWords[identityLower(raws[j])] = true;
    }
  }
  return { words: words, pairs: pairs, modelWords: modelWords };
}

// Mirror of looksPlural() on the client: "Johnsons"/"Adventures", not
// "class"/"bus"/"Chris".
function identityLooksPlural(token) {
  return /s$/i.test(token) && !/['’]/.test(token) && !/(?:ss|us|is)$/i.test(token);
}

function identityPrecededByDeterminer(scan, tokenIndex, token, grounding) {
  let remaining = scan.slice(0, tokenIndex);
  let crossedUnknownCapital = false;
  let crossedAdjective = false;
  let crossedPersonAdjective = false;
  const ownWordIsVehicle =
    !!grounding.words[identityLower(token)] || isAutomotiveBrandToken(token);
  // A plural reached through nothing but lead-in vocabulary is a crowd or a
  // thing ("New Adventures", "Michigan Winters") unless "the" introduces it.
  const plural = identityLooksPlural(token);
  for (let hops = 0; hops <= 6; hops++) {
    const match = IDENTITY_PREVIOUS_WORD.exec(remaining);
    if (!match) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    const raw = match[1];
    const word = identityLower(raw);
    const possessive =
      /['’]s?$/.test(raw) || /['’]s\s*$/.test(match[0].replace(/\s+$/, ""));
    if (word === "customer" && possessive) return true;
    // "Michelle from Brighton is all smiles", "our newest owner from Howell":
    // a place, when a person (the label or a head noun) sits before "from".
    if (hops === 0 && (word === "from" || word === "of")) {
      const beforeMatch = IDENTITY_PREVIOUS_WORD.exec(
        remaining.slice(0, match.index + match[0].indexOf(raw)),
      );
      if (beforeMatch) {
        const beforeWord = identityLower(beforeMatch[1]);
        if (beforeWord === "customer" || IDENTITY_PERSON_HEAD_NOUNS[beforeWord])
          return true;
      }
    }
    if (IDENTITY_LEAD_IN_BOUNDARY_WORDS[word]) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    // "Our newest customer Michelle", "Our Team Michelle", "our Service
    // Manager Bob": the noun right before the candidate hands the sentence
    // to a person.
    if (
      hops === 0 &&
      (IDENTITY_TITLE_HEAD_NOUNS[word] ||
        IDENTITY_RELATIVE_NOUN_SET[word] ||
        (IDENTITY_PERSON_HEAD_NOUNS[word] && !plural))
    ) {
      return false;
    }
    if (IDENTITY_NOUN_DETERMINERS[word]) {
      // "Our Sarah is thrilled", "our Chris": "our"/"my" directly before an
      // unknown word introduces a person, never a vehicle.
      if (hops === 0 && IDENTITY_OWN_PERSON_DETERMINERS[word] && !ownWordIsVehicle) {
        return false;
      }
      // "our amazing Sarah": praise between a person-capable determiner and
      // the candidate introduces a person.
      if (crossedPersonAdjective && IDENTITY_PERSON_CAPABLE_DETERMINERS[word]) {
        return false;
      }
      return !(
        crossedUnknownCapital &&
        !crossedAdjective &&
        IDENTITY_PERSON_CAPABLE_DETERMINERS[word]
      );
    }
    if (word === "the") {
      if (plural && crossedUnknownCapital) return true;
      return !/['’]/.test(token) && !plural && !crossedPersonAdjective;
    }
    if (identityHasDigit(raw)) return true;
    const capitalized = IDENTITY_CAPITAL.test(raw);
    const knownVehicleWord =
      capitalized && (!!grounding.words[word] || isAutomotiveBrandToken(raw));
    // "Mom's new SUV", "New Year's Eve": a generic noun's possessive owns a
    // thing too.
    if (capitalized && possessive) {
      return knownVehicleWord || !!IDENTITY_NON_CUSTOMER_WORDS[word];
    }
    const walkable =
      !!IDENTITY_DETERMINER_ADJECTIVES[word] ||
      !!IDENTITY_PERSON_ADJECTIVES[word] ||
      /-/.test(raw) ||
      (capitalized && !IDENTITY_TRIGGER_WORDS[word]);
    if (!walkable) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    if (IDENTITY_DETERMINER_ADJECTIVES[word]) crossedAdjective = true;
    if (IDENTITY_PERSON_ADJECTIVES[word]) crossedPersonAdjective = true;
    if (
      capitalized &&
      !knownVehicleWord &&
      !IDENTITY_NON_CUSTOMER_WORDS[word] &&
      !IDENTITY_DETERMINER_ADJECTIVES[word] &&
      !IDENTITY_PERSON_ADJECTIVES[word] &&
      !IDENTITY_HOP_LEAD_IN_WORDS[word]
    ) {
      crossedUnknownCapital = true;
    }
    remaining = remaining.slice(0, match.index + match[0].indexOf(raw));
  }
  return false;
}

function identityPrecedingRun(scan, matchIndex, token, grounding) {
  let remaining = scan.slice(0, matchIndex);
  let current = identityLower(token);
  let tokenCount = 0;
  let containsBrand = false;
  for (;;) {
    const match = IDENTITY_CHAIN_WORD.exec(remaining);
    if (!match) {
      return { unrelated: false, tokenCount: tokenCount, containsBrand: containsBrand };
    }
    const lower = identityLower(match[1]);
    if (
      IDENTITY_NON_CUSTOMER_WORDS[lower] ||
      IDENTITY_TRIGGER_WORDS[lower] ||
      IDENTITY_NOUN_DETERMINERS[lower] ||
      lower === "the"
    ) {
      return { unrelated: false, tokenCount: tokenCount, containsBrand: containsBrand };
    }
    if (!grounding.pairs[lower + ">" + current]) {
      return { unrelated: true, tokenCount: tokenCount, containsBrand: containsBrand };
    }
    tokenCount += 1;
    if (isAutomotiveBrandToken(match[1])) containsBrand = true;
    current = lower;
    remaining = remaining.slice(0, match.index);
  }
}

function identityGroundedRun(scan, tokenEnd, token, grounding, brandMayLeadModelRun) {
  let remaining = scan.slice(tokenEnd);
  let current = identityLower(token);
  let afterBrand = brandMayLeadModelRun && isAutomotiveBrandToken(token);
  let end = tokenEnd;
  let tokenCount = 1;
  let endsWithPossessive = /['’]s?$/.test(token);
  let lastIsBrand = isAutomotiveBrandToken(token);
  let containsBrand = lastIsBrand;
  for (;;) {
    const match = IDENTITY_NEXT_WORD.exec(remaining);
    if (!match) break;
    const raw = match[2];
    const lower = identityLower(raw);
    if (
      IDENTITY_NON_CUSTOMER_WORDS[lower] ||
      IDENTITY_DETERMINER_ADJECTIVES[lower] ||
      IDENTITY_HOP_LEAD_IN_WORDS[lower]
    ) {
      break;
    }
    if (grounding.pairs[current + ">" + lower]) {
      current = lower;
      afterBrand = brandMayLeadModelRun && isAutomotiveBrandToken(raw);
      lastIsBrand = isAutomotiveBrandToken(raw);
      if (lastIsBrand) containsBrand = true;
    } else if (afterBrand && !match[1]) {
      lastIsBrand = false;
    } else {
      return {
        ok: false,
        end: end,
        tokenCount: tokenCount,
        endsWithPossessive: endsWithPossessive,
        lastIsBrand: lastIsBrand,
        containsBrand: containsBrand,
      };
    }
    tokenCount += 1;
    endsWithPossessive = /['’]s?$/.test(raw);
    remaining = remaining.slice(match[0].length);
    end += match[0].length;
  }
  return {
    ok: true,
    end: end,
    tokenCount: tokenCount,
    endsWithPossessive: endsWithPossessive,
    lastIsBrand: lastIsBrand,
    containsBrand: containsBrand,
  };
}

function identityDeliberateRunIsBusiness(
  scan,
  run,
  loneTokenAllowed,
  fullNameIsBusiness,
) {
  if (run.endsWithPossessive) return true;
  let rest = scan.slice(run.end);
  const next = new RegExp(
    "^\\s+([" + IDENTITY_LETTER + "0-9][" + IDENTITY_LETTER + "0-9'’-]*)",
  ).exec(rest);
  if (!next) return loneTokenAllowed || run.containsBrand;
  // "Howell 4-H", "Howell 2026 Grads": a number after the town.
  if (identityHasDigit(next[1])) return true;
  // "Bob Maxey Ford of Howell on 25 years": the store's name spelled out is
  // the store, whatever follows — outside a vehicle slot.
  if (
    fullNameIsBusiness &&
    (run.tokenCount >= 3 || (run.tokenCount >= 2 && run.containsBrand))
  ) {
    return true;
  }
  // "Howell Little League": walk the lead-in words to the organisation.
  for (let hops = 0; hops < 4; hops++) {
    const word = IDENTITY_FOLLOWING_WORD.exec(rest);
    if (!word) return false;
    const lower = identityLower(word[1]);
    if (
      IDENTITY_COLLECTIVE_FOLLOWERS[lower] ||
      IDENTITY_ORGANISATION_FOLLOWERS[lower] ||
      IDENTITY_LEAD_IN_NOUN_SET[lower]
    ) {
      return true;
    }
    if (!IDENTITY_DETERMINER_ADJECTIVES[lower] && !IDENTITY_HOP_LEAD_IN_WORDS[lower]) {
      return false;
    }
    rest = rest.slice(word[0].length);
  }
  return false;
}

// Mirror of followedByCollectiveNoun(): "Bronco Nation", "Ford family".
function identityFollowedByCollectiveNoun(scan, tokenEnd) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  return !!following && !!IDENTITY_COLLECTIVE_FOLLOWERS[identityLower(following[1])];
}

// Mirror of followedByOrganisationNoun(): "Livingston County", "Brighton High
// School" — a place or organisation.
function identityFollowedByOrganisationNoun(scan, tokenEnd) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  return !!following && !!IDENTITY_ORGANISATION_FOLLOWERS[identityLower(following[1])];
}

// Mirror of followedByFamilyNoun(): "The Miller family loves…" — the surname
// a family noun follows.
function identityFollowedByFamilyNoun(scan, tokenEnd) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  return !!following && !!IDENTITY_FAMILY_FOLLOWERS[identityLower(following[1])];
}

function identityHandoffTargetAfter(scan, run, grounding) {
  let remaining = scan.slice(run.end);
  if (!run.endsWithPossessive) {
    const collective = IDENTITY_COLLECTIVE_POSSESSIVE.exec(remaining);
    if (!collective || !IDENTITY_COLLECTIVE_FOLLOWERS[identityLower(collective[1])]) {
      return null;
    }
    remaining = remaining.slice(collective[0].length);
  }
  let afterBrand = false;
  for (let hops = 0; hops < 12; hops++) {
    const match = IDENTITY_HANDOFF_WORD.exec(remaining);
    if (!match) return null;
    const raw = match[1];
    const lower = identityLower(raw);
    const rest = remaining.slice(match[0].length);
    const wordStart = scan.length - remaining.length + match[0].indexOf(raw);
    remaining = rest;
    if (!IDENTITY_CAPITAL.test(raw) || identityHasDigit(raw) || /-/.test(raw)) {
      // "…newest customer on her new Escape": the clause moved on to the
      // vehicle before naming anyone.
      if (IDENTITY_HOP_STOP_WORDS[lower]) return null;
      afterBrand = false;
      continue;
    }
    if (IDENTITY_TRIGGER_WORDS[lower]) return null;
    if (isAutomotiveBrandToken(raw)) {
      afterBrand = true;
      continue;
    }
    // "…newest arrival: the 2025 Expedition": a determiner or model year
    // right before the word introduces a thing, unless it is a plural
    // family name ("…newest owners, the Johnsons").
    const previous = IDENTITY_PREVIOUS_WORD.exec(scan.slice(0, wordStart));
    if (
      previous &&
      (IDENTITY_NOUN_DETERMINERS[identityLower(previous[1])] ||
        (identityLower(previous[1]) === "the" && !identityLooksPlural(raw)) ||
        identityHasDigit(previous[1]) ||
        (IDENTITY_DETERMINER_ADJECTIVES[identityLower(previous[1])] &&
          !new RegExp("^\\s+[" + IDENTITY_UPPER + "]").test(rest)))
    ) {
      continue;
    }
    if (
      afterBrand ||
      grounding.words[lower] ||
      IDENTITY_NON_CUSTOMER_WORDS[lower] ||
      IDENTITY_DETERMINER_ADJECTIVES[lower]
    ) {
      continue;
    }
    const following = IDENTITY_FOLLOWING_WORD.exec(rest);
    if (following) {
      const followingLower = identityLower(following[1]);
      if (
        IDENTITY_CAPITAL.test(following[1]) ||
        IDENTITY_HANDOFF_CONNECTORS[followingLower] ||
        IDENTITY_NON_CUSTOMER_WORDS[followingLower]
      ) {
        if (!IDENTITY_CAPITAL.test(following[1])) continue;
        const third = IDENTITY_FOLLOWING_WORD.exec(rest.slice(following[0].length));
        if (
          third &&
          (IDENTITY_HANDOFF_CONNECTORS[identityLower(third[1])] ||
            IDENTITY_NON_CUSTOMER_WORDS[identityLower(third[1])])
        ) {
          continue;
        }
      }
    }
    return stripIdentityPossessive(raw);
  }
  return null;
}

function identityHeadlineTailAfter(scan, run, grounding) {
  const tail = IDENTITY_HEADLINE_TAIL.exec(scan.slice(run.end));
  if (!tail) return null;
  // "— New Owner Michelle!": walk the closed lead-in vocabulary to the person.
  let word = tail[1];
  let cursor = run.end + tail[0].length;
  for (let hops = 0; hops < 6; hops++) {
    const lower = identityLower(word);
    if (grounding.words[lower] || isAutomotiveBrandToken(word)) return null;
    if (IDENTITY_HOP_STOP_WORDS[lower]) return null;
    if (!IDENTITY_HOP_LEAD_IN_WORDS[lower] && !IDENTITY_NON_CUSTOMER_WORDS[lower]) {
      if (IDENTITY_TRIGGER_WORDS[lower]) return null;
      return stripIdentityPossessive(word);
    }
    const next = IDENTITY_FOLLOWING_WORD.exec(scan.slice(cursor));
    if (!next || !IDENTITY_CAPITAL.test(next[1])) return null;
    word = next[1];
    cursor += next[0].length;
  }
  return null;
}

// Mirror of followedByHandoffNoun(): "Bronco owner" — the next word owns the
// candidate. Only the nouns count, never "to"/"for".
function identityFollowedByHandoffNoun(scan, tokenEnd) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  if (!following) return false;
  const followingLower = identityLower(following[1]);
  return (
    !!IDENTITY_HANDOFF_CONNECTORS[followingLower] &&
    followingLower !== "to" &&
    followingLower !== "for"
  );
}

// Mirror of leadInDeterminer(): which determiner governs a lead-in phrase.
function identityLeadInDeterminer(scan, tokenStart) {
  let remaining = scan.slice(0, tokenStart);
  for (let hops = 0; hops <= 6; hops++) {
    const match = IDENTITY_PREVIOUS_WORD.exec(remaining);
    if (!match) return "none";
    const word = identityLower(match[1]);
    if (word === "the") return "the";
    if (IDENTITY_OWN_PERSON_DETERMINERS[word]) return "own";
    if (IDENTITY_NOUN_DETERMINERS[word]) return "other";
    if (
      !IDENTITY_HOP_LEAD_IN_WORDS[word] &&
      !IDENTITY_DETERMINER_ADJECTIVES[word] &&
      !IDENTITY_PERSON_ADJECTIVES[word]
    ) {
      return "none";
    }
    remaining = remaining.slice(0, match.index + match[0].indexOf(match[1]));
  }
  return "none";
}

// Mirror of leadInTargetVerdict(): a lead-in target is a THING when the next
// word owns it or a determiner phrase introduces it as one, a PERSON when a
// family noun follows it (unless the phrase is the dealer's own: "our Detail
// Team") or nothing introduces it as a thing.
function identityLeadInTargetVerdict(scan, tokenStart, tokenEnd, token, grounding) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  const followingLower = following ? identityLower(following[1]) : "";
  if (following && IDENTITY_FAMILY_FOLLOWERS[followingLower]) return "person";
  if (following && IDENTITY_TIME_FOLLOWERS[followingLower]) return "thing";
  if (identityFollowedByHandoffNoun(scan, tokenEnd)) return "thing";
  if (following && IDENTITY_ORGANISATION_FOLLOWERS[followingLower]) return "thing";
  if (IDENTITY_LOCATION_BEFORE.test(scan.slice(0, tokenStart))) return "thing";
  if (following && IDENTITY_COLLECTIVE_FOLLOWERS[followingLower]) {
    if (followingLower === "family" || followingLower === "families") {
      return "person";
    }
    const determiner = identityLeadInDeterminer(scan, tokenStart);
    return determiner === "own" || determiner === "other" ? "thing" : "person";
  }
  return identityPrecededByDeterminer(scan, tokenStart, token, grounding)
    ? "thing"
    : "person";
}

// Mirror of splitHashtag() in utils/captionQuality.ts: keep capitalization
// only where a split tag forms an addressing shape (opener + lead-ins + the
// name); lowercase the rest so Title Case cannot read as a name in prose.
const IDENTITY_HASHTAG_OPENER_WORDS = {};
Object.keys(IDENTITY_TRIGGER_WORDS).forEach(function (word) {
  if (word !== "for" && word !== "with" && word !== "from") {
    IDENTITY_HASHTAG_OPENER_WORDS[word] = true;
  }
});
// "#NewCarDayMichelle", "#HappyCustomerSarah", "#BroncoOwnerSarah"
[
  "new",
  "car",
  "day",
  "happy",
  "proud",
  "newest",
  "our",
  "customer",
  "customers",
  "owner",
  "owners",
  "member",
  "members",
  "team",
  "spotlight",
  "employee",
].forEach(function (word) {
  IDENTITY_HASHTAG_OPENER_WORDS[word] = true;
});
const IDENTITY_LETTER_DIGIT_BOUNDARY = new RegExp(
  "([" + IDENTITY_LETTER + "])([0-9])",
  "g",
);
const IDENTITY_CAMEL_BOUNDARY = new RegExp(
  "([" + IDENTITY_LOWER + "0-9])([" + IDENTITY_UPPER + "])",
  "g",
);
// Only a preposition ends a split tag's addressing shape (HASHTAG_STOP_WORDS
// on the client): "#ThankYouMichelle" keeps "You" as part of the opener.
const IDENTITY_HASHTAG_STOP_WORDS = {
  by: true,
  of: true,
  for: true,
  from: true,
  at: true,
  in: true,
  on: true,
};
function identitySplitHashtag(tag, grounding) {
  const raw = tag
    .replace(/_/g, " ")
    .replace(IDENTITY_CAMEL_BOUNDARY, "$1 $2")
    .replace(IDENTITY_LETTER_DIGIT_BOUNDARY, "$1 $2")
    .split(" ")
    .filter(Boolean)
    // "#Congrats2Sarah", "#Thanks4Choosing": text-speak prepositions.
    .map(function (word) {
      return word === "2" ? "to" : word === "4" ? "for" : word;
    });
  // "#Congrats2025Sarah": a year before the name is decoration.
  const words = raw.filter(function (word, index) {
    return !(/^[0-9]+$/.test(word) && IDENTITY_CAPITAL.test(raw[index + 1] || ""));
  });
  let state = "plain";
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();
    if (state !== "stopped" && IDENTITY_HASHTAG_OPENER_WORDS[lower]) {
      state = "leadin";
      out.push(word);
    } else if (state === "leadin") {
      // A stop word ends the shape ("#ThanksForVisitingHowell" names nobody).
      if (IDENTITY_HASHTAG_STOP_WORDS[lower]) {
        state = "stopped";
        out.push(word);
        continue;
      }
      const walkable =
        identityHasDigit(word) ||
        IDENTITY_HOP_LEAD_IN_WORDS[lower] ||
        IDENTITY_NON_CUSTOMER_WORDS[lower] ||
        grounding.words[lower] ||
        isAutomotiveBrandToken(word);
      if (!walkable) state = "done";
      out.push(word);
    } else {
      // "#NewOwnerSarahJohnson": the words after the name keep their case.
      out.push(state === "done" ? word : lower);
    }
  }
  return out.join(" ");
}

function identityVehicleSlotPattern(patternIndex, matchText) {
  return (
    patternIndex === IDENTITY_BARE_ACTION_INDEX ||
    patternIndex === 7 ||
    patternIndex === 8 ||
    (patternIndex === 6 && IDENTITY_VEHICLE_HEADLINE_OPENER.test(matchText))
  );
}

// Cache only fixed grammar, never customer text or dealership state. Goja's
// Unicode/lookaround compilation dominated History under concurrent use when
// these 18 identical patterns were rebuilt for every caption and disclosure.
// A JSVM executes synchronously; hasIdentityMatch resets each global lastIndex.
let cachedIdentityMatchers = null;
function identityMatchers() {
  if (cachedIdentityMatchers) return cachedIdentityMatchers;
  const name = IDENTITY_NAME_TOKEN;
  const separator = "(?:\\s+[Aa][Nn][Dd]\\s+|\\s*(?:&|\\+|/)\\s*)";
  const names = name + "(?:" + separator + name + ")*";
  // Participles only ("Sarah smiling beside her Bronco"). The finite forms
  // ("smiles", "stands", "pose") read as nouns in the captions the model
  // actually writes — "Big smiles today!", "All smiles!" — and every one of
  // those flagged the sentence-opening word as a customer. Kept identical to
  // utils/captionQuality.ts on the client (parity-tested).
  // Verbs and the for/with/from prose openers stay case-sensitive: in ALL
  // CAPS every word is "capitalized", so "THANK YOU FOR CHOOSING US" and
  // "SUMMER SAVINGS ARE HERE" would read as names. Only the deliberate
  // openers ("CONGRATS TO", "WELCOME HOME,") match case-insensitively.
  const directAction =
    "drove|drives|drive|driving|found|chose|chooses|selected|picked|picks|pick|purchased|bought|is|are|was|were|has|have|had|got|went|left|joined|became|owns|loves|love|loved|enjoys|enjoyed|celebrated|celebrates|celebrate|shared|shares|takes|take|took|starts|started|received|receives|standing|posing|smiling|traded|upgraded|stopped|signed|arrived|arrives|walked|rolled|headed|landed|grabbed|grabs|snagged|scored|added|adds|wanted|wants|needed|needs|deserved|deserves|earned|earns|treated|ordered|visited|dropped|recommended|recommends|trusted|trusts|thanked|welcomed|handled|cruised|came|comes|brought|brings|said|says|told|tells|made|makes|leased|leases|financed|finances|gave|gives|rated|rates|wrote|writes|worked|works|waited|waits|returned|returns|swung|swings|sold|sells|helped|helps|put|puts|spent|spends|hit|hits|smiled|smiles|stands|stood|poses|posed|test-drove|test-drives|finally|officially|recently|proudly|happily|already|truly|really|absolutely|totally|now|always|never|still|also|even|simply|definitely|clearly|literally|test|couldn't|couldn’t|can't|can’t|cannot|could|can|will|would|wasn't|wasn’t|weren't|weren’t|isn't|isn’t|aren't|aren’t|hasn't|hasn’t|haven't|haven’t|didn't|didn’t|won't|won’t|doesn't|doesn’t|don't|don’t";
  const action = directAction + "|just\\s+(?:" + directAction + ")";
  const actionWords = { just: true };
  directAction.split("|").forEach(function (word) {
    actionWords[word] = true;
  });
  // "Sarah and her family are…": an unnamed party may follow the person.
  const unnamedParty =
    "(?:\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:(?:her|his|their|the|our)\\s+)?[" +
    IDENTITY_LOWER +
    "]+)?";
  const congratsOpeners = [
    identityCiAlt([
      "congratulations",
      "congrats",
      "cheers",
      "kudos",
      "thanks",
      "props",
    ]),
    identityCi("shout") + "(?:[\\s-]?" + identityCi("out") + ")?",
    identityCi("thank") + "\\s+" + identityCi("you"),
    identityCi("say") + "\\s+(?:" + identityCi("hello") + "|" + identityCi("hi") + ")",
    identityCi("hats") + "\\s+" + identityCi("off"),
    identityCi("high") + "\\s+" + identityCi("five"),
    "(?:" +
      identityCi("so") +
      "\\s+)?" +
      identityCi("proud") +
      "\\s+" +
      identityCi("of"),
    identityCi("enjoy") + "\\s+" + identityCi("the") + "\\s+" + identityCi("ride"),
    identityCi("way") + "\\s+" + identityCi("to") + "\\s+" + identityCi("go"),
    identityCi("well") + "\\s+" + identityCi("done"),
    identityCi("happy") + "\\s+" + identityCi("trails"),
    identityCi("safe") + "\\s+" + identityCi("travels"),
    identityCi("good") + "\\s+" + identityCi("luck"),
    identityCi("nice") + "\\s+" + identityCi("work"),
    identityCi("great") + "\\s+" + identityCi("job"),
    identityCi("welcome") + "\\s+" + identityCi("back"),
    identityCi("warm") + "\\s+" + identityCi("welcome"),
    identityCi("spotlight") + "\\s+" + identityCi("on"),
    identityCi("happy") +
      "(?:\\s+[" +
      IDENTITY_LETTER +
      "0-9-]+){0,3}?\\s+(?:" +
      identityCiAlt(["birthday", "anniversary", "retirement", "graduation"]) +
      "|" +
      identityCi("year") +
      "s?)",
    identityCi("congratulations") +
      "\\s+" +
      identityCi("are") +
      "\\s+" +
      identityCi("in") +
      "\\s+" +
      identityCi("order") +
      "\\s+(?:" +
      identityCi("for") +
      "|" +
      IDENTITY_TO +
      ")",
  ].join("|");
  const personLabels = [
    identityCi("spotlight"),
    "(?:" +
      identityCiAlt(["employee", "salesperson", "customer", "member"]) +
      ")\\s+" +
      identityCi("of") +
      "\\s+" +
      identityCi("the") +
      "\\s+" +
      identityCi("month"),
    "(?:[" +
      IDENTITY_LETTER +
      "-]+\\s+){0,3}?(?:" +
      identityCiAlt([
        "owner",
        "owners",
        "customer",
        "customers",
        "member",
        "members",
        "driver",
        "drivers",
        "buyer",
        "buyers",
        "client",
        "clients",
        "winner",
        "winners",
        "name",
        "names",
        "guest",
        "guests",
        "host",
        "hosts",
        "hire",
        "advisor",
        "consultant",
        "salesperson",
        "credit",
        "featured",
        "pictured",
        "photo",
      ]) +
      ")",
    identityCi("referred") + "\\s+" + identityCi("by"),
    identityCi("hosted") + "\\s+" + identityCi("by"),
    identityCi("sold") + "\\s+" + IDENTITY_TO,
    identityCi("delivered") + "\\s+" + IDENTITY_TO,
  ].join("|");
  // Mirror of AFFECTION_OPENERS: openers that only name a person through "to".
  const affectionOpeners = [
    identityCi("salute"),
    "(?:" + identityCi("a") + "\\s+)?" + identityCi("toast"),
    identityCi("here") + "['’]" + identityCi("s"),
    identityCi("best") + "\\s+" + identityCi("wishes"),
    identityCi("sending") +
      "\\s+(?:" +
      identityCiAlt(["love", "hugs", "congrats", "congratulations", "thanks"]) +
      ")",
    identityCi("all") + "\\s+" + identityCi("the") + "\\s+" + identityCi("best"),
    identityCi("much") + "\\s+" + identityCi("love"),
    "(?:" +
      identityCi("a") +
      "\\s+)?(?:" +
      identityCi("big") +
      "\\s+)?" +
      identityCi("round") +
      "\\s+" +
      identityCi("of") +
      "\\s+" +
      identityCi("applause"),
    identityCi("three") + "\\s+" + identityCi("cheers"),
    identityCi("standing") + "\\s+" + identityCi("ovation"),
  ].join("|");
  // Mirror of PHOTO_PARTICIPLES / PHOTO_CONTINUATION.
  const photoParticiples = identityCiAlt(IDENTITY_PHOTO_PARTICIPLE_WORDS);
  const photoContinuation = [
    "(?:" +
      identityCi("with") +
      "|" +
      identityCi("and") +
      "|&)\\s+(?:" +
      identityCiAlt(["her", "his", "their"]) +
      ")\\b",
    identityCi("next") + "\\s+" + IDENTITY_TO + "\\b",
    identityCi("in") + "\\s+" + identityCi("front") + "\\s+" + identityCi("of") + "\\b",
    identityCi("behind") +
      "\\s+" +
      identityCi("the") +
      "\\s+" +
      identityCi("wheel") +
      "\\b",
    identityCi("ready") + "\\s+" + identityCi("for") + "\\b",
    identityCi("all") + "\\s+" + identityCi("smiles") + "\\b",
    identityCi("pictured") + "\\b",
    identityCi("here") + "\\s+" + identityCi("at") + "\\b",
    "(?:" + photoParticiples + ")\\b",
  ].join("|");
  // Mirror of VOCATIVE_CONTINUATION.
  const vocativeContinuation = identityCiAlt([
    "enjoy",
    "congrats",
    "congratulations",
    "welcome",
    "thank",
    "thanks",
    "hope",
    "wishing",
    "cheers",
    "glad",
    "hats",
    "way",
    "well",
    "we",
    "so",
  ]);
  const personHeadLabels = identityCiAlt([
    "customer",
    "customers",
    "owner",
    "owners",
    "member",
    "members",
    "buyer",
    "buyers",
    "driver",
    "drivers",
  ]);

  const patterns = [
    // 0: "Congrats to Sarah", "Much love to Sarah".
    new RegExp(
      "\\b(?:(?:(?:" +
        identityCiAlt(["big", "huge", "special", "massive", "major"]) +
        ")\\s+)?(?:" +
        congratsOpeners +
        ")(?:\\s+(?:" +
        identityCiAlt(["going", "goes", "go"]) +
        ")(?:\\s+" +
        identityCi("out") +
        ")?)?(?:\\s+(?:" +
        identityCi("once") +
        "\\s+)?" +
        identityCi("again") +
        "|\\s+" +
        identityCi("also") +
        "|\\s+" +
        identityCi("as") +
        "\\s+" +
        identityCi("well") +
        ")?(?:\\s+" +
        IDENTITY_TO +
        IDENTITY_OPENER_LEAD_IN +
        "|(?:\\s+[0-9][" +
        IDENTITY_LETTER +
        "0-9-]*)?[,:]?)|(?:" +
        affectionOpeners +
        ")(?:\\s+(?:" +
        identityCi("once") +
        "\\s+)?" +
        identityCi("again") +
        "|\\s+" +
        identityCi("also") +
        ")?\\s+" +
        IDENTITY_TO +
        IDENTITY_OPENER_LEAD_IN +
        ")\\s+[\"“'‘(\\[]?(" +
        names +
        ")",
      "g",
    ),
    // 1: "Meet Sarah", "Welcome Sarah".
    new RegExp(
      "\\b(?:" +
        identityCiAlt(["meet", "welcoming"]) +
        "|" +
        identityCi("celebrate") +
        "(?:\\s+" +
        identityCi("with") +
        ")?|" +
        identityCi("welcome") +
        "(?!\\s+(?:" +
        IDENTITY_TO +
        "|" +
        identityCi("aboard") +
        ")\\b))" +
        IDENTITY_OPENER_LEAD_IN +
        "\\s+[\"“'‘(\\[]?(" +
        names +
        ")",
      "g",
    ),
    // 2: "Sarah is…", "Sarah from our sales team is…".
    new RegExp(
      "(?:^|[^" +
        IDENTITY_LETTER +
        "0-9'’-])(" +
        names +
        ")(?=,?(?:\\s+[" +
        IDENTITY_UPPER +
        "]\\.|\\s+(?:" +
        identityCiAlt(IDENTITY_FAMILY_NOUNS.concat(["crew", "kids", "twins"])) +
        "))?(?:\\s+(?:from|in|at|of|with)(?:\\s+[" +
        IDENTITY_LETTER +
        "][" +
        IDENTITY_LETTER +
        "'’-]*){0,4}?)?" +
        unnamedParty +
        "\\s+(?:" +
        action +
        ")\\b)",
      "g",
    ),
    // 3: "for/with/from Sarah …verb".
    new RegExp(
      "\\b(?:" +
        IDENTITY_PREPOSITION_OPENERS +
        ")" +
        IDENTITY_OPENER_LEAD_IN_WORDS +
        "\\s+(" +
        names +
        ")(?=(?:\\s+" +
        name +
        ")*(?:[,!.?]|\\s+(?:" +
        action +
        ")\\b|\\s+(?:" +
        identityCiAlt(IDENTITY_FAMILY_NOUNS) +
        ")\\b|\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:her|his|their|the)\\b))",
      "g",
    ),
    // 4: "Helping Sarah", "Introducing Sarah".
    new RegExp(
      "\\b(?:" +
        identityCiAlt([
          "helping",
          "helped",
          "welcoming",
          "welcomed",
          "thanking",
          "thanked",
          "thank",
          "congratulating",
          "congratulated",
          "congratulate",
          "introducing",
          "presenting",
          "wishing",
          "honoring",
          "honored",
          "celebrating",
          "spotlighting",
          "recognizing",
          "recognized",
          "saluting",
          "surprising",
          "surprised",
          "greeting",
          "greeted",
          "treating",
          "treated",
          "gifting",
          "gifted",
          "assisting",
          "assisted",
          "serving",
          "served",
          "handed",
        ]) +
        ")" +
        IDENTITY_OPENER_LEAD_IN_WORDS +
        "\\s+[\"“'‘(\\[]?(" +
        names +
        ")",
      "g",
    ),
    // 5: "for/with/from Sarah" at the end of the phrase.
    new RegExp(
      "\\b(?:" +
        IDENTITY_PREPOSITION_OPENERS +
        ")" +
        IDENTITY_OPENER_LEAD_IN_WORDS +
        "\\s+(" +
        names +
        ")(?=(?:\\s+" +
        name +
        ")*(?:$|[,!.?]|\\s+(?:" +
        "at|during|today|this|on|after|before|who|by|to" +
        ")\\b|\\s+(?:" +
        identityCiAlt(IDENTITY_FAMILY_NOUNS) +
        ")\\b|\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:her|his|their|the)\\b))",
      "g",
    ),
    // 6: headline openers.
    new RegExp(
      "\\b(?:(?:" +
        IDENTITY_HEADLINE_OPENERS +
        ")(?:\\s+" +
        IDENTITY_TO +
        IDENTITY_OPENER_LEAD_IN +
        "\\s+|[,:\\s–—-]+|[,:\\s]+[^,:!.?\\n–—]{1,80}?(?:\\s*[–—-]+\\s*|\\s+" +
        IDENTITY_TO +
        IDENTITY_OPENER_LEAD_IN +
        "\\s+))|" +
        identityCi("welcome") +
        "\\s+(?:" +
        identityCi("aboard") +
        "|" +
        IDENTITY_TO +
        "\\s+[^,:!\\n–—]{1,80}?)\\s*[,:–—-]+\\s*|" +
        identityCi("welcome") +
        "\\s+" +
        IDENTITY_TO +
        "\\s+[^,:!.?\\n–—]{1,80}?\\s+(?:" +
        identityCiAlt(["family", "families", "team", "crew", "nation", "club"]) +
        ")\\s+)(?:" +
        IDENTITY_THE +
        "\\s+)?(" +
        names +
        ")(?=$|[^" +
        IDENTITY_LETTER +
        "])",
      "g",
    ),
    // 7: "Sarah — welcome home".
    new RegExp(
      "(?:^|[^" +
        IDENTITY_LETTER +
        "0-9'’-])(" +
        names +
        ")\\s*(?:[,!]|[–—-])\\s*(?:" +
        identityCi("welcome") +
        "\\s+(?:" +
        identityCi("home") +
        "|" +
        identityCi("aboard") +
        "|" +
        IDENTITY_TO +
        "\\s+[^.!?\\n]{1,60})|" +
        identityCi("new") +
        "\\s+" +
        identityCi("car") +
        "\\s+" +
        identityCi("day") +
        "|" +
        identityCi("delivered") +
        "|" +
        identityCi("sold") +
        ")\\b",
      "g",
    ),
    // 8: trailing vocative.
    new RegExp(
      "(?:,|[^\"”'’\\s][^\\S\\n]*[–—])\\s*(?:" +
        IDENTITY_THE +
        "\\s+)?(" +
        names +
        ")(?:\\s+" +
        name +
        ")*\\s*(?:[!.?]+|(?=$|\\n)|,\\s*(?=(?:" +
        vocativeContinuation +
        "|you|your|it|this|here|see|have|and)\\b))",
      "g",
    ),
    // 9: "Sarah's new ride" — a possessive name.
    new RegExp(
      "(?:^|[^" +
        IDENTITY_LETTER +
        "0-9'’-])([" +
        IDENTITY_UPPER +
        "][" +
        IDENTITY_LETTER +
        "\\-]{1,39}['’][Ss])(?=$|[^" +
        IDENTITY_LETTER +
        "0-9])",
      "g",
    ),
    // 10: "Sarah, enjoy your new Bronco!", "Sarah — enjoy…" — a leading vocative.
    new RegExp(
      "(?:^|\\n)\\s*(" +
        names +
        ")(?:\\s+" +
        name +
        ")*\\s*(?:,\\s*(?=[" +
        IDENTITY_LOWER +
        "])|[:–—-]+\\s*(?=(?:" +
        vocativeContinuation +
        ")\\b))",
      "g",
    ),
    // 11: "Employee of the Month: Sarah!"
    new RegExp(
      "\\b(?:" +
        personLabels +
        ")\\s*:\\s*(?:" +
        IDENTITY_THE +
        "\\s+)?(" +
        names +
        ")",
      "g",
    ),
    // 12: '"Best experience ever!" — Sarah', a line that is just "— Sarah".
    new RegExp("(?:[\"”'’]\\s*|(?:^|\\n)\\s*)[–—-]+\\s*(" + names + ")", "g"),
    // 13: "Proud owner Dave Miller with his new F-150!"
    new RegExp(
      "\\b(?:" +
        personHeadLabels +
        ")\\s+(" +
        names +
        ")(?:\\s+" +
        name +
        ")*(?=\\s*(?:[!.?,;:—–|-]|$|\\n)|\\s+(?:and|&|with|on|in|at|from|of|by|" +
        action +
        "|" +
        photoParticiples +
        ")\\b)",
      "g",
    ),
    // 14: "Sarah Johnson with her new Bronco!" — the person a photo caption opens with.
    new RegExp(
      "(?:^|\\n|[.!?])[^" +
        IDENTITY_LETTER +
        "0-9\\n]*(?:" +
        name +
        "\\s+)*?(" +
        names +
        ")(?=(?:\\s+" +
        name +
        ")*(?:\\s+(?:" +
        identityCiAlt(["family", "families", "household", "crew", "kids", "twins"]) +
        "))?(?:\\s+" +
        identityCi("of") +
        "\\s+" +
        name +
        ")?\\s*(?:,\\s*|[–—]\\s*)?(?:" +
        photoContinuation +
        ")|\\s+" +
        name +
        "(?:\\s+" +
        name +
        ")*\\s*[:|])",
      "g",
    ),
    // 15: "her husband Bob", "our friend Dave".
    new RegExp(
      "\\b(?:" +
        identityCiAlt(["her", "his", "their", "my", "our", "the"]) +
        ")\\s+(?:" +
        identityCiAlt(IDENTITY_RELATIVE_NOUNS) +
        ")\\s+(" +
        names +
        ")",
      "g",
    ),
    // 16: "Michelle and Bob!" — a caption that is nothing but names.
    new RegExp(
      "^\\s*(" +
        name +
        "(?:(?:" +
        separator +
        "|\\s*,\\s*)" +
        name +
        ")+)\\s*(?:,?\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:the|their|her|his)\\s+[" +
        IDENTITY_LOWER +
        "]+)?\\s*[!.]*\\s*$",
      "g",
    ),
    // 17: "The Johnson family's new Explorer" — a family's possessive.
    new RegExp(
      "(?:^|[^" +
        IDENTITY_LETTER +
        "0-9'’-])(" +
        name +
        ")\\s+(?:" +
        identityCiAlt(["family", "families", "household", "crew", "kids"]) +
        ")['’][Ss]\\b",
      "g",
    ),
  ];

  cachedIdentityMatchers = { patterns: patterns, actionWords: actionWords };
  return cachedIdentityMatchers;
}

/**
 * Mirror of unauthorizedCustomerNames() in utils/captionQuality.ts — same
 * patterns, same word lists, same walks, same order. Returns true when the
 * text names someone who is not the authorized customer.
 */
function containsUnexpectedCustomerIdentity(text, expectedCustomer, allowedPhrases) {
  if (!(text || "").toString().trim()) return false;
  const expected = publicCustomerLabel(expectedCustomer);
  // Every whitespace run collapses to one character, but a line break stays
  // a line break so a new sentence on the next line is a hard boundary.
  const allowed = normalizeAllowedIdentityPhrases(allowedPhrases);
  const grounding = buildIdentityGrounding(allowed);
  const preSplit = (text || "")
    .toString()
    .normalize("NFKC")
    .replace(/\u0001/g, "")
    // Smart punctuation is the same punctuation.
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‒―−]/g, "—")
    // "Mr. Miller", "Dr. Nguyen": the title's period is not a sentence end.
    .replace(IDENTITY_TITLE_ABBREVIATIONS, "$1")
    .trim()
    .replace(/\s+/g, function (ws) {
      return ws.indexOf("\n") >= 0 ? "\n" : " ";
    });
  // "#CongratsMichelle" addresses a person as plainly as prose does; split a
  // camel-case hashtag into its words so the same openers see it. A tag is
  // its own clause: a period is emitted before every tag that follows text
  // on the same line. Mirrors unauthorizedCustomerNames on the client.
  const rawScan = preSplit
    .replace(
      new RegExp("([^\\s#])[^\\S\\n]+(?=#[" + IDENTITY_LETTER + "0-9_])", "g"),
      "$1. ",
    )
    .replace(new RegExp("#([" + IDENTITY_LETTER + "0-9_]+)", "g"), function (_m, tag) {
      return identitySplitHashtag(tag, grounding);
    })
    // "@SarahJohnson" is a name written without spaces; "@BobMaxeyFord" is
    // the store's. Split the mention and keep its case.
    .replace(new RegExp("@([" + IDENTITY_LETTER + "0-9_]+)", "g"), function (_m, tag) {
      return tag.replace(/_/g, " ").replace(IDENTITY_CAMEL_BOUNDARY, "$1 $2").trim();
    })
    .trim()
    .replace(/\s+/g, function (ws) {
      return ws.indexOf("\n") >= 0 ? "\n" : " ";
    });
  if (
    expected &&
    (new RegExp(
      "(^|[^" +
        IDENTITY_LETTER +
        "0-9])" +
        escapeRegExp(expected) +
        "(?:[" +
        IDENTITY_LETTER +
        "]+|-[" +
        IDENTITY_LETTER +
        "]+)(?=$|[^" +
        IDENTITY_LETTER +
        "0-9])",
      "i",
    ).test(preSplit) ||
      // Inside a camel-case tag ("#CongratsMichelleSmith") the label keeps
      // its own capital so "Ann" never matches "Planned" — whatever case
      // the release spelled it in.
      new RegExp(
        "[" +
          IDENTITY_LOWER +
          "]" +
          escapeRegExp(expected.charAt(0).toUpperCase()) +
          identityCi(escapeRegExp(expected.slice(1))) +
          "[" +
          IDENTITY_UPPER +
          "][" +
          IDENTITY_LETTER +
          "]*(?=$|[^" +
          IDENTITY_LETTER +
          "0-9])",
      ).test(preSplit))
  ) {
    return true;
  }
  const matchers = identityMatchers();
  const patterns = matchers.patterns;
  const actionWords = matchers.actionWords;

  // Mirror of hopToPerson(): walk forward over the closed lead-in vocabulary
  // from `cursor` to the next capitalized word and examine it as the person
  // the phrase was really addressing.
  const hopToPerson = function (scan, cursor, context) {
    for (let hops = 0; hops < 8; hops++) {
      const next = IDENTITY_HOP_WORD.exec(scan.slice(cursor));
      if (!next) return false;
      const nextStart = cursor + next[0].indexOf(next[1]);
      cursor += next[0].length;
      const nextLower = identityLower(next[1]);
      // "Congrats to Our Newest Owner Will!", "the Parks family": a
      // vocabulary word that is also a name, ending the phrase in a
      // person-addressing slot, is the person.
      if (
        IDENTITY_AMBIGUOUS_NAME_WORDS[nextLower] &&
        IDENTITY_CAPITAL.test(next[1]) &&
        identityPersonContinuation(
          scan,
          cursor,
          next[1],
          grounding,
          !IDENTITY_PERSON_SLOT_OPENER.test(context.matchText),
          actionWords,
        ) &&
        !identityAmbiguousWordCompletesPhrase(scan, nextStart)
      ) {
        return true;
      }
      if (nextLower === "and" || next[1] === "&") continue;
      if (IDENTITY_HOP_STOP_WORDS[nextLower]) return false;
      // "Our Newest F-150 Owner Dave": a model code or year is part of the thing.
      if (identityHasDigit(next[1])) continue;
      if (
        IDENTITY_HOP_LEAD_IN_WORDS[nextLower] ||
        IDENTITY_NON_CUSTOMER_WORDS[nextLower] ||
        IDENTITY_DETERMINER_ADJECTIVES[nextLower] ||
        (IDENTITY_HANDOFF_CONNECTORS[nextLower] &&
          nextLower !== "to" &&
          nextLower !== "for")
      ) {
        continue;
      }
      if (!IDENTITY_CAPITAL.test(next[1])) return false;
      const hopped = {};
      for (const key in context) hopped[key] = context[key];
      hopped.viaLeadIn = true;
      return evaluateCandidate(scan, next[1], nextStart, cursor, hopped);
    }
    return false;
  };

  const evaluateCandidate = function (scan, token, tokenStart, tokenEnd, context) {
    const lower = identityLower(token);
    const isBareAction = context.patternIndex === IDENTITY_BARE_ACTION_INDEX;
    const isPhotoCaption = context.patternIndex === IDENTITY_PHOTO_CAPTION_INDEX;
    // "New Arrivals: Bronco, Explorer, Expedition": the last item of a list.
    if (context.listTail) return false;
    // "America's Truck": a possessive in a photo caption belongs to the
    // possessive pattern.
    if (isPhotoCaption && /['’][Ss]$/.test(token)) return false;
    if (
      IDENTITY_NON_CUSTOMER_WORDS[lower] ||
      IDENTITY_TRIGGER_WORDS[lower] ||
      (!isBareAction &&
        (IDENTITY_HOP_LEAD_IN_WORDS[lower] ||
          IDENTITY_AMBIGUOUS_NAME_WORDS[lower] ||
          (actionWords[lower] && !IDENTITY_AMBIGUOUS_NAME_WORDS[lower])))
    ) {
      // A capitalized lead-in word landed in the name slot; hop over the
      // closed lead-in vocabulary to the person after it.
      if (isPhotoCaption && IDENTITY_HOP_LEAD_IN_WORDS[lower] && !isBareAction) {
        return hopToPerson(scan, tokenEnd, context);
      }
      if (isBareAction || isPhotoCaption) {
        // "Sarah Day is all smiles with her new Bronco", "Summer is all
        // smiles with her new Bronco": a vocabulary surname or given name
        // when the clause goes on about one person.
        if (identityClauseOwnsPerson(scan, tokenEnd)) {
          if (
            identityPrecededByUnknownCapital(scan, tokenStart, grounding, actionWords)
          ) {
            return true;
          }
          if (
            IDENTITY_AMBIGUOUS_NAME_WORDS[lower] &&
            !identityAmbiguousWordCompletesPhrase(scan, tokenStart)
          ) {
            return true;
          }
        }
        return false;
      }
      if (actionWords[lower] && !IDENTITY_AMBIGUOUS_NAME_WORDS[lower]) return false;
      // "Congrats to the Spring family": any word but an adjective is a
      // surname in front of a family noun after "the".
      if (
        identityFollowedByFamilyNoun(scan, tokenEnd) &&
        /\bthe\s+$/i.test(scan.slice(0, tokenStart)) &&
        !IDENTITY_PERSON_ADJECTIVES[lower] &&
        !IDENTITY_DETERMINER_ADJECTIVES[lower] &&
        !IDENTITY_TRIGGER_WORDS[lower] &&
        !IDENTITY_NOUN_DETERMINERS[lower] &&
        !IDENTITY_HOP_STOP_WORDS[lower] &&
        !IDENTITY_LEAD_IN_BOUNDARY_WORDS[lower] &&
        !IDENTITY_COLLECTIVE_FOLLOWERS[lower] &&
        !IDENTITY_HANDOFF_CONNECTORS[lower]
      ) {
        return true;
      }
      // "Congrats to April!", "Meet Porter!", "Congrats to Summer Johnson",
      // "Cheers to April on her new Bronco": a vocabulary word that is also a
      // name, standing where only a person can.
      if (
        IDENTITY_AMBIGUOUS_NAME_WORDS[lower] &&
        context.patternIndex !== IDENTITY_POSSESSIVE_INDEX &&
        identityPersonContinuation(
          scan,
          tokenEnd,
          token,
          grounding,
          !(
            IDENTITY_PERSON_SLOT_OPENER.test(context.matchText) ||
            context.patternIndex === 8 ||
            context.patternIndex === IDENTITY_LEADING_VOCATIVE_INDEX ||
            context.patternIndex >= 11
          ),
          actionWords,
        ) &&
        !identityAmbiguousWordCompletesPhrase(scan, tokenStart)
      ) {
        return true;
      }
      if (context.patternIndex === IDENTITY_POSSESSIVE_INDEX) {
        // "Father's Day to Bronco Dads": a vocabulary possessive hands off
        // only to a relative ("Customer's son Jake").
        const next = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
        if (!next || !IDENTITY_RELATIVE_NOUN_SET[identityLower(next[1])]) return false;
      } else if (
        !IDENTITY_HOP_LEAD_IN_WORDS[lower] &&
        !IDENTITY_AMBIGUOUS_NAME_WORDS[lower]
      ) {
        return false;
      }
      return hopToPerson(scan, tokenEnd, context);
    }

    if (grounding.words[lower]) {
      const run = identityGroundedRun(
        scan,
        tokenEnd,
        token,
        grounding,
        context.vehicleSlot,
      );
      const before = identityPrecedingRun(scan, tokenStart, token, grounding);
      if (run.ok && !before.unrelated) {
        const totalTokens = run.tokenCount + before.tokenCount;
        const anyBrand = run.containsBrand || before.containsBrand;
        // "Mr. Ford", "Coach Ford", "her son Ford": a title or relative before
        // the store's word names a person who shares it — never a
        // VIN-grounded model ("Meet Mr. Bronco").
        if (
          !isBareAction &&
          !isPhotoCaption &&
          !grounding.modelWords[lower] &&
          identityPrecededByPersonNoun(scan, tokenStart)
        ) {
          return true;
        }
        if (isBareAction || isPhotoCaption) {
          if (
            totalTokens >= 2 ||
            anyBrand ||
            grounding.modelWords[lower] ||
            identityPrecededByDeterminer(scan, tokenStart, token, grounding)
          ) {
            return false;
          }
          return true;
        }
        // "Congrats to Ford on 120 years!": the make itself, unless the
        // clause goes on about a person ("Congrats to Ford on his new Bronco").
        if (
          anyBrand &&
          run.tokenCount === 1 &&
          !identityClauseOwnsPerson(scan, run.end) &&
          !identityFollowedByUnknownCapital(scan, run.end, grounding, actionWords)
        ) {
          return hopToPerson(scan, run.end, context);
        }
        // "Welcome, Bronco Raptor!", "Meet Bronco owner Sarah": a VIN-grounded
        // model word is the vehicle in any slot.
        if (grounding.modelWords[lower]) return hopToPerson(scan, run.end, context);
        if (
          identityDeliberateRunIsBusiness(
            scan,
            run,
            context.loneTokenAllowed,
            !context.vehicleSlot,
          )
        ) {
          if (identityHandoffTargetAfter(scan, run, grounding)) return true;
          // "Howell's newest Bronco Sport owner": the possessive walk above
          // already examined the clause.
          if (
            run.endsWithPossessive ||
            new RegExp("^\\s+[" + IDENTITY_LETTER + "]+['’][Ss]?\\b").test(
              scan.slice(run.end),
            )
          ) {
            return false;
          }
          if (context.vehicleSlot && identityHeadlineTailAfter(scan, run, grounding)) {
            return true;
          }
          // "the Ford Family Michelle": the collective may still name its person.
          return hopToPerson(scan, run.end, context);
        }
        // "Delivered: Ford Bronco Sport to the Howell family" / "to Michelle":
        // the vehicle was handed to whoever follows "to".
        if (context.vehicleSlot && /^\s+[Tt][Oo]\b/.test(scan.slice(run.end))) {
          return hopToPerson(scan, run.end, context);
        }
        // "Thanks to everyone in Howell": the town.
        if (
          context.viaLeadIn &&
          IDENTITY_LOCATION_BEFORE.test(scan.slice(0, tokenStart))
        ) {
          return hopToPerson(scan, run.end, context);
        }
        // "Meet the Bronco Sport Badlands": a determiner before a grounded run
        // in a lead-in slot introduces the thing, not the founder.
        if (
          context.viaLeadIn &&
          identityPrecededByDeterminer(scan, tokenStart, token, grounding)
        ) {
          return hopToPerson(scan, run.end, context);
        }
        return true;
      }
      if (
        (isBareAction || context.viaLeadIn) &&
        identityPrecededByDeterminer(scan, tokenStart, token, grounding)
      ) {
        if (context.viaLeadIn) return hopToPerson(scan, tokenEnd, context);
        return false;
      }
      // "Meet us at Howell Melon Festival": the town, then whatever it hosts.
      if (
        context.viaLeadIn &&
        IDENTITY_LOCATION_BEFORE.test(scan.slice(0, tokenStart))
      ) {
        return hopToPerson(scan, tokenEnd, context);
      }
      return true;
    }

    // "Built for America", "Happy Birthday to America": the country.
    if (
      (lower === "america" || lower === "americas" || lower === "usa") &&
      !identityClauseOwnsPerson(scan, tokenEnd)
    ) {
      return false;
    }
    // "Bronco Nation, this one's for you!", "Truck Month, let's go!": a group
    // or an occasion opening the caption, not a person.
    if (
      context.patternIndex === IDENTITY_LEADING_VOCATIVE_INDEX &&
      (identityFollowedByOrganisationNoun(scan, tokenEnd) ||
        identityFollowedByTimeNoun(scan, tokenEnd) ||
        identityFollowedByCollectiveNoun(scan, tokenEnd))
    ) {
      return false;
    }
    // "The Johnson family's new Explorer": the family's name.
    if (context.patternIndex === IDENTITY_FAMILY_POSSESSIVE_INDEX) return true;

    if (context.patternIndex === IDENTITY_POSSESSIVE_INDEX) {
      // "Sarah's new ride": a possessive name is the person — unless it
      // names an occasion ("Mother's Day"), a region ("America's truck") or
      // a determiner introduces the thing owned ("the Bronco's new owner").
      if (identityFollowedByTimeNoun(scan, tokenEnd)) return false;
      if (lower === "america" || lower === "americas") return false;
      if (identityPrecededByDeterminer(scan, tokenStart, token, grounding)) {
        return hopToPerson(scan, tokenEnd, context);
      }
      return true;
    }

    if (isBareAction) {
      // "The Miller family loves their new Explorer": the family noun makes
      // the word before it a surname, whatever introduced it.
      if (identityFollowedByFamilyNoun(scan, tokenEnd)) return true;
      if (identityPrecededByDeterminer(scan, tokenStart, token, grounding))
        return false;
      if (
        !context.isNameList &&
        !/s$/i.test(stripIdentityPossessive(token)) &&
        /(?:^|[.!?\n:;—–-])\s*$/.test(scan.slice(0, tokenStart)) &&
        /^\s+(?:just\s+)?love\b/i.test(scan.slice(tokenEnd))
      ) {
        return false;
      }
      return true;
    }

    // "Customer Perks", "Owner Benefits": a plural thing after a head label.
    if (
      context.patternIndex === IDENTITY_HEAD_LABEL_INDEX &&
      identityLooksPlural(token) &&
      !context.isNameList &&
      !identityFollowedByUnknownCapital(scan, tokenEnd, grounding, actionWords)
    ) {
      return false;
    }
    if (
      (context.viaLeadIn ||
        identityFollowedByHandoffNoun(scan, tokenEnd) ||
        identityFollowedByOrganisationNoun(scan, tokenEnd) ||
        identityFollowedByTimeNoun(scan, tokenEnd)) &&
      identityLeadInTargetVerdict(scan, tokenStart, tokenEnd, token, grounding) ===
        "thing"
    ) {
      // The thing is forgiven, but the phrase may still name its person
      // after it: "the newest Bronco owner Sarah", "the Radiant Michelle".
      return hopToPerson(scan, tokenEnd, context);
    }
    return true;
  };

  const hasIdentityMatch = function (scan, patternIndexes) {
    for (let i = 0; i < patternIndexes.length; i++) {
      const patternIndex = patternIndexes[i];
      const pattern = patterns[patternIndex];
      pattern.lastIndex = 0;
      let match = null;
      while ((match = pattern.exec(scan)) !== null) {
        const group = match[1] || "";
        const groupOffset = match[0].lastIndexOf(group);
        const groupStart = match.index + groupOffset;
        const opener = match[0].slice(0, groupOffset);
        const vehicleSlot = identityVehicleSlotPattern(patternIndex, match[0]);
        const context = {
          patternIndex: patternIndex,
          matchText: match[0],
          vehicleSlot: vehicleSlot,
          loneTokenAllowed:
            vehicleSlot ||
            patternIndex === 8 ||
            patternIndex === IDENTITY_LEADING_VOCATIVE_INDEX ||
            (IDENTITY_FROM_OPENER.test(opener) &&
              !IDENTITY_CONGRATULATION_OPENER.test(scan.slice(0, match.index))),
          isNameList: /\s+and\s+|[&+/]/i.test(group),
          viaLeadIn:
            (patternIndex === 0 ||
              patternIndex === 1 ||
              patternIndex === 3 ||
              patternIndex === 4 ||
              patternIndex === 5 ||
              patternIndex === 6) &&
            IDENTITY_LEAD_IN_OPENER.test(opener),
          listTail:
            patternIndex === IDENTITY_TRAILING_VOCATIVE_INDEX &&
            identityTrailingVocativeIsList(scan, groupStart),
        };
        const candidates = group.split(/\s+and\s+|\s*(?:&|\+|\/|,)\s*/i);
        let cursor = 0;
        for (let j = 0; j < candidates.length; j++) {
          const raw = candidates[j];
          const token = raw.trim();
          if (!token) continue;
          const tokenStart = groupStart + group.indexOf(raw, cursor);
          cursor = group.indexOf(raw, cursor) + raw.length;
          if (
            evaluateCandidate(scan, token, tokenStart, tokenStart + raw.length, context)
          ) {
            return true;
          }
        }
        if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
      }
    }
    return false;
  };

  // The approved label is blanked and checked for a glued-on surname
  // ("Michelle Smith" -> "Customer Smith"). Nothing else is ever blanked:
  // grounded business phrases are forgiven per word by the run walkers, so
  // the person they hand off to stays visible.
  const tagged = expected ? replaceAllowedCustomerPhrase(rawScan, expected) : rawScan;
  // Mirror of surnameAfterPlaceholder(): a capitalized word glued to the
  // blanked label is a surname unless it is the sentence's next word in
  // Title Case or ALL CAPS ("CONGRATS TO MICHELLE ON HER NEW BRONCO").
  const afterPlaceholder = new RegExp(
    "\\u0001Customer\\s+" +
      IDENTITY_NAME_PARTICLES +
      "([" +
      IDENTITY_UPPER +
      "][" +
      IDENTITY_LETTER +
      "'’-]{1,39}|[" +
      IDENTITY_UPPER +
      "]\\.)(?=$|[^" +
      IDENTITY_LETTER +
      "])",
    "g",
  );
  let placeholderMatch = null;
  while ((placeholderMatch = afterPlaceholder.exec(tagged)) !== null) {
    const word = placeholderMatch[1];
    const lower = identityLower(word);
    const rest = tagged.slice(placeholderMatch.index + placeholderMatch[0].length);
    if (grounding.words[lower] || isAutomotiveBrandToken(word)) return true;
    // "Michelle Day is all smiles", "Michelle Porter!": a vocabulary word
    // that is also a surname, followed by the sentence going on in lowercase
    // (or ending) rather than by Title Case.
    if (
      IDENTITY_AMBIGUOUS_NAME_WORDS[lower] &&
      !IDENTITY_PERSON_ADJECTIVES[lower] &&
      new RegExp("^(?:\\s*(?:[!.?,;]|$|\\n)|\\s+[" + IDENTITY_LOWER + "])").test(rest)
    ) {
      return true;
    }
    if (!(
      IDENTITY_NON_CUSTOMER_WORDS[lower] ||
      IDENTITY_HOP_STOP_WORDS[lower] ||
      IDENTITY_LEAD_IN_BOUNDARY_WORDS[lower] ||
      IDENTITY_HOP_LEAD_IN_WORDS[lower] ||
      IDENTITY_DETERMINER_ADJECTIVES[lower] ||
      IDENTITY_PERSON_ADJECTIVES[lower] ||
      IDENTITY_TRIGGER_WORDS[lower] ||
      actionWords[lower] ||
      IDENTITY_AMBIGUOUS_NAME_WORDS[lower]
    )) {
      return true;
    }
    if (afterPlaceholder.lastIndex === placeholderMatch.index)
      afterPlaceholder.lastIndex += 1;
  }
  const strictScan = tagged.replace(/\u0001/g, "");
  // A salesperson's name is masked only out of the generic "X is/has…" and
  // "for/with/from" prose scans. "Congratulations to <salesperson>" stays a
  // refusal.
  let looseScan = strictScan;
  for (let i = 0; i < allowed.length; i++) {
    if (allowed[i].grounded) continue;
    looseScan = replaceAllowedCustomerPhrase(looseScan, allowed[i].phrase);
  }
  looseScan = looseScan.replace(/\u0001/g, "");

  const deliberateIndexes = [];
  for (let i = 0; i < patterns.length; i++) {
    if (i === IDENTITY_BARE_ACTION_INDEX) continue;
    if (IDENTITY_PROSE_INDEXES.indexOf(i) !== -1) continue;
    deliberateIndexes.push(i);
  }
  if (hasIdentityMatch(strictScan, deliberateIndexes)) return true;
  return hasIdentityMatch(
    looseScan,
    [IDENTITY_BARE_ACTION_INDEX].concat(IDENTITY_PROSE_INDEXES),
  );
}

function releaseAuthorizesPublicCustomerLabel(protectedName, proposedLabel) {
  const expected = publicCustomerLabel(protectedName);
  const proposed = (proposedLabel || "").toString().trim().replace(/\s+/g, " ");
  return !!expected && !!proposed && expected.toLowerCase() === proposed.toLowerCase();
}

function projectProtectedCustomerNamePreservingAllowed(
  value,
  protectedName,
  allowedPhrases,
) {
  let protectedValue = (value || "").toString();
  // Nothing can be redacted without a protected name or source text. In the
  // PocketBase JSVM, compiling the Unicode lookaround expressions below is
  // expensive even when they cannot match. Keep the separate unexpected-name
  // review in reviewPostCustomerIdentity; this skips only no-op projection.
  if (!protectedValue || !(protectedName || "").toString().trim())
    return protectedValue;
  const restorations = [];
  const allowed = normalizeAllowedIdentityPhrases(allowedPhrases);
  for (let i = 0; i < allowed.length; i++) {
    const phrase = allowed[i].phrase;
    protectedValue = protectedValue.replace(
      new RegExp(
        "(^|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF0-9])" +
          escapeRegExp(phrase) +
          "(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF0-9])",
        "gi",
      ),
      function (match, prefix) {
        const token = "__GROUNDED_PHRASE_" + restorations.length + "__";
        restorations.push(match.slice((prefix || "").length));
        return (prefix || "") + token;
      },
    );
  }
  let projected = replaceProtectedCustomerName(protectedValue, protectedName);
  for (let i = 0; i < restorations.length; i++) {
    projected = projected.replace("__GROUNDED_PHRASE_" + i + "__", restorations[i]);
  }
  return projected;
}

function reviewPostCustomerIdentity(
  protectedName,
  values,
  allowedPhrases,
  rejectUnnamed,
) {
  const publicLabel = publicCustomerLabel(protectedName);
  const sourceValues = Array.isArray(values) ? values : [];
  const projectedValues = sourceValues.map(function (value) {
    return projectProtectedCustomerNamePreservingAllowed(
      value,
      protectedName,
      allowedPhrases || [],
    );
  });
  const projectionApplied = projectedValues.some(function (value, index) {
    return value !== (sourceValues[index] || "").toString();
  });
  const unexpectedIdentity = projectedValues.some(function (value) {
    if (!publicLabel && !rejectUnnamed) return false;
    return containsUnexpectedCustomerIdentity(value, publicLabel, allowedPhrases || []);
  });
  return {
    publicLabel: publicLabel,
    projectedValues: projectedValues,
    projectionApplied: projectionApplied,
    reviewRequired: unexpectedIdentity || projectionApplied,
    unexpectedIdentity: unexpectedIdentity,
  };
}

function replaceProtectedCustomerName(text, protectedName) {
  const source = (text || "").toString();
  const normalized = (protectedName || "").toString().trim().replace(/\s+/g, " ");
  if (!source || !normalized) return source;
  const parts = normalized.split(" ").map(escapeRegExp);
  const pattern = new RegExp(parts.join("\\s+"), "gi");
  const publicLabel = publicCustomerLabel(normalized);
  let result = source.replace(pattern, publicLabel);
  const nameParts = normalized.split(" ").filter(Boolean);
  if (nameParts.length > 1) {
    const familyName = escapeRegExp(nameParts[nameParts.length - 1]);
    result = result.replace(
      new RegExp(
        "\\b(?:the\\s+)?" + familyName + "(?:['’]s)?\\s+(?:family|household)\\b",
        "gi",
      ),
      publicLabel + "'s family",
    );
    result = result.replace(
      new RegExp("\\b(?:mr|mrs|ms|miss|dr)\\.?\\s+" + familyName + "\\b", "gi"),
      publicLabel,
    );
  }
  const protectedTokens = protectedNonFirstNameTokens(normalized);
  for (let i = 0; i < protectedTokens.length; i++) {
    const automotiveBrand = isAutomotiveBrandToken(protectedTokens[i]);
    result = result.replace(
      protectedNameTokenPattern(protectedTokens[i], true),
      function (match, prefix, possessive) {
        if (automotiveBrand && !possessive) return match;
        return prefix + (possessive ? "the customer's" : "the customer");
      },
    );
  }
  return result;
}

function containsVinLike(text) {
  return /\b[A-HJ-NPR-Z0-9]{17}\b/i.test((text || "").toString());
}

function containsSensitiveContactText(text) {
  const value = (text || "").toString();
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(value)) return true;
  if (
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s]*)?\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/(?:^|\D)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?:\D|$)/.test(value)) {
    return true;
  }
  if (/\b1?\d{10}\b/.test(value)) return true;
  if (/\b\d{3}-?\d{2}-?\d{4}\b/.test(value)) return true;
  if (
    /\b(?:social security|ssn|bank account|routing number|credit card|driver'?s license|release signature)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  return /\b\d{1,6}\s+[A-Za-z0-9.'’-]+(?:\s+[A-Za-z0-9.'’-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy|parkway|pkwy|place|pl|circle|cir|terrace|ter|trail|trl)\b/i.test(
    value,
  );
}

function containsProtectedName(text, protectedName) {
  const source = (text || "").toString();
  const normalized = (protectedName || "").toString().trim().replace(/\s+/g, " ");
  if (!source || !normalized) return false;
  const pattern = new RegExp(normalized.split(" ").map(escapeRegExp).join("\\s+"), "i");
  return pattern.test(source);
}

function containsProtectedFamilyReference(text, protectedName) {
  const source = (text || "").toString();
  const normalized = (protectedName || "").toString().trim().replace(/\s+/g, " ");
  const nameParts = normalized.split(" ").filter(Boolean);
  if (!source || nameParts.length < 2) return false;
  const familyName = escapeRegExp(nameParts[nameParts.length - 1]);
  return new RegExp(
    "\\b(?:(?:the\\s+)?" +
      familyName +
      "(?:['’]s)?\\s+(?:family|household)|(?:mr|mrs|ms|miss|dr)\\.?\\s+" +
      familyName +
      ")\\b",
    "i",
  ).test(source);
}

function containsProtectedNonFirstNameToken(text, protectedName) {
  const source = (text || "").toString();
  if (!source) return false;
  const tokens = protectedNonFirstNameTokens(protectedName);
  for (let i = 0; i < tokens.length; i++) {
    if (isAutomotiveBrandToken(tokens[i])) {
      if (
        new RegExp(
          "(^|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF])" +
            escapeRegExp(tokens[i]) +
            "(['’]s)(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF])",
          "i",
        ).test(source)
      ) {
        return true;
      }
      continue;
    }
    if (protectedNameTokenPattern(tokens[i], false).test(source)) return true;
  }
  return false;
}

function groundedVehicleIdentityPhrase(value) {
  const normalized = (value || "").toString().trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (/^(?:the vehicle they chose|customer experience)$/i.test(normalized)) {
    return normalized;
  }
  if (/\b(?:19|20)\d{2}\b/.test(normalized)) return normalized;
  const tokens = normalized.split(/[^A-Za-z]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (isAutomotiveBrandToken(tokens[i])) return normalized;
  }
  return "";
}

// `reviewIdentity` defaults to the guard itself. The interactive routes pass
// requestPolicies.identityReviewExcludingDisclosures(reviewPostCustomerIdentity)
// so website copy gets the same canonical-disclosure exemption as the caption
// set: a website draft the save route accepted is never refused at share,
// send or History for carrying the fixed legal text.
function publicWebsiteDraftForPost(post, dealerName, oemAffiliation, reviewIdentity) {
  const parsed = parseWebsiteDraft(recordString(post, "website_draft"));
  if (!parsed.ok || !parsed.value || !parsed.value.enabled) {
    return { websiteDraft: null, identityReviewRequired: false };
  }
  const draft = parsed.value;
  const protectedName = recordString(post, "customer_name");
  const publicLabel = publicCustomerLabel(protectedName);
  const salespersonName = recordString(post, "salesperson_name");
  const vehicleDescription = groundedVehicleIdentityPhrase(
    draft.vehicleDescription || "",
  );
  const review = (reviewIdentity || reviewPostCustomerIdentity)(
    protectedName,
    [draft.title || "", draft.body || "", draft.altText || ""],
    [
      groundedIdentityPhrase(dealerName || ""),
      groundedIdentityPhrase(oemAffiliation || ""),
      salespersonName,
      publicCustomerLabel(salespersonName),
      groundedIdentityPhrase(vehicleDescription),
    ],
    (recordBool(post, "release_required") || draft.kind === "customer_story") &&
      !publicLabel,
  );
  const labelConflict =
    !!draft.customerDisplayName &&
    !releaseAuthorizesPublicCustomerLabel(protectedName, draft.customerDisplayName);
  if (review.unexpectedIdentity || labelConflict) {
    return { websiteDraft: null, identityReviewRequired: true };
  }
  const publicDraft = Object.assign({}, draft, {
    title: review.projectedValues[0] || "",
    body: review.projectedValues[1] || "",
    altText: review.projectedValues[2] || "",
  });
  if (draft.kind === "customer_story" && publicLabel) {
    publicDraft.customerDisplayName = publicLabel;
  } else {
    delete publicDraft.customerDisplayName;
  }
  return {
    websiteDraft: publicDraft,
    identityReviewRequired: review.reviewRequired,
  };
}

function assertCanaryContent(post, draft) {
  const dealerId = recordString(post, "dealer");
  const canaryDealerId = readEnvironment("CUSTOMER_HUB_CANARY_DEALER_ID").trim();
  if (
    !canaryDealerId ||
    dealerId !== canaryDealerId ||
    dealerId === readEnvironment("CUSTOMER_HUB_DEALER_ID")
  )
    return;
  const config = destinationConfiguration(dealerId);
  if (!config.enabled) throw new Error("destination_unavailable");
  if (draft.kind !== "site_update" || draft.category !== "community")
    throw new Error("website_mapping_conflict");
  const fields = [
    "customer_name",
    "vin",
    "customer_email",
    "customer_phone",
    "email",
    "phone",
  ];
  for (let i = 0; i < fields.length; i++) {
    if (recordString(post, fields[i]) || draft[fields[i]])
      throw new Error("private_identifier_in_website_copy");
  }
  if (
    draft.customerDisplayName ||
    draft.vehicleDescription ||
    recordBool(post, "release_required") ||
    recordBool(post, "has_release")
  )
    throw new Error("private_identifier_in_website_copy");
  const copy = [
    draft.title,
    draft.body,
    draft.altText,
    recordString(post, "disclosures"),
  ];
  for (let i = 0; i < copy.length; i++) {
    if (containsUnexpectedCustomerIdentity(copy[i], "", []))
      throw new Error("private_identifier_in_website_copy");
  }
}

function buildOutboundContent(post, draft, media, dao) {
  const mapping = dao
    ? resolveWebsiteMappingForPostWithDao(dao, post)
    : resolveWebsiteMappingForPost(post);
  if (!mapping || draft.kind !== mapping.kind || draft.category !== mapping.category) {
    throw new Error("website_mapping_conflict");
  }
  assertCanaryContent(post, draft);
  const protectedName = recordString(post, "customer_name");
  const expectedCustomerLabel = publicCustomerLabel(protectedName);
  let customerDisplayName = "";
  if (draft.customerDisplayName) {
    const proposedCustomerLabel = draft.customerDisplayName
      .toString()
      .trim()
      .replace(/\s+/g, " ");
    const canonicalProposedLabel = publicCustomerLabel(proposedCustomerLabel);
    if (
      !expectedCustomerLabel ||
      !canonicalProposedLabel ||
      proposedCustomerLabel.toLowerCase() !== canonicalProposedLabel.toLowerCase() ||
      proposedCustomerLabel.toLowerCase() !== expectedCustomerLabel.toLowerCase()
    ) {
      throw new Error("customer_identity_conflict");
    }
    customerDisplayName = expectedCustomerLabel;
  } else if (draft.kind === "customer_story" && expectedCustomerLabel) {
    customerDisplayName = expectedCustomerLabel;
  }
  // This value is grounded from decoded vehicle data. Do not turn a vehicle
  // make such as Ford into "the customer" when it is also a surname.
  let vehicleDescription = (draft.vehicleDescription || "").toString();
  if (draft.kind === "customer_story" && !vehicleDescription) {
    vehicleDescription =
      mapping.scenarioId === "customer_testimonial"
        ? "Customer experience"
        : "the vehicle they chose";
  }
  const groundedVehicleDescription = groundedVehicleIdentityPhrase(vehicleDescription);
  if (vehicleDescription && !groundedVehicleDescription) {
    throw new Error("customer_identity_conflict");
  }
  vehicleDescription = groundedVehicleDescription;
  let dealerName = "";
  let oemAffiliation = "";
  const effectiveDao =
    dao || (typeof $app !== "undefined" && $app && $app.dao ? $app.dao() : null);
  if (effectiveDao) {
    try {
      const dealer = effectiveDao.findRecordById(
        "dealers",
        recordString(post, "dealer"),
      );
      dealerName = recordString(dealer, "name");
      oemAffiliation = recordString(dealer, "oem_affiliation");
    } catch (_e) {}
  }
  const groundedIdentityPhrases = [
    dealerName,
    oemAffiliation,
    vehicleDescription,
    mapping.scenarioLabel,
  ];
  const sanitizeMarketing = function (value) {
    return projectProtectedCustomerNamePreservingAllowed(
      (value || "").toString(),
      protectedName,
      groundedIdentityPhrases,
    );
  };
  const title = sanitizeMarketing(draft.title);
  const body = sanitizeMarketing(draft.body);
  const altText = sanitizeMarketing(draft.altText);
  // Disclosures are legal copy, not editable marketing text. Legacy protected
  // identity in this field must block delivery instead of being rewritten.
  const disclosures = recordString(post, "disclosures");
  const protectedIdentifierScan = function (value) {
    let scan = (value || "").toString();
    for (let i = 0; i < groundedIdentityPhrases.length; i++) {
      scan = replaceAllowedCustomerPhrase(scan, groundedIdentityPhrases[i]);
    }
    return scan;
  };

  if (
    draft.kind === "customer_story" &&
    (containsUnexpectedCustomerIdentity(title, customerDisplayName, [
      groundedIdentityPhrase(vehicleDescription),
      mapping.scenarioLabel,
      groundedIdentityPhrase(dealerName),
      groundedIdentityPhrase(oemAffiliation),
    ]) ||
      containsUnexpectedCustomerIdentity(body, customerDisplayName, [
        groundedIdentityPhrase(vehicleDescription),
        mapping.scenarioLabel,
        groundedIdentityPhrase(dealerName),
        groundedIdentityPhrase(oemAffiliation),
      ]) ||
      containsUnexpectedCustomerIdentity(altText, customerDisplayName, [
        groundedIdentityPhrase(vehicleDescription),
        mapping.scenarioLabel,
        groundedIdentityPhrase(dealerName),
        groundedIdentityPhrase(oemAffiliation),
      ]))
  ) {
    throw new Error("customer_identity_conflict");
  }

  if (disclosures.length > 2000)
    throw new Error("disclosures_exceed_destination_limit");
  if (
    containsProtectedName(protectedIdentifierScan(disclosures), protectedName) ||
    containsProtectedFamilyReference(
      protectedIdentifierScan(disclosures),
      protectedName,
    ) ||
    containsProtectedNonFirstNameToken(
      protectedIdentifierScan(disclosures),
      protectedName,
    ) ||
    containsProtectedNonFirstNameToken(protectedIdentifierScan(title), protectedName) ||
    containsProtectedNonFirstNameToken(protectedIdentifierScan(body), protectedName) ||
    containsProtectedNonFirstNameToken(
      protectedIdentifierScan(altText),
      protectedName,
    ) ||
    containsProtectedNonFirstNameToken(
      protectedIdentifierScan(customerDisplayName),
      protectedName,
    ) ||
    containsProtectedNonFirstNameToken(
      protectedIdentifierScan(vehicleDescription),
      protectedName,
    ) ||
    containsProtectedName(protectedIdentifierScan(vehicleDescription), protectedName) ||
    containsProtectedFamilyReference(
      protectedIdentifierScan(vehicleDescription),
      protectedName,
    ) ||
    containsVinLike(disclosures) ||
    containsVinLike(title) ||
    containsVinLike(body) ||
    containsVinLike(altText) ||
    containsVinLike(customerDisplayName) ||
    containsVinLike(vehicleDescription)
  ) {
    throw new Error("private_identifier_in_website_copy");
  }
  if (
    containsSensitiveContactText(disclosures) ||
    containsSensitiveContactText(title) ||
    containsSensitiveContactText(body) ||
    containsSensitiveContactText(altText) ||
    containsSensitiveContactText(customerDisplayName) ||
    containsSensitiveContactText(vehicleDescription)
  ) {
    throw new Error("private_contact_in_website_copy");
  }

  const content = {
    kind: mapping.kind,
    postTypeId: mapping.scenarioId,
    category: mapping.category,
    title: title,
    body: body,
    altText: altText,
    // Server-owned legal copy is separate from AI marketing copy and remains
    // byte-for-byte identical to the approved post disclosure field.
    disclosures: disclosures,
  };
  if (customerDisplayName) content.customerDisplayName = customerDisplayName;
  if (vehicleDescription) content.vehicleDescription = vehicleDescription;
  // Advisory only: Customer Hub surfaces these as human review notes and
  // never treats them as evidence of consent or approval.
  if (draft.privacyFlags && draft.privacyFlags.length) {
    content.privacyFlags = draft.privacyFlags.slice(0, 5);
  }
  content.media = media;
  return content;
}

function publicationSourceSnapshotHash(
  post,
  draft,
  media,
  securityApi,
  dao,
  destinationBinding,
) {
  const crypto = securityApi || $security;
  const snapshot = {
    sourcePostId: post.id,
    sourceDealerId: recordString(post, "dealer"),
    content: buildOutboundContent(post, draft, media, dao),
  };
  // The event id carried by the signed envelope commits to the effective
  // destination and credential/config revision without exposing credentials
  // or changing Customer Hub's schema-v1 wire contract.
  if (destinationBinding && destinationBinding.identity)
    snapshot.destinationBinding = {
      identity: destinationBinding.identity,
      revision: Number(destinationBinding.revision || 0),
    };
  const sourceSnapshot = JSON.stringify(snapshot);
  const digest = (crypto.sha256(sourceSnapshot) || "").toString().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("website_source_snapshot_invalid");
  }
  return digest;
}

function verifyPublicationSourceSnapshot(
  publication,
  post,
  draft,
  media,
  securityApi,
  dao,
) {
  const eventId = recordString(publication, "event_id").toLowerCase();
  const match = eventId.match(/^wp_s_[a-f0-9]{32}_([a-f0-9]{40})$/);
  if (!match) return;
  const actual = publicationSourceSnapshotHash(post, draft, media, securityApi, dao, {
    identity: recordString(publication, "destination_identity"),
    revision: recordInt(publication, "config_revision"),
  });
  if (match[1] !== actual.slice(0, 40)) {
    throw new Error("payload_revision_conflict");
  }
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64Block(bytes, count) {
  let result = "";
  for (let i = 0; i < count; i += 3) {
    const a = Number(bytes[i]) & 255;
    const b = Number(bytes[i + 1]) & 255;
    const c = Number(bytes[i + 2]) & 255;
    result +=
      BASE64_ALPHABET.charAt(a >> 2) +
      BASE64_ALPHABET.charAt(((a & 3) << 4) | (b >> 4)) +
      BASE64_ALPHABET.charAt(((b & 15) << 2) | (c >> 6)) +
      BASE64_ALPHABET.charAt(c & 63);
  }
  return result;
}

function base64EncodeBytes(bytes) {
  const length = bytes ? bytes.length : 0;
  const complete = length - (length % 3);
  let result = encodeBase64Block(bytes, complete);
  const remainder = length - complete;
  if (remainder === 1) {
    const a = Number(bytes[complete]) & 255;
    result +=
      BASE64_ALPHABET.charAt(a >> 2) + BASE64_ALPHABET.charAt((a & 3) << 4) + "==";
  } else if (remainder === 2) {
    const a = Number(bytes[complete]) & 255;
    const b = Number(bytes[complete + 1]) & 255;
    result +=
      BASE64_ALPHABET.charAt(a >> 2) +
      BASE64_ALPHABET.charAt(((a & 3) << 4) | (b >> 4)) +
      BASE64_ALPHABET.charAt((b & 15) << 2) +
      "=";
  }
  return result;
}

function base64EncodeReader(reader, expectedSize) {
  if (!Number.isFinite(expectedSize) || expectedSize < 1) {
    throw new Error("creative_media_empty");
  }
  if (expectedSize > WEBSITE_MEDIA_MAX_BYTES) {
    throw new Error("creative_media_too_large");
  }

  const bufferSize = Math.min(49152, expectedSize);
  const seedPath =
    $os.tempDir() +
    "/dealer-social-media-buffer-" +
    $security.randomStringWithAlphabet(24, "abcdefghijklmnopqrstuvwxyz0123456789");
  let buffer = null;
  try {
    $os.writeFile(seedPath, "", 384);
    $os.truncate(seedPath, bufferSize);
    // $os.readFile returns a native []byte. Passing a normal JS Array to a Go
    // io.Reader copies it and loses mutations; the native slice is required.
    buffer = $os.readFile(seedPath);
  } finally {
    try {
      $os.remove(seedPath);
    } catch (_e) {}
  }

  const chunks = [];
  let carry = [];
  let total = 0;
  while (total < expectedSize) {
    const count = Number(reader.read(buffer)) || 0;
    if (count <= 0 || total + count > expectedSize) {
      throw new Error("creative_media_read_failed");
    }
    const combined = carry.slice();
    for (let i = 0; i < count; i++) combined.push(Number(buffer[i]) & 255);
    const complete = combined.length - (combined.length % 3);
    if (complete) chunks.push(encodeBase64Block(combined, complete));
    carry = combined.slice(complete);
    total += count;
  }
  if (total !== expectedSize) throw new Error("creative_media_read_failed");
  if (carry.length) chunks.push(base64EncodeBytes(carry));
  return chunks.join("");
}

function readPostCreative(post) {
  const storedFilename = recordString(post, "creative_image");
  if (!storedFilename) throw new Error("creative_media_missing");
  const fileKey = post.baseFilesPath() + "/" + storedFilename;
  const fsys = $app.newFilesystem();
  let reader = null;
  try {
    if (!fsys.exists(fileKey)) throw new Error("creative_media_missing");
    reader = fsys.getFile(fileKey);
    const size = Number(reader.size());
    let mimeType = (reader.contentType() || "")
      .toString()
      .split(";")[0]
      .trim()
      .toLowerCase();
    const lowerFilename = storedFilename.toLowerCase();
    if (mimeType === "image/jpg") mimeType = "image/jpeg";
    if (
      mimeType !== "image/jpeg" &&
      mimeType !== "image/png" &&
      mimeType !== "image/webp"
    ) {
      if (/\.(jpe?g)$/.test(lowerFilename)) mimeType = "image/jpeg";
      else if (/\.png$/.test(lowerFilename)) mimeType = "image/png";
      else if (/\.webp$/.test(lowerFilename)) mimeType = "image/webp";
      else throw new Error("creative_media_type_unsupported");
    }
    const extension =
      mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    return {
      mimeType: mimeType,
      filename: "website-post-" + post.id + "." + extension,
      base64: base64EncodeReader(reader, size),
    };
  } finally {
    if (reader) reader.close();
    fsys.close();
  }
}

function buildLogicalPayload(publication, post, media) {
  const parsedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
  if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) {
    throw new Error("website_request_withdrawn");
  }
  const sourceRevision = recordInt(publication, "source_revision");
  const sentAt = recordString(publication, "payload_sent_at");
  if (!sourceRevision || !sentAt) throw new Error("publication_revision_invalid");
  return {
    schemaVersion: WEBSITE_PAYLOAD_SCHEMA_VERSION,
    eventId: recordString(publication, "event_id"),
    destinationId: recordString(publication, "destination_id"),
    sourcePostId: post.id,
    sourceDealerId: recordString(post, "dealer"),
    sourceRevision: sourceRevision,
    // Frozen at enqueue, not regenerated per attempt.
    sentAt: sentAt,
    content: buildOutboundContent(post, parsedDraft.value, media),
  };
}

function publicationCanaryIdentity(post, publication) {
  try {
    const dealerId = recordString(post, "dealer");
    if (
      dealerId !== readEnvironment("CUSTOMER_HUB_CANARY_DEALER_ID").trim() ||
      dealerId === readEnvironment("CUSTOMER_HUB_DEALER_ID")
    )
      return null;
    const config = destinationConfiguration(dealerId);
    if (
      !config.canary ||
      !publicationDestinationMatches(publication, config, dealerId) ||
      recordString(publication, "post") !== post.id ||
      recordString(publication, "status") !== "draft_ready" ||
      !/^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/.test(recordString(publication, "event_id")) ||
      !Number.isInteger(recordInt(publication, "source_revision")) ||
      recordInt(publication, "source_revision") < 1
    )
      return null;
    const media = readPostCreative(post);
    const parsed = parseWebsiteDraft(recordString(post, "website_draft"));
    if (!parsed.ok || !parsed.value) return null;
    verifyPublicationSourceSnapshot(publication, post, parsed.value, media, $security);
    const payload = buildLogicalPayload(publication, post, media);
    const payloadHash = $security.sha256(JSON.stringify(payload)).toLowerCase();
    if (
      !/^[a-f0-9]{64}$/.test(payloadHash) ||
      payloadHash !== recordString(publication, "payload_hash")
    )
      return null;
    return {
      identity: {
        eventId: payload.eventId,
        payloadHash: payloadHash,
        sourceDealerId: payload.sourceDealerId,
        sourcePostId: payload.sourcePostId,
        sourceRevision: payload.sourceRevision,
      },
      mediaBase64Sha256: $security.sha256(media.base64).toLowerCase(),
    };
  } catch (_e) {
    return null;
  }
}

function hmacHeaders(rawBody, timestamp, nonce, secret, securityApi) {
  const crypto = securityApi || $security;
  const bodyHash = (crypto.sha256(rawBody) || "").toString().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(bodyHash)) throw new Error("payload_hash_failed");
  // Contract: lowercase hex HMAC-SHA256 of exactly
  // timestamp + '.' + nonce + '.' + lowercaseHexSha256(rawBody).
  // $security.hs256 is the same byte-level HMAC as WebCrypto on Customer Hub;
  // no base64 or alternate encoding is accepted.
  const message = timestamp + "." + nonce + "." + bodyHash;
  const signature = (crypto.hs256(message, secret) || "").toString().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error("payload_signature_failed");
  return { bodyHash: bodyHash, signature: signature, message: message };
}

function freezeOrVerifyPayloadHash(publication, bodyHash) {
  const existing = recordString(publication, "payload_hash");
  if (existing) {
    if (existing !== bodyHash) throw new Error("payload_revision_conflict");
    return;
  }
  const result = $app
    .dao()
    .db()
    .newQuery(
      "UPDATE website_publications SET payload_hash = {:hash}, updated = {:updated} " +
        "WHERE id = {:id} AND (payload_hash = '' OR payload_hash IS NULL)",
    )
    .bind({
      hash: bodyHash,
      updated: dbTimestamp(new Date().toISOString()),
      id: publication.id,
    })
    .execute();
  if (result && result.rowsAffected() === 1) {
    // Keep the in-memory Record in sync so the later status save cannot write
    // its stale empty value over the hash frozen by the atomic SQL update.
    publication.set("payload_hash", bodyHash);
    return;
  }
  if (!result || result.rowsAffected() !== 1) {
    const current = $app.dao().findRecordById("website_publications", publication.id);
    if (recordString(current, "payload_hash") !== bodyHash) {
      throw new Error("payload_revision_conflict");
    }
    publication.set("payload_hash", bodyHash);
  }
}

function safeReviewUrl(value, siteUrl) {
  const reviewUrl = assertBoundedString(value, 2048, {});
  if (!reviewUrl || !siteUrl) return "";
  return reviewUrl.indexOf(siteUrl + "/") === 0 ? reviewUrl : "";
}

function acceptedDestinationState(
  statusCode,
  responseStatus,
  draftId,
  reviewUrl,
  idempotentReplay,
) {
  const isSuccessStatus = statusCode === 200 || statusCode === 201;
  const isIdempotentConflict = statusCode === 409 && !!draftId;
  if (
    (isSuccessStatus || isIdempotentConflict) &&
    responseStatus === "draft" &&
    draftId &&
    reviewUrl
  ) {
    return "draft_ready";
  }
  if (
    isSuccessStatus &&
    idempotentReplay === true &&
    responseStatus === "published" &&
    draftId
  ) {
    return "published";
  }
  if (
    isSuccessStatus &&
    idempotentReplay === true &&
    responseStatus === "withdrawn" &&
    draftId
  ) {
    return "withdrawn";
  }
  return "";
}

function statusReplayResponseIsBound(
  isStatusReplay,
  idempotentReplay,
  draftId,
  existingRemoteDraftId,
) {
  return (
    !isStatusReplay ||
    (idempotentReplay === true &&
      !!existingRemoteDraftId &&
      draftId === existingRemoteDraftId)
  );
}

function nextBackoffMilliseconds(attempts) {
  const delays = [
    60,
    5 * 60,
    15 * 60,
    60 * 60,
    4 * 60 * 60,
    12 * 60 * 60,
    24 * 60 * 60,
  ];
  return delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)] * 1000;
}

function scheduleRetry(publication, code) {
  const attempts = recordInt(publication, "attempts");
  // Once the Hub has acknowledged a private draft, a temporary status-check
  // outage must never erase that known-good state or exhaust delivery retries.
  if (recordString(publication, "remote_draft_id")) {
    return savePublicationState(publication, {
      status: "draft_ready",
      next_attempt_at: new Date(Date.now() + WEBSITE_STATUS_REFRESH_MS).toISOString(),
      last_error: code,
    });
  }
  if (attempts >= WEBSITE_DELIVERY_MAX_ATTEMPTS) {
    return savePublicationState(publication, {
      status: "failed",
      next_attempt_at: "",
      last_error: code,
    });
  }
  return savePublicationState(publication, {
    status: "retrying",
    next_attempt_at: new Date(
      Date.now() + nextBackoffMilliseconds(attempts),
    ).toISOString(),
    last_error: code,
  });
}

function suspendStatusReplay(publication, code) {
  return savePublicationState(publication, {
    status: "draft_ready",
    // A blank value is deliberately not due. A person can retry this safe,
    // idempotent status check after the underlying issue is corrected.
    next_attempt_at: "",
    last_error: code,
  });
}

function statusReplayErrorIsPermanent(code) {
  return (
    code === "creative_media_empty" ||
    code === "creative_media_too_large" ||
    code === "creative_media_missing" ||
    code === "creative_media_type_unsupported" ||
    code === "image_review_required" ||
    code === "disclosures_exceed_destination_limit" ||
    code === "private_identifier_in_website_copy" ||
    code === "private_contact_in_website_copy" ||
    code === "website_mapping_conflict" ||
    code === "website_request_withdrawn" ||
    code === "publication_revision_invalid" ||
    code === "payload_hash_failed" ||
    code === "payload_signature_failed" ||
    code === "payload_revision_conflict"
  );
}

function safeDeliveryErrorCode(err) {
  const code = (err && err.message ? err.message : err || "delivery_failed")
    .toString()
    .trim()
    .toLowerCase();
  const allowlisted = [
    "creative_media_empty",
    "creative_media_too_large",
    "creative_media_read_failed",
    "creative_media_missing",
    "creative_media_type_unsupported",
    "image_review_required",
    "disclosures_exceed_destination_limit",
    "private_identifier_in_website_copy",
    "private_contact_in_website_copy",
    "website_mapping_conflict",
    "website_request_withdrawn",
    "publication_revision_invalid",
    "payload_hash_failed",
    "payload_signature_failed",
    "payload_revision_conflict",
    "destination_unavailable",
  ];
  return allowlisted.indexOf(code) !== -1 ? code : "destination_transport_failed";
}

function publicationDestinationMatches(publication, config, dealerId) {
  return (
    !!config &&
    config.enabled &&
    recordString(publication, "dealer") === dealerId &&
    config.allowedDealerId === dealerId &&
    config.id === recordString(publication, "destination_id") &&
    // Unbound historical rows cannot establish their original target.
    ((!config.identity && typeof __hooks === "undefined") ||
      (recordString(publication, "destination_identity") === config.identity &&
        recordInt(publication, "config_revision") === Number(config.revision)))
  );
}

function deliverClaimedPublication(publication) {
  const isStatusReplay = !!recordString(publication, "remote_draft_id");
  let post = null;
  try {
    post = $app.dao().findRecordById("posts", recordString(publication, "post"));
  } catch (_e) {
    if (isStatusReplay) {
      return suspendStatusReplay(publication, "source_post_missing");
    }
    return savePublicationState(publication, {
      status: "withdrawn",
      next_attempt_at: "",
      last_error: "source_post_missing",
    });
  }
  if (!isStatusReplay) {
    const readiness = postReadiness(post);
    if (readiness.terminal) {
      return savePublicationState(publication, {
        status: "withdrawn",
        next_attempt_at: "",
        last_error: readiness.code,
      });
    }
    if (!readiness.ready) {
      return savePublicationState(publication, {
        status: "waiting_approval",
        next_attempt_at: "",
        last_error: readiness.code,
      });
    }
  }

  const config = destinationConfiguration(recordString(post, "dealer"));
  if (
    !publicationDestinationMatches(publication, config, recordString(post, "dealer"))
  ) {
    return savePublicationState(publication, {
      status: isStatusReplay ? "draft_ready" : "failed",
      next_attempt_at: "",
      last_error: "destination_configuration_changed",
    });
  }

  let rawBody = "";
  let signed = null;
  try {
    const media = readPostCreative(post);
    const parsedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
    if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) {
      throw new Error("website_request_withdrawn");
    }
    verifyPublicationSourceSnapshot(
      publication,
      post,
      parsedDraft.value,
      media,
      $security,
    );
    rawBody = JSON.stringify(buildLogicalPayload(publication, post, media));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = $security.randomStringWithAlphabet(
      32,
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    );
    signed = hmacHeaders(rawBody, timestamp, nonce, config.secret, $security);
    freezeOrVerifyPayloadHash(publication, signed.bodyHash);

    const response = (
      typeof __hooks === "undefined" ? $http : require(__hooks + "/safeHttp.js")
    ).send({
      url: config.endpointUrl,
      method: "POST",
      body: rawBody,
      timeout: 45,
      headers: {
        "Content-Type": "application/json",
        "X-Dealer-Social-Timestamp": timestamp,
        "X-Dealer-Social-Nonce": nonce,
        "X-Dealer-Social-Signature": signed.signature,
      },
    });
    const responseBody =
      response && response.json && typeof response.json === "object"
        ? response.json
        : {};
    const draftId = assertBoundedString(responseBody.draftId, 128, {});
    const responseStatus = (responseBody.status || "").toString();
    const reviewUrl = safeReviewUrl(responseBody.reviewUrl, config.siteUrl);
    const existingRemoteDraftId = recordString(publication, "remote_draft_id");
    const existingReviewUrl = recordString(publication, "review_url");
    const acceptedState = acceptedDestinationState(
      response.statusCode,
      responseStatus,
      draftId,
      reviewUrl || (isStatusReplay ? existingReviewUrl : ""),
      responseBody.idempotentReplay,
    );
    const replayResponseIsBound = statusReplayResponseIsBound(
      isStatusReplay,
      responseBody.idempotentReplay,
      draftId,
      existingRemoteDraftId,
    );
    if (acceptedState && !replayResponseIsBound) {
      return suspendStatusReplay(publication, "destination_policy_violation");
    }
    if (acceptedState) {
      const acceptedAt = new Date().toISOString();
      return savePublicationState(publication, {
        status: acceptedState,
        attempts: 0,
        next_attempt_at:
          acceptedState === "draft_ready"
            ? new Date(Date.now() + WEBSITE_STATUS_REFRESH_MS).toISOString()
            : "",
        delivered_at: recordString(publication, "delivered_at") || acceptedAt,
        remote_draft_id: draftId,
        review_url: acceptedState === "withdrawn" ? "" : reviewUrl || existingReviewUrl,
        last_error: "",
      });
    }
    if (responseStatus === "published" || responseStatus === "withdrawn") {
      if (isStatusReplay) {
        return suspendStatusReplay(publication, "destination_policy_violation");
      }
      return savePublicationState(publication, {
        status: "failed",
        next_attempt_at: "",
        last_error: "destination_policy_violation",
      });
    }
    if (response.statusCode === 401 || response.statusCode === 403) {
      if (isStatusReplay) {
        return suspendStatusReplay(publication, "destination_auth_failed");
      }
      return savePublicationState(publication, {
        status: "failed",
        next_attempt_at: "",
        last_error: "destination_auth_failed",
      });
    }
    if (
      response.statusCode === 400 ||
      response.statusCode === 404 ||
      response.statusCode === 413 ||
      response.statusCode === 422
    ) {
      if (isStatusReplay) {
        return suspendStatusReplay(publication, "destination_rejected_payload");
      }
      return savePublicationState(publication, {
        status: "failed",
        next_attempt_at: "",
        last_error: "destination_rejected_payload",
      });
    }
    return scheduleRetry(
      publication,
      response.statusCode === 429
        ? "destination_rate_limited"
        : "destination_unavailable",
    );
  } catch (err) {
    const code = safeDeliveryErrorCode(err);
    if (isStatusReplay) {
      return statusReplayErrorIsPermanent(code)
        ? suspendStatusReplay(publication, code)
        : scheduleRetry(publication, code);
    }
    const permanent =
      code === "payload_revision_conflict" ||
      code === "private_identifier_in_website_copy" ||
      code === "private_contact_in_website_copy" ||
      code === "website_mapping_conflict" ||
      code === "disclosures_exceed_destination_limit" ||
      code === "creative_media_too_large" ||
      code === "creative_media_type_unsupported" ||
      code === "image_review_required";
    if (permanent) {
      return savePublicationState(publication, {
        status: "failed",
        next_attempt_at: "",
        last_error: code,
      });
    }
    return scheduleRetry(publication, code);
  }
}

function claimDuePublication(publication) {
  const now = dbTimestamp(new Date().toISOString());
  const result = $app
    .dao()
    .db()
    .newQuery(
      "UPDATE website_publications " +
        "SET status = 'delivering', attempts = CASE " +
        "WHEN status IN ('queued', 'retrying') " +
        "THEN MIN(COALESCE(attempts, 0) + 1, 8) " +
        "ELSE COALESCE(attempts, 0) END, " +
        "last_attempt_at = {:now}, updated = {:now} " +
        "WHERE id = {:id} AND status IN ('queued', 'retrying', 'draft_ready') " +
        "AND (next_attempt_at = '' OR next_attempt_at IS NULL OR next_attempt_at <= {:now})",
    )
    .bind({ now: now, id: publication.id })
    .execute();
  if (!result || result.rowsAffected() !== 1) return null;
  return $app.dao().findRecordById("website_publications", publication.id);
}

function reconcileWaitingPublications(limit) {
  let rows = [];
  try {
    rows = $app
      .dao()
      .findRecordsByFilter(
        "website_publications",
        "status = 'waiting_approval'",
        "created",
        Math.min(Math.max(limit || 100, 1), 500),
        0,
        {},
      );
  } catch (_e) {
    return;
  }
  for (let i = 0; i < rows.length; i++)
    reconcilePublicationForPost(recordString(rows[i], "post"));
}

function recoverStaleDeliveries() {
  const cutoff = dbTimestamp(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  let rows = [];
  try {
    rows = $app
      .dao()
      .findRecordsByFilter(
        "website_publications",
        "status = 'delivering' && last_attempt_at != '' && last_attempt_at <= {:cutoff}",
        "last_attempt_at",
        100,
        0,
        { cutoff: cutoff },
      );
  } catch (_e) {
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const hasRemoteDraft = !!recordString(rows[i], "remote_draft_id");
    savePublicationState(rows[i], {
      status: hasRemoteDraft ? "draft_ready" : "retrying",
      next_attempt_at: new Date().toISOString(),
      last_error: hasRemoteDraft ? "status_check_interrupted" : "delivery_interrupted",
    });
  }
}

function processDuePublications(limit) {
  recoverStaleDeliveries();
  reconcileWaitingPublications(200);
  const max = Math.min(Math.max(limit || 10, 1), 25);
  const now = dbTimestamp(new Date().toISOString());
  let rows = [];
  try {
    const deliveryRows = $app
      .dao()
      .findRecordsByFilter(
        "website_publications",
        "(status = 'queued' || status = 'retrying') && " +
          "(next_attempt_at = '' || next_attempt_at <= {:now})",
        "next_attempt_at,created",
        max,
        0,
        { now: now },
      );
    const refreshRows = $app
      .dao()
      .findRecordsByFilter(
        "website_publications",
        "status = 'draft_ready' && " +
          "next_attempt_at != '' && next_attempt_at <= {:now}",
        "next_attempt_at,created",
        max,
        0,
        { now: now },
      );
    const refreshReserve = refreshRows.length ? Math.max(1, Math.floor(max / 4)) : 0;
    const deliveryTake = Math.min(deliveryRows.length, max - refreshReserve);
    rows = deliveryRows.slice(0, deliveryTake);
    const refreshTake = Math.min(refreshRows.length, max - rows.length);
    rows = rows.concat(refreshRows.slice(0, refreshTake));
    if (rows.length < max && deliveryRows.length > deliveryTake) {
      rows = rows.concat(
        deliveryRows.slice(deliveryTake, max - rows.length + deliveryTake),
      );
    }
  } catch (_e) {
    return { processed: 0 };
  }
  let processed = 0;
  for (let i = 0; i < rows.length; i++) {
    const claimed = claimDuePublication(rows[i]);
    if (!claimed) continue;
    deliverClaimedPublication(claimed);
    processed += 1;
  }
  return { processed: processed };
}

function retryPublication(post) {
  const publication = findPublicationForPost(post.id, "");
  // Retry is never an alternate enqueue path. A first handoff must carry the
  // exact post revision through claimPublicationForPost.
  if (!publication) throw new Error("website_request_not_sent");
  const currentStatus = recordString(publication, "status");
  if (currentStatus === "draft_ready") {
    if (recordString(publication, "last_error")) {
      return savePublicationState(publication, {
        next_attempt_at: new Date().toISOString(),
      });
    }
    throw new Error("website_draft_already_ready");
  }
  if (currentStatus === "published") {
    throw new Error("website_draft_already_ready");
  }
  if (currentStatus === "withdrawn") {
    throw new Error("website_request_withdrawn");
  }
  const readiness = postReadiness(post);
  if (readiness.terminal) throw new Error(readiness.code);
  const now = new Date().toISOString();
  const values = {
    status: readiness.ready ? "queued" : "waiting_approval",
    attempts: 0,
    next_attempt_at: readiness.ready ? now : "",
    last_attempt_at: "",
    delivered_at: "",
    remote_draft_id: "",
    review_url: "",
    last_error: readiness.ready ? "" : readiness.code,
  };
  if (readiness.ready) {
    values.payload_sent_at = payloadSentAtForFirstQueue(publication, now);
  }
  return savePublicationState(publication, values);
}

// Called only after the admin route validates its selected dealership. Test
// delivery uses the same outbox, current image policy, release and privacy gates.
function testWebsiteDraft(dealerId, postId, expectedRevision, actor) {
  if (!actor || (actor.role !== "super_admin" && actor.role !== "dealer_admin"))
    throw new Error("website_admin_required");
  if (actor.role !== "super_admin" && (!actor.dealer || actor.dealer.id !== dealerId))
    throw new Error("website_dealer_conflict");
  const dao = $app.dao();
  dao.findRecordById("dealers", dealerId);
  const post = dao.findRecordById("posts", postId);
  if (recordString(post, "dealer") !== dealerId)
    throw new Error("website_dealer_conflict");
  const config = destinationConfiguration(dealerId);
  if (!config.enabled || Number(expectedRevision) !== Number(config.revision))
    throw new Error("destination_configuration_changed");
  const readiness = postReadinessWithDao(dao, post);
  if (!readiness.ready) throw new Error(readiness.code);
  const claim = claimPublicationForPost(
    postId,
    recordString(post, "website_draft"),
    recordString(post, "updated"),
    dealerId,
  );
  let publication = claim.publication;
  if (recordString(publication, "status") !== "draft_ready") {
    // Preserve retries' payload, source and event identity; never enqueue another pipeline.
    const claimed = claimDuePublication(publication);
    if (claimed) publication = deliverClaimedPublication(claimed);
  }
  const current = destinationConfiguration(dealerId);
  const ready =
    publicationDestinationMatches(publication, current, dealerId) &&
    Number(current.revision) === Number(expectedRevision) &&
    recordString(publication, "status") === "draft_ready" &&
    !!recordString(publication, "delivered_at") &&
    !!recordString(publication, "remote_draft_id") &&
    !!safeReviewUrl(recordString(publication, "review_url"), current.siteUrl) &&
    /^[a-f0-9]{64}$/.test(recordString(publication, "payload_hash"));
  return {
    ready: ready,
    source: "website_draft_receipt",
    proofId: publication.id,
    configRevision: current.revision,
    configIdentity: current.identity,
    dealerId: dealerId,
    capabilities: ready ? ["website"] : [],
    status: ready ? "draft_ready" : "pending",
  };
}

module.exports = {
  base64EncodeReader,
  groundedIdentityPhrase,
  WEBSITE_DRAFT_SCHEMA_VERSION,
  WEBSITE_BODY_LIMITS,
  parseWebsiteDraft,
  resolveWebsiteMapping,
  websiteDraftMatchesScenario,
  destinationConfiguration,
  publicationDestinationMatches,
  testWebsiteDraft,
  publicDestinationConfiguration,
  publicationSummary,
  publicationSummaryForPost,
  publicationSummariesForDealer,
  findPublicationForPost,
  findPublicationForPostWithDao,
  findPublicationForPostWithDaoStrict,
  postReadiness,
  hasValidLinkedRelease,
  claimPublicationForPost,
  publicationEventIdForPostRevision,
  publicationEventRevisionMatches,
  publicationSourceSnapshotHash,
  verifyPublicationSourceSnapshot,
  reconcilePublicationForPost,
  processDuePublications,
  retryPublication,
  publicCustomerLabel,
  releaseAuthorizesPublicCustomerLabel,
  reviewPostCustomerIdentity,
  groundedVehicleIdentityPhrase,
  publicWebsiteDraftForPost,
  replaceProtectedCustomerName,
  containsVinLike,
  containsSensitiveContactText,
  containsUnexpectedCustomerIdentity,
  buildOutboundContent,
  base64EncodeBytes,
  hmacHeaders,
  payloadSentAtForFirstQueue,
  acceptedDestinationState,
  statusReplayResponseIsBound,
};
