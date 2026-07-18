/**
 * Pure request policies shared by PocketBase hooks. Keeping these free of
 * PocketBase globals makes the security-sensitive decisions regression-testable.
 */

function serializeProxyBody(requestInfo) {
  if (
    !requestInfo ||
    requestInfo.method !== "POST" ||
    requestInfo.data === undefined ||
    requestInfo.data === null
  ) {
    return "";
  }
  return JSON.stringify(requestInfo.data);
}

function recordBool(record, fieldName) {
  if (!record) return false;
  if (typeof record.getBool === "function") {
    return record.getBool(fieldName);
  }
  if (typeof record.get === "function") {
    return !!record.get(fieldName);
  }
  return false;
}

function initialApprovalStatus(dealer) {
  return recordBool(dealer, "requires_approval") ? "pending" : "n_a";
}

function isValidAdminDealerCode(value) {
  const raw = value === undefined || value === null ? "" : value.toString();
  return /^[A-Za-z0-9]{12}$/.test(raw);
}

// Canonical disclosure templates for approval-bound social copy. These are an
// authorization contract, not a UI hint: a client-provided marker or edited
// approximation never satisfies the required text.
const POST_COMPLIANCE_RULES = [
  {
    category: "financing_apr",
    patterns: [
      /\b\d{1,2}(?:\.\d{1,2})?\s*%\s*apr\b/i,
      /\bzero\s+percent\s+apr\b/i,
      /\b0\s*apr\b/i,
      /\bfinancing\s+as\s+low\s+as\b/i,
    ],
    disclosure:
      "Financing subject to credit approval through dealer-participating lenders. Advertised APR is for qualified buyers (top-tier credit) and may vary by term, lender, and applicant credit. Not all buyers will qualify. See dealer for complete terms.",
  },
  {
    category: "zero_down",
    patterns: [
      /\$\s*0\s+down\b/i,
      /\bno\s+money\s+down\b/i,
      /\$\s*0\s+due\s+at\s+signing\b/i,
      /\bzero\s+down\b/i,
    ],
    disclosure:
      "Sign-and-drive offer subject to credit approval. First payment may be due at signing. Taxes, title, license, registration, and dealer documentary fees additional.",
  },
  {
    category: "lease",
    patterns: [
      /\blease\s+(?:for|from|starting\s+at)\b/i,
      /\$\d+(?:\.\d{1,2})?\s*\/?\s*mo(?:nth)?\b/i,
      /\bmonthly\s+lease\b/i,
      /\b\d+\s*-month\s+lease\b/i,
    ],
    disclosure:
      "Lease offer with approved credit through participating captive or third-party lender. Excludes tax, title, license, registration, acquisition, disposition, and dealer documentary fees. Mileage and wear-and-tear limits apply. Lessee responsible for excess. See dealer for full terms.",
  },
  {
    category: "rebate_pricing",
    patterns: [
      /\$\d[\d,]*\s+off\s+msrp\b/i,
      /\$\d[\d,]*\s+below\s+(?:invoice|msrp)\b/i,
      /\bsave\s+up\s+to\s+\$\d[\d,]*/i,
      /\b\d+%\s+off\b/i,
    ],
    disclosure:
      "Pricing excludes tax, title, license, registration, and dealer documentary fees. Offer applies to specific stock units only — stock # available upon request. Cannot be combined with all incentives. Offer expires end of month or while supplies last.",
  },
  {
    category: "trade_value",
    patterns: [
      /\btrade(?:-|\s)?in\s+value\b/i,
      /\bworth\s+up\s+to\s+\$\d[\d,]*/i,
      /\bguaranteed\s+trade\s+value\b/i,
    ],
    disclosure:
      "Trade-in value is an estimate based on industry guides and is subject to a physical inspection. Final trade allowance is at the dealer's discretion and may vary based on condition, mileage, and market.",
  },
];

const POST_PROHIBITED_PATTERNS = [
  /\bguaranteed\s+(?:approval|credit|financing)\b/i,
  /\bno\s+credit\s+check\b/i,
  /\beveryone\s+(?:approved|gets\s+approved)\b/i,
  /\b100%\s+(?:approval|approved)\b/i,
];

function normalizeCompliancePhrase(value) {
  let text = (value || "").toString();
  // NFKC is available in browsers and newer JSVMs; PocketBase 0.22 builds that
  // omit it still get deterministic ASCII/case/punctuation normalization.
  try {
    if (typeof text.normalize === "function") text = text.normalize("NFKC");
  } catch (_e) {}
  return text
    .toLowerCase()
    .replace(
      /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\u2010-\u2027\u2030-\u205e\u20a0-\u20cf]+/g,
      " ",
    )
    .trim();
}

function parseDealerBannedPhrases(value) {
  const raw = Array.isArray(value) ? value : (value || "").toString().split(/[\n,]+/);
  const phrases = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const phrase = (raw[i] || "").toString().trim();
    const normalized = normalizeCompliancePhrase(phrase);
    if (!normalized || seen[normalized]) continue;
    seen[normalized] = true;
    phrases.push({ original: phrase, normalized: normalized });
  }
  return phrases;
}

function canonicalPostCompliance(caption, bannedPhrases) {
  const text = (caption || "").toString();
  const categories = [];
  const disclosureTexts = [];
  for (let i = 0; i < POST_COMPLIANCE_RULES.length; i++) {
    const rule = POST_COMPLIANCE_RULES[i];
    let matched = false;
    for (let j = 0; j < rule.patterns.length; j++) {
      if (rule.patterns[j].test(text)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      categories.push(rule.category);
      disclosureTexts.push(rule.disclosure);
    }
  }

  let legalProhibited = false;
  for (let i = 0; i < POST_PROHIBITED_PATTERNS.length; i++) {
    if (POST_PROHIBITED_PATTERNS[i].test(text)) {
      legalProhibited = true;
      break;
    }
  }

  const normalizedCaption = " " + normalizeCompliancePhrase(text) + " ";
  const blockedPhrases = [];
  const dealerPhrases = parseDealerBannedPhrases(bannedPhrases);
  for (let i = 0; i < dealerPhrases.length; i++) {
    if (normalizedCaption.indexOf(" " + dealerPhrases[i].normalized + " ") !== -1) {
      blockedPhrases.push(dealerPhrases[i].original);
    }
  }

  return {
    categories: categories,
    required_disclosures: disclosureTexts.length
      ? "— Disclosures —\n" + disclosureTexts.join(" ")
      : "",
    legal_prohibited: legalProhibited,
    dealer_blocked_phrases: blockedPhrases,
  };
}

function validatePostCompliance(caption, disclosures, bannedPhrases) {
  const text = (caption || "").toString();
  const supplied = (disclosures || "").toString().replace(/\r\n?/g, "\n").trim();
  const result = canonicalPostCompliance(text, bannedPhrases);

  if (text.indexOf("— Disclosures —") !== -1) {
    return {
      ...result,
      ok: false,
      error: "Compliance disclosures must be submitted separately from the caption",
    };
  }
  if (result.legal_prohibited || result.dealer_blocked_phrases.length > 0) {
    return {
      ...result,
      ok: false,
      error: result.legal_prohibited
        ? "Caption contains prohibited advertising claims"
        : "Caption contains wording blocked by this dealership",
    };
  }
  if (supplied !== result.required_disclosures) {
    return {
      ...result,
      ok: false,
      error: result.required_disclosures
        ? "Caption requires the exact canonical compliance disclosures"
        : "Disclosures must be empty when no compliance trigger applies",
    };
  }

  return { ...result, ok: true, error: "" };
}

// These filters are always injected by the server. Client payloads are not
// allowed to contain `safetySettings`, so a browser cannot lower a threshold.
const SERVER_SAFETY_SETTINGS = [
  {
    category: "HARM_CATEGORY_HATE_SPEECH",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
  {
    category: "HARM_CATEGORY_HARASSMENT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
  {
    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
  {
    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
];

// Language-neutral contract mirrored from config/gemini-model-policy.json.
// `scripts/check-model-policy.mjs` and Vitest fail if this snapshot drifts.
const GEMINI_MODEL_POLICY_SNAPSHOT = {
  version: 1,
  verifiedAt: "2026-07-17",
  models: {
    textQuality: "gemini-3.5-flash",
    textFast: "gemini-3.1-flash-lite",
    imageStandard: "gemini-3.1-flash-image",
    imageStudio: "gemini-3-pro-image",
    imageLite: "gemini-3.1-flash-lite-image",
    videoStandard: "veo-3.1-fast-generate-preview",
    videoQuality: "veo-3.1-generate-preview",
  },
  tasks: {
    caption: {
      kind: "text",
      tier: "quality",
      models: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
      maxOutputTokens: 2048,
    },
    caption_regenerate: {
      kind: "text",
      tier: "quality",
      models: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
      maxOutputTokens: 2048,
    },
    caption_edit: {
      kind: "text",
      tier: "fast",
      models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
      maxOutputTokens: 2048,
    },
    image_standard: {
      kind: "image",
      tier: "standard",
      models: [
        "gemini-3.1-flash-image",
        "gemini-3-pro-image",
        "gemini-3.1-flash-lite-image",
      ],
      maxOutputTokens: 4096,
      imageSizes: {
        "gemini-3.1-flash-image": "2K",
        "gemini-3-pro-image": "2K",
        "gemini-3.1-flash-lite-image": "1K",
      },
    },
    image_studio: {
      kind: "image",
      tier: "studio",
      models: [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gemini-3.1-flash-lite-image",
      ],
      maxOutputTokens: 4096,
      imageSizes: {
        "gemini-3-pro-image": "2K",
        "gemini-3.1-flash-image": "2K",
        "gemini-3.1-flash-lite-image": "1K",
      },
    },
    video_standard: {
      kind: "video",
      tier: "standard",
      models: ["veo-3.1-fast-generate-preview"],
      resolution: "720p",
    },
    video_quality: {
      kind: "video",
      tier: "quality",
      models: ["veo-3.1-generate-preview"],
      resolution: "1080p",
    },
  },
  allowedRequestFields: {
    generateContent: {
      topLevel: ["contents", "generationConfig"],
      content: ["parts"],
      textPart: ["text"],
      imagePart: ["inlineData"],
      inlineData: ["mimeType", "data"],
      textGenerationConfig: ["maxOutputTokens"],
      imageGenerationConfig: ["responseModalities", "imageConfig", "maxOutputTokens"],
      imageConfig: ["imageSize"],
      legacyImageGenerationConfig: [
        "responseModalities",
        "responseFormat",
        "maxOutputTokens",
      ],
      legacyResponseFormat: ["image"],
      legacyResponseFormatImage: ["imageSize"],
    },
    veo: {
      topLevel: ["instances", "parameters"],
      instance: ["prompt", "image"],
      image: ["bytesBase64Encoded", "mimeType"],
      legacyImage: ["inlineData"],
      parameters: ["aspectRatio", "personGeneration", "durationSeconds", "resolution"],
    },
  },
  requestLimits: {
    maxPromptChars: 20000,
    maxInlineImageChars: 16 * 1024 * 1024,
    maxTotalInlineImageChars: 20 * 1024 * 1024,
    maxTextImages: 1,
    maxImageTaskImages: 2,
  },
  safetySettings: SERVER_SAFETY_SETTINGS,
};

function geminiModelPolicySnapshot() {
  return JSON.parse(JSON.stringify(GEMINI_MODEL_POLICY_SNAPSHOT));
}

function uniqueModelsForTasks(taskNames) {
  const seen = {};
  const models = [];
  for (let i = 0; i < taskNames.length; i++) {
    const task = GEMINI_MODEL_POLICY_SNAPSHOT.tasks[taskNames[i]];
    for (let j = 0; j < task.models.length; j++) {
      const model = task.models[j];
      if (!seen[model]) {
        seen[model] = true;
        models.push(model);
      }
    }
  }
  return models;
}

const TEXT_GENERATE_CONTENT_MODELS = uniqueModelsForTasks([
  "caption",
  "caption_regenerate",
  "caption_edit",
]);
const IMAGE_GENERATE_CONTENT_MODELS = uniqueModelsForTasks([
  "image_standard",
  "image_studio",
]);
const ALLOWED_GENERATE_CONTENT_MODELS = TEXT_GENERATE_CONTENT_MODELS.concat(
  IMAGE_GENERATE_CONTENT_MODELS,
);
const ALLOWED_VEO_MODELS = uniqueModelsForTasks(["video_standard", "video_quality"]);

/**
 * The client-side router is a preference, not an authorization boundary.
 * Restrict the provider proxy to the exact model/method pairs the app uses so
 * an authenticated browser cannot select an arbitrary expensive model.
 */
function isAllowedProxyPath(path) {
  // Strip query/hash — clients and path extractors sometimes append ?alt=media.
  const normalized = (path || "")
    .toString()
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+/, "");

  const contentMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):generateContent$/i,
  );
  if (contentMatch) {
    return ALLOWED_GENERATE_CONTENT_MODELS.indexOf(contentMatch[1]) !== -1;
  }

  const veoStartMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):predictLongRunning$/i,
  );
  if (veoStartMatch) {
    return ALLOWED_VEO_MODELS.indexOf(veoStartMatch[1]) !== -1;
  }

  if (/^v1beta\/operations\/[a-z0-9._~-]+$/i.test(normalized)) {
    return true;
  }

  const modelOperationMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+)\/operations\/[a-z0-9._~-]+$/i,
  );
  if (modelOperationMatch) {
    return ALLOWED_VEO_MODELS.indexOf(modelOperationMatch[1]) !== -1;
  }

  return /^v1beta\/files\/[a-z0-9._~-]+:download$/i.test(normalized);
}

function isAllowedProxyRequest(path, method) {
  if (!isAllowedProxyPath(path)) return false;
  const normalizedMethod = (method || "").toString().toUpperCase();
  const isGenerationStart =
    /:generateContent$/i.test(path || "") || /:predictLongRunning$/i.test(path || "");

  if (normalizedMethod === "POST") return isGenerationStart;
  if (normalizedMethod === "GET") return !isGenerationStart;
  return false;
}

function providerOperationStartProvider(path, method) {
  if ((method || "").toString().toUpperCase() !== "POST") return null;
  const normalized = (path || "").toString();

  const geminiMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):predictLongRunning$/i,
  );
  if (geminiMatch && ALLOWED_VEO_MODELS.indexOf(geminiMatch[1]) !== -1) {
    return "gemini";
  }

  // Vertex paths remain denied by isAllowedProxyPath today. Keeping their
  // canonical ownership grammar here makes that future path fail closed if it
  // is deliberately enabled later.
  if (
    /^vertex\/v1(?:beta1)?\/projects\/[a-z0-9._-]+\/locations\/[a-z0-9-]+\/publishers\/google\/models\/[a-z0-9._-]+:predictLongRunning$/i.test(
      normalized,
    )
  ) {
    return "vertex";
  }

  return null;
}

function providerOperationFromName(name, provider) {
  let normalized = (name || "").toString().trim().replace(/^\/+/, "");
  if (!normalized || normalized.length > 500) return null;

  if (provider === "gemini") {
    normalized = normalized.replace(/^v1beta\//i, "");
    if (/^operations\/[a-z0-9._~-]+$/i.test(normalized)) {
      return {
        provider: "gemini",
        resource_type: "operation",
        resource_id: normalized,
      };
    }
    const modelMatch = normalized.match(
      /^models\/([a-z0-9._-]+)\/operations\/[a-z0-9._~-]+$/i,
    );
    if (modelMatch && ALLOWED_VEO_MODELS.indexOf(modelMatch[1]) !== -1) {
      return {
        provider: "gemini",
        resource_type: "operation",
        resource_id: normalized,
      };
    }
    return null;
  }

  if (provider === "vertex") {
    normalized = normalized.replace(/^vertex\//i, "").replace(/^v1(?:beta1)?\//i, "");
    if (
      /^projects\/[a-z0-9._-]+\/locations\/[a-z0-9-]+\/operations\/[a-z0-9._~-]+$/i.test(
        normalized,
      )
    ) {
      return {
        provider: "vertex",
        resource_type: "operation",
        resource_id: normalized,
      };
    }
  }

  return null;
}

/** Canonicalize an authorized poll/download request into its durable key. */
function providerResourceRequest(path, method) {
  if ((method || "").toString().toUpperCase() !== "GET") return null;
  const normalized = (path || "").toString();

  let match = normalized.match(/^v1beta\/(operations\/[a-z0-9._~-]+)$/i);
  if (match) {
    return {
      provider: "gemini",
      resource_type: "operation",
      resource_id: match[1],
    };
  }

  match = normalized.match(
    /^v1beta\/(models\/([a-z0-9._-]+)\/operations\/[a-z0-9._~-]+)$/i,
  );
  if (match && ALLOWED_VEO_MODELS.indexOf(match[2]) !== -1) {
    return {
      provider: "gemini",
      resource_type: "operation",
      resource_id: match[1],
    };
  }

  match = normalized.match(/^v1beta\/(files\/[a-z0-9._~-]+):download$/i);
  if (match) {
    return {
      provider: "gemini",
      resource_type: "file",
      resource_id: match[1],
    };
  }

  match = normalized.match(
    /^vertex\/v1(?:beta1)?\/(projects\/[a-z0-9._-]+\/locations\/[a-z0-9-]+\/operations\/[a-z0-9._~-]+)$/i,
  );
  if (match) {
    return {
      provider: "vertex",
      resource_type: "operation",
      resource_id: match[1],
    };
  }

  return null;
}

function providerFileFromUri(uri) {
  const match = (uri || "")
    .toString()
    .trim()
    .match(
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/(files\/[a-z0-9._~-]+):download(?:\?[^#\s\\]*)?$/i,
    );
  if (!match) return null;
  return {
    provider: "gemini",
    resource_type: "file",
    resource_id: match[1],
  };
}

/**
 * Extract only provider identifiers the client will subsequently poll or
 * download. Traversal is bounded and file IDs are accepted only from known URI
 * fields with Google's exact HTTPS origin; prompts/text cannot create claims.
 */
function providerResourcesFromResponse(path, responseBody) {
  if (!isObject(responseBody)) return [];
  const startProvider = providerOperationStartProvider(path, "POST");
  const requested = providerResourceRequest(path, "GET");
  if (!startProvider && (!requested || requested.resource_type !== "operation")) {
    return [];
  }

  const resources = [];
  const seen = {};
  const add = (resource) => {
    if (!resource) return;
    const key =
      resource.provider + ":" + resource.resource_type + ":" + resource.resource_id;
    if (seen[key] || resources.length >= 32) return;
    seen[key] = true;
    resources.push(resource);
  };

  if (startProvider && typeof responseBody.name === "string") {
    add(providerOperationFromName(responseBody.name, startProvider));
  }

  let visited = 0;
  const walk = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 12 || visited >= 512) {
      return;
    }
    visited += 1;
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const child = value[key];
      const normalizedKey = key.toLowerCase();
      if (
        typeof child === "string" &&
        (normalizedKey === "uri" ||
          normalizedKey === "fileuri" ||
          normalizedKey === "file_uri" ||
          normalizedKey === "videouri" ||
          normalizedKey === "video_uri")
      ) {
        add(providerFileFromUri(child));
      } else if (child && typeof child === "object") {
        walk(child, depth + 1);
      }
    }
  };
  walk(responseBody, 0);

  return resources;
}

const GEMINI_REQUEST_FIELDS = GEMINI_MODEL_POLICY_SNAPSHOT.allowedRequestFields;
const GEMINI_REQUEST_LIMITS = GEMINI_MODEL_POLICY_SNAPSHOT.requestLimits;
const MAX_PROMPT_CHARS = GEMINI_REQUEST_LIMITS.maxPromptChars;
const MAX_INLINE_IMAGE_CHARS = GEMINI_REQUEST_LIMITS.maxInlineImageChars;
const MAX_TOTAL_INLINE_IMAGE_CHARS = GEMINI_REQUEST_LIMITS.maxTotalInlineImageChars;
const ALLOWED_INLINE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys, requiredKeys) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (allowedKeys.indexOf(keys[i]) === -1) return false;
  }
  for (let i = 0; i < requiredKeys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, requiredKeys[i])) {
      return false;
    }
  }
  return true;
}

function sanitizeInlineImage(part) {
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  if (!hasOnlyKeys(part, fields.imagePart, fields.imagePart)) return null;
  const inlineData = part.inlineData;
  if (!hasOnlyKeys(inlineData, fields.inlineData, fields.inlineData)) {
    return null;
  }

  const mimeType = (inlineData.mimeType || "").toString().toLowerCase();
  const data = inlineData.data;
  if (
    ALLOWED_INLINE_IMAGE_TYPES.indexOf(mimeType) === -1 ||
    typeof data !== "string" ||
    data.length < 4 ||
    data.length > MAX_INLINE_IMAGE_CHARS ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    return null;
  }

  return { inlineData: { mimeType: mimeType, data: data } };
}

function sanitizeGenerateContentContents(input, minImages, maxImages) {
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  if (!Array.isArray(input) || input.length !== 1) return null;
  const content = input[0];
  if (!hasOnlyKeys(content, fields.content, fields.content)) return null;
  if (!Array.isArray(content.parts) || !content.parts.length) return null;

  let textCount = 0;
  let imageCount = 0;
  let totalImageChars = 0;
  const parts = [];

  for (let i = 0; i < content.parts.length; i++) {
    const part = content.parts[i];
    if (!isObject(part)) return null;

    if (Object.prototype.hasOwnProperty.call(part, "text")) {
      if (!hasOnlyKeys(part, fields.textPart, fields.textPart)) return null;
      if (
        typeof part.text !== "string" ||
        !part.text.trim() ||
        part.text.length > MAX_PROMPT_CHARS
      ) {
        return null;
      }
      textCount += 1;
      parts.push({ text: part.text });
      continue;
    }

    const imagePart = sanitizeInlineImage(part);
    if (!imagePart) return null;
    imageCount += 1;
    totalImageChars += imagePart.inlineData.data.length;
    if (imageCount > maxImages || totalImageChars > MAX_TOTAL_INLINE_IMAGE_CHARS) {
      return null;
    }
    parts.push(imagePart);
  }

  if (textCount !== 1 || imageCount < minImages || imageCount > maxImages) {
    return null;
  }
  return [{ parts: parts }];
}

function buildGenerateContentRequest(model, input) {
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  // Deliberately omit `safetySettings` from the accepted client keys. The
  // canonical server policy below is the only safety configuration forwarded.
  if (!hasOnlyKeys(input, fields.topLevel, fields.topLevel)) {
    return null;
  }

  const generationConfig = input.generationConfig;
  if (TEXT_GENERATE_CONTENT_MODELS.indexOf(model) !== -1) {
    const requiredMaxOutputTokens =
      GEMINI_MODEL_POLICY_SNAPSHOT.tasks.caption.maxOutputTokens;
    if (
      !hasOnlyKeys(
        generationConfig,
        fields.textGenerationConfig,
        fields.textGenerationConfig,
      ) ||
      generationConfig.maxOutputTokens !== requiredMaxOutputTokens
    ) {
      return null;
    }

    const contents = sanitizeGenerateContentContents(
      input.contents,
      0,
      GEMINI_REQUEST_LIMITS.maxTextImages,
    );
    if (!contents) return null;
    return {
      contents: contents,
      generationConfig: {
        maxOutputTokens: generationConfig.maxOutputTokens,
      },
      safetySettings: SERVER_SAFETY_SETTINGS,
    };
  }

  if (IMAGE_GENERATE_CONTENT_MODELS.indexOf(model) === -1) return null;
  const requiredMaxOutputTokens =
    GEMINI_MODEL_POLICY_SNAPSHOT.tasks.image_standard.maxOutputTokens;
  if (
    generationConfig.maxOutputTokens !== requiredMaxOutputTokens ||
    !Array.isArray(generationConfig.responseModalities) ||
    generationConfig.responseModalities.length !== 2 ||
    generationConfig.responseModalities[0] !== "TEXT" ||
    generationConfig.responseModalities[1] !== "IMAGE"
  ) {
    return null;
  }

  // Prefer generationConfig.imageConfig.imageSize ("1K"|"2K" string tokens).
  // Legacy clients sent responseFormat.image.imageSize; Google now treats that
  // nested field as a protobuf enum and rejects bare "2K". Always rewrite to
  // imageConfig before proxying.
  const requiredSize =
    GEMINI_MODEL_POLICY_SNAPSHOT.tasks.image_standard.imageSizes[model] ||
    GEMINI_MODEL_POLICY_SNAPSHOT.tasks.image_studio.imageSizes[model];
  if (!requiredSize) return null;
  let requestedSize = "";
  const hasImageConfig =
    generationConfig.imageConfig &&
    typeof generationConfig.imageConfig === "object" &&
    hasOnlyKeys(generationConfig.imageConfig, fields.imageConfig, fields.imageConfig);
  const hasLegacyResponseFormat =
    generationConfig.responseFormat &&
    typeof generationConfig.responseFormat === "object" &&
    hasOnlyKeys(
      generationConfig.responseFormat,
      fields.legacyResponseFormat,
      fields.legacyResponseFormat,
    ) &&
    generationConfig.responseFormat.image &&
    typeof generationConfig.responseFormat.image === "object" &&
    hasOnlyKeys(
      generationConfig.responseFormat.image,
      fields.legacyResponseFormatImage,
      fields.legacyResponseFormatImage,
    );

  if (hasImageConfig) {
    if (
      !hasOnlyKeys(
        generationConfig,
        fields.imageGenerationConfig,
        fields.imageGenerationConfig,
      )
    ) {
      return null;
    }
    requestedSize = generationConfig.imageConfig.imageSize;
  } else if (hasLegacyResponseFormat) {
    if (
      !hasOnlyKeys(
        generationConfig,
        fields.legacyImageGenerationConfig,
        fields.legacyImageGenerationConfig,
      )
    ) {
      return null;
    }
    requestedSize = generationConfig.responseFormat.image.imageSize;
  } else {
    return null;
  }

  if (requestedSize !== requiredSize) {
    return null;
  }

  const contents = sanitizeGenerateContentContents(
    input.contents,
    1,
    GEMINI_REQUEST_LIMITS.maxImageTaskImages,
  );
  if (!contents) return null;
  return {
    contents: contents,
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: requiredSize },
      maxOutputTokens: requiredMaxOutputTokens,
    },
    safetySettings: SERVER_SAFETY_SETTINGS,
  };
}

function buildVeoRequest(model, input) {
  const fields = GEMINI_REQUEST_FIELDS.veo;
  if (
    !hasOnlyKeys(input, fields.topLevel, fields.topLevel) ||
    !Array.isArray(input.instances) ||
    input.instances.length !== 1
  ) {
    return null;
  }

  const instance = input.instances[0];
  if (
    !hasOnlyKeys(instance, fields.instance, fields.instance) ||
    typeof instance.prompt !== "string" ||
    !instance.prompt.trim() ||
    instance.prompt.length > MAX_PROMPT_CHARS ||
    !instance.image ||
    typeof instance.image !== "object"
  ) {
    return null;
  }

  // Accept either Veo-native { bytesBase64Encoded, mimeType } or legacy
  // Gemini-style { inlineData: { data, mimeType } }, always emit Veo-native.
  let veoImage = null;
  if (hasOnlyKeys(instance.image, fields.image, fields.image)) {
    const sanitized = sanitizeInlineImage({
      inlineData: {
        mimeType: instance.image.mimeType,
        data: instance.image.bytesBase64Encoded,
      },
    });
    if (sanitized) {
      veoImage = {
        bytesBase64Encoded: sanitized.inlineData.data,
        mimeType: sanitized.inlineData.mimeType,
      };
    }
  } else if (hasOnlyKeys(instance.image, fields.legacyImage, fields.legacyImage)) {
    const sanitized = sanitizeInlineImage({
      inlineData: instance.image.inlineData,
    });
    if (sanitized) {
      veoImage = {
        bytesBase64Encoded: sanitized.inlineData.data,
        mimeType: sanitized.inlineData.mimeType,
      };
    }
  }
  if (!veoImage) return null;

  const parameters = input.parameters;
  if (
    !hasOnlyKeys(parameters, fields.parameters, fields.parameters) ||
    ["16:9", "9:16"].indexOf(parameters.aspectRatio) === -1 ||
    parameters.personGeneration !== "allow_adult" ||
    [4, 6, 8].indexOf(parameters.durationSeconds) === -1 ||
    ["720p", "1080p"].indexOf(parameters.resolution) === -1 ||
    (model === GEMINI_MODEL_POLICY_SNAPSHOT.models.videoStandard &&
      parameters.resolution !==
        GEMINI_MODEL_POLICY_SNAPSHOT.tasks.video_standard.resolution) ||
    (model === GEMINI_MODEL_POLICY_SNAPSHOT.models.videoQuality &&
      parameters.resolution !==
        GEMINI_MODEL_POLICY_SNAPSHOT.tasks.video_quality.resolution) ||
    (parameters.resolution === "1080p" && parameters.durationSeconds !== 8)
  ) {
    return null;
  }

  return {
    instances: [
      {
        prompt: instance.prompt,
        image: veoImage,
      },
    ],
    parameters: {
      aspectRatio: parameters.aspectRatio,
      personGeneration: "allow_adult",
      durationSeconds: parameters.durationSeconds,
      resolution: parameters.resolution,
    },
  };
}

function buildGeminiProxyRequest(path, input) {
  const normalized = (path || "").toString();
  const contentMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):generateContent$/i,
  );
  if (contentMatch && ALLOWED_GENERATE_CONTENT_MODELS.indexOf(contentMatch[1]) !== -1) {
    return buildGenerateContentRequest(contentMatch[1], input);
  }

  const veoMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):predictLongRunning$/i,
  );
  if (veoMatch && ALLOWED_VEO_MODELS.indexOf(veoMatch[1]) !== -1) {
    return buildVeoRequest(veoMatch[1], input);
  }

  return null;
}

function buildOpenAIImageRequest(input) {
  const data = input && typeof input === "object" ? input : {};
  const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
  const allowedSizes = ["1024x1024", "1024x1536", "1536x1024"];
  const allowedQualities = ["low", "medium", "high"];

  if (
    !prompt ||
    prompt.length > 10000 ||
    (data.model && data.model !== "gpt-image-2") ||
    (data.size && allowedSizes.indexOf(data.size) === -1) ||
    (data.quality && allowedQualities.indexOf(data.quality) === -1)
  ) {
    return null;
  }

  return {
    model: "gpt-image-2",
    prompt: prompt,
    size: data.size || "1024x1024",
    quality: data.quality || "high",
    n: 1,
    output_format: "png",
    moderation: "auto",
  };
}

function buildAnthropicMessageRequest(input) {
  const data = input && typeof input === "object" ? input : {};
  if (
    (data.model && data.model !== "claude-haiku-4-5-20251001") ||
    !Array.isArray(data.messages) ||
    data.messages.length !== 1
  ) {
    return null;
  }

  const message = data.messages[0] || {};
  if (message.role !== "user" || !Array.isArray(message.content)) return null;

  let totalTextLength = 0;
  const content = [];
  for (let i = 0; i < message.content.length; i++) {
    const block = message.content[i] || {};
    if (block.type !== "text" || typeof block.text !== "string") return null;
    totalTextLength += block.text.length;
    content.push({ type: "text", text: block.text });
  }
  if (!content.length || totalTextLength > 20000) return null;

  const system = typeof data.system === "string" ? data.system : "";
  if (system.length > 5000) return null;

  const requestedTokens =
    typeof data.max_tokens === "number" ? Math.floor(data.max_tokens) : 800;
  if (requestedTokens < 1 || requestedTokens > 1200) return null;

  const requestedTemperature =
    typeof data.temperature === "number" ? data.temperature : 0.8;
  if (requestedTemperature < 0 || requestedTemperature > 1) return null;

  const request = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: requestedTokens,
    temperature: requestedTemperature,
    messages: [{ role: "user", content: content }],
  };
  if (system) request.system = system;
  return request;
}

/**
 * Expensive generation starts get their own budget. Operation polling and
 * ordinary text calls continue to use the broader proxy limiter.
 */
function proxyCostPolicy(path) {
  const normalized = (path || "").toString().toLowerCase();

  if (
    normalized.indexOf(":predictlongrunning") !== -1 ||
    normalized.indexOf(":generatevideos") !== -1
  ) {
    return { bucket: "video-start", maxRequests: 3, windowMs: 60 * 1000 };
  }

  if (
    normalized.indexOf(":generateimages") !== -1 ||
    /\/models\/[^/]*(?:image|imagen)[^/]*:(?:generatecontent|predict)$/.test(normalized)
  ) {
    return { bucket: "image-start", maxRequests: 10, windowMs: 60 * 1000 };
  }

  return null;
}

// PocketBase 0.22's $http client doesn't expose DNS pinning or redirect
// callbacks. An arbitrary-host proxy therefore cannot safely defend against
// DNS rebinding and redirects to private networks. Keep the fetch surface to
// operator-trusted image origins instead. Extra exact hosts or `*.suffix`
// patterns can be supplied through IMAGE_PROXY_ALLOWED_HOSTS.
const DEFAULT_IMAGE_PROXY_HOST_PATTERNS = [
  "dealer-social-post-ai-production.fly.dev",
  "i.imgur.com",
];

function normalizeTrustedHostPattern(value) {
  let pattern = (value || "").toString().trim().toLowerCase();
  if (pattern.endsWith(".")) pattern = pattern.slice(0, -1);
  const wildcard = pattern.startsWith("*.");
  const hostname = wildcard ? pattern.slice(2) : pattern;
  const labels = hostname.split(".");

  if (
    !hostname ||
    hostname.length > 253 ||
    labels.length < 2 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.indexOf(":") !== -1 ||
    /^\d+(?:\.\d+){0,3}$/.test(hostname) ||
    labels.some(
      (label) =>
        !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }

  return wildcard ? "*." + hostname : hostname;
}

function imageProxyHostPatterns(configuredHosts) {
  const extra = (configuredHosts || "")
    .toString()
    .split(",")
    .map(normalizeTrustedHostPattern)
    .filter(Boolean);
  return DEFAULT_IMAGE_PROXY_HOST_PATTERNS.concat(extra);
}

function isAllowedImageProxyUrl(rawUrl, configuredHosts) {
  if (typeof rawUrl !== "string" || !rawUrl || rawUrl.length > 2048) {
    return false;
  }

  // PocketBase 0.22's Goja runtime does not provide the browser/Node URL
  // constructor. Parse only the small surface this proxy accepts: an absolute
  // HTTPS URL, an ASCII DNS hostname, no credentials, and no non-default port.
  // Reject control characters and backslashes up front so the parser and the
  // Go HTTP client cannot disagree about authority boundaries.
  if (rawUrl.trim() !== rawUrl || /[\u0000-\u0020\u007f\\]/.test(rawUrl)) {
    return false;
  }

  const authorityMatch = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(rawUrl);
  if (!authorityMatch) return false;

  const authority = authorityMatch[1];
  if (!authority || authority.indexOf("@") !== -1) return false;

  let hostname = authority;
  const colon = authority.lastIndexOf(":");
  if (colon !== -1) {
    // Multiple colons are IPv6/userinfo ambiguity; neither is supported.
    if (authority.indexOf(":") !== colon) return false;
    if (authority.slice(colon + 1) !== "443") return false;
    hostname = authority.slice(0, colon);
  }

  hostname = normalizeTrustedHostPattern(hostname);
  if (!hostname || hostname.startsWith("*.")) return false;

  return imageProxyHostPatterns(configuredHosts).some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // includes the leading dot
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === pattern;
  });
}

module.exports = {
  serializeProxyBody,
  initialApprovalStatus,
  isValidAdminDealerCode,
  canonicalPostCompliance,
  validatePostCompliance,
  isAllowedProxyPath,
  isAllowedProxyRequest,
  providerOperationStartProvider,
  providerResourceRequest,
  providerResourcesFromResponse,
  buildGeminiProxyRequest,
  buildOpenAIImageRequest,
  buildAnthropicMessageRequest,
  proxyCostPolicy,
  isAllowedImageProxyUrl,
  imageProxyHostPatterns,
  geminiModelPolicySnapshot,
};
