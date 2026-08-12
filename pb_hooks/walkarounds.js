const MAX_CLIPS = 12;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_TOTAL_DURATION_MS = 20 * 60 * 1000;
const RELEASE_VERSION = "walkaround-v1";
const MIME_TYPES = ["video/quicktime", "video/mp4", "video/webm"];
const PRODUCTION_STATES = [
  "draft",
  "uploading",
  "uploaded",
  "queued",
  "analyzing",
  "rendering",
  "audio_polish",
  "quality_check",
  "review_ready",
  "retryable_failed",
  "terminal_failed",
  "cancelled",
  "deleting",
  "deleted",
];
const PUBLICATION_STATES = [
  "not_requested",
  "uploading_private",
  "processing",
  "publishing",
  "published_unlisted",
  "published_public",
  "reconciliation_required",
  "failed",
];

function cleanString(value, max, required) {
  if (typeof value !== "string") return required ? null : "";
  const result = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !result) || result.length > max) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) return null;
  return result;
}

function integer(value, min, max) {
  const result = Number(value);
  return Number.isInteger(result) && result >= min && result <= max ? result : null;
}

function jsonObject(value, maxLength) {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > maxLength) return null;
    try {
      parsed = JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const serialized = JSON.stringify(parsed);
  return serialized.length <= maxLength
    ? { value: parsed, serialized: serialized }
    : null;
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse((raw || "").toString());
  } catch (_e) {
    return fallback;
  }
}

function bool(record, field) {
  try {
    return record.getBool ? !!record.getBool(field) : !!record.get(field);
  } catch (_e) {
    return false;
  }
}

function now() {
  return new Date().toISOString();
}

function isManager(context) {
  return (
    !!context && (context.role === "dealer_admin" || context.role === "super_admin")
  );
}

function featureEnabled() {
  try {
    return (
      ($os.getenv("WALKAROUND_STUDIO_ENABLED") || "")
        .toString()
        .trim()
        .toLowerCase() === "true"
    );
  } catch (_e) {
    return false;
  }
}

function contextOrResponse(c, helpers) {
  if (!featureEnabled()) {
    c.json(503, {
      error: "Vehicle Walkaround Studio is not enabled",
      code: "FEATURE_DISABLED",
    });
    return null;
  }
  // Single choke point for every walkaround app route. Same in-process bucket
  // semantics as /api/proxy/*.
  try {
    const rate = helpers.checkProxyRateLimit(
      "walkaround-app:" + helpers.clientIP(c),
      120,
      60 * 1000,
    );
    if (!rate.ok) {
      try {
        helpers.logCoalescedAuthEvent(
          "walkaround_rate_limited",
          {
            ip: helpers.clientIP(c),
            userAgent: helpers.userAgent(c),
            detail: "app route window exceeded",
          },
          15 * 60,
          30,
        );
      } catch (_e) {}
      c.json(429, {
        error: "Too many requests",
        retry_after_seconds: Math.ceil((rate.retryAfterMs || 1000) / 1000),
      });
      return null;
    }
  } catch (_e) {}
  const context = helpers.sessionContext(c);
  if (!context || !context.person || bool(context.dealer, "is_system")) {
    c.json(401, { error: "No active dealer person session" });
    return null;
  }
  return context;
}

/**
 * Tighter per-dealer window for the routes that authorize real spend
 * (project creation → 10 GB of signed uploads; processing → a Temporal
 * workflow with Vertex/Shotstack/Auphonic cost). Returns true when allowed.
 */
function dealerActionAllowed(c, helpers, context, action, maxPerHour) {
  try {
    const dealerId =
      context && context.dealer && context.dealer.id
        ? context.dealer.id.toString()
        : "unknown";
    const rate = helpers.checkProxyRateLimit(
      "walkaround-" + action + ":" + dealerId,
      maxPerHour,
      60 * 60 * 1000,
    );
    if (!rate.ok) {
      c.json(429, {
        error:
          "This dealership has reached its hourly walkaround " +
          action +
          " limit. Try again later.",
        retry_after_seconds: Math.ceil((rate.retryAfterMs || 1000) / 1000),
      });
      return false;
    }
  } catch (_e) {}
  return true;
}

function projectForContext(c, helpers, options) {
  const context = contextOrResponse(c, helpers);
  if (!context) return null;
  let project = null;
  try {
    project = $app.dao().findRecordById("walkaround_projects", c.pathParam("id"));
  } catch (_e) {
    c.json(404, { error: "Walkaround not found" });
    return null;
  }
  if (
    project.getString("dealer") !== context.dealer.id ||
    project.getString("production_state") === "deleted"
  ) {
    c.json(404, { error: "Walkaround not found" });
    return null;
  }
  if (!isManager(context) && project.getString("owner_person") !== context.person.id) {
    c.json(404, { error: "Walkaround not found" });
    return null;
  }
  if (options && options.manager && !isManager(context)) {
    c.json(403, { error: "Manager access required" });
    return null;
  }
  return { context: context, project: project };
}

function audit(dao, project, person, action, result, revision, detailCode) {
  const collection = dao.findCollectionByNameOrId("walkaround_audit_events");
  const event = new Record(collection);
  event.set("project", project ? project.id : "");
  event.set("dealer", project ? project.getString("dealer") : "");
  event.set("actor_person", person ? person.id : "");
  event.set("action", action);
  event.set("result", result);
  event.set("revision", revision || 0);
  event.set("detail_code", detailCode || "");
  dao.saveRecord(event);
}

function sourcesForProject(dao, projectId) {
  return dao.findRecordsByFilter(
    "walkaround_assets",
    "project = {:project} && kind = 'source' && state != 'deleted'",
    "+clip_order",
    MAX_CLIPS + 1,
    0,
    { project: projectId },
  );
}

function totalSourceMetrics(records) {
  let bytes = 0;
  let duration = 0;
  for (let i = 0; i < records.length; i++) {
    bytes += Number(records[i].get("size_bytes") || 0);
    duration += Number(records[i].get("duration_ms") || 0);
  }
  return { bytes: bytes, durationMs: duration };
}

function serializeAsset(asset, includeUpload) {
  const result = {
    id: asset.id,
    kind: asset.getString("kind"),
    order: Number(asset.get("clip_order") || 0),
    state: asset.getString("state"),
    filename: asset.getString("original_filename"),
    lastModified: Number(asset.get("original_last_modified_ms") || 0),
    mime: asset.getString("verified_mime") || asset.getString("declared_mime"),
    sizeBytes: Number(asset.get("size_bytes") || 0),
    durationMs: Number(asset.get("duration_ms") || 0),
    sha256: asset.getString("sha256"),
  };
  // Resumable URLs are bearer credentials and are never persisted or returned
  // through project status. The authenticated uploads endpoint reissues one
  // from the opaque broker reference when resumeAssetId is supplied.
  return result;
}

function serializeProject(project, dao, includeUpload) {
  const assets = dao.findRecordsByFilter(
    "walkaround_assets",
    "project = {:project} && state != 'deleted'",
    "+clip_order,+created",
    50,
    0,
    { project: project.id },
  );
  let publication = null;
  try {
    publication = dao.findFirstRecordByFilter(
      "walkaround_publications",
      "project = {:project}",
      { project: project.id },
    );
  } catch (_e) {}
  const readyAsset = (kind) => {
    for (let index = assets.length - 1; index >= 0; index--) {
      const asset = assets[index];
      if (asset.getString("kind") !== kind || asset.getString("state") !== "ready")
        continue;
      if (
        kind === "master" &&
        project.getString("master_sha256") &&
        asset.getString("sha256") !== project.getString("master_sha256")
      )
        continue;
      return asset;
    }
    return null;
  };
  const master = readyAsset("master"),
    teaser = readyAsset("teaser"),
    thumbnail = readyAsset("thumbnail");
  const youtube = youtubeConnection(dao, project.getString("dealer"));
  const revision = Number(project.get("metadata_revision") || 1);
  const storedMetadata = safeJson(project.getString("metadata_json"), null);
  const clientMetadata = storedMetadata
    ? Object.assign({}, storedMetadata, {
        thumbnailText:
          storedMetadata.thumbnailText || storedMetadata.thumbnailCopy || "",
        captionsText:
          project.getString("captions_text") || storedMetadata.captionsText || "",
        chapters: Array.isArray(storedMetadata.chapters)
          ? storedMetadata.chapters.map((chapter) => ({
              seconds: Number(chapter.seconds ?? chapter.atSeconds ?? 0),
              label: (chapter.label || chapter.title || "").toString(),
            }))
          : [],
      })
    : null;
  const approved =
    !!project.getString("approved_at") &&
    project.getString("approved_master_sha256") ===
      project.getString("master_sha256") &&
    Number(project.get("approved_metadata_revision") || 0) === revision;
  const result = {
    id: project.id,
    audience: project.getString("audience_mode"),
    audienceMode: project.getString("audience_mode"),
    captureMode: project.getString("capture_mode"),
    scenarioId: project.getString("scenario_id"),
    vehicleSnapshot: safeJson(project.getString("vehicle_snapshot"), {}),
    containsIdentifiableNonEmployee: bool(
      project,
      "contains_identifiable_non_employee",
    ),
    productionState: project.getString("production_state"),
    publicationState: project.getString("publication_state"),
    reviewRevision: revision,
    metadataRevision: revision,
    metadata: clientMetadata,
    qcPassed: bool(project, "qc_passed"),
    qcSummary: safeJson(project.getString("qc_summary"), null),
    approvalRequired: bool(
      dao.findRecordById("dealers", project.getString("dealer")),
      "requires_approval",
    ),
    approved: approved,
    approvedRevision: approved
      ? Number(project.get("approved_metadata_revision") || 0)
      : null,
    reviewedRevision:
      project.getString("reviewed_master_sha256") === project.getString("master_sha256")
        ? Number(project.get("reviewed_metadata_revision") || 0) || null
        : null,
    masterSha256: project.getString("master_sha256") || null,
    releaseValid: validRelease(dao, project),
    youtubeChannel: youtube
      ? { connected: true, channelTitle: youtube.getString("channel_title") }
      : { connected: false },
    availabilityAttestedAt: project.getString("availability_attested_at") || null,
    assets: assets.map((asset) => serializeAsset(asset, includeUpload)),
    publication: publication
      ? {
          videoId: publication.getString("video_id") || null,
          visibility: publication.getString("actual_visibility") || "private",
          playbackVerified: !!publication.getString("playback_verified_at"),
          shareUrl: publication.getString("playback_verified_at")
            ? publication.getString("share_url") || null
            : null,
        }
      : null,
    failureCode: project.getString("failure_code") || null,
    editInstructions: project.getString("edit_instructions") || "",
    captionsText: project.getString("captions_text") || "",
    created: project.getString("created"),
    updated: project.getString("updated"),
  };
  if (master)
    result.masterPreviewUrl =
      "/api/app/walkarounds/" + project.id + "/assets/master/preview";
  if (teaser)
    result.teaserPreviewUrl =
      "/api/app/walkarounds/" + project.id + "/assets/teaser/preview";
  if (thumbnail)
    result.thumbnailUrl =
      "/api/app/walkarounds/" + project.id + "/assets/thumbnail/preview";
  return result;
}

function uploadBrokerConfig() {
  let base = "";
  let token = "";
  try {
    base = ($os.getenv("WALKAROUND_UPLOAD_BROKER_URL") || "")
      .toString()
      .trim()
      .replace(/\/+$/, "");
    token = ($os.getenv("WALKAROUND_UPLOAD_BROKER_TOKEN") || "").toString();
  } catch (_e) {
    return null;
  }
  if (
    !/^https:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[^?#]*)?$/.test(base) ||
    token.length < 32 ||
    token !== token.trim()
  )
    return null;
  return { base: base, token: token };
}

function youtubeBrokerConfig() {
  let base = "",
    token = "";
  try {
    base = ($os.getenv("WALKAROUND_YOUTUBE_BROKER_URL") || "")
      .toString()
      .trim()
      .replace(/\/+$/, "");
    token = ($os.getenv("WALKAROUND_YOUTUBE_BROKER_TOKEN") || "").toString();
  } catch (_e) {
    return null;
  }
  if (
    !/^https:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[^?#]*)?$/.test(base) ||
    token.length < 32 ||
    token !== token.trim()
  )
    return null;
  return { base: base, token: token };
}

function brokerRequest(config, path, payload, idempotencyKey) {
  const response = $http.send({
    url: config.base + path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.token,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    timeout: 30,
  });
  if (!response || response.statusCode < 200 || response.statusCode >= 300)
    throw new Error("UPLOAD_BROKER_UNAVAILABLE");
  return typeof response.json === "object" && response.json
    ? response.json
    : safeJson(response.raw, null);
}

function sanitizedUploadHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  const allowed = ["content-type", "content-range", "x-goog-resumable"];
  Object.keys(value).forEach((key) => {
    if (allowed.indexOf(key.toLowerCase()) === -1) return;
    const header = cleanString((value[key] || "").toString(), 300, true);
    if (header) result[key] = header;
  });
  return result;
}

function createProject(c, helpers) {
  const context = contextOrResponse(c, helpers);
  if (!context) return;
  const body = $apis.requestInfo(c).data || {};
  const audience = body.audience || body.audienceMode || body.audience_mode;
  if (audience !== "customer" && audience !== "inventory")
    return c.json(400, { error: "audienceMode must be customer or inventory" });
  const scenario = cleanString(
    (body.scenarioId || body.scenario_id || "new_arrival").toString(),
    80,
    true,
  );
  if (!scenario || !/^[a-z0-9][a-z0-9_-]*$/.test(scenario))
    return c.json(400, { error: "Invalid scenarioId" });
  const snapshot = jsonObject(body.vehicleSnapshot || body.vehicle_snapshot, 24000);
  if (!snapshot) return c.json(400, { error: "vehicleSnapshot is required" });
  let captureMode = body.captureMode || body.capture_mode || "multi_clip";
  if (captureMode === "continuous") captureMode = "one_take";
  if (captureMode === "clips") captureMode = "multi_clip";
  if (captureMode !== "one_take" && captureMode !== "multi_clip")
    return c.json(400, { error: "captureMode must be one_take or multi_clip" });
  const token = helpers.readSessionToken(c);
  const ownerHash = token ? helpers.hashSessionToken(token) : "";
  if (!ownerHash) return c.json(401, { error: "No active session" });
  // Charge the shared dealer quota only for a request that will be accepted:
  // malformed submissions must not be able to exhaust the store's hourly
  // budget (per-IP throttling in contextOrResponse covers abuse).
  if (!dealerActionAllowed(c, helpers, context, "creation", 12)) return;
  const collection = $app.dao().findCollectionByNameOrId("walkaround_projects");
  const project = new Record(collection);
  project.set("dealer", context.dealer.id);
  project.set("owner_person", context.person.id);
  project.set("owner_session_hash", ownerHash);
  project.set("audience_mode", audience);
  project.set("capture_mode", captureMode);
  project.set("scenario_id", scenario);
  project.set("vehicle_snapshot", snapshot.serialized);
  project.set(
    "contains_identifiable_non_employee",
    !!(body.containsIdentifiableNonEmployee || body.contains_identifiable_non_employee),
  );
  project.set("production_state", "draft");
  project.set("publication_state", "not_requested");
  project.set("metadata_revision", 1);
  project.set("metadata_validated_revision", 0);
  project.set("qc_passed", false);
  $app.dao().saveRecord(project);
  audit($app.dao(), project, context.person, "project_created", "accepted", 1, "");
  c.response().header().set("Cache-Control", "private, no-store");
  const response = serializeProject(project, $app.dao(), false);
  response.canApprove = isManager(context);
  return c.json(201, response);
}

function createUpload(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const project = authorized.project;
  if (["draft", "uploading"].indexOf(project.getString("production_state")) === -1)
    return c.json(409, { error: "Uploads are closed for this project" });
  const config = uploadBrokerConfig();
  if (!config)
    return c.json(503, {
      error: "Walkaround private upload service is not configured",
      code: "UPLOAD_SERVICE_UNAVAILABLE",
    });
  const body = $apis.requestInfo(c).data || {};
  const resumeAssetId = cleanString(
    (body.resumeAssetId || body.resume_asset_id || "").toString(),
    64,
    false,
  );
  if (resumeAssetId) {
    let resumeAsset = null;
    try {
      resumeAsset = $app.dao().findRecordById("walkaround_assets", resumeAssetId);
    } catch (_e) {}
    if (
      !resumeAsset ||
      resumeAsset.getString("project") !== project.id ||
      resumeAsset.getString("dealer") !== authorized.context.dealer.id ||
      resumeAsset.getString("kind") !== "source" ||
      !resumeAsset.getString("upload_session_reference") ||
      ["uploading", "pending_upload"].indexOf(resumeAsset.getString("state")) === -1
    )
      return c.json(404, { error: "Resumable upload not found" });
    let resumed = null;
    try {
      resumed = brokerRequest(
        config,
        "/v1/resumable-upload-sessions/resume",
        {
          projectId: project.id,
          assetId: resumeAsset.id,
          sessionReference: resumeAsset.getString("upload_session_reference"),
          objectKey: resumeAsset.getString("storage_key"),
        },
        "gcs-resume:" +
          resumeAsset.id +
          ":" +
          Number(resumeAsset.get("upload_offset") || 0),
      );
    } catch (_e) {
      return c.json(503, {
        error: "Private upload session could not be resumed",
        code: "UPLOAD_SERVICE_UNAVAILABLE",
      });
    }
    const resumedUrl = cleanString(resumed && resumed.url, 4096, true),
      resumedExpiry = cleanString(resumed && resumed.expiresAt, 80, true);
    if (!resumedUrl || !/^https:\/\//.test(resumedUrl) || !resumedExpiry)
      return c.json(503, {
        error: "Private upload session could not be resumed",
        code: "UPLOAD_SERVICE_UNAVAILABLE",
      });
    const resumedOffset = integer(resumed.offset || 0, 0, MAX_TOTAL_BYTES) || 0;
    resumeAsset.set("upload_offset", resumedOffset);
    resumeAsset.set("upload_session_expires_at", resumedExpiry);
    $app.dao().saveRecord(resumeAsset);
    return c.json(200, {
      assetId: resumeAsset.id,
      sessionUrl: resumedUrl,
      url: resumedUrl,
      method: "PUT",
      headers: sanitizedUploadHeaders(resumed.headers),
      offset: resumedOffset,
      expiry: resumedExpiry,
      expiresAt: resumedExpiry,
    });
  }
  const filename = cleanString((body.filename || "").toString(), 180, true);
  let mime = (body.mime || body.contentType || "").toString();
  if (!mime && filename) {
    if (/\.mov$/i.test(filename)) mime = "video/quicktime";
    else if (/\.mp4$/i.test(filename)) mime = "video/mp4";
    else if (/\.webm$/i.test(filename)) mime = "video/webm";
  }
  const size = integer(
    body.sizeBytes === undefined ? body.size_bytes : body.sizeBytes,
    1,
    MAX_TOTAL_BYTES,
  );
  const duration = integer(
    body.durationMs === undefined ? body.duration_ms : body.durationMs,
    1,
    MAX_TOTAL_DURATION_MS,
  );
  const lastModified = integer(
    body.lastModified === undefined ? 0 : body.lastModified,
    0,
    4102444800000,
  );
  if (
    !filename ||
    MIME_TYPES.indexOf(mime) === -1 ||
    size === null ||
    duration === null ||
    lastModified === null
  )
    return c.json(400, { error: "Invalid video upload metadata" });
  const sources = sourcesForProject($app.dao(), project.id);
  const requestedOrder = integer(
    body.order === undefined ? sources.length : body.order,
    0,
    MAX_CLIPS - 1,
  );
  if (requestedOrder === null || requestedOrder !== sources.length)
    return c.json(409, { error: "Clip order must be contiguous and zero-based" });
  const clipLimit = project.getString("capture_mode") === "one_take" ? 1 : MAX_CLIPS;
  if (sources.length >= clipLimit)
    return c.json(409, {
      error:
        clipLimit === 1
          ? "One-take mode supports one clip"
          : "A walkaround supports at most 12 clips",
    });
  const totals = totalSourceMetrics(sources);
  if (
    totals.bytes + size > MAX_TOTAL_BYTES ||
    totals.durationMs + duration > MAX_TOTAL_DURATION_MS
  )
    return c.json(413, { error: "Walkaround exceeds the 10 GB or 20 minute limit" });
  const collection = $app.dao().findCollectionByNameOrId("walkaround_assets");
  const asset = new Record(collection);
  asset.set("project", project.id);
  asset.set("dealer", project.getString("dealer"));
  asset.set("kind", "source");
  asset.set("clip_order", requestedOrder);
  asset.set("state", "pending_upload");
  asset.set("original_filename", filename);
  asset.set("original_last_modified_ms", lastModified);
  asset.set("declared_mime", mime);
  asset.set("size_bytes", size);
  asset.set("duration_ms", duration);
  asset.set("upload_offset", 0);
  asset.set(
    "storage_key",
    "walkarounds/" +
      project.getString("dealer") +
      "/" +
      project.id +
      "/sources/" +
      asset.id,
  );
  $app.dao().saveRecord(asset);
  const requestKey = "gcs-upload:" + asset.id;
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/resumable-upload-sessions",
      {
        projectId: project.id,
        assetId: asset.id,
        dealerId: project.getString("dealer"),
        objectKey: asset.getString("storage_key"),
        contentType: mime,
        sizeBytes: size,
      },
      requestKey,
    );
    const url = cleanString(result && result.url, 4096, true);
    const sessionReference = cleanString(result && result.sessionReference, 256, true);
    const expiresAt = cleanString(result && result.expiresAt, 80, true);
    const headers = sanitizedUploadHeaders(result && result.headers);
    if (
      !url ||
      !/^https:\/\//.test(url) ||
      !sessionReference ||
      !/^[A-Za-z0-9:._/-]+$/.test(sessionReference) ||
      !expiresAt ||
      JSON.stringify(headers).length > 8000
    )
      throw new Error("UPLOAD_BROKER_INVALID_RESPONSE");
    asset.set("upload_session_reference", sessionReference);
    asset.set("upload_session_expires_at", expiresAt);
    asset.set("upload_offset", integer(result.offset || 0, 0, MAX_TOTAL_BYTES) || 0);
    asset.set("state", "uploading");
    $app.dao().saveRecord(asset);
    project.set("production_state", "uploading");
    $app.dao().saveRecord(project);
  } catch (_e) {
    try {
      asset.set("state", "deleted");
      asset.set("upload_session_reference", "");
      $app.dao().saveRecord(asset);
      enqueueTask(
        $app.dao(),
        project,
        "delete_objects",
        "walkaround-upload-failed:" + asset.id,
        {
          projectId: project.id,
          workflowId: "walkaround-upload-failed-" + asset.id,
          expectedRevision: Number(project.get("metadata_revision") || 1),
          assetId: asset.id,
        },
      );
    } catch (_cleanupError) {}
    return c.json(503, {
      error: "Private upload session could not be created",
      code: "UPLOAD_SERVICE_UNAVAILABLE",
    });
  }
  c.response().header().set("Cache-Control", "private, no-store");
  return c.json(201, {
    assetId: asset.id,
    sessionUrl: result.url,
    url: result.url,
    method: "PUT",
    headers: sanitizedUploadHeaders(result.headers),
    offset: Number(asset.get("upload_offset") || 0),
    expiry: asset.getString("upload_session_expires_at"),
    expiresAt: asset.getString("upload_session_expires_at"),
  });
}

function finalizeUpload(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const config = uploadBrokerConfig();
  if (!config)
    return c.json(503, {
      error: "Walkaround private upload service is not configured",
      code: "UPLOAD_SERVICE_UNAVAILABLE",
    });
  let asset = null;
  try {
    asset = $app.dao().findRecordById("walkaround_assets", c.pathParam("assetId"));
  } catch (_e) {}
  if (
    !asset ||
    asset.getString("project") !== authorized.project.id ||
    asset.getString("dealer") !== authorized.context.dealer.id ||
    asset.getString("kind") !== "source"
  )
    return c.json(404, { error: "Upload not found" });
  if (asset.getString("state") === "verified")
    return c.json(200, { asset: serializeAsset(asset, false), idempotentReplay: true });
  let verified = null;
  try {
    verified = brokerRequest(
      config,
      "/v1/resumable-upload-sessions/verify",
      {
        projectId: authorized.project.id,
        assetId: asset.id,
        objectKey: asset.getString("storage_key"),
      },
      "gcs-finalize:" + asset.id,
    );
  } catch (_e) {
    return c.json(503, {
      error: "Uploaded object could not be verified",
      code: "UPLOAD_VERIFICATION_UNAVAILABLE",
    });
  }
  const mime = cleanString(verified && verified.mime, 80, true);
  const size = integer(verified && verified.sizeBytes, 1, MAX_TOTAL_BYTES);
  const duration = integer(verified && verified.durationMs, 1, MAX_TOTAL_DURATION_MS);
  const sha = cleanString(verified && verified.sha256, 64, true);
  const generation = cleanString(verified && verified.generation, 80, true);
  if (
    MIME_TYPES.indexOf(mime) === -1 ||
    size === null ||
    duration === null ||
    !sha ||
    !/^[a-f0-9]{64}$/.test(sha) ||
    !generation
  )
    return c.json(422, { error: "Uploaded object failed media verification" });
  const other = sourcesForProject($app.dao(), authorized.project.id).filter(
    (row) => row.id !== asset.id,
  );
  const totals = totalSourceMetrics(other);
  if (
    totals.bytes + size > MAX_TOTAL_BYTES ||
    totals.durationMs + duration > MAX_TOTAL_DURATION_MS
  )
    return c.json(413, { error: "Walkaround exceeds the 10 GB or 20 minute limit" });
  asset.set("verified_mime", mime);
  asset.set("size_bytes", size);
  asset.set("duration_ms", duration);
  asset.set("sha256", sha);
  asset.set("storage_generation", generation);
  asset.set("state", "verified");
  asset.set("upload_session_reference", "");
  $app.dao().saveRecord(asset);
  const all = sourcesForProject($app.dao(), authorized.project.id);
  if (all.length && all.every((row) => row.getString("state") === "verified")) {
    authorized.project.set("production_state", "uploaded");
    $app.dao().saveRecord(authorized.project);
  }
  return c.json(200, {
    asset: serializeAsset(asset, false),
    project: serializeProject(authorized.project, $app.dao(), false),
  });
}

function saveRelease(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const body = $apis.requestInfo(c).data || {};
  const signedName = cleanString(
    (body.signedName || body.signed_name || "").toString(),
    120,
    true,
  );
  const version = cleanString(
    (body.consentVersion || body.consent_version || "").toString(),
    40,
    true,
  );
  const signatureData = (
    body.signaturePngDataUrl ||
    body.signature_png_data_url ||
    ""
  ).toString();
  const signatureMatch = signatureData.match(
    /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (
    !signedName ||
    version !== RELEASE_VERSION ||
    body.videoConsent !== true ||
    body.voiceConsent !== true ||
    body.cloudProcessingConsent !== true ||
    body.youtubeConsent !== true ||
    !signatureMatch ||
    signatureData.length > 700000
  )
    return c.json(400, {
      error:
        "Complete signed video, voice, cloud-processing, and YouTube consent is required",
    });
  let signatureFile = null;
  try {
    const bytes = $security.base64Decode(signatureMatch[1]);
    if (
      !bytes ||
      bytes.length < 8 ||
      bytes.length > 512000 ||
      bytes.charCodeAt(0) !== 0x89 ||
      bytes.slice(1, 4) !== "PNG"
    )
      throw new Error("invalid_png");
    signatureFile = $filesystem.fileFromBytes(bytes, "walkaround-release.png");
  } catch (_e) {
    return c.json(400, { error: "Signature must be a valid PNG image" });
  }
  const token = helpers.readSessionToken(c);
  const ownerHash = token ? helpers.hashSessionToken(token) : "";
  if (!ownerHash) return c.json(401, { error: "No active session" });
  const collection = $app.dao().findCollectionByNameOrId("walkaround_releases");
  const release = new Record(collection);
  const form = new RecordUpsertForm($app, release);
  form.setFullManageAccess(true);
  form.loadData({
    project: authorized.project.id,
    dealer: authorized.context.dealer.id,
    captured_by: authorized.context.person.id,
    owner_session_hash: ownerHash,
    consent_version: version,
    signed_name: signedName,
    video_consent: true,
    voice_consent: true,
    cloud_processing_consent: true,
    youtube_consent: true,
    signed_at: now(),
  });
  form.addFiles("signature_png", signatureFile);
  form.submit();
  audit(
    $app.dao(),
    authorized.project,
    authorized.context.person,
    "release_captured",
    "accepted",
    Number(authorized.project.get("metadata_revision") || 1),
    "",
  );
  return c.json(201, {
    id: release.id,
    consentVersion: version,
    signedAt: release.getString("signed_at"),
  });
}

function validRelease(dao, project) {
  // A customer-audience capture always requires a signed release. The
  // self-attested `contains_identifiable_non_employee` flag comes from the
  // client at creation and is never re-derived, so it can only ever ADD a
  // release requirement — never waive the one the audience implies.
  const requiresRelease =
    project.getString("audience_mode") === "customer" ||
    bool(project, "contains_identifiable_non_employee");
  if (!requiresRelease) return true;
  try {
    const release = dao.findFirstRecordByFilter(
      "walkaround_releases",
      "project = {:project} && revoked_at = ''",
      { project: project.id },
    );
    return (
      !!release.getString("signature_png") &&
      release.getString("consent_version") === RELEASE_VERSION &&
      bool(release, "video_consent") &&
      bool(release, "voice_consent") &&
      bool(release, "cloud_processing_consent") &&
      bool(release, "youtube_consent")
    );
  } catch (_e) {
    return false;
  }
}

function enqueueTask(dao, project, kind, key, payload) {
  try {
    return dao.findFirstRecordByFilter(
      "walkaround_worker_tasks",
      "idempotency_key = {:key}",
      { key: key },
    );
  } catch (_e) {}
  const task = new Record(dao.findCollectionByNameOrId("walkaround_worker_tasks"));
  task.set("project", project.id);
  task.set("dealer", project.getString("dealer"));
  task.set("kind", kind);
  task.set("idempotency_key", key);
  task.set("payload", JSON.stringify(payload));
  task.set("status", "queued");
  task.set("attempts", 0);
  dao.saveRecord(task);
  return task;
}

function processProject(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const project = authorized.project;
  if (
    ["uploaded", "retryable_failed"].indexOf(project.getString("production_state")) ===
    -1
  )
    return c.json(409, { error: "Project is not ready to process" });
  if (
    project.getString("production_state") === "retryable_failed" &&
    /(AMBIGUOUS|RECONCILIATION)/.test(project.getString("failure_code"))
  )
    return c.json(409, {
      error: "An ambiguous provider operation must be reconciled before retry",
      code: "PROVIDER_RECONCILIATION_REQUIRED",
    });
  if (project.getString("failure_code") === "REVIEW_VALIDATION_FAILED")
    return c.json(409, {
      error: "Revise and save the review metadata instead of rerendering the video",
      code: "REVIEW_REVISION_REQUIRED",
    });
  const sources = sourcesForProject($app.dao(), project.id);
  const totals = totalSourceMetrics(sources);
  if (
    !sources.length ||
    sources.length > MAX_CLIPS ||
    !sources.every((row) => row.getString("state") === "verified") ||
    totals.bytes > MAX_TOTAL_BYTES ||
    totals.durationMs > MAX_TOTAL_DURATION_MS
  )
    return c.json(409, {
      error: "All source clips must be verified before processing",
    });
  if (!validRelease($app.dao(), project))
    return c.json(409, {
      error: "Required walkaround release is missing",
      code: "CONSENT_REQUIRED",
    });
  // Every eligibility gate has passed — only now does the attempt count
  // against the dealership's hourly processing budget.
  if (!dealerActionAllowed(c, helpers, authorized.context, "processing", 20)) return;
  const revision = Number(project.get("metadata_revision") || 1);
  const priorTasks = $app
    .dao()
    .findRecordsByFilter(
      "walkaround_worker_tasks",
      "project = {:project} && kind = 'produce'",
      "+created",
      10,
      0,
      { project: project.id },
    );
  if (priorTasks.length >= 3)
    return c.json(409, { error: "Walkaround retry limit reached" });
  const workflowId =
    "walkaround-producer-" +
    project.id +
    "-r" +
    revision +
    "-a" +
    (priorTasks.length + 1);
  const task = enqueueTask($app.dao(), project, "produce", workflowId, {
    projectId: project.id,
    workflowId: workflowId,
    expectedRevision: revision,
  });
  project.set("producer_workflow_id", workflowId);
  project.set("production_state", "queued");
  project.set("failure_code", "");
  $app.dao().saveRecord(project);
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "production_queued",
    "accepted",
    revision,
    "",
  );
  return c.json(202, {
    projectId: project.id,
    workflowId: workflowId,
    taskId: task.id,
    state: "queued",
  });
}

function getProject(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  c.response().header().set("Cache-Control", "private, no-store");
  const response = serializeProject(authorized.project, $app.dao(), true);
  response.canApprove = isManager(authorized.context);
  return c.json(200, response);
}

function normalizeMetadata(raw) {
  const object = jsonObject(raw, 64000);
  if (!object) return null;
  const value = object.value;
  const title = cleanString(value.title, 100, true);
  const description = cleanString(value.description, 5000, true);
  const thumbnailText = cleanString(value.thumbnailText || "", 100, false);
  if (
    !title ||
    !description ||
    thumbnailText === null ||
    typeof value.madeForKids !== "boolean"
  )
    return null;
  const tags = Array.isArray(value.tags) ? value.tags : [];
  if (tags.length > 30) return null;
  const cleanTags = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = cleanString(tags[i], 60, true);
    if (!tag) return null;
    if (cleanTags.indexOf(tag) === -1) cleanTags.push(tag);
  }
  const result = {
    title: title,
    description: description,
    tags: cleanTags,
    madeForKids: value.madeForKids,
  };
  result.thumbnailCopy = cleanString(
    value.thumbnailCopy || value.thumbnailText || "",
    100,
    false,
  );
  result.claimEvidence = Array.isArray(value.claimEvidence)
    ? value.claimEvidence.slice(0, 100)
    : [];
  result.captionsText = cleanString(value.captionsText || "", 30000, false);
  if (result.captionsText === null) return null;
  result.chapters = Array.isArray(value.chapters)
    ? value.chapters.slice(0, 50).map((chapter) => ({
        title: cleanString(chapter.title || chapter.label || "", 120, true),
        atSeconds: Number(chapter.atSeconds ?? chapter.seconds ?? 0),
      }))
    : [];
  if (
    result.chapters.some(
      (chapter) =>
        !chapter.title || !Number.isFinite(chapter.atSeconds) || chapter.atSeconds < 0,
    )
  )
    return null;
  if (
    result.claimEvidence.some(
      (item) =>
        !item ||
        !cleanString(item.claim || "", 500, true) ||
        !cleanString(item.evidence || "", 1000, true),
    )
  )
    return null;
  return JSON.stringify(result);
}

function reviewProject(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const project = authorized.project;
  if (
    ["review_ready", "retryable_failed"].indexOf(
      project.getString("production_state"),
    ) === -1
  )
    return c.json(409, { error: "Project is not ready for review" });
  const body = $apis.requestInfo(c).data || {};
  const expectedRevision = integer(body.revision, 1, 1000000);
  if (expectedRevision !== Number(project.get("metadata_revision") || 1))
    return c.json(409, { error: "Review revision conflict" });
  const metadata = normalizeMetadata(body.metadata);
  if (!metadata)
    return c.json(400, {
      error: "Invalid YouTube metadata; madeForKids must be explicitly selected",
    });
  const revision = Number(project.get("metadata_revision") || 1) + 1;
  const priorReviewTasks = $app
    .dao()
    .findRecordsByFilter(
      "walkaround_worker_tasks",
      "project = {:project} && kind = 'validate_review'",
      "+created",
      10,
      0,
      { project: project.id },
    );
  if (priorReviewTasks.length >= 3)
    return c.json(409, { error: "Review validation retry limit reached" });
  project.set("metadata_revision", revision);
  project.set("metadata_json", metadata);
  project.set("captions_text", safeJson(metadata, {}).captionsText || "");
  project.set("metadata_validated_revision", 0);
  project.set("qc_passed", false);
  project.set("reviewed_master_sha256", project.getString("master_sha256"));
  project.set("reviewed_metadata_revision", revision);
  project.set("reviewed_by", authorized.context.person.id);
  project.set("reviewed_at", now());
  project.set("approved_at", "");
  project.set("approved_by", "");
  project.set("approved_master_sha256", "");
  project.set("approved_metadata_revision", 0);
  project.set("production_state", "quality_check");
  $app.dao().saveRecord(project);
  const workflowId = "walkaround-review-" + project.id + "-r" + revision;
  const task = enqueueTask($app.dao(), project, "validate_review", workflowId, {
    projectId: project.id,
    workflowId: workflowId,
    expectedRevision: revision,
  });
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "review_saved",
    "accepted",
    revision,
    "",
  );
  return c.json(202, {
    projectId: project.id,
    metadataRevision: revision,
    reviewedRevision: revision,
    state: "quality_check",
    taskId: task.id,
  });
}

function approveProject(c, helpers) {
  const authorized = projectForContext(c, helpers, { manager: true });
  if (!authorized) return;
  const project = authorized.project;
  const revision = Number(project.get("metadata_revision") || 0);
  const body = $apis.requestInfo(c).data || {};
  if (
    integer(body.revision, 1, 1000000) !== revision ||
    cleanString(body.masterSha256 || "", 64, true) !==
      project.getString("master_sha256")
  )
    return c.json(409, { error: "Approval revision binding changed" });
  if (
    project.getString("production_state") !== "review_ready" ||
    !bool(project, "qc_passed") ||
    Number(project.get("metadata_validated_revision") || 0) !== revision ||
    project.getString("reviewed_master_sha256") !==
      project.getString("master_sha256") ||
    Number(project.get("reviewed_metadata_revision") || 0) !== revision ||
    !project.getString("master_sha256")
  )
    return c.json(409, {
      error: "The exact master and metadata revision must pass review before approval",
    });
  project.set("approved_master_sha256", project.getString("master_sha256"));
  project.set("approved_metadata_revision", revision);
  project.set("approved_by", authorized.context.person.id);
  project.set("approved_at", now());
  $app.dao().saveRecord(project);
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "project_approved",
    "accepted",
    revision,
    "",
  );
  return c.json(200, {
    approved: true,
    masterSha256: project.getString("master_sha256"),
    metadataRevision: revision,
  });
}

function reEditProject(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const project = authorized.project;
  if (project.getString("production_state") !== "review_ready")
    return c.json(409, { error: "Project is not ready for re-editing" });
  const body = $apis.requestInfo(c).data || {};
  const currentRevision = Number(project.get("metadata_revision") || 1);
  if (integer(body.revision, 1, 1000000) !== currentRevision)
    return c.json(409, { error: "Re-edit revision conflict" });
  const instructions = cleanString(body.instructions || "", 4000, true);
  const captions = cleanString(body.captionsText || "", 30000, false);
  if (!instructions || captions === null)
    return c.json(400, { error: "Bounded re-edit instructions are required" });
  const revision = currentRevision + 1;
  project.set("edit_instructions", instructions);
  project.set("captions_text", captions);
  project.set("metadata_revision", revision);
  project.set("metadata_validated_revision", 0);
  project.set("qc_passed", false);
  project.set("reviewed_master_sha256", "");
  project.set("reviewed_metadata_revision", 0);
  project.set("reviewed_by", "");
  project.set("reviewed_at", "");
  project.set("approved_master_sha256", "");
  project.set("approved_metadata_revision", 0);
  project.set("approved_by", "");
  project.set("approved_at", "");
  const workflowId = "walkaround-producer-" + project.id + "-reedit-r" + revision;
  project.set("producer_workflow_id", workflowId);
  project.set("production_state", "queued");
  $app.dao().saveRecord(project);
  const task = enqueueTask($app.dao(), project, "produce", workflowId, {
    projectId: project.id,
    workflowId: workflowId,
    expectedRevision: revision,
  });
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "reedit_queued",
    "accepted",
    revision,
    "",
  );
  return c.json(202, {
    projectId: project.id,
    reviewRevision: revision,
    workflowId: workflowId,
    taskId: task.id,
    state: "queued",
  });
}

function youtubeConnection(dao, dealerId) {
  try {
    return dao.findFirstRecordByFilter(
      "walkaround_youtube_connections",
      "dealer = {:dealer} && status = 'connected'",
      { dealer: dealerId },
    );
  } catch (_e) {
    return null;
  }
}

function publishProject(c, helpers) {
  // Publishing pushes video to the dealership's YouTube channel and, when the
  // dealer does not require explicit approval, mints the approval record
  // itself below. It therefore carries at least the authority of
  // approveProject and must be manager-gated the same way.
  const authorized = projectForContext(c, helpers, { manager: true });
  if (!authorized) return;
  const project = authorized.project;
  if (
    ["not_requested", "failed"].indexOf(project.getString("publication_state")) === -1
  )
    return c.json(409, { error: "Publication is already active or complete" });
  if (
    project.getString("publication_state") === "failed" &&
    /(AMBIGUOUS|RECONCILIATION)/.test(project.getString("failure_code"))
  )
    return c.json(409, {
      error: "The prior YouTube operation must be reconciled before retry",
      code: "YOUTUBE_RECONCILIATION_REQUIRED",
    });
  const body = $apis.requestInfo(c).data || {};
  let visibility = (body.visibility || "unlisted").toString();
  if (project.getString("audience_mode") === "customer") visibility = "unlisted";
  if (visibility !== "unlisted" && visibility !== "public")
    return c.json(400, { error: "Visibility must be unlisted or public" });
  if (visibility === "public" && project.getString("audience_mode") !== "inventory")
    return c.json(409, { error: "Customer walkarounds can only be unlisted" });
  if (visibility === "public" && body.availabilityAttested !== true)
    return c.json(409, {
      error: "Current inventory availability must be attested before public publishing",
    });
  const revision = Number(project.get("metadata_revision") || 0);
  if (
    integer(body.revision, 1, 1000000) !== revision ||
    cleanString(body.masterSha256 || "", 64, true) !==
      project.getString("master_sha256")
  )
    return c.json(409, { error: "Publish revision binding changed" });
  const dealer = $app.dao().findRecordById("dealers", project.getString("dealer"));
  const reviewed =
    project.getString("reviewed_master_sha256") ===
      project.getString("master_sha256") &&
    Number(project.get("reviewed_metadata_revision") || 0) === revision;
  if (!reviewed)
    return c.json(409, {
      error: "The exact master and metadata revision must be reviewed",
    });
  let approved =
    project.getString("approved_at") &&
    project.getString("approved_master_sha256") ===
      project.getString("master_sha256") &&
    Number(project.get("approved_metadata_revision") || 0) === revision;
  if (
    !approved &&
    !bool(dealer, "requires_approval") &&
    project.getString("production_state") === "review_ready"
  ) {
    project.set("approved_master_sha256", project.getString("master_sha256"));
    project.set("approved_metadata_revision", revision);
    project.set("approved_by", authorized.context.person.id);
    project.set("approved_at", now());
    approved = true;
  }
  if (
    !approved ||
    !bool(project, "qc_passed") ||
    Number(project.get("metadata_validated_revision") || 0) !== revision
  )
    return c.json(409, {
      error: "The exact reviewed master and metadata revision are not approved",
    });
  if (!validRelease($app.dao(), project))
    return c.json(409, {
      error: "Required YouTube consent is missing",
      code: "CONSENT_REQUIRED",
    });
  const connection = youtubeConnection($app.dao(), project.getString("dealer"));
  if (!connection)
    return c.json(503, {
      error: "YouTube is not connected for this dealership",
      code: "YOUTUBE_NOT_CONNECTED",
    });
  if (visibility === "public") {
    project.set("availability_attested_at", now());
    project.set("availability_attested_by", authorized.context.person.id);
  }
  const priorTasks = $app
    .dao()
    .findRecordsByFilter(
      "walkaround_worker_tasks",
      "project = {:project} && kind = 'publish_youtube'",
      "+created",
      5,
      0,
      { project: project.id },
    );
  if (priorTasks.length >= 2)
    return c.json(409, { error: "YouTube publication retry limit reached" });
  const workflowId =
    "walkaround-publisher-" +
    project.id +
    "-r" +
    revision +
    "-a" +
    (priorTasks.length + 1);
  const task = enqueueTask($app.dao(), project, "publish_youtube", workflowId, {
    projectId: project.id,
    workflowId: workflowId,
    expectedRevision: revision,
  });
  project.set("publisher_workflow_id", workflowId);
  project.set("publication_state", "uploading_private");
  $app.dao().saveRecord(project);
  let publication = null;
  try {
    publication = $app
      .dao()
      .findFirstRecordByFilter("walkaround_publications", "project = {:project}", {
        project: project.id,
      });
  } catch (_e) {}
  if (!publication)
    publication = new Record(
      $app.dao().findCollectionByNameOrId("walkaround_publications"),
    );
  publication.set("project", project.id);
  publication.set("dealer", project.getString("dealer"));
  publication.set("channel_id", connection.getString("channel_id"));
  publication.set("requested_visibility", visibility);
  publication.set("actual_visibility", "private");
  const metadata = safeJson(project.getString("metadata_json"), {});
  publication.set("made_for_kids", metadata.madeForKids === true);
  publication.set("master_sha256", project.getString("master_sha256"));
  publication.set("metadata_revision", revision);
  $app.dao().saveRecord(publication);
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "publication_queued",
    "accepted",
    revision,
    "",
  );
  return c.json(202, {
    projectId: project.id,
    workflowId: workflowId,
    taskId: task.id,
    state: "uploading_private",
    visibility: visibility,
  });
}

function deleteProject(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const project = authorized.project;
  if (
    ["uploading_private", "processing", "publishing"].indexOf(
      project.getString("publication_state"),
    ) !== -1
  )
    return c.json(409, {
      error: "Wait for the YouTube publication attempt to finish before deletion",
    });
  project.set("production_state", "deleting");
  project.set("deleted_at", now());
  $app.dao().saveRecord(project);
  const key = "walkaround-delete:" + project.id;
  const task = enqueueTask($app.dao(), project, "delete_objects", key, {
    projectId: project.id,
    workflowId: key,
    expectedRevision: Number(project.get("metadata_revision") || 1),
  });
  audit(
    $app.dao(),
    project,
    authorized.context.person,
    "deletion_queued",
    "accepted",
    Number(project.get("metadata_revision") || 0),
    "",
  );
  return c.json(202, {
    deleted: false,
    state: "deleting",
    taskId: task.id,
    youtubeVideoRetained:
      project.getString("publication_state").indexOf("published_") === 0,
  });
}

function youtubeStatus(c, helpers) {
  const context = contextOrResponse(c, helpers);
  if (!context) return;
  if (!isManager(context)) return c.json(403, { error: "Manager access required" });
  const connection = youtubeConnection($app.dao(), context.dealer.id);
  c.response().header().set("Cache-Control", "private, no-store");
  return c.json(
    200,
    connection
      ? {
          connected: true,
          channelId: connection.getString("channel_id"),
          channelTitle: connection.getString("channel_title"),
          lastVerifiedAt: connection.getString("last_verified_at") || null,
        }
      : { connected: false },
  );
}

function youtubeConnect(c, helpers) {
  const context = contextOrResponse(c, helpers);
  if (!context) return;
  if (!isManager(context)) return c.json(403, { error: "Manager access required" });
  const config = youtubeBrokerConfig();
  if (!config)
    return c.json(503, {
      error: "YouTube connection is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/youtube/oauth/start",
      { dealerId: context.dealer.id, managerPersonId: context.person.id },
      "youtube-oauth-start:" + context.dealer.id + ":" + context.person.id,
    );
  } catch (_e) {
    return c.json(503, { error: "YouTube authorization could not be started" });
  }
  const authorizationUrl = cleanString(result && result.authorizationUrl, 4096, true);
  const stateReference = cleanString(result && result.stateReference, 256, true);
  if (
    !authorizationUrl ||
    !/^https:\/\/accounts\.google\.com\//.test(authorizationUrl) ||
    !stateReference ||
    !/^[A-Za-z0-9:._/-]+$/.test(stateReference)
  )
    return c.json(503, { error: "YouTube authorization could not be started" });
  // Nonce, PKCE verifier, callback state, and OAuth tokens remain entirely in
  // the trusted broker; the browser receives only its one-time authorization URL.
  return c.json(200, { authorizationUrl: authorizationUrl });
}

function youtubeDisconnect(c, helpers) {
  const context = contextOrResponse(c, helpers);
  if (!context) return;
  if (!isManager(context)) return c.json(403, { error: "Manager access required" });
  const config = youtubeBrokerConfig();
  let connection = null;
  try {
    connection = $app
      .dao()
      .findFirstRecordByFilter("walkaround_youtube_connections", "dealer = {:dealer}", {
        dealer: context.dealer.id,
      });
  } catch (_e) {}
  if (!connection) return c.json(200, { connected: false, idempotentReplay: true });
  if (!config)
    return c.json(503, {
      error: "YouTube disconnect is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  try {
    brokerRequest(
      config,
      "/v1/youtube/oauth/disconnect",
      {
        dealerId: context.dealer.id,
        credentialReference: connection.getString("credential_reference"),
      },
      "youtube-disconnect:" + context.dealer.id,
    );
  } catch (_e) {
    return c.json(503, { error: "YouTube connection could not be disconnected" });
  }
  connection.set("status", "disconnected");
  connection.set("credential_reference", "disconnected:" + connection.id);
  $app.dao().saveRecord(connection);
  return c.json(200, { connected: false });
}

function youtubeComplete(c, helpers) {
  const context = contextOrResponse(c, helpers);
  if (!context) return;
  if (!isManager(context)) return c.json(403, { error: "Manager access required" });
  const config = youtubeBrokerConfig();
  const body = $apis.requestInfo(c).data || {};
  const stateReference = cleanString(body.stateReference || "", 256, true);
  if (!config || !stateReference || !/^[A-Za-z0-9:._/-]+$/.test(stateReference))
    return c.json(503, {
      error: "YouTube connection is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/youtube/oauth/complete",
      { dealerId: context.dealer.id, stateReference: stateReference },
      "youtube-oauth-complete:" + context.dealer.id + ":" + stateReference,
    );
  } catch (_e) {
    return c.json(503, { error: "YouTube authorization could not be verified" });
  }
  const channelId = cleanString(result && result.channelId, 128, true);
  const channelTitle = cleanString(result && result.channelTitle, 180, true);
  const credentialReference = cleanString(
    result && result.credentialReference,
    256,
    true,
  );
  if (
    !channelId ||
    !channelTitle ||
    !credentialReference ||
    !/^[A-Za-z0-9:._/-]+$/.test(credentialReference)
  )
    return c.json(503, { error: "YouTube authorization could not be verified" });
  let connection = null;
  try {
    connection = $app
      .dao()
      .findFirstRecordByFilter("walkaround_youtube_connections", "dealer = {:dealer}", {
        dealer: context.dealer.id,
      });
  } catch (_e) {}
  if (!connection)
    connection = new Record(
      $app.dao().findCollectionByNameOrId("walkaround_youtube_connections"),
    );
  connection.set("dealer", context.dealer.id);
  connection.set("channel_id", channelId);
  connection.set("channel_title", channelTitle);
  connection.set("credential_reference", credentialReference);
  connection.set("status", "connected");
  connection.set("connected_by", context.person.id);
  connection.set("last_verified_at", now());
  $app.dao().saveRecord(connection);
  return c.json(200, {
    connected: true,
    channelId: channelId,
    channelTitle: channelTitle,
  });
}

function previewAsset(c, helpers) {
  const authorized = projectForContext(c, helpers);
  if (!authorized) return;
  const kind = c.pathParam("kind");
  if (kind !== "master" && kind !== "teaser" && kind !== "thumbnail")
    return c.json(404, { error: "Preview not found" });
  let asset = null;
  try {
    asset = $app
      .dao()
      .findFirstRecordByFilter(
        "walkaround_assets",
        "project = {:project} && kind = {:kind} && state = 'ready'",
        { project: authorized.project.id, kind: kind },
      );
  } catch (_e) {}
  const config = uploadBrokerConfig();
  if (!asset || !config) return c.json(404, { error: "Preview not found" });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/signed-reads",
      {
        projectId: authorized.project.id,
        assetId: asset.id,
        objectKey: asset.getString("storage_key"),
        storageGeneration: asset.getString("storage_generation"),
      },
      "preview:" +
        authorized.project.id +
        ":" +
        asset.id +
        ":" +
        Math.floor(Date.now() / (10 * 60 * 1000)),
    );
  } catch (_e) {
    return c.json(503, { error: "Preview is temporarily unavailable" });
  }
  const url = cleanString(result && result.url, 4096, true);
  if (!url || !/^https:\/\//.test(url))
    return c.json(503, { error: "Preview is temporarily unavailable" });
  c.response().header().set("Cache-Control", "private, no-store");
  return c.redirect(307, url);
}

function rawRequestBody(c) {
  try {
    return readerToString(c.request().body);
  } catch (_e) {
    return "";
  }
}

/**
 * Nonces already accepted inside the freshness window, held in $app.store()
 * so the record is shared across PocketBase's pooled hook VMs (module-level
 * state is per-VM and would let a replay succeed once per pool member). The
 * check-then-set below is not atomic, so two perfectly simultaneous replays
 * could both pass — the v2 signature's method+path+idempotency binding plus
 * per-route idempotency dedupe on mutations remain the authoritative
 * anti-replay controls; this cache closes the practical window.
 */
const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_KEY_PREFIX = "walkaroundNonce:";
const NONCE_PRUNE_AT_KEY = "walkaroundNoncePrunedAt";

function seenWalkaroundNonceUntil(nonce) {
  try {
    return Number($app.store().get(NONCE_KEY_PREFIX + nonce) || 0);
  } catch (_e) {
    return 0;
  }
}

function markWalkaroundNonceSeen(nonce) {
  try {
    $app.store().set(NONCE_KEY_PREFIX + nonce, Date.now() + NONCE_TTL_MS);
  } catch (_e) {}
}

function pruneSeenWalkaroundNonces(now) {
  try {
    const last = Number($app.store().get(NONCE_PRUNE_AT_KEY) || 0);
    if (now - last < 60 * 1000) return;
    $app.store().set(NONCE_PRUNE_AT_KEY, now);
    const all = $app.store().getAll();
    const keys = Object.keys(all || {});
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(NONCE_KEY_PREFIX) === 0 && Number(all[keys[i]] || 0) <= now) {
        $app.store().remove(keys[i]);
      }
    }
  } catch (_e) {
    // Entries are tiny and worker traffic is low; if enumeration is
    // unavailable the cache simply grows until the next deploy restart.
  }
}

function internalAuth(c, rawBody) {
  if (!featureEnabled()) return null;
  let helpers = null;
  try {
    helpers = require(__hooks + "/helpers.js");
  } catch (_e) {
    return null;
  }
  const deny = function (detail) {
    // Parity with /api/proxy/*: rejected worker calls become coalesced audit
    // rows instead of a silent null, so a brute-force against the internal
    // surface is visible.
    try {
      helpers.logCoalescedAuthEvent(
        "walkaround_internal_unauthorized",
        {
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail: detail,
        },
        15 * 60,
        30,
      );
    } catch (_e) {}
    return null;
  };
  try {
    // The internal surface is publicly reachable (Fly origin + Vercel /api
    // rewrite); throttle before any comparison work.
    const rate = helpers.checkProxyRateLimit(
      "walkaround-internal:" + helpers.clientIP(c),
      300,
      60 * 1000,
    );
    if (!rate.ok) return deny("rate limited");
  } catch (_e) {
    return null;
  }
  let token = "",
    secret = "",
    authorization = "",
    timestamp = "",
    signature = "",
    signatureVersion = "",
    nonce = "",
    idempotency = "";
  try {
    token = ($os.getenv("WALKAROUND_WORKER_TOKEN") || "").toString();
    secret = ($os.getenv("WALKAROUND_WORKER_SIGNING_SECRET") || "").toString();
    authorization = (c.request().header.get("Authorization") || "").toString();
    timestamp = (c.request().header.get("X-Walkaround-Timestamp") || "").toString();
    signature = (c.request().header.get("X-Walkaround-Signature") || "")
      .toString()
      .toLowerCase();
    signatureVersion = (c.request().header.get("X-Walkaround-Signature-Version") || "")
      .toString()
      .trim();
    nonce = (c.request().header.get("X-Walkaround-Nonce") || "")
      .toString()
      .toLowerCase();
    idempotency = (c.request().header.get("Idempotency-Key") || "").toString();
  } catch (_e) {
    return null;
  }
  if (
    token.length < 32 ||
    secret.length < 32 ||
    token !== token.trim() ||
    secret !== secret.trim()
  )
    return null;
  const suppliedToken =
    authorization.indexOf("Bearer ") === 0 ? authorization.slice(7) : "";
  if (
    suppliedToken.length !== token.length ||
    $security.sha256(suppliedToken) !== $security.sha256(token)
  )
    return deny("bearer mismatch");
  const seconds = Number(timestamp);
  if (
    !Number.isInteger(seconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300
  )
    return deny("stale timestamp");
  let expected = "";
  if (signatureVersion === "2") {
    // v2 binds the signature to everything the handler will trust: method,
    // exact path (so a captured signed-read cannot mint URLs for another
    // project), the idempotency key (so a captured claim cannot re-lease
    // with a fresh key), and a single-use nonce.
    if (!/^[a-f0-9]{32}$/.test(nonce)) return deny("malformed nonce");
    const now = Date.now();
    pruneSeenWalkaroundNonces(now);
    if (seenWalkaroundNonceUntil(nonce) > now) {
      return deny("replayed nonce");
    }
    let method = "";
    let path = "";
    try {
      method = (c.request().method || "").toString().toUpperCase();
      path = (c.request().url.path || "").toString();
    } catch (_e) {
      return deny("request introspection failed");
    }
    if (!method || !path) return deny("request introspection failed");
    const bodyHash = ($security.sha256(rawBody) || "").toString().toLowerCase();
    expected = (
      $security.hs256(
        "v2." +
          timestamp +
          "." +
          nonce +
          "." +
          method +
          "." +
          path +
          "." +
          idempotency +
          "." +
          bodyHash,
        secret,
      ) || ""
    )
      .toString()
      .toLowerCase();
  } else {
    // Legacy v1 covers only timestamp+body. Allowed for one release while the
    // worker fleet updates; flip WALKAROUND_SIGNATURE_V1_ALLOWED=false, then
    // delete this branch.
    const v1Allowed =
      ($os.getenv("WALKAROUND_SIGNATURE_V1_ALLOWED") || "true")
        .toString()
        .trim()
        .toLowerCase() !== "false";
    if (!v1Allowed) return deny("v1 signature rejected");
    expected = ($security.hs256(timestamp + "." + rawBody, secret) || "")
      .toString()
      .toLowerCase();
  }
  if (
    !/^[a-f0-9]{64}$/.test(signature) ||
    $security.sha256(signature) !== $security.sha256(expected)
  )
    return deny("signature mismatch");
  if (signatureVersion === "2") {
    // Mark only verified nonces so garbage requests cannot poison the cache.
    markWalkaroundNonceSeen(nonce);
  }
  return { idempotencyKey: idempotency };
}

function internalProject(c, rawBody, mutation) {
  const auth = internalAuth(c, rawBody);
  if (!auth) {
    c.json(401, { error: "Unauthorized worker request" });
    return null;
  }
  if (mutation && !/^[A-Za-z0-9:._-]{16,180}$/.test(auth.idempotencyKey)) {
    c.json(400, { error: "Valid Idempotency-Key required" });
    return null;
  }
  let project = null;
  try {
    project = $app.dao().findRecordById("walkaround_projects", c.pathParam("id"));
  } catch (_e) {}
  if (!project || project.getString("production_state") === "deleted") {
    c.json(404, { error: "Walkaround not found" });
    return null;
  }
  return { auth: auth, project: project };
}

function taskRequest(c, rawBody) {
  const auth = internalAuth(c, rawBody);
  if (!auth) {
    c.json(401, { error: "Unauthorized worker request" });
    return null;
  }
  if (!/^[A-Za-z0-9:._-]{16,180}$/.test(auth.idempotencyKey)) {
    c.json(400, { error: "Valid Idempotency-Key required" });
    return null;
  }
  return auth;
}

function taskDeletionTarget(dao, task) {
  if (task.getString("kind") !== "delete_objects") return undefined;
  const payload = safeJson(task.getString("payload"), {});
  const filter = payload.assetId
    ? "project = {:project} && id = {:asset}"
    : "project = {:project} && storage_key != ''";
  const params = payload.assetId
    ? { project: task.getString("project"), asset: payload.assetId }
    : { project: task.getString("project") };
  const assets = dao.findRecordsByFilter(
    "walkaround_assets",
    filter,
    "+created",
    100,
    0,
    params,
  );
  return {
    scope: payload.assetId ? "asset" : "project",
    objects: assets.map((asset) => ({
      storageKey: asset.getString("storage_key"),
      storageGeneration: asset.getString("storage_generation") || undefined,
    })),
  };
}

function taskReviewContext(dao, task) {
  if (task.getString("kind") !== "validate_review") return undefined;
  const project = dao.findRecordById("walkaround_projects", task.getString("project"));
  const dealer = dao.findRecordById("dealers", project.getString("dealer"));
  const master = masterAssetForProject(dao, project);
  if (!master) throw new Error("review_master_missing");
  return {
    masterStorageKey: master.getString("storage_key"),
    masterSha256: master.getString("sha256"),
    metadata: safeJson(project.getString("metadata_json"), {}),
    captionsText: project.getString("captions_text"),
    vehicleSnapshot: safeJson(project.getString("vehicle_snapshot"), {}),
    bannedPhrases: dealer
      .getString("banned_phrases")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function claimTask(c) {
  const raw = rawRequestBody(c);
  const taskAuth = taskRequest(c, raw);
  if (!taskAuth) return;
  const body = safeJson(raw, null);
  const dispatcherId = cleanString(body && body.dispatcherId, 120, true);
  const leaseSeconds = integer(body && body.leaseSeconds, 30, 300);
  if (
    !dispatcherId ||
    !/^[A-Za-z0-9:._-]+$/.test(dispatcherId) ||
    leaseSeconds === null
  )
    return c.json(400, { error: "Invalid dispatcher lease request" });
  const signingSecret = (
    $os.getenv("WALKAROUND_WORKER_SIGNING_SECRET") || ""
  ).toString();
  const leaseToken = $security.hs256(
    taskAuth.idempotencyKey + "." + dispatcherId,
    signingSecret,
  );
  const leaseHash = $security.sha256(leaseToken).toLowerCase();
  const nowValue = now();
  const expiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  let claimed = null;
  $app.dao().runInTransaction(function (txDao) {
    try {
      claimed = txDao.findFirstRecordByFilter(
        "walkaround_worker_tasks",
        "claim_request_key = {:key} && (status = 'claimed' || status = 'started')",
        { key: taskAuth.idempotencyKey },
      );
    } catch (_e) {}
    if (claimed) return;
    let candidates = [];
    try {
      candidates = txDao.findRecordsByFilter(
        "walkaround_worker_tasks",
        "(status = 'queued' || status = 'retrying' || (status = 'claimed' && lease_expires_at <= {:now})) && (next_attempt_at = '' || next_attempt_at <= {:now})",
        "+created",
        1,
        0,
        { now: nowValue },
      );
    } catch (_e) {}
    if (!candidates.length) return;
    claimed = candidates[0];
    claimed.set("status", "claimed");
    claimed.set("lease_owner", dispatcherId);
    claimed.set("claim_request_key", taskAuth.idempotencyKey);
    claimed.set("lease_token_hash", leaseHash);
    claimed.set("claimed_at", nowValue);
    claimed.set("lease_expires_at", expiry);
    claimed.set("attempts", Number(claimed.get("attempts") || 0) + 1);
    txDao.saveRecord(claimed);
  });
  if (!claimed) return c.json(200, { task: null });
  const payload = safeJson(claimed.getString("payload"), {});
  const kind = claimed.getString("kind");
  const workflowNames = {
    produce: "vehicle_walkaround_producer",
    publish_youtube: "youtube_walkaround_publisher",
  };
  return c.json(200, {
    task: {
      taskId: claimed.id,
      kind: kind,
      leaseToken: leaseToken,
      idempotencyKey: claimed.getString("idempotency_key"),
      workflowName: workflowNames[kind] || undefined,
      workflowId: payload.workflowId,
      input: {
        projectId: payload.projectId,
        workflowId: payload.workflowId,
        expectedRevision: Number(payload.expectedRevision || 0),
      },
      deletion: taskDeletionTarget($app.dao(), claimed),
      review: taskReviewContext($app.dao(), claimed),
    },
  });
}

function taskLeaseMutation(c, action) {
  const raw = rawRequestBody(c);
  if (!taskRequest(c, raw)) return;
  const body = safeJson(raw, null);
  const dispatcherId = cleanString(body && body.dispatcherId, 120, true);
  const leaseToken = cleanString(body && body.leaseToken, 128, true);
  if (!dispatcherId || !leaseToken) return c.json(400, { error: "Invalid task lease" });
  let task = null;
  try {
    task = $app.dao().findRecordById("walkaround_worker_tasks", c.pathParam("taskId"));
  } catch (_e) {}
  const requestedRunId = cleanString(
    (body && (body.temporalRunId || (body.result && body.result.temporalRunId))) || "",
    160,
    false,
  );
  if (
    action === "ack" &&
    task &&
    task.getString("status") === "started" &&
    requestedRunId &&
    requestedRunId === task.getString("temporal_run_id") &&
    task.getString("lease_owner") === dispatcherId &&
    $security.sha256(leaseToken).toLowerCase() === task.getString("lease_token_hash")
  )
    return c.json(200, { accepted: true, idempotentReplay: true });
  if (
    !task ||
    task.getString("status") !== "claimed" ||
    task.getString("lease_owner") !== dispatcherId ||
    task.getString("lease_expires_at") <= now() ||
    $security.sha256(leaseToken).toLowerCase() !== task.getString("lease_token_hash")
  )
    return c.json(409, { error: "Task lease is no longer authoritative" });
  if (action === "ack") {
    const kind = task.getString("kind");
    if (kind === "produce" || kind === "publish_youtube") {
      const runId = cleanString(
        body.temporalRunId || (body.result && body.result.temporalRunId) || "",
        160,
        true,
      );
      if (!runId) return c.json(400, { error: "temporalRunId is required" });
      task.set("status", "started");
      task.set("temporal_run_id", runId);
    } else {
      const project = $app
        .dao()
        .findRecordById("walkaround_projects", task.getString("project"));
      if (kind === "validate_review") {
        const payload = safeJson(task.getString("payload"), {});
        if (
          Number(payload.expectedRevision || 0) !==
          Number(project.get("metadata_revision") || 0)
        )
          return c.json(409, { error: "Review validation revision changed" });
        const passed =
          body.result &&
          (body.result.passed === true ||
            (body.result.qc && body.result.qc.passed === true));
        project.set("qc_passed", passed);
        project.set(
          "metadata_validated_revision",
          passed ? Number(payload.expectedRevision || 0) : 0,
        );
        project.set("production_state", passed ? "review_ready" : "retryable_failed");
        project.set("failure_code", passed ? "" : "REVIEW_VALIDATION_FAILED");
        $app.dao().saveRecord(project);
      } else if (kind === "delete_objects") {
        const target = taskDeletionTarget($app.dao(), task);
        const deletedCount = integer(
          body.result && body.result.deletedObjectCount,
          0,
          100000,
        );
        if (deletedCount === null)
          return c.json(422, { error: "Authoritative deletion result is required" });
        if (target && target.scope === "project") {
          project.set("production_state", "deleted");
          $app.dao().saveRecord(project);
        }
      }
      task.set("status", "completed");
      task.set("completed_at", now());
    }
  } else {
    const errorCode = cleanString(body.errorCode || "", 80, true);
    const retryAfter = integer(body.retryAfterSeconds, 1, 86400);
    if (!errorCode || !/^[A-Z0-9_]+$/.test(errorCode) || retryAfter === null)
      return c.json(400, { error: "Valid retry error is required" });
    const terminal = Number(task.get("attempts") || 0) >= 8;
    task.set("status", terminal ? "failed" : "retrying");
    task.set("last_error_code", errorCode);
    task.set(
      "next_attempt_at",
      terminal ? "" : new Date(Date.now() + retryAfter * 1000).toISOString(),
    );
  }
  if (task.getString("status") !== "started") {
    task.set("lease_owner", "");
    task.set("lease_token_hash", "");
    task.set("lease_expires_at", "");
  }
  $app.dao().saveRecord(task);
  return c.json(200, { accepted: true });
}

function ackTask(c) {
  return taskLeaseMutation(c, "ack");
}
function nackTask(c) {
  return taskLeaseMutation(c, "nack");
}

function renewTask(c) {
  const raw = rawRequestBody(c);
  if (!taskRequest(c, raw)) return;
  const body = safeJson(raw, null);
  const dispatcherId = cleanString(body && body.dispatcherId, 120, true);
  const leaseToken = cleanString(body && body.leaseToken, 128, true);
  const leaseSeconds = integer(body && body.leaseSeconds, 30, 300);
  let task = null;
  try {
    task = $app.dao().findRecordById("walkaround_worker_tasks", c.pathParam("taskId"));
  } catch (_e) {}
  if (
    !task ||
    !dispatcherId ||
    !leaseToken ||
    leaseSeconds === null ||
    task.getString("status") !== "claimed" ||
    task.getString("lease_owner") !== dispatcherId ||
    task.getString("lease_expires_at") <= now() ||
    $security.sha256(leaseToken).toLowerCase() !== task.getString("lease_token_hash")
  )
    return c.json(409, { error: "Task lease is no longer authoritative" });
  task.set(
    "lease_expires_at",
    new Date(Date.now() + leaseSeconds * 1000).toISOString(),
  );
  $app.dao().saveRecord(task);
  return c.json(200, { accepted: true, leaseToken: leaseToken });
}

function internalContext(c, lane) {
  const found = internalProject(c, "", false);
  if (!found) return;
  const project = found.project;
  const dealer = $app.dao().findRecordById("dealers", project.getString("dealer"));
  const sources = sourcesForProject($app.dao(), project.id);
  const connection =
    lane === "publication"
      ? youtubeConnection($app.dao(), project.getString("dealer"))
      : null;
  let bucket = "";
  try {
    bucket = ($os.getenv("WALKAROUND_GCS_BUCKET") || "").toString().trim();
  } catch (_e) {}
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket))
    return c.json(503, { error: "Private media storage is on configuration hold" });
  let release = null;
  try {
    release = $app
      .dao()
      .findFirstRecordByFilter(
        "walkaround_releases",
        "project = {:project} && revoked_at = ''",
        { project: project.id },
      );
  } catch (_e) {}
  const consentValid = validRelease($app.dao(), project);
  const releaseRequired = bool(project, "contains_identifiable_non_employee");
  const consentAllowed = !releaseRequired || consentValid;
  const revision = Number(project.get("metadata_revision") || 1);
  const vehicleRaw = safeJson(project.getString("vehicle_snapshot"), {});
  const vehicleSnapshot = {};
  Object.keys(vehicleRaw).forEach((key) => {
    vehicleSnapshot[key] = (vehicleRaw[key] ?? "").toString();
  });
  const providerJobs = $app
    .dao()
    .findRecordsByFilter(
      "walkaround_provider_jobs",
      "project = {:project}",
      "+created",
      100,
      0,
      { project: project.id },
    );
  const base = {
    projectId: project.id,
    revision: revision,
    dealerId: project.getString("dealer"),
    ownerId: project.getString("owner_person"),
    mode: project.getString("audience_mode"),
    productionState: project.getString("production_state"),
  };
  let response = null;
  if (lane === "production") {
    response = Object.assign({}, base, {
      vehicleSnapshot: vehicleSnapshot,
      branding: {
        dealerName: dealer.getString("name"),
        brandColor: dealer.getString("brand_color"),
        tagline: dealer.getString("tagline"),
        defaultFooter: dealer.getString("default_footer"),
      },
      bannedPhrases: dealer
        .getString("banned_phrases")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      music: { enabled: false },
      editInstructions: project.getString("edit_instructions"),
      captionsText: project.getString("captions_text"),
      consent: {
        version: release ? release.getString("consent_version") : RELEASE_VERSION,
        video: consentAllowed && (!releaseRequired || bool(release, "video_consent")),
        voice: consentAllowed && (!releaseRequired || bool(release, "voice_consent")),
        cloudProcessing:
          consentAllowed &&
          (!releaseRequired || bool(release, "cloud_processing_consent")),
        youtube:
          consentAllowed && (!releaseRequired || bool(release, "youtube_consent")),
        identifiableNonEmployee: releaseRequired,
      },
      approvalRequired: bool(dealer, "requires_approval"),
      assets: sources.map((asset) => ({
        id: asset.id,
        order: Number(asset.get("clip_order") || 0),
        gcsUri: "gs://" + bucket + "/" + asset.getString("storage_key"),
        mimeType: asset.getString("verified_mime"),
        sizeBytes: Number(asset.get("size_bytes") || 0),
        durationSeconds: Number(asset.get("duration_ms") || 0) / 1000,
        sha256: asset.getString("sha256"),
        finalized: true,
      })),
      providerJobs: providerJobs.map((job) => ({
        kind: job.getString("provider") + ":" + job.getString("operation"),
        requestKey: job.getString("request_key"),
        providerJobId: job.getString("provider_job_id") || undefined,
        status: job.getString("status"),
      })),
    });
  } else {
    let master = null;
    try {
      master = $app
        .dao()
        .findFirstRecordByFilter(
          "walkaround_assets",
          "project = {:project} && kind = 'master' && state = 'ready' && sha256 = {:sha}",
          { project: project.id, sha: project.getString("master_sha256") },
        );
    } catch (_e) {}
    let publication = null;
    try {
      publication = $app
        .dao()
        .findFirstRecordByFilter("walkaround_publications", "project = {:project}", {
          project: project.id,
        });
    } catch (_e) {}
    if (!connection || !master || !publication)
      return c.json(409, { error: "Publication context is incomplete" });
    const metadata = safeJson(project.getString("metadata_json"), null);
    if (!metadata) return c.json(409, { error: "Publication metadata is missing" });
    const approved =
      !!project.getString("approved_at") &&
      project.getString("approved_master_sha256") ===
        project.getString("master_sha256") &&
      Number(project.get("approved_metadata_revision") || 0) === revision;
    const youtubeJobs = providerJobs.filter(
      (job) => job.getString("provider") === "youtube",
    );
    const providerJob = youtubeJobs.length ? youtubeJobs[youtubeJobs.length - 1] : null;
    response = Object.assign({}, base, {
      publicationState: project.getString("publication_state"),
      consent: {
        version: release ? release.getString("consent_version") : RELEASE_VERSION,
        youtube:
          consentAllowed && (!releaseRequired || bool(release, "youtube_consent")),
      },
      approvalRequired: bool(dealer, "requires_approval"),
      approval: {
        approved: approved,
        masterSha256: project.getString("approved_master_sha256"),
        metadataRevision: Number(project.get("approved_metadata_revision") || 0),
        approverId: project.getString("approved_by") || undefined,
      },
      master: {
        assetId: master.id,
        gcsUri: "gs://" + bucket + "/" + master.getString("storage_key"),
        sha256: master.getString("sha256"),
        sizeBytes: Number(master.get("size_bytes") || 0),
      },
      metadataRevision: revision,
      metadata: metadata,
      madeForKids: !!metadata.madeForKids,
      requestedVisibility: publication.getString("requested_visibility"),
      availabilityAttestationId: project.getString("availability_attested_at")
        ? project.id + ":" + project.getString("availability_attested_at")
        : undefined,
      channel: {
        connected: true,
        channelId: connection.getString("channel_id"),
        title: connection.getString("channel_title"),
      },
      providerJob: providerJob
        ? {
            requestKey: providerJob.getString("request_key"),
            providerJobId: providerJob.id,
            status: providerJob.getString("status"),
            nextOffset: Number(providerJob.get("next_offset") || 0),
            videoId: providerJob.getString("provider_job_id") || undefined,
          }
        : undefined,
    });
  }
  c.response().header().set("Cache-Control", "private, no-store");
  return c.json(200, response);
}

function alreadyProcessedEvent(dao, eventId) {
  try {
    return dao.findFirstRecordByFilter(
      "walkaround_worker_events",
      "event_id = {:event}",
      { event: eventId },
    );
  } catch (_e) {
    return null;
  }
}

function recordWorkerEvent(dao, project, eventId, workflowId, lane, state) {
  const event = new Record(dao.findCollectionByNameOrId("walkaround_worker_events"));
  event.set("project", project.id);
  event.set("dealer", project.getString("dealer"));
  event.set("event_id", eventId);
  event.set("workflow_id", workflowId);
  event.set("lane", lane);
  event.set("state", state);
  dao.saveRecord(event);
}

function completeWorkflowTask(dao, project, workflowId) {
  let task = null;
  try {
    task = dao.findFirstRecordByFilter(
      "walkaround_worker_tasks",
      "project = {:project} && idempotency_key = {:workflow}",
      { project: project.id, workflow: workflowId },
    );
  } catch (_e) {}
  if (!task || ["completed", "cancelled"].indexOf(task.getString("status")) !== -1)
    return;
  task.set("status", "completed");
  task.set("completed_at", now());
  task.set("lease_owner", "");
  task.set("lease_token_hash", "");
  task.set("lease_expires_at", "");
  dao.saveRecord(task);
}

function failWorkflowTask(dao, project, workflowId, code) {
  let task = null;
  try {
    task = dao.findFirstRecordByFilter(
      "walkaround_worker_tasks",
      "project = {:project} && idempotency_key = {:workflow}",
      { project: project.id, workflow: workflowId },
    );
  } catch (_e) {}
  if (!task) return;
  task.set("status", "failed");
  task.set("last_error_code", code || "WORKFLOW_FAILED");
  task.set("lease_owner", "");
  task.set("lease_token_hash", "");
  task.set("lease_expires_at", "");
  dao.saveRecord(task);
}

function productionEvent(c) {
  const raw = rawRequestBody(c);
  const found = internalProject(c, raw, true);
  if (!found) return;
  const body = safeJson(raw, null);
  if (!body || body.eventId !== found.auth.idempotencyKey)
    return c.json(400, { error: "eventId must match Idempotency-Key" });
  const eventId = cleanString(body.eventId, 160, true),
    workflowId = cleanString(body.workflowId, 160, true);
  const state = cleanString(body.productionState || body.state, 80, true);
  if (
    !eventId ||
    !workflowId ||
    workflowId !== found.project.getString("producer_workflow_id")
  )
    return c.json(409, { error: "Invalid production event binding" });
  if (alreadyProcessedEvent($app.dao(), eventId)) {
    if (body.providerJob && body.providerJob.requestKey) {
      let replayJob = null;
      try {
        replayJob = $app
          .dao()
          .findFirstRecordByFilter("walkaround_provider_jobs", "request_key = {:key}", {
            key: body.providerJob.requestKey,
          });
      } catch (_e) {}
      if (replayJob)
        return c.json(200, {
          requestKey: replayJob.getString("request_key"),
          providerJobId: replayJob.getString("provider_job_id") || undefined,
          status: replayJob.getString("status"),
          revision: Number(found.project.get("metadata_revision") || 1),
          idempotentReplay: true,
        });
    }
    return c.json(200, {
      accepted: true,
      revision: Number(found.project.get("metadata_revision") || 1),
      idempotentReplay: true,
    });
  }
  const expectedRevision = integer(body.expectedRevision, 1, 1000000);
  if (expectedRevision !== Number(found.project.get("metadata_revision") || 1))
    return c.json(409, { error: "Metadata revision conflict" });
  if (
    body.type === "provider_job_reserved" ||
    body.type === "provider_job_accepted" ||
    body.type === "provider_job_reconciliation"
  ) {
    const providerJob = body.providerJob || {};
    const requestKey = cleanString(providerJob.requestKey, 160, true);
    const kind = cleanString(providerJob.kind, 80, true);
    if (!requestKey || !kind || !/^[A-Za-z0-9:._-]+$/.test(requestKey))
      return c.json(422, { error: "Invalid provider reservation" });
    const lower = kind.toLowerCase();
    const provider =
      lower.indexOf("shotstack") !== -1
        ? "shotstack"
        : lower.indexOf("auphonic") !== -1
          ? "auphonic"
          : lower.indexOf("vertex") !== -1 || lower.indexOf("gemini") !== -1
            ? "vertex"
            : lower.indexOf("gcs") !== -1 || lower === "media_prepare"
              ? "gcs"
              : null;
    if (!provider) return c.json(422, { error: "Unsupported provider reservation" });
    let job = null;
    try {
      job = $app
        .dao()
        .findFirstRecordByFilter("walkaround_provider_jobs", "request_key = {:key}", {
          key: requestKey,
        });
    } catch (_e) {}
    if (!job) {
      job = new Record($app.dao().findCollectionByNameOrId("walkaround_provider_jobs"));
      job.set("project", found.project.id);
      job.set("dealer", found.project.getString("dealer"));
      job.set("provider", provider);
      job.set("operation", lower.replace(/[^a-z0-9_]/g, "_").slice(0, 80));
      job.set("request_key", requestKey);
      job.set("status", "reserved");
      job.set("attempts", 0);
    }
    if (body.type === "provider_job_accepted") {
      const providerJobId = cleanString(providerJob.providerJobId, 256, true);
      if (!providerJobId) return c.json(422, { error: "Provider job ID is required" });
      job.set("provider_job_id", providerJobId);
      job.set(
        "status",
        providerJob.status === "completed" || providerJob.status === "succeeded"
          ? "succeeded"
          : "submitted",
      );
    } else if (body.type === "provider_job_reconciliation") {
      const errorCode = cleanString(
        body.redactedError && body.redactedError.code,
        80,
        true,
      );
      if (!errorCode || !/^[A-Z0-9_]+$/.test(errorCode))
        return c.json(422, { error: "Valid reconciliation error is required" });
      job.set("status", "reconciliation_required");
      job.set("last_error_code", errorCode);
      found.project.set("production_state", "retryable_failed");
      found.project.set("failure_code", errorCode);
      $app.dao().saveRecord(found.project);
    }
    $app.dao().saveRecord(job);
    recordWorkerEvent(
      $app.dao(),
      found.project,
      eventId,
      workflowId,
      "production",
      body.type,
    );
    return c.json(202, {
      requestKey: requestKey,
      providerJobId: job.getString("provider_job_id") || undefined,
      status: job.getString("status"),
      revision: expectedRevision,
    });
  }
  if (PRODUCTION_STATES.indexOf(state) === -1)
    return c.json(409, { error: "Invalid production state" });
  const eventPayload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload
      : null;
  if (eventPayload && eventPayload.metadata) body.metadata = eventPayload.metadata;
  if (eventPayload && eventPayload.evaluation) {
    const evaluation = eventPayload.evaluation;
    const passed =
      evaluation.groundingPassed === true &&
      evaluation.privacyPassed === true &&
      evaluation.continuityPassed === true &&
      evaluation.audioPassed === true &&
      evaluation.visualPassed === true &&
      evaluation.youtubeReady === true &&
      evaluation.reshootRequired !== true;
    body.qc = { passed: passed, summary: evaluation };
  }
  if (body.metadata !== undefined) {
    const currentMetadata = safeJson(found.project.getString("metadata_json"), {});
    const workerMetadata = Object.assign({}, body.metadata, {
      madeForKids:
        typeof body.metadata.madeForKids === "boolean"
          ? body.metadata.madeForKids
          : typeof currentMetadata.madeForKids === "boolean"
            ? currentMetadata.madeForKids
            : false,
    });
    const metadata = normalizeMetadata(workerMetadata);
    if (!metadata)
      return c.json(422, { error: "Worker metadata failed deterministic validation" });
    found.project.set("metadata_json", metadata);
  }
  if (body.qc !== undefined) {
    if (!body.qc || typeof body.qc !== "object" || typeof body.qc.passed !== "boolean")
      return c.json(422, { error: "Invalid QC event" });
    const summary = jsonObject(body.qc.summary || {}, 8000);
    if (!summary) return c.json(422, { error: "Invalid QC summary" });
    found.project.set("qc_passed", body.qc.passed);
    found.project.set("qc_summary", summary.serialized);
    found.project.set(
      "metadata_validated_revision",
      body.qc.passed ? expectedRevision : 0,
    );
  }
  if (body.artifact !== undefined) {
    const artifact = body.artifact || {};
    const kind = artifact.kind;
    if (
      [
        "proxy",
        "transcript",
        "edit_plan",
        "master",
        "teaser",
        "captions",
        "thumbnail",
      ].indexOf(kind) === -1
    )
      return c.json(422, { error: "Invalid artifact kind" });
    const storageKey = cleanString(artifact.storageKey, 512, true),
      sha = cleanString(artifact.sha256, 64, true);
    if (
      !storageKey ||
      storageKey.indexOf(
        "walkarounds/" +
          found.project.getString("dealer") +
          "/" +
          found.project.id +
          "/",
      ) !== 0 ||
      !sha ||
      !/^[a-f0-9]{64}$/.test(sha)
    )
      return c.json(422, { error: "Invalid artifact binding" });
    const asset = new Record($app.dao().findCollectionByNameOrId("walkaround_assets"));
    asset.set("project", found.project.id);
    asset.set("dealer", found.project.getString("dealer"));
    asset.set("kind", kind);
    asset.set("state", "ready");
    asset.set("storage_key", storageKey);
    asset.set(
      "storage_generation",
      cleanString(artifact.storageGeneration || "", 80, false) || "",
    );
    asset.set("sha256", sha);
    asset.set(
      "verified_mime",
      cleanString(artifact.mime || "application/json", 80, true),
    );
    asset.set("size_bytes", integer(artifact.sizeBytes || 0, 0, MAX_TOTAL_BYTES) || 0);
    asset.set(
      "duration_ms",
      integer(artifact.durationMs || 0, 0, MAX_TOTAL_DURATION_MS) || 0,
    );
    $app.dao().saveRecord(asset);
    if (kind === "master") {
      found.project.set("master_sha256", sha);
      found.project.set("reviewed_master_sha256", "");
      found.project.set("reviewed_metadata_revision", 0);
      found.project.set("approved_master_sha256", "");
      found.project.set("approved_metadata_revision", 0);
    }
  }
  if (body.redactedError !== undefined) {
    const code = cleanString(body.redactedError && body.redactedError.code, 80, true);
    if (!code || !/^[A-Z0-9_]+$/.test(code))
      return c.json(422, { error: "Invalid redacted error" });
    found.project.set("failure_code", code);
  }
  if (state === "review_ready") {
    const readyAssets = $app
      .dao()
      .findRecordsByFilter(
        "walkaround_assets",
        "project = {:project} && state = 'ready'",
        "+created",
        100,
        0,
        { project: found.project.id },
      );
    const readyKinds = readyAssets.map((asset) => asset.getString("kind"));
    for (const requiredKind of [
      "transcript",
      "edit_plan",
      "master",
      "teaser",
      "captions",
      "thumbnail",
    ]) {
      if (readyKinds.indexOf(requiredKind) === -1)
        return c.json(409, { error: "Required production artifact is missing" });
    }
    if (
      !bool(found.project, "qc_passed") ||
      Number(found.project.get("metadata_validated_revision") || 0) !==
        expectedRevision ||
      !found.project.getString("metadata_json")
    )
      return c.json(409, { error: "Grounded package validation is incomplete" });
  }
  found.project.set("production_state", state);
  $app.dao().saveRecord(found.project);
  recordWorkerEvent(
    $app.dao(),
    found.project,
    eventId,
    workflowId,
    "production",
    state,
  );
  if (state === "review_ready")
    completeWorkflowTask($app.dao(), found.project, workflowId);
  else if (state === "retryable_failed" || state === "terminal_failed")
    failWorkflowTask(
      $app.dao(),
      found.project,
      workflowId,
      found.project.getString("failure_code") || "PRODUCTION_WORKFLOW_FAILED",
    );
  return c.json(202, { accepted: true, revision: expectedRevision });
}

function publicationEvent(c) {
  const raw = rawRequestBody(c);
  const found = internalProject(c, raw, true);
  if (!found) return;
  const body = safeJson(raw, null);
  if (!body || body.eventId !== found.auth.idempotencyKey)
    return c.json(400, { error: "eventId must match Idempotency-Key" });
  const eventId = cleanString(body.eventId, 160, true),
    workflowId = cleanString(body.workflowId, 160, true),
    state = cleanString(body.publicationState || body.state, 80, true);
  if (
    !eventId ||
    !workflowId ||
    PUBLICATION_STATES.indexOf(state) === -1 ||
    workflowId !== found.project.getString("publisher_workflow_id")
  )
    return c.json(409, { error: "Invalid publication event binding" });
  if (alreadyProcessedEvent($app.dao(), eventId))
    return c.json(200, {
      accepted: true,
      revision: Number(found.project.get("metadata_revision") || 1),
      idempotentReplay: true,
    });
  const revision = integer(body.expectedRevision, 1, 1000000);
  if (
    revision !== Number(found.project.get("metadata_revision") || 0) ||
    found.project.getString("approved_master_sha256") !==
      found.project.getString("master_sha256") ||
    Number(found.project.get("approved_metadata_revision") || 0) !== revision
  )
    return c.json(409, { error: "Approved artifact binding changed" });
  let publication = null;
  try {
    publication = $app
      .dao()
      .findFirstRecordByFilter("walkaround_publications", "project = {:project}", {
        project: found.project.id,
      });
  } catch (_e) {}
  if (!publication) return c.json(409, { error: "Publication request missing" });
  if (body.publication && typeof body.publication === "object") {
    body.videoId = body.publication.videoId;
    body.actualVisibility = body.publication.actualVisibility;
    body.playbackVerified = body.publication.playbackVerified;
  }
  const videoId = cleanString(body.videoId || "", 128, false);
  if (videoId && !/^[A-Za-z0-9_-]{6,128}$/.test(videoId))
    return c.json(422, { error: "Invalid YouTube video ID" });
  if (videoId) publication.set("video_id", videoId);
  if (body.actualVisibility) {
    const allowed = ["private", "unlisted", "public"];
    if (allowed.indexOf(body.actualVisibility) === -1)
      return c.json(422, { error: "Invalid visibility" });
    if (
      found.project.getString("audience_mode") === "customer" &&
      body.actualVisibility === "public"
    )
      return c.json(409, { error: "Customer videos cannot become public" });
    publication.set("actual_visibility", body.actualVisibility);
  }
  if (body.playbackVerified === true) {
    if (!publication.getString("video_id"))
      return c.json(409, { error: "Playback cannot be verified without video ID" });
    publication.set("playback_verified_at", now());
    publication.set(
      "share_url",
      "https://youtu.be/" + publication.getString("video_id"),
    );
  }
  if (body.redactedError !== undefined) {
    const code = cleanString(body.redactedError && body.redactedError.code, 80, true);
    if (!code || !/^[A-Z0-9_]+$/.test(code))
      return c.json(422, { error: "Invalid redacted error" });
    found.project.set("failure_code", code);
  }
  found.project.set("publication_state", state);
  $app.dao().saveRecord(publication);
  $app.dao().saveRecord(found.project);
  recordWorkerEvent(
    $app.dao(),
    found.project,
    eventId,
    workflowId,
    "publication",
    state,
  );
  if (state === "published_unlisted" || state === "published_public")
    completeWorkflowTask($app.dao(), found.project, workflowId);
  else if (state === "failed" || state === "reconciliation_required")
    failWorkflowTask(
      $app.dao(),
      found.project,
      workflowId,
      found.project.getString("failure_code") || "PUBLICATION_WORKFLOW_FAILED",
    );
  return c.json(202, { accepted: true, revision: revision });
}

function signedRead(c) {
  const raw = rawRequestBody(c);
  const found = internalProject(c, raw, true);
  if (!found) return;
  let asset = null;
  try {
    asset = $app.dao().findRecordById("walkaround_assets", c.pathParam("assetId"));
  } catch (_e) {}
  if (
    !asset ||
    asset.getString("project") !== found.project.id ||
    asset.getString("dealer") !== found.project.getString("dealer") ||
    ["verified", "ready"].indexOf(asset.getString("state")) === -1
  )
    return c.json(404, { error: "Asset not found" });
  const config = uploadBrokerConfig();
  if (!config) return c.json(503, { error: "Private storage signing is unavailable" });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/signed-reads",
      {
        projectId: found.project.id,
        assetId: asset.id,
        objectKey: asset.getString("storage_key"),
        storageGeneration: asset.getString("storage_generation"),
      },
      found.auth.idempotencyKey,
    );
  } catch (_e) {
    return c.json(503, { error: "Private storage signing is unavailable" });
  }
  const url = cleanString(result && result.url, 4096, true),
    expiry = cleanString(result && result.expiresAt, 80, true);
  if (!url || !/^https:\/\//.test(url) || !expiry)
    return c.json(503, { error: "Private storage signing is unavailable" });
  return c.json(200, {
    url: url,
    method: "GET",
    headers: result.headers || {},
    expiry: expiry,
    expiresAt: expiry,
  });
}

function publicationBinding(found, body) {
  const project = found.project;
  const revision = integer(body.expectedRevision, 1, 1000000);
  const metadataRevision = integer(body.metadataRevision, 1, 1000000);
  const sha = cleanString(body.masterSha256, 64, true);
  return (
    !!revision &&
    revision === metadataRevision &&
    revision === Number(project.get("metadata_revision") || 0) &&
    sha === project.getString("master_sha256") &&
    sha === project.getString("approved_master_sha256") &&
    revision === Number(project.get("approved_metadata_revision") || 0) &&
    cleanString(body.workflowId, 160, true) ===
      project.getString("publisher_workflow_id")
  );
}

function masterAssetForProject(dao, project) {
  try {
    const asset = dao.findFirstRecordByFilter(
      "walkaround_assets",
      "project = {:project} && kind = 'master' && state = 'ready' && sha256 = {:sha}",
      { project: project.id, sha: project.getString("master_sha256") },
    );
    return asset && asset.getString("storage_key") ? asset : null;
  } catch (_e) {
    return null;
  }
}

function youtubeUploadSession(c) {
  const raw = rawRequestBody(c),
    found = internalProject(c, raw, true);
  if (!found) return;
  const body = safeJson(raw, null);
  if (!body || !publicationBinding(found, body))
    return c.json(409, { error: "Approved publication binding changed" });
  const metadata = normalizeMetadata({
    title: body.title,
    description: body.description,
    tags: body.tags,
    madeForKids: body.madeForKids,
  });
  if (!metadata || typeof body.madeForKids !== "boolean")
    return c.json(422, { error: "Invalid YouTube metadata" });
  const connection = youtubeConnection($app.dao(), found.project.getString("dealer"));
  const master = masterAssetForProject($app.dao(), found.project);
  const config = youtubeBrokerConfig();
  if (!connection || !master || !config)
    return c.json(503, {
      error: "YouTube publication is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  const requestKey =
    "youtube-upload:" + found.project.id + ":r" + body.metadataRevision;
  let job = null;
  try {
    job = $app
      .dao()
      .findFirstRecordByFilter("walkaround_provider_jobs", "request_key = {:key}", {
        key: requestKey,
      });
  } catch (_e) {}
  if (job && job.getString("session_reference"))
    return c.json(200, {
      providerJobId: job.id,
      state: job.getString("status") === "processing" ? "processing" : "uploading",
      nextOffset: Number(job.get("next_offset") || 0),
      videoId: job.getString("provider_job_id") || undefined,
      revision: Number(found.project.get("metadata_revision") || 1),
      idempotentReplay: true,
    });
  if (!job) {
    job = new Record($app.dao().findCollectionByNameOrId("walkaround_provider_jobs"));
    job.set("project", found.project.id);
    job.set("dealer", found.project.getString("dealer"));
    job.set("provider", "youtube");
    job.set("operation", "resumable_upload");
    job.set("request_key", requestKey);
    job.set("status", "reserved");
    job.set("attempts", 0);
    $app.dao().saveRecord(job);
  }
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/youtube/upload-sessions",
      {
        projectId: found.project.id,
        providerJobId: job.id,
        channelId: connection.getString("channel_id"),
        credentialReference: connection.getString("credential_reference"),
        objectKey: master.getString("storage_key"),
        storageGeneration: master.getString("storage_generation"),
        metadata: safeJson(metadata, {}),
        privacyStatus: "private",
      },
      requestKey,
    );
    const sessionReference = cleanString(result && result.sessionReference, 256, true);
    if (!sessionReference || !/^[A-Za-z0-9:._/-]+$/.test(sessionReference))
      throw new Error("invalid_session_reference");
    job.set("session_reference", sessionReference);
    job.set("next_offset", integer(result.nextOffset || 0, 0, MAX_TOTAL_BYTES) || 0);
    job.set("status", "submitted");
    job.set("attempts", Number(job.get("attempts") || 0) + 1);
    $app.dao().saveRecord(job);
  } catch (_e) {
    job.set("status", "reconciliation_required");
    job.set("last_error_code", "YOUTUBE_SESSION_AMBIGUOUS");
    $app.dao().saveRecord(job);
    return c.json(503, {
      error: "YouTube upload session requires reconciliation",
      code: "YOUTUBE_RECONCILIATION_REQUIRED",
      providerJobId: job.id,
    });
  }
  return c.json(201, {
    providerJobId: job.id,
    state: "uploading",
    nextOffset: Number(job.get("next_offset") || 0),
    revision: Number(found.project.get("metadata_revision") || 1),
  });
}

function youtubeUploadNext(c) {
  const raw = rawRequestBody(c),
    found = internalProject(c, raw, true);
  if (!found) return;
  const body = safeJson(raw, null);
  const providerJobId = cleanString(body && body.providerJobId, 64, true);
  const revision = Number(found.project.get("metadata_revision") || 0);
  if (
    !body ||
    !providerJobId ||
    integer(body.expectedRevision, 1, 1000000) !== revision ||
    cleanString(body.workflowId, 160, true) !==
      found.project.getString("publisher_workflow_id") ||
    found.project.getString("approved_master_sha256") !==
      found.project.getString("master_sha256") ||
    Number(found.project.get("approved_metadata_revision") || 0) !== revision
  )
    return c.json(409, { error: "Invalid YouTube upload binding" });
  let job = null;
  try {
    job = $app.dao().findRecordById("walkaround_provider_jobs", providerJobId);
  } catch (_e) {}
  const master = masterAssetForProject($app.dao(), found.project),
    config = youtubeBrokerConfig();
  if (
    !job ||
    job.getString("project") !== found.project.id ||
    job.getString("provider") !== "youtube" ||
    !job.getString("session_reference") ||
    !master ||
    !config
  )
    return c.json(503, {
      error: "YouTube upload is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/youtube/upload-next",
      {
        projectId: found.project.id,
        providerJobId: job.id,
        sessionReference: job.getString("session_reference"),
        objectKey: master.getString("storage_key"),
        storageGeneration: master.getString("storage_generation"),
        nextOffset: Number(job.get("next_offset") || 0),
      },
      found.auth.idempotencyKey,
    );
  } catch (_e) {
    job.set("status", "reconciliation_required");
    job.set("last_error_code", "YOUTUBE_CHUNK_AMBIGUOUS");
    $app.dao().saveRecord(job);
    return c.json(503, {
      error: "YouTube upload requires reconciliation",
      code: "YOUTUBE_RECONCILIATION_REQUIRED",
      providerJobId: job.id,
    });
  }
  const nextOffset = integer(result && result.nextOffset, 0, MAX_TOTAL_BYTES);
  const state = cleanString(result && result.state, 40, true);
  const videoId = cleanString((result && result.videoId) || "", 128, false);
  if (
    nextOffset === null ||
    ["submitted", "processing", "succeeded"].indexOf(state) === -1 ||
    (videoId && !/^[A-Za-z0-9_-]{6,128}$/.test(videoId)) ||
    ((state === "processing" || state === "succeeded") && !videoId)
  )
    return c.json(503, {
      error: "YouTube upload returned an invalid status",
      code: "YOUTUBE_RECONCILIATION_REQUIRED",
    });
  job.set("next_offset", nextOffset);
  job.set(
    "status",
    state === "succeeded"
      ? "processing"
      : state === "submitted"
        ? "submitted"
        : "processing",
  );
  if (videoId) job.set("provider_job_id", videoId);
  $app.dao().saveRecord(job);
  return c.json(200, {
    providerJobId: job.id,
    state: state === "submitted" ? "uploading" : "processing",
    videoId: videoId || null,
    nextOffset: nextOffset,
    revision: revision,
  });
}

function youtubeVideoStatus(c) {
  const found = internalProject(c, "", false);
  if (!found) return;
  const videoId = cleanString(c.pathParam("videoId"), 128, true),
    config = youtubeBrokerConfig();
  const connection = youtubeConnection($app.dao(), found.project.getString("dealer"));
  if (!videoId || !/^[A-Za-z0-9_-]{6,128}$/.test(videoId))
    return c.json(400, { error: "Invalid YouTube video ID" });
  if (!config || !connection)
    return c.json(503, {
      error: "YouTube status is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  let publication = null;
  try {
    publication = $app
      .dao()
      .findFirstRecordByFilter("walkaround_publications", "project = {:project}", {
        project: found.project.id,
      });
  } catch (_e) {}
  if (!publication || publication.getString("video_id") !== videoId)
    return c.json(409, { error: "YouTube video binding changed" });
  let result = null;
  try {
    result = brokerRequest(
      config,
      "/v1/youtube/videos/status",
      {
        projectId: found.project.id,
        videoId: videoId,
        channelId: connection.getString("channel_id"),
        credentialReference: connection.getString("credential_reference"),
      },
      "youtube-status:" +
        found.project.id +
        ":" +
        videoId +
        ":" +
        Math.floor(Date.now() / 10000),
    );
  } catch (_e) {
    return c.json(503, { error: "YouTube status is unavailable" });
  }
  return c.json(200, {
    uploadStatus: cleanString(result.uploadStatus || "", 40, false),
    processingStatus: cleanString(result.processingStatus || "", 40, false),
    playbackVerified: result.playbackVerified === true,
    privacyStatus:
      ["private", "unlisted", "public"].indexOf(result.privacyStatus) !== -1
        ? result.privacyStatus
        : "private",
    revision: Number(found.project.get("metadata_revision") || 1),
  });
}

function youtubeVisibility(c) {
  const raw = rawRequestBody(c),
    found = internalProject(c, raw, true);
  if (!found) return;
  const body = safeJson(raw, null),
    videoId = cleanString(c.pathParam("videoId"), 128, true);
  const visibility = body && body.visibility;
  if (
    !videoId ||
    !/^[A-Za-z0-9_-]{6,128}$/.test(videoId) ||
    ["unlisted", "public"].indexOf(visibility) === -1
  )
    return c.json(400, { error: "Invalid visibility request" });
  const revision = Number(found.project.get("metadata_revision") || 0);
  if (
    !body ||
    cleanString(body.workflowId || "", 160, true) !==
      found.project.getString("publisher_workflow_id") ||
    integer(body.expectedRevision, 1, 1000000) !== revision ||
    found.project.getString("approved_master_sha256") !==
      found.project.getString("master_sha256") ||
    Number(found.project.get("approved_metadata_revision") || 0) !== revision
  )
    return c.json(409, { error: "Approved publication binding changed" });
  let publication = null;
  try {
    publication = $app
      .dao()
      .findFirstRecordByFilter("walkaround_publications", "project = {:project}", {
        project: found.project.id,
      });
  } catch (_e) {}
  if (
    !publication ||
    publication.getString("video_id") !== videoId ||
    publication.getString("requested_visibility") !== visibility ||
    publication.getString("master_sha256") !==
      found.project.getString("master_sha256") ||
    Number(publication.get("metadata_revision") || 0) !== revision
  )
    return c.json(409, { error: "Publication request binding changed" });
  if (
    found.project.getString("audience_mode") === "customer" &&
    visibility !== "unlisted"
  )
    return c.json(409, { error: "Customer walkarounds can only be unlisted" });
  if (
    visibility === "public" &&
    (!found.project.getString("availability_attested_at") ||
      cleanString(body.availabilityAttestationId || "", 160, true) !==
        found.project.id + ":" + found.project.getString("availability_attested_at"))
  )
    return c.json(409, { error: "Inventory availability attestation is required" });
  const config = youtubeBrokerConfig(),
    connection = youtubeConnection($app.dao(), found.project.getString("dealer"));
  if (!config || !connection)
    return c.json(503, {
      error: "YouTube publication is on configuration hold",
      code: "YOUTUBE_CONFIG_HOLD",
    });
  let authoritative = null;
  try {
    brokerRequest(
      config,
      "/v1/youtube/videos/visibility",
      {
        projectId: found.project.id,
        videoId: videoId,
        channelId: connection.getString("channel_id"),
        credentialReference: connection.getString("credential_reference"),
        visibility: visibility,
      },
      found.auth.idempotencyKey,
    );
    authoritative = brokerRequest(
      config,
      "/v1/youtube/videos/status",
      {
        projectId: found.project.id,
        videoId: videoId,
        channelId: connection.getString("channel_id"),
        credentialReference: connection.getString("credential_reference"),
      },
      found.auth.idempotencyKey + ":status",
    );
  } catch (_e) {
    return c.json(503, { error: "YouTube visibility update is unavailable" });
  }
  return c.json(200, {
    uploadStatus: cleanString(authoritative.uploadStatus || "", 40, false),
    processingStatus:
      ["processing", "succeeded", "failed"].indexOf(authoritative.processingStatus) !==
      -1
        ? authoritative.processingStatus
        : "processing",
    playbackVerified: authoritative.playbackVerified === true,
    privacyStatus:
      ["private", "unlisted", "public"].indexOf(authoritative.privacyStatus) !== -1
        ? authoritative.privacyStatus
        : "private",
    revision: revision,
  });
}

function cleanupAbandonedUploads() {
  if (!featureEnabled()) return 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let assets = [];
  try {
    assets = $app
      .dao()
      .findRecordsByFilter(
        "walkaround_assets",
        "kind = 'source' && (state = 'pending_upload' || state = 'uploading' || state = 'failed') && created < {:cutoff}",
        "+created",
        250,
        0,
        { cutoff: cutoff },
      );
  } catch (err) {
    console.error("[walkaround cleanup] abandoned upload query failed");
    return 0;
  }
  let cleaned = 0;
  for (let i = 0; i < assets.length; i++) {
    try {
      const asset = assets[i];
      const project = $app
        .dao()
        .findRecordById("walkaround_projects", asset.getString("project"));
      if (["draft", "uploading"].indexOf(project.getString("production_state")) === -1)
        continue;
      asset.set("state", "deleted");
      asset.set("upload_session_reference", "");
      $app.dao().saveRecord(asset);
      const remaining = sourcesForProject($app.dao(), project.id);
      if (!remaining.length) {
        project.set("production_state", "cancelled");
        $app.dao().saveRecord(project);
      }
      enqueueTask(
        $app.dao(),
        project,
        "delete_objects",
        "walkaround-abandoned:" + asset.id,
        {
          projectId: project.id,
          workflowId: "walkaround-abandoned-" + asset.id,
          expectedRevision: Number(project.get("metadata_revision") || 1),
          assetId: asset.id,
        },
      );
      cleaned++;
    } catch (_e) {
      console.error("[walkaround cleanup] one abandoned upload could not be queued");
    }
  }
  return cleaned;
}

module.exports = {
  MAX_CLIPS,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_DURATION_MS,
  RELEASE_VERSION,
  cleanString,
  integer,
  jsonObject,
  normalizeMetadata,
  createProject,
  createUpload,
  finalizeUpload,
  saveRelease,
  processProject,
  getProject,
  reviewProject,
  reEditProject,
  approveProject,
  publishProject,
  deleteProject,
  youtubeStatus,
  youtubeConnect,
  youtubeDisconnect,
  youtubeComplete,
  previewAsset,
  internalContext,
  productionEvent,
  publicationEvent,
  signedRead,
  youtubeUploadSession,
  youtubeUploadNext,
  youtubeVideoStatus,
  youtubeVisibility,
  cleanupAbandonedUploads,
  claimTask,
  ackTask,
  nackTask,
  renewTask,
};
