/**
 * Customer Hub private-draft delivery.
 *
 * This module intentionally owns no route callbacks. PocketBase serializes
 * each callback into an isolated JSVM program, so routes/cron jobs require the
 * module inside their own callback and call these exported functions.
 */

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
  const normalized = (value || "").toString().trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const tokens = normalized.split(" ").filter(Boolean);
  const clean = function (token) {
    return token.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "");
  };
  const first = clean(tokens[0]).slice(0, 40);
  if (!first) return "Customer";
  if (tokens.length < 2) return first;
  const last = clean(tokens[tokens.length - 1]);
  return last ? first + " " + last.charAt(0).toUpperCase() + "." : first;
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

function buildOutboundContent(post, draft, media, dao) {
  const mapping = dao
    ? resolveWebsiteMappingForPostWithDao(dao, post)
    : resolveWebsiteMappingForPost(post);
  if (!mapping || draft.kind !== mapping.kind || draft.category !== mapping.category) {
    throw new Error("website_mapping_conflict");
  }
  const protectedName = recordString(post, "customer_name");
  const sanitizeMarketing = function (value) {
    return replaceProtectedCustomerName((value || "").toString(), protectedName);
  };
  const title = sanitizeMarketing(draft.title);
  const body = sanitizeMarketing(draft.body);
  const altText = sanitizeMarketing(draft.altText);
  const disclosures = recordString(post, "disclosures");
  let customerDisplayName = "";
  if (draft.customerDisplayName) {
    customerDisplayName = protectedName
      ? publicCustomerLabel(protectedName)
      : publicCustomerLabel(draft.customerDisplayName);
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

  if (disclosures.length > 2000)
    throw new Error("disclosures_exceed_destination_limit");
  if (
    containsProtectedName(disclosures, protectedName) ||
    containsProtectedFamilyReference(disclosures, protectedName) ||
    containsProtectedNonFirstNameToken(disclosures, protectedName) ||
    containsProtectedNonFirstNameToken(title, protectedName) ||
    containsProtectedNonFirstNameToken(body, protectedName) ||
    containsProtectedNonFirstNameToken(altText, protectedName) ||
    containsProtectedNonFirstNameToken(customerDisplayName, protectedName) ||
    containsProtectedNonFirstNameToken(vehicleDescription, protectedName) ||
    containsProtectedName(vehicleDescription, protectedName) ||
    containsProtectedFamilyReference(vehicleDescription, protectedName) ||
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
    .bind({ hash: bodyHash, updated: new Date().toISOString(), id: publication.id })
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
      code === "creative_media_type_unsupported";
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
  const now = new Date().toISOString();
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
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
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
  const now = new Date().toISOString();
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
  claimPublicationForPost,
  publicationEventIdForPostRevision,
  publicationEventRevisionMatches,
  publicationSourceSnapshotHash,
  verifyPublicationSourceSnapshot,
  reconcilePublicationForPost,
  processDuePublications,
  retryPublication,
  publicCustomerLabel,
  replaceProtectedCustomerName,
  containsVinLike,
  containsSensitiveContactText,
  buildOutboundContent,
  base64EncodeBytes,
  hmacHeaders,
  payloadSentAtForFirstQueue,
  acceptedDestinationState,
  statusReplayResponseIsBound,
};
