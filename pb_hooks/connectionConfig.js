// Server-only managed connections. Never serialize runtimeSnapshot to a client.
// Authentication must come from helpers.sessionContext, never request data.
const CONFIG_COLLECTION = "managed_connections";
const PROOF_COLLECTION = "connection_verifications";
const VERSION = 1;
const TEST_LEASE_MS = 45000;
const PROOF_VALID_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_CODES = [
  "CONNECTION_CONFIG_CORRUPT",
  "CONNECTION_STORAGE_UNAVAILABLE",
  "CONNECTION_SECURE_STORAGE_REQUIRED",
  "CONNECTION_ORIGIN_NOT_APPROVED",
  "CONNECTION_FIELDS_INVALID",
  "CONNECTION_CREDENTIAL_INVALID",
  "CONNECTION_MODEL_POLICY_INVALID",
  "CONNECTION_TEST_FAILED",
  "CONNECTION_DRAFT_PENDING",
  "CONNECTION_TEST_TIMEOUT",
  "CONNECTION_TEST_UNKNOWN",
  "CONNECTION_PROOF_EXPIRED",
  "CONNECTION_RESPONSE_INVALID",
  "CONNECTION_AUTH_FAILED",
  "CONNECTION_RATE_LIMITED",
  "CONNECTION_TARGET_CHANGED",
];
function safeCode(value, fallback) {
  return SAFE_CODES.indexOf(value) >= 0 ? value : fallback;
}
function elapsed(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Date.now() - parsed : Infinity;
}
function allowedCapabilities(service) {
  return service === "website"
    ? ["website"]
    : service === "walkaround"
      ? ["processing", "youtube"]
      : ["text"];
}
function proofKind(service) {
  return service === "website"
    ? "website_receipt"
    : service === "walkaround"
      ? "walkaround_receipt"
      : "text_only";
}
function providerPolicyIdentity(service) {
  if (["gemini", "anthropic", "openai"].indexOf(service) < 0) return "";
  try {
    const policy = require(__hooks + "/requestPolicies.js");
    // Bind to both the tested adapter version and the current production policy.
    const production =
      service === "gemini"
        ? policy.geminiModelPolicySnapshot()
        : service === "anthropic"
          ? policy.buildAnthropicMessageRequest({
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: "connection-policy" }],
                },
              ],
            })
          : policy.buildOpenAIImageRequest({ prompt: "connection-policy" });
    if (!production) fail("CONNECTION_MODEL_POLICY_INVALID");
    return $security.sha256(
      JSON.stringify([
        1,
        service,
        service === "openai" ? "gpt-4.1-nano" : "",
        production,
      ]),
    );
  } catch (_e) {
    fail("CONNECTION_MODEL_POLICY_INVALID");
  }
}
const DEFINITIONS = {
  gemini: {
    scope: "global",
    settings: {},
    credentials: { apiKey: "GEMINI_API_KEY" },
    flag: "",
    required: ["apiKey"],
  },
  anthropic: {
    scope: "global",
    settings: {},
    credentials: { apiKey: "ANTHROPIC_API_KEY" },
    flag: "ENABLE_CLAUDE_FALLBACK",
    required: ["apiKey"],
  },
  openai: {
    scope: "global",
    settings: {},
    credentials: { apiKey: "OPENAI_API_KEY" },
    flag: "ENABLE_OPENAI_FALLBACK",
    required: ["apiKey"],
  },
  website: {
    scope: "dealer",
    settings: {
      origin: "CUSTOMER_HUB_URL",
      destinationId: "CUSTOMER_HUB_DESTINATION_ID",
    },
    credentials: { sharedSecret: "CUSTOMER_HUB_SECRET" },
    flag: "",
    required: ["origin", "destinationId", "sharedSecret"],
  },
  walkaround: {
    scope: "global",
    settings: {
      gcsBucket: "WALKAROUND_GCS_BUCKET",
      uploadBrokerUrl: "WALKAROUND_UPLOAD_BROKER_URL",
      youtubeBrokerUrl: "WALKAROUND_YOUTUBE_BROKER_URL",
    },
    credentials: {
      uploadBrokerToken: "WALKAROUND_UPLOAD_BROKER_TOKEN",
      youtubeBrokerToken: "WALKAROUND_YOUTUBE_BROKER_TOKEN",
      workerToken: "WALKAROUND_WORKER_TOKEN",
      workerSigningSecret: "WALKAROUND_WORKER_SIGNING_SECRET",
    },
    flag: "WALKAROUND_STUDIO_ENABLED",
    required: [
      "gcsBucket",
      "uploadBrokerUrl",
      "uploadBrokerToken",
      "workerToken",
      "workerSigningSecret",
    ],
  },
};
function fail(code) {
  throw new Error(code);
}
function environment(name) {
  try {
    return String($os.getenv(name) || "");
  } catch (_e) {
    return "";
  }
}
function definition(service) {
  if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, service))
    fail("CONNECTION_SERVICE_INVALID");
  return DEFINITIONS[service];
}
function keyFor(service, dealerId) {
  const def = definition(service);
  if (
    def.scope === "dealer" &&
    (typeof dealerId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(dealerId))
  )
    fail("CONNECTION_DEALER_REQUIRED");
  if (def.scope === "global" && dealerId) fail("CONNECTION_SCOPE_INVALID");
  return {
    scope: def.scope,
    dealer: def.scope === "dealer" ? dealerId : "",
    service: service,
  };
}
function authorize(service, dealerId, actor) {
  const key = keyFor(service, dealerId);
  if (!actor || typeof actor !== "object") fail("CONNECTION_FORBIDDEN");
  if (actor.role === "super_admin") return key;
  const dealer = (actor.dealer && actor.dealer.id) || actor.dealerId;
  if (key.scope !== "dealer" || actor.role !== "dealer_admin" || dealer !== key.dealer)
    fail("CONNECTION_FORBIDDEN");
  return key;
}
function encryptionKey() {
  const key = environment("CONNECTIONS_ENCRYPTION_KEY");
  if (!/^[\x21-\x7e]{32}$/.test(key)) fail("CONNECTION_SECURE_STORAGE_REQUIRED");
  return key;
}
function storageReady() {
  try {
    encryptionKey();
    return true;
  } catch (_e) {
    return false;
  }
}
function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, allowed) {
  if (
    !object(value) ||
    Object.keys(value).some(function (key) {
      return allowed.indexOf(key) < 0;
    })
  )
    fail("CONNECTION_FIELDS_INVALID");
}
function json(value) {
  try {
    return JSON.parse(value);
  } catch (_e) {
    fail("CONNECTION_CONFIG_CORRUPT");
  }
}
function readRecord(dao, collection, key) {
  // A storage/query failure is not absence: callers fail closed rather than
  // resurrecting environment credentials when managed storage is unavailable.
  const rows = dao.findRecordsByFilter(
    collection,
    "scope = {:scope} && dealer = {:dealer} && service = {:service}",
    "-created,-id",
    1,
    0,
    key,
  );
  return rows && rows.length ? rows[0] : null;
}
function recordNumber(record, name) {
  return Number(record.get(name) || 0);
}
function validCiphertext(text) {
  if (
    typeof text !== "string" ||
    text.length < 40 ||
    text.length > 32768 ||
    text.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)
  )
    return false;
  const padding = text.slice(-2) === "==" ? 2 : text.slice(-1) === "=" ? 1 : 0;
  // PB0.22 decrypt slices nonce[:12] without checking length. Never call it
  // until at least the 12-byte nonce and 16-byte GCM tag are present.
  return (text.length / 4) * 3 - padding >= 28;
}
function decrypt(record, key) {
  const encrypted = record.getString("ciphertext");
  if (!validCiphertext(encrypted)) fail("CONNECTION_CONFIG_CORRUPT");
  let envelope;
  try {
    envelope = json(toString($security.decrypt(encrypted, encryptionKey())));
  } catch (error) {
    if (String(error.message) === "CONNECTION_SECURE_STORAGE_REQUIRED") throw error;
    fail("CONNECTION_CONFIG_CORRUPT");
  }
  const revision = recordNumber(record, "revision");
  if (
    !object(envelope) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    envelope.version !== VERSION ||
    envelope.scope !== key.scope ||
    envelope.dealer !== key.dealer ||
    envelope.service !== key.service ||
    envelope.revision !== revision ||
    envelope.enabled !== record.getBool("enabled") ||
    !object(envelope.settings) ||
    !object(envelope.credentials)
  )
    fail("CONNECTION_CONFIG_CORRUPT");
  validateValues(key.service, envelope.settings, envelope.credentials, false);
  return envelope;
}
function canonicalOrigin(value) {
  if (typeof value !== "string" || value.length > 253) return "";
  const match = value.match(
    /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/,
  );
  if (
    !match ||
    match[1].split(".").some(function (part) {
      return part.length > 63;
    }) ||
    !/[a-z]/.test(match[1].split(".").pop())
  )
    return "";
  return value;
}
function approvedOrigin(value) {
  if (!value) return true;
  const origin = canonicalOrigin(value);
  if (!origin) return false;
  const allowed = environment("CONNECTIONS_ALLOWED_ORIGINS")
    .split(/[\s,]+/)
    .filter(Boolean);
  // Existing server-owned destinations are also explicit authority. Never
  // learn an approved domain from managed records or caller request data.
  [
    "CUSTOMER_HUB_URL",
    "WALKAROUND_UPLOAD_BROKER_URL",
    "WALKAROUND_YOUTUBE_BROKER_URL",
  ].forEach(function (name) {
    const legacy = canonicalOrigin(environment(name));
    if (legacy) allowed.push(legacy);
  });
  return allowed.indexOf(origin) >= 0;
}
function validateValues(service, settings, credentials, enforceOrigins) {
  const def = definition(service);
  exactKeys(settings, Object.keys(def.settings));
  exactKeys(credentials, Object.keys(def.credentials));
  Object.keys(settings).forEach(function (field) {
    const value = settings[field];
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      fail("CONNECTION_FIELDS_INVALID");
    if (!value) return;
    if (
      (field === "origin" || /BrokerUrl$/.test(field)) &&
      !(enforceOrigins ? approvedOrigin(value) : canonicalOrigin(value))
    )
      fail("CONNECTION_ORIGIN_NOT_APPROVED");
    if (field === "destinationId" && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value))
      fail("CONNECTION_FIELDS_INVALID");
    if (field === "gcsBucket" && !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(value))
      fail("CONNECTION_FIELDS_INVALID");
  });
  Object.keys(credentials).forEach(function (field) {
    const value = credentials[field];
    const min = field === "apiKey" ? 8 : 32;
    if (
      typeof value !== "string" ||
      (value &&
        (value.length < min || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)))
    )
      fail("CONNECTION_CREDENTIAL_INVALID");
  });
}
function isWebsiteCanaryDealer(dealerId) {
  const canaryDealer = environment("CUSTOMER_HUB_CANARY_DEALER_ID");
  return (
    /^[A-Za-z0-9_-]{1,64}$/.test(canaryDealer.trim()) &&
    dealerId === canaryDealer.trim() &&
    dealerId !== environment("CUSTOMER_HUB_DEALER_ID")
  );
}
function websiteCanaryEnvelope(dealerId) {
  const realDealer = environment("CUSTOMER_HUB_DEALER_ID");
  const secret = environment("CUSTOMER_HUB_CANARY_SECRET");
  let real = null;
  try {
    real = snapshot("website", realDealer);
  } catch (_e) {}
  const valid =
    environment("CUSTOMER_HUB_CANARY_DEALER_ID") === dealerId &&
    !!real &&
    real.enabled &&
    real.configured &&
    !real.error &&
    /^[\x21-\x7e]{32,512}$/.test(secret) &&
    secret !== environment("CUSTOMER_HUB_SECRET") &&
    secret !== real.values.CUSTOMER_HUB_SECRET;
  return {
    enabled: valid,
    settings: valid ? real.settings : {},
    credentials: valid ? { sharedSecret: secret } : {},
    // This discriminator binds proofs to the server's reserved synthetic mapping.
    canaryMapping: [
      "synthetic_canary",
      dealerId,
      realDealer,
      $security.sha256(
        JSON.stringify([
          environment("CUSTOMER_HUB_CANARY_DEALER_ID"),
          secret,
          real ? real.identity : "",
        ]),
      ),
    ],
  };
}
function envEnvelope(service, dealerId) {
  if (service === "website" && isWebsiteCanaryDealer(dealerId))
    return websiteCanaryEnvelope(dealerId);
  const def = definition(service);
  const settings = {},
    credentials = {};
  Object.keys(def.settings).forEach(function (field) {
    settings[field] = environment(def.settings[field]);
  });
  Object.keys(def.credentials).forEach(function (field) {
    credentials[field] = environment(def.credentials[field]);
  });
  let enabled = def.flag ? environment(def.flag).trim().toLowerCase() === "true" : true;
  if (service === "website" && environment("CUSTOMER_HUB_DEALER_ID") !== dealerId) {
    enabled = false;
    Object.keys(settings).forEach(function (field) {
      settings[field] = "";
    });
    Object.keys(credentials).forEach(function (field) {
      credentials[field] = "";
    });
  }
  return { settings: settings, credentials: credentials, enabled: enabled };
}
function identity(key, revision, envelope) {
  const def = definition(key.service);
  const values = Object.keys(def.settings)
    .sort()
    .map(function (field) {
      return [field, envelope.settings[field] || ""];
    })
    .concat(
      Object.keys(def.credentials)
        .sort()
        .map(function (field) {
          return [field, envelope.credentials[field] || ""];
        }),
    );
  if (envelope.canaryMapping) values.push(["canaryMapping", envelope.canaryMapping]);
  return $security.sha256(
    JSON.stringify([
      VERSION,
      key.scope,
      key.dealer,
      key.service,
      revision,
      envelope.enabled,
      values,
      providerPolicyIdentity(key.service),
    ]),
  );
}
function snapshot(service, dealerId, dao) {
  const key = keyFor(service, dealerId),
    def = definition(service);
  let record,
    envelope,
    error = "";
  try {
    record = readRecord(dao || $app.dao(), CONFIG_COLLECTION, key);
  } catch (_e) {
    error = "CONNECTION_STORAGE_UNAVAILABLE";
  }
  const source = record || error ? "managed" : "environment";
  const revision = record ? recordNumber(record, "revision") : 0;
  if (!error) {
    try {
      envelope = record ? decrypt(record, key) : envEnvelope(service, dealerId);
    } catch (e) {
      error = safeCode(String(e.message), "CONNECTION_CONFIG_CORRUPT");
    }
  }
  envelope = envelope || { enabled: false, settings: {}, credentials: {} };
  // Central origin revocation also blocks existing managed endpoints.
  if (record && !error) {
    try {
      validateValues(service, envelope.settings, envelope.credentials, true);
    } catch (e) {
      error = safeCode(String(e.message), "CONNECTION_CONFIG_CORRUPT");
    }
  }
  if (service === "website" && isWebsiteCanaryDealer(dealerId)) {
    const pinned = websiteCanaryEnvelope(dealerId);
    // Managed off/corrupt remains authoritative. A managed record cannot select
    // a different endpoint or key for the reserved synthetic dealership.
    if (
      !pinned.enabled ||
      (record &&
        (envelope.settings.origin !== pinned.settings.origin ||
          envelope.settings.destinationId !== pinned.settings.destinationId ||
          envelope.credentials.sharedSecret !== pinned.credentials.sharedSecret))
    )
      error = error || "CONNECTION_FIELDS_INVALID";
    envelope.canaryMapping = pinned.canaryMapping;
  }
  const configured =
    !error &&
    def.required.every(function (field) {
      return !!(envelope.settings[field] || envelope.credentials[field]);
    });
  const enabled = !error && envelope.enabled;
  const values = {};
  Object.keys(def.settings).forEach(function (field) {
    values[def.settings[field]] =
      enabled && configured ? envelope.settings[field] || "" : "";
  });
  Object.keys(def.credentials).forEach(function (field) {
    values[def.credentials[field]] =
      enabled && configured ? envelope.credentials[field] || "" : "";
  });
  if (def.flag) values[def.flag] = enabled && configured ? "true" : "false";
  if (service === "website")
    values.CUSTOMER_HUB_DEALER_ID = enabled && configured ? key.dealer : "";
  return {
    service: service,
    scope: key.scope,
    dealerId: key.dealer,
    source: source,
    revision: revision,
    identity: identity(key, revision, envelope),
    enabled: !!enabled,
    configured: !!configured,
    values: values,
    settings: envelope.settings,
    credentialConfigured: Object.keys(def.credentials).reduce(function (result, field) {
      result[field] = !!envelope.credentials[field];
      return result;
    }, {}),
    error: error,
  };
}
function runtimeSnapshot(service, dealerId) {
  return snapshot(service, dealerId);
}
function runtimeValue(name, dealerId) {
  const services = Object.keys(DEFINITIONS);
  for (let i = 0; i < services.length; i++) {
    const service = services[i],
      def = DEFINITIONS[service];
    const names = Object.keys(def.settings)
      .map(function (key) {
        return def.settings[key];
      })
      .concat(
        Object.keys(def.credentials).map(function (key) {
          return def.credentials[key];
        }),
      );
    if (def.flag) names.push(def.flag);
    if (service === "website") names.push("CUSTOMER_HUB_DEALER_ID");
    if (names.indexOf(name) >= 0)
      return (
        snapshot(service, def.scope === "dealer" ? dealerId : undefined).values[name] ||
        ""
      );
  }
  fail("CONNECTION_ENV_INVALID");
}
function proofFor(current, dao) {
  const key = keyFor(current.service, current.dealerId);
  let row;
  try {
    row = readRecord(dao || $app.dao(), PROOF_COLLECTION, key);
  } catch (_e) {
    return null;
  }
  if (
    !row ||
    row.getString("identity") !== current.identity ||
    recordNumber(row, "config_revision") !== current.revision
  )
    return null;
  return row;
}
function publicSettings(service, values) {
  const result = {};
  Object.keys(definition(service).settings).forEach(function (field) {
    const value = values[field] || "";
    try {
      const one = {};
      one[field] = value;
      validateValues(service, one, {}, false);
      result[field] = value;
    } catch (_e) {
      result[field] = "";
    }
  });
  return result;
}
function getPublicConfig(service, dealerId) {
  const current = snapshot(service, dealerId),
    proof = proofFor(current);
  const verification = { state: "not_tested", checkedAt: "", code: "", scope: "" };
  const capabilities = {
    text: false,
    images: false,
    video: false,
    website: false,
    processing: false,
    youtube: false,
  };
  if (proof) {
    const status = proof.getString("state");
    verification.state =
      ["testing", "verified", "failed", "unknown"].indexOf(status) >= 0
        ? status
        : "failed";
    verification.code = safeCode(proof.getString("code"), "");
    if (status === "failed" && verification.code === "CONNECTION_DRAFT_PENDING")
      verification.state = "not_tested";
    const age = elapsed(proof.getString("started_at"));
    if (status === "testing" && (age < 0 || age > TEST_LEASE_MS)) {
      verification.state = "unknown";
      verification.code = "CONNECTION_TEST_UNKNOWN";
    }
    if (status === "verified") {
      const checkedAge = elapsed(proof.getString("checked_at"));
      if (checkedAge < 0 || checkedAge > PROOF_VALID_MS) {
        verification.state = "not_tested";
        verification.code = "CONNECTION_PROOF_EXPIRED";
      } else {
        try {
          const names = JSON.parse(proof.getString("capabilities_json") || "[]");
          if (
            !Array.isArray(names) ||
            !names.length ||
            names.some(function (name) {
              return allowedCapabilities(service).indexOf(name) < 0;
            }) ||
            proof.getString("proof_kind") !== proofKind(service)
          )
            fail("CONNECTION_PROOF_INVALID");
          names.forEach(function (name) {
            capabilities[name] = true;
          });
        } catch (_e) {
          verification.state = "failed";
          verification.code = "CONNECTION_RESPONSE_INVALID";
        }
      }
    }
    const checked = proof.getString("checked_at");
    verification.checkedAt = Number.isFinite(Date.parse(checked)) ? checked : "";
    verification.scope =
      proof.getString("proof_kind") === proofKind(service) ? proofKind(service) : "";
  }
  // OpenAI is an image fallback in this product. A bounded text test verifies
  // credential access without claiming the image capability is ready.
  const sufficient =
    service === "openai"
      ? capabilities.images
      : service === "walkaround"
        ? capabilities.processing
        : service === "website"
          ? capabilities.website
          : capabilities.text;
  const state = current.error
    ? "attention"
    : !current.enabled
      ? "off"
      : !current.configured
        ? "needs_setup"
        : verification.state === "verified" && sufficient
          ? "ready"
          : verification.state === "testing"
            ? "testing"
            : verification.state === "failed"
              ? "attention"
              : "needs_test";
  return {
    service: current.service,
    scope: current.scope,
    dealerId: current.dealerId,
    source: current.source,
    revision: current.revision,
    enabled: current.enabled,
    configured: current.configured,
    state: state,
    settings: publicSettings(current.service, current.settings),
    credentialConfigured: current.credentialConfigured,
    verification: verification,
    capabilities: capabilities,
    storageReady: storageReady(),
    prerequisite: !storageReady()
      ? "Ask your system administrator to configure CONNECTIONS_ENCRYPTION_KEY as a dedicated 32-character secret before saving connections."
      : "",
    code: current.error,
  };
}
function writeFence(dao) {
  dao
    .db()
    .newQuery(
      "UPDATE managed_connections SET revision = revision WHERE id = (SELECT id FROM managed_connections LIMIT 1)",
    )
    .execute();
}
function saveConfig(service, dealerId, input, expectedRevision, actor) {
  const key = authorize(service, dealerId, actor),
    def = definition(service);
  exactKeys(input, [
    "enabled",
    "settings",
    "credentials",
    "confirmApply",
    "expectedRevision",
  ]);
  if (input.confirmApply !== true) fail("CONNECTION_APPLY_CONFIRMATION_REQUIRED");
  if (expectedRevision === undefined) expectedRevision = input.expectedRevision;
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    typeof input.enabled !== "boolean"
  )
    fail("CONNECTION_REVISION_REQUIRED");
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== expectedRevision
  )
    fail("CONNECTION_REVISION_CONFLICT");
  exactKeys(
    input.settings === undefined ? {} : input.settings,
    Object.keys(def.settings).concat(service === "website" ? ["url"] : []),
  );
  exactKeys(
    input.credentials === undefined ? {} : input.credentials,
    Object.keys(def.credentials),
  );
  const secureKey = encryptionKey();
  let output;
  $app.dao().runInTransaction(function (dao) {
    // Acquire SQLite's write fence before reading the revision (including a
    // first insert); a unique scoped index also rejects competing creations.
    writeFence(dao);
    let record = readRecord(dao, CONFIG_COLLECTION, key);
    const revision = record ? recordNumber(record, "revision") : 0;
    if (revision !== expectedRevision) fail("CONNECTION_REVISION_CONFLICT");
    let base;
    if (record) {
      try {
        base = decrypt(record, key);
      } catch (_e) {
        base = { settings: {}, credentials: {} };
      }
    } else base = envEnvelope(service, dealerId);
    const settings = {},
      credentials = {};
    Object.keys(def.settings).forEach(function (field) {
      settings[field] = base.settings[field] || "";
    });
    Object.keys(def.credentials).forEach(function (field) {
      credentials[field] = base.credentials[field] || "";
    });
    const updates = input.settings || {};
    Object.keys(updates).forEach(function (field) {
      if (field === "url") {
        if (updates.origin !== undefined && updates.origin !== updates.url)
          fail("CONNECTION_FIELDS_INVALID");
        settings.origin = updates.url;
      } else settings[field] = updates[field];
    });
    Object.keys(input.credentials || {}).forEach(function (field) {
      credentials[field] = input.credentials[field];
    });
    validateValues(service, settings, credentials, true);
    const envelope = {
      version: VERSION,
      scope: key.scope,
      dealer: key.dealer,
      service: service,
      revision: revision + 1,
      enabled: input.enabled,
      settings: settings,
      credentials: credentials,
    };
    const ciphertext = $security.encrypt(JSON.stringify(envelope), secureKey);
    if (!validCiphertext(ciphertext)) fail("CONNECTION_ENCRYPTION_FAILED");
    if (!record)
      record = new Record(dao.findCollectionByNameOrId(CONFIG_COLLECTION), key);
    record.set("revision", revision + 1);
    record.set("enabled", input.enabled);
    record.set("ciphertext", ciphertext);
    dao.saveRecord(record);
    // Keep durable operation keys; the new identity/revision invalidates their proof.
    output = revision + 1;
  });
  const result = getPublicConfig(service, dealerId);
  if (result.revision !== output) fail("CONNECTION_REVISION_CONFLICT");
  return result;
}
function inventory(dealerId, actor) {
  if (!actor || (actor.role !== "super_admin" && actor.role !== "dealer_admin"))
    fail("CONNECTION_FORBIDDEN");
  if (actor.role !== "super_admin" && (!actor.dealer || actor.dealer.id !== dealerId))
    fail("CONNECTION_FORBIDDEN");
  return Object.keys(DEFINITIONS)
    .filter(function (service) {
      return actor.role === "super_admin"
        ? service !== "website" || !!dealerId
        : service === "website";
    })
    .map(function (service) {
      return getPublicConfig(
        service,
        DEFINITIONS[service].scope === "dealer" ? dealerId : undefined,
      );
    });
}
// Tickets and proof identities are server-only. Never accept them as client
// claims. The route must resolve authenticated scope before calling reserve.
function reserveVerification(service, dealerId, expectedRevision, actor, operation) {
  const key = authorize(service, dealerId, actor);
  encryptionKey();
  operation = operation || {};
  exactKeys(operation, ["idempotencyKey", "proofId", "targetDealerId"]);
  const requestKey = operation.idempotencyKey;
  if (typeof requestKey !== "string" || !/^[A-Za-z0-9:_-]{8,128}$/.test(requestKey))
    fail("CONNECTION_OPERATION_REQUIRED");
  const proofId = operation.proofId === undefined ? "" : operation.proofId,
    targetDealerId =
      operation.targetDealerId === undefined ? "" : operation.targetDealerId;
  if (
    typeof proofId !== "string" ||
    !/^[A-Za-z0-9_-]{0,80}$/.test(proofId) ||
    typeof targetDealerId !== "string" ||
    !/^[A-Za-z0-9_-]{0,64}$/.test(targetDealerId)
  )
    fail("CONNECTION_PROOF_INVALID");
  const keyHash = $security.sha256(requestKey);
  const requestHash = $security.sha256(
    JSON.stringify([
      key.scope,
      key.dealer,
      service,
      expectedRevision,
      proofId,
      targetDealerId,
    ]),
  );
  let ticket;
  $app.dao().runInTransaction(function (dao) {
    writeFence(dao);
    const current = snapshot(service, dealerId, dao);
    let prior = dao.findRecordsByFilter(
      PROOF_COLLECTION,
      "scope = {:scope} && dealer = {:dealer} && service = {:service} && key_hash = {:keyHash}",
      "",
      1,
      0,
      Object.assign({}, key, { keyHash: keyHash }),
    );
    prior = prior && prior.length ? prior[0] : null;
    if (prior) {
      if (
        prior.getString("request_hash") !== requestHash ||
        prior.getString("identity") !== current.identity ||
        recordNumber(prior, "config_revision") !== current.revision
      )
        fail("CONNECTION_OPERATION_CONFLICT");
      let state = prior.getString("state");
      if (
        state === "testing" &&
        (elapsed(prior.getString("started_at")) < 0 ||
          elapsed(prior.getString("started_at")) > TEST_LEASE_MS)
      ) {
        state = "unknown";
        prior.set("state", state);
        prior.set("code", "CONNECTION_TEST_UNKNOWN");
        dao.saveRecord(prior);
      }
      ticket = {
        replay: true,
        state: state,
        service: service,
        dealerId: key.dealer,
        revision: current.revision,
        identity: current.identity,
        runId: prior.id,
      };
      return;
    }
    if (!Number.isInteger(expectedRevision) || current.revision !== expectedRevision)
      fail("CONNECTION_REVISION_CONFLICT");
    if (!current.enabled || !current.configured || current.error)
      fail("CONNECTION_NOT_CONFIGURED");
    const active = proofFor(current, dao);
    if (
      active &&
      active.getString("state") === "testing" &&
      elapsed(active.getString("started_at")) >= 0 &&
      elapsed(active.getString("started_at")) <= TEST_LEASE_MS
    )
      fail("CONNECTION_TEST_BUSY");
    const token = $security.randomString(32);
    const record = new Record(dao.findCollectionByNameOrId(PROOF_COLLECTION), key);
    record.set("key_hash", keyHash);
    record.set("request_hash", requestHash);
    record.set("identity", current.identity);
    record.set("config_revision", current.revision);
    record.set("attempt_hash", $security.sha256(token));
    record.set("state", "testing");
    record.set("started_at", new Date().toISOString());
    record.set("checked_at", "");
    record.set("code", "");
    record.set("proof_kind", "");
    record.set("capabilities_json", "[]");
    dao.saveRecord(record);
    ticket = {
      replay: false,
      service: service,
      dealerId: key.dealer,
      revision: current.revision,
      identity: current.identity,
      token: token,
      runId: record.id,
      snapshot: current,
    };
  });
  if (ticket.replay) ticket.result = getPublicConfig(service, dealerId);
  return ticket;
}
function finalizeVerification(ticket, proof) {
  // Only server-owned provider/receipt adapters may supply proof. Drop all
  // unrecognized payload fields and never persist response bodies or URLs.
  if (!object(ticket) || !object(proof)) fail("CONNECTION_PROOF_INVALID");
  const key = keyFor(ticket.service, ticket.dealerId),
    allowed = allowedCapabilities(ticket.service);
  const kind = proofKind(ticket.service);
  if (
    typeof proof.ok !== "boolean" ||
    !Array.isArray(proof.capabilities) ||
    proof.capabilities.some(function (name) {
      return allowed.indexOf(name) < 0;
    }) ||
    (proof.ok && !proof.capabilities.length)
  )
    fail("CONNECTION_PROOF_INVALID");
  const codes = [
    "CONNECTION_MODEL_POLICY_INVALID",
    "CONNECTION_TEST_FAILED",
    "CONNECTION_DRAFT_PENDING",
    "CONNECTION_TEST_TIMEOUT",
    "CONNECTION_RESPONSE_INVALID",
    "CONNECTION_AUTH_FAILED",
    "CONNECTION_RATE_LIMITED",
    "CONNECTION_TARGET_CHANGED",
  ];
  if (!proof.ok && codes.indexOf(proof.code) < 0) fail("CONNECTION_PROOF_INVALID");
  $app.dao().runInTransaction(function (dao) {
    writeFence(dao);
    const current = snapshot(ticket.service, ticket.dealerId, dao);
    let record;
    try {
      record = dao.findRecordById(PROOF_COLLECTION, ticket.runId);
    } catch (_e) {
      fail("CONNECTION_PROOF_STALE");
    }
    if (
      current.identity !== ticket.identity ||
      current.revision !== ticket.revision ||
      !current.enabled ||
      !current.configured ||
      !record ||
      record.getString("scope") !== key.scope ||
      record.getString("dealer") !== key.dealer ||
      record.getString("service") !== key.service ||
      record.getString("identity") !== ticket.identity ||
      recordNumber(record, "config_revision") !== ticket.revision ||
      record.getString("attempt_hash") !== $security.sha256(ticket.token) ||
      record.getString("state") !== "testing"
    )
      fail("CONNECTION_PROOF_STALE");
    if (
      elapsed(record.getString("started_at")) < 0 ||
      elapsed(record.getString("started_at")) > TEST_LEASE_MS
    )
      fail("CONNECTION_PROOF_STALE");
    record.set("state", proof.ok ? "verified" : "failed");
    record.set("checked_at", new Date().toISOString());
    record.set("proof_kind", kind);
    record.set("code", proof.ok ? "" : proof.code);
    record.set("capabilities_json", JSON.stringify(proof.ok ? proof.capabilities : []));
    record.set("attempt_hash", "");
    dao.saveRecord(record);
  });
  return getPublicConfig(ticket.service, ticket.dealerId);
}
// Health reads managed destination candidates in small pages, never dealership
// rosters. Incomplete or retired setup for one store cannot hide a healthy
// destination for another. The launch/admin surface supports up to 200 stores.
function hasConfiguredWebsite() {
  const legacyDealer = String($os.getenv("CUSTOMER_HUB_DEALER_ID") || "").trim();
  if (legacyDealer) {
    try {
      const current = runtimeSnapshot("website", legacyDealer);
      if (current.enabled && current.configured && !current.error) return true;
    } catch (_e) {}
  }
  try {
    const dao = $app.dao();
    for (let offset = 0; offset < 200; offset += 10) {
      const rows = dao.findRecordsByFilter(
        CONFIG_COLLECTION,
        "scope = 'dealer' && service = 'website' && enabled = true",
        "+created,+id",
        10,
        offset,
      );
      for (let i = 0; i < rows.length; i++) {
        try {
          const dealerId = rows[i].getString("dealer");
          const dealer = dao.findRecordById("dealers", dealerId);
          if (dealer.getBool("is_system")) continue;
          const current = runtimeSnapshot("website", dealerId);
          if (current.enabled && current.configured && !current.error) return true;
        } catch (_e) {} // A deleted or corrupt store does not represent other stores.
      }
      if (rows.length < 10) break;
    }
  } catch (_e) {}
  return false;
}
function verifyStoredEncryption() {
  let count = 0;
  try {
    const rows = $app
      .dao()
      .findRecordsByFilter(CONFIG_COLLECTION, 'id != ""', "+id", 5001, 0);
    count = rows ? rows.length : 0;
    if (count > 5000) return { ok: false, count: count };
    if (count === 0) return { ok: true, count: 0 };
    encryptionKey();
    for (let i = 0; i < count; i++) {
      const record = rows[i];
      const key = keyFor(record.getString("service"), record.getString("dealer"));
      if (record.getString("scope") !== key.scope) fail("CONNECTION_CONFIG_CORRUPT");
      // Recoverability does not depend on this isolated restore host's current
      // approved endpoints. Decrypt still validates every value and binding.
      decrypt(record, key);
    }
    return { ok: true, count: count };
  } catch (_e) {
    return { ok: false, count: count };
  }
}
module.exports = {
  verifyStoredEncryption: verifyStoredEncryption,
  runtimeValue: runtimeValue,
  runtimeSnapshot: runtimeSnapshot,
  hasConfiguredWebsite: hasConfiguredWebsite,
  getPublicConfig: getPublicConfig,
  saveConfig: saveConfig,
  inventory: inventory,
  reserveVerification: reserveVerification,
  finalizeVerification: finalizeVerification,
  authorize: authorize,
  validCiphertext: validCiphertext,
  approvedOrigin: approvedOrigin,
};
