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
  const siteUrl = normalizeSiteUrl(readEnvironment("CUSTOMER_HUB_URL"));
  const secret = readEnvironment("CUSTOMER_HUB_SECRET");
  const destinationId = readEnvironment("CUSTOMER_HUB_DESTINATION_ID");
  const allowedDealerId = readEnvironment("CUSTOMER_HUB_DEALER_ID");
  const destinationIdValid =
    destinationId === destinationId.trim() &&
    /^[a-z0-9][a-z0-9_-]{0,79}$/.test(destinationId);
  const secretValid =
    secret === secret.trim() && secret.length >= 32 && secret.length <= 512;
  const guardValid =
    !!allowedDealerId &&
    allowedDealerId === allowedDealerId.trim() &&
    /^[A-Za-z0-9_-]{1,64}$/.test(allowedDealerId);
  const enabled =
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
  if (record) return publicationSummary(record);
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

    const existing = findPublicationForPostWithDaoStrict(txDao, post.id, config.id);
    const storedDraft = parseWebsiteDraft(recordString(post, "website_draft"));
    if (existing) {
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
    const token = rawTokens[i].replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "");
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
    "(^|[^A-Za-zÀ-ÖØ-öø-ÿ])" + escapeRegExp(token) + "(['’]s)?(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ])",
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
  const clean = function (token) {
    return token.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "");
  };
  const first = clean(tokens[0]).slice(0, 40);
  if (!first) return "Customer";
  return first;
}

function replaceAllowedCustomerPhrase(text, phrase) {
  const normalized = (phrase || "").toString().trim().replace(/\s+/g, " ");
  if (!normalized) return text;
  return text.replace(
    new RegExp(
      "(^|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])" +
        escapeRegExp(normalized).replace(/ /g, "\\s+") +
        "(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])",
      "gi",
    ),
    "$1 Customer ",
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
].forEach(function (word) {
  IDENTITY_DETERMINER_ADJECTIVES[word] = true;
});

const IDENTITY_LETTER = "A-Za-zÀ-ÖØ-öø-ÿ";
const IDENTITY_UPPER = "A-ZÀ-ÖØ-Þ";
const IDENTITY_LOWER = "a-zà-öø-ÿ";
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
const IDENTITY_HEADLINE_TAIL = new RegExp(
  "^\\s*[,:–—-]+\\s*([" + IDENTITY_UPPER + "][" + IDENTITY_LETTER + "'’-]*)",
);
const IDENTITY_CAPITAL = new RegExp("^[" + IDENTITY_UPPER + "]");
const IDENTITY_DIGIT = /[0-9]/;
// Up to five lowercase words may sit between "to" and the person.
const IDENTITY_OPENER_LEAD_IN =
  "(?:\\s+[" + IDENTITY_LOWER + "][" + IDENTITY_LOWER + "'’-]*){0,5}?[,:]?";
const IDENTITY_HEADLINE_OPENERS =
  "[Ww]elcome\\s+home|[Ww]elcome\\s+to\\s+the\\s+family|[Nn]ew\\s+car\\s+day|[Dd]elivered|[Ss]old";
// A congratulation opener still governing the clause just before a match.
const IDENTITY_CONGRATULATION_OPENER =
  /\b(?:[Cc]ongratulations|[Cc]ongrats|[Cc]heers|[Ss]hout(?:-?out)?|[Tt]hanks|[Tt]hank\s+you|[Kk]udos|[Mm]eet|[Ww]elcome)\b[^.!?\n]*$/;

const IDENTITY_BARE_ACTION_INDEX = 2;
const IDENTITY_PROSE_INDEXES = [3, 5];

function stripIdentityPossessive(token) {
  return (token || "").toString().replace(/['’]s?$/, "");
}

function identityLower(token) {
  return stripIdentityPossessive(token).toLowerCase();
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

function identityPrecededByDeterminer(scan, tokenIndex, token, grounding) {
  let remaining = scan.slice(0, tokenIndex);
  let crossedUnknownCapital = false;
  let crossedAdjective = false;
  for (let hops = 0; hops <= 6; hops++) {
    const match = IDENTITY_PREVIOUS_WORD.exec(remaining);
    if (!match) return false;
    const raw = match[1];
    const word = identityLower(raw);
    const possessive =
      /['’]s?$/.test(raw) || /['’]s\s*$/.test(match[0].replace(/\s+$/, ""));
    if (word === "customer" && possessive) return true;
    if (IDENTITY_NOUN_DETERMINERS[word]) {
      return !(
        crossedUnknownCapital &&
        !crossedAdjective &&
        IDENTITY_PERSON_CAPABLE_DETERMINERS[word]
      );
    }
    if (word === "the") return !/['’]/.test(token) && !/s$/i.test(token);
    if (identityHasDigit(raw)) return true;
    const capitalized = IDENTITY_CAPITAL.test(raw);
    const knownVehicleWord =
      capitalized && (!!grounding.words[word] || isAutomotiveBrandToken(raw));
    if (capitalized && possessive && !knownVehicleWord) return false;
    const walkable =
      !!IDENTITY_DETERMINER_ADJECTIVES[word] ||
      /-/.test(raw) ||
      (capitalized && !IDENTITY_TRIGGER_WORDS[word]);
    if (!walkable) return false;
    if (IDENTITY_DETERMINER_ADJECTIVES[word]) crossedAdjective = true;
    if (capitalized && !knownVehicleWord && !IDENTITY_NON_CUSTOMER_WORDS[word]) {
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
    if (IDENTITY_NON_CUSTOMER_WORDS[lower]) break;
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

function identityDeliberateRunIsBusiness(scan, run, loneTokenAllowed) {
  if (run.endsWithPossessive) return true;
  const next = IDENTITY_FOLLOWING_WORD.exec(scan.slice(run.end));
  if (!next) return loneTokenAllowed || run.containsBrand;
  return !!IDENTITY_COLLECTIVE_FOLLOWERS[identityLower(next[1])];
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
    remaining = rest;
    if (!IDENTITY_CAPITAL.test(raw) || identityHasDigit(raw) || /-/.test(raw)) {
      afterBrand = false;
      continue;
    }
    if (IDENTITY_TRIGGER_WORDS[lower]) return null;
    if (isAutomotiveBrandToken(raw)) {
      afterBrand = true;
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
  const lower = identityLower(tail[1]);
  if (
    grounding.words[lower] ||
    IDENTITY_NON_CUSTOMER_WORDS[lower] ||
    IDENTITY_TRIGGER_WORDS[lower] ||
    isAutomotiveBrandToken(tail[1])
  ) {
    return null;
  }
  return stripIdentityPossessive(tail[1]);
}

function identityLeadInTargetIsThing(scan, tokenStart, tokenEnd, token) {
  const following = IDENTITY_FOLLOWING_WORD.exec(scan.slice(tokenEnd));
  const followingLower = following ? identityLower(following[1]) : "";
  if (following && IDENTITY_HANDOFF_CONNECTORS[followingLower]) return true;
  if (following && IDENTITY_CAPITAL.test(following[1])) return false;
  if (following && IDENTITY_COLLECTIVE_FOLLOWERS[followingLower]) return false;
  const the = /\bthe\s+$/.test(scan.slice(0, tokenStart));
  return the && !/['’]/.test(token) && !/s$/i.test(token);
}

function identityVehicleSlotPattern(patternIndex, matchText) {
  return (
    patternIndex === IDENTITY_BARE_ACTION_INDEX ||
    patternIndex === 7 ||
    patternIndex === 8 ||
    (patternIndex === 6 &&
      /^(?:[Dd]elivered|[Nn]ew\s+car\s+day|[Ss]old)/.test(matchText))
  );
}

/**
 * Mirror of unauthorizedCustomerNames() in utils/captionQuality.ts — same
 * patterns, same word lists, same walks, same order. Returns true when the
 * text names someone who is not the authorized customer.
 */
function containsUnexpectedCustomerIdentity(text, expectedCustomer, allowedPhrases) {
  const expected = publicCustomerLabel(expectedCustomer);
  // Every whitespace run collapses to one character, but a line break stays
  // a line break so a new sentence on the next line is a hard boundary.
  const rawScan = (text || "")
    .toString()
    .trim()
    .replace(/\s+/g, function (ws) {
      return ws.indexOf("\n") >= 0 ? "\n" : " ";
    });
  const allowed = normalizeAllowedIdentityPhrases(allowedPhrases);
  if (
    expected &&
    new RegExp(
      "(^|[^" +
        IDENTITY_LETTER +
        "0-9])" +
        escapeRegExp(expected) +
        "[" +
        IDENTITY_LETTER +
        "]+(?=$|[^" +
        IDENTITY_LETTER +
        "0-9])",
      "i",
    ).test(rawScan)
  ) {
    return true;
  }
  const name = IDENTITY_NAME_TOKEN;
  const separator = "(?:\\s+and\\s+|\\s*(?:&|\\+|/)\\s*)";
  const names = name + "(?:" + separator + name + ")*";
  // Participles only ("Sarah smiling beside her Bronco"). The finite forms
  // ("smiles", "stands", "pose") read as nouns in the captions the model
  // actually writes — "Big smiles today!", "All smiles!" — and every one of
  // those flagged the sentence-opening word as a customer. Kept identical to
  // utils/captionQuality.ts on the client (parity-tested).
  const directAction =
    "drove|drives|found|chose|chooses|picked|purchased|bought|is|are|was|were|has|have|got|went|left|joined|became|owns|loves|love|celebrated|celebrates|celebrate|shared|shares|takes|took|starts|started|received|receives|standing|posing|smiling";
  const action = directAction + "|just\\s+(?:" + directAction + ")";

  const grounding = buildIdentityGrounding(allowed);

  const patterns = [
    new RegExp(
      "\\b(?:[Cc]ongratulations|[Cc]ongrats|[Cc]heers|[Ss]hout(?:-?out)?|[Tt]hanks|[Tt]hank\\s+you|[Kk]udos)(?:\\s+again)?(?:\\s+to" +
        IDENTITY_OPENER_LEAD_IN +
        "|[,:]?)\\s+(" +
        names +
        ")",
      "g",
    ),
    new RegExp(
      "\\b(?:[Mm]eet|[Ww]elcoming|[Cc]elebrate(?:\\s+with)?|[Ww]elcome(?!\\s+(?:to|aboard)\\b))[,:]?\\s+(" +
        names +
        ")",
      "g",
    ),
    new RegExp("\\b(" + names + ")(?=\\s+(?:" + action + ")\\b)", "g"),
    new RegExp(
      "\\b(?:[Ff]or|[Ww]ith|[Ff]rom)\\s+(?:the\\s+)?(" +
        names +
        ")(?=(?:\\s+" +
        name +
        ")*(?:[,!.?]|\\s+(?:" +
        action +
        ")\\b))",
      "g",
    ),
    new RegExp(
      "\\b(?:[Hh]elping|[Ww]elcoming|[Tt]hanking|[Cc]ongratulating)\\s+(" + names + ")",
      "g",
    ),
    new RegExp(
      "\\b(?:[Ff]or|[Ww]ith|[Ff]rom)\\s+(?:the\\s+)?(" +
        names +
        ")(?=(?:\\s+" +
        name +
        ")*(?:$|[,!.?]|\\s+(?:at|during|today|this|on|after|before|who)\\b))",
      "g",
    ),
    new RegExp(
      "\\b(?:(?:" +
        IDENTITY_HEADLINE_OPENERS +
        ")(?:\\s+to" +
        IDENTITY_OPENER_LEAD_IN +
        "\\s+|[,:\\s–—-]+)|[Ww]elcome\\s+(?:aboard|to\\s+[^,:!\\n–—]{1,80}?)\\s*[,:–—-]+\\s*)(" +
        names +
        ")(?=$|[^" +
        IDENTITY_LETTER +
        "])",
      "g",
    ),
    new RegExp(
      "\\b(" +
        names +
        ")\\s*(?:[,!]|[–—-])\\s*(?:[Ww]elcome\\s+(?:home|aboard|to\\s+[^.!?\\n]{1,60})|[Nn]ew\\s+car\\s+day|[Dd]elivered|[Ss]old)\\b",
      "g",
    ),
    new RegExp(",\\s*(" + names + ")(?:\\s+" + name + ")*\\s*[!.?]*\\s*(?=$|\\n)", "g"),
  ];

  const evaluateCandidate = function (scan, token, tokenStart, tokenEnd, context) {
    const lower = identityLower(token);
    if (IDENTITY_NON_CUSTOMER_WORDS[lower]) return false;
    const isBareAction = context.patternIndex === IDENTITY_BARE_ACTION_INDEX;

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
        if (isBareAction) {
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
        if (identityDeliberateRunIsBusiness(scan, run, context.loneTokenAllowed)) {
          if (identityHandoffTargetAfter(scan, run, grounding)) return true;
          if (context.vehicleSlot && identityHeadlineTailAfter(scan, run, grounding)) {
            return true;
          }
          return false;
        }
        return true;
      }
      if (
        isBareAction &&
        identityPrecededByDeterminer(scan, tokenStart, token, grounding)
      ) {
        return false;
      }
      return true;
    }

    if (isBareAction) {
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

    if (
      context.viaLeadIn &&
      identityLeadInTargetIsThing(scan, tokenStart, tokenEnd, token)
    ) {
      return false;
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
          vehicleSlot: vehicleSlot,
          loneTokenAllowed:
            vehicleSlot ||
            patternIndex === 8 ||
            (/^[Ff]rom\b/.test(match[0]) &&
              !IDENTITY_CONGRATULATION_OPENER.test(scan.slice(0, match.index))),
          isNameList: /\s+and\s+|[&+/]/i.test(group),
          viaLeadIn:
            (patternIndex === 0 ||
              patternIndex === 3 ||
              patternIndex === 5 ||
              patternIndex === 6) &&
            /\bto\s+[a-zà-öø-ÿ]|\bthe\s+$/.test(opener),
        };
        const candidates = group.split(/\s+and\s+|\s*(?:&|\+|\/)\s*/i);
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
  let strictScan = rawScan;
  if (expected) strictScan = replaceAllowedCustomerPhrase(strictScan, expected);
  if (
    strictScan !== rawScan &&
    new RegExp(
      "\\bCustomer\\s+(?:[" +
        IDENTITY_UPPER +
        "][" +
        IDENTITY_LETTER +
        "'’-]{1,39}|[" +
        IDENTITY_UPPER +
        "]\\.)(?=$|[^" +
        IDENTITY_LETTER +
        "])",
    ).test(strictScan)
  ) {
    return true;
  }
  // A salesperson's name is masked only out of the generic "X is/has…" and
  // "for/with/from" prose scans. "Congratulations to <salesperson>" stays a
  // refusal.
  let looseScan = strictScan;
  for (let i = 0; i < allowed.length; i++) {
    if (allowed[i].grounded) continue;
    looseScan = replaceAllowedCustomerPhrase(looseScan, allowed[i].phrase);
  }

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
  const restorations = [];
  const allowed = normalizeAllowedIdentityPhrases(allowedPhrases);
  for (let i = 0; i < allowed.length; i++) {
    const phrase = allowed[i].phrase;
    protectedValue = protectedValue.replace(
      new RegExp(
        "(^|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])" +
          escapeRegExp(phrase) +
          "(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])",
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
          "(^|[^A-Za-zÀ-ÖØ-öø-ÿ])" +
            escapeRegExp(tokens[i]) +
            "(['’]s)(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ])",
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

function publicWebsiteDraftForPost(post, dealerName, oemAffiliation) {
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
  const review = reviewPostCustomerIdentity(
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

function buildOutboundContent(post, draft, media, dao) {
  const mapping = dao
    ? resolveWebsiteMappingForPostWithDao(dao, post)
    : resolveWebsiteMappingForPost(post);
  if (!mapping || draft.kind !== mapping.kind || draft.category !== mapping.category) {
    throw new Error("website_mapping_conflict");
  }
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

function publicationSourceSnapshotHash(post, draft, media, securityApi, dao) {
  const crypto = securityApi || $security;
  const sourceSnapshot = JSON.stringify({
    sourcePostId: post.id,
    sourceDealerId: recordString(post, "dealer"),
    content: buildOutboundContent(post, draft, media, dao),
  });
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
  const actual = publicationSourceSnapshotHash(post, draft, media, securityApi, dao);
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
    !config.enabled ||
    config.id !== recordString(publication, "destination_id") ||
    config.allowedDealerId !== recordString(post, "dealer")
  ) {
    return scheduleRetry(publication, "destination_unavailable");
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

    const response = $http.send({
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

module.exports = {
  groundedIdentityPhrase,
  WEBSITE_DRAFT_SCHEMA_VERSION,
  WEBSITE_BODY_LIMITS,
  parseWebsiteDraft,
  resolveWebsiteMapping,
  websiteDraftMatchesScenario,
  destinationConfiguration,
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
