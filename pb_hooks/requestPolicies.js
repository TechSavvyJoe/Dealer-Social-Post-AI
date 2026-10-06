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

function recordString(record, fieldName) {
  if (!record) return "";
  if (typeof record.getString === "function") {
    return (record.getString(fieldName) || "").toString();
  }
  if (typeof record.get === "function") {
    return (record.get(fieldName) || "").toString();
  }
  return "";
}

function initialApprovalStatus(dealer) {
  return recordBool(dealer, "requires_approval") ? "pending" : "n_a";
}

// The exact header that opens every canonical disclosure block. Mirrored in
// utils/complianceDisclosures.ts.
const CANONICAL_DISCLOSURE_HEADER = "— Disclosures —";

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
      ? CANONICAL_DISCLOSURE_HEADER + "\n" + disclosureTexts.join(" ")
      : "",
    legal_prohibited: legalProhibited,
    dealer_blocked_phrases: blockedPhrases,
  };
}

function validatePostCompliance(caption, disclosures, bannedPhrases) {
  return validatePostComplianceSet([caption], disclosures, bannedPhrases);
}

function canonicalPostComplianceSet(captions, bannedPhrases) {
  const values = Array.isArray(captions) ? captions : [captions];
  const categories = {};
  const blockedPhrases = [];
  let legalProhibited = false;

  for (let i = 0; i < values.length; i++) {
    const result = canonicalPostCompliance((values[i] || "").toString(), bannedPhrases);
    for (let j = 0; j < result.categories.length; j++) {
      categories[result.categories[j]] = true;
    }
    legalProhibited = legalProhibited || result.legal_prohibited;
    for (let j = 0; j < result.dealer_blocked_phrases.length; j++) {
      const phrase = result.dealer_blocked_phrases[j];
      if (blockedPhrases.indexOf(phrase) === -1) blockedPhrases.push(phrase);
    }
  }

  const orderedCategories = [];
  const disclosureTexts = [];
  for (let i = 0; i < POST_COMPLIANCE_RULES.length; i++) {
    const rule = POST_COMPLIANCE_RULES[i];
    if (!categories[rule.category]) continue;
    orderedCategories.push(rule.category);
    disclosureTexts.push(rule.disclosure);
  }
  return {
    categories: orderedCategories,
    required_disclosures: disclosureTexts.length
      ? CANONICAL_DISCLOSURE_HEADER + "\n" + disclosureTexts.join(" ")
      : "",
    legal_prohibited: legalProhibited,
    dealer_blocked_phrases: blockedPhrases,
  };
}

function validatePostComplianceSet(captions, disclosures, bannedPhrases) {
  const values = Array.isArray(captions) ? captions : [captions];
  const supplied = (disclosures || "").toString().replace(/\r\n?/g, "\n").trim();
  const result = canonicalPostComplianceSet(values, bannedPhrases);

  for (let i = 0; i < values.length; i++) {
    if ((values[i] || "").toString().indexOf(CANONICAL_DISCLOSURE_HEADER) !== -1) {
      return {
        ...result,
        ok: false,
        error: "Compliance disclosures must be submitted separately from the caption",
      };
    }
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

// Canonical disclosure material: the exact header plus every rule's exact
// disclosure text. This is fixed legal copy the server writes, so it can never
// carry a customer name — and the customer-name guard reads its capitalised
// legal words ("Taxes", "Lessee", "Disclosures") as names. Mirrored exactly by
// canonicalDisclosureMaterial() in utils/complianceDisclosures.ts.
function canonicalDisclosureMaterial() {
  const material = [CANONICAL_DISCLOSURE_HEADER];
  for (let i = 0; i < POST_COMPLIANCE_RULES.length; i++) {
    material.push(POST_COMPLIANCE_RULES[i].disclosure);
  }
  return material;
}

// What may bound canonical material on each side, besides the start or end of
// the text. Explicit lists rather than \s, so the PocketBase JSVM and the
// browser agree character for character. A rule's legal text ends in "." and
// the server joins it with spaces, so any whitespace bounds it. The header does
// not end a sentence and the server always writes it on its own line, so only a
// line break bounds it: "Welcome to the — Disclosures — Ford Family Michelle!"
// keeps its header and is reviewed as one line, the way a reader sees it.
// Mirrored in utils/complianceDisclosures.ts.
const CANONICAL_DISCLOSURE_BOUNDARY = " \t\n\r\f\v";
const CANONICAL_DISCLOSURE_HEADER_BOUNDARY = "\n\r";

// What each stripped piece of canonical material becomes: a line break. The
// legal copy ends in "." and a reader sees it as a sentence of its own, so the
// guard must see a hard boundary there too. Replacing it with nothing fused
// the text on either side into one word ("Big day" + <APR text> + "Jessica…"
// reached the guard as "Big dayJessica…") and erased the sentence break before
// a name, so the guard missed names a reader sees. Mirrored in
// utils/complianceDisclosures.ts.
const CANONICAL_DISCLOSURE_REPLACEMENT = "\n";

function isCanonicalDisclosureBoundary(source, index, boundary) {
  if (index < 0 || index >= source.length) return true;
  return boundary.indexOf(source.charAt(index)) !== -1;
}

// The first occurrence of `item` at or after `from` that is bounded on both
// sides (see CANONICAL_DISCLOSURE_BOUNDARY). Material glued to other text is
// not canonical there and stays in for review.
function nextBoundedCanonicalMaterial(source, item, from) {
  const boundary =
    item === CANONICAL_DISCLOSURE_HEADER
      ? CANONICAL_DISCLOSURE_HEADER_BOUNDARY
      : CANONICAL_DISCLOSURE_BOUNDARY;
  let at = source.indexOf(item, from);
  while (at !== -1) {
    if (
      isCanonicalDisclosureBoundary(source, at - 1, boundary) &&
      isCanonicalDisclosureBoundary(source, at + item.length, boundary)
    ) {
      return at;
    }
    at = source.indexOf(item, at + 1);
  }
  return -1;
}

// Split text around every exact, bounded occurrence of canonical disclosure
// material, scanning left to right once. Even indexes are free
// text, odd indexes are canonical material, and joining every part reproduces
// the input exactly.
function splitCanonicalDisclosures(text) {
  const source = (text || "").toString();
  const material = canonicalDisclosureMaterial();
  const parts = [];
  let cursor = 0;
  for (;;) {
    let foundAt = -1;
    let foundLength = 0;
    for (let i = 0; i < material.length; i++) {
      const at = nextBoundedCanonicalMaterial(source, material[i], cursor);
      if (at === -1) continue;
      if (
        foundAt === -1 ||
        at < foundAt ||
        (at === foundAt && material[i].length > foundLength)
      ) {
        foundAt = at;
        foundLength = material[i].length;
      }
    }
    if (foundAt === -1) break;
    parts.push(
      source.slice(cursor, foundAt),
      source.slice(foundAt, foundAt + foundLength),
    );
    cursor = foundAt + foundLength;
  }
  parts.push(source.slice(cursor));
  return parts;
}

// The one rule, identical to stripCanonicalDisclosures() in
// utils/complianceDisclosures.ts: replace each exact, bounded piece of
// canonical disclosure material with a line break and keep everything else.
// Anything that is not exactly canonical — a name planted beside real
// disclosures, an edited sentence, legal copy glued to other text — stays in
// the text and is still reviewed.
function stripCanonicalDisclosures(text) {
  const parts = splitCanonicalDisclosures(text);
  const freeText = [];
  for (let i = 0; i < parts.length; i += 2) freeText.push(parts[i]);
  return freeText.join(CANONICAL_DISCLOSURE_REPLACEMENT);
}

// websitePublications.reviewPostCustomerIdentity (passed in as `review`) over
// the values with canonical disclosure material stripped
// (stripCanonicalDisclosures: each piece becomes a line break): the guard
// decides only on what remains. The projection keeps canonical material
// verbatim, so the customer-name redaction can never rewrite legal copy either.
// The same review as a four-argument function, for helpers that take the
// guard as a parameter (websitePublications.publicWebsiteDraftForPost).
function identityReviewExcludingDisclosures(review) {
  return function (protectedName, values, allowedPhrases, rejectUnnamed) {
    return reviewCustomerIdentityExcludingDisclosures(
      review,
      protectedName,
      values,
      allowedPhrases,
      rejectUnnamed,
    );
  };
}

function reviewCustomerIdentityExcludingDisclosures(
  review,
  protectedName,
  values,
  allowedPhrases,
  rejectUnnamed,
) {
  const sources = (Array.isArray(values) ? values : []).map(function (value) {
    return (value || "").toString();
  });
  // A protected name can straddle a seam: customer "Anna Lease" and a caption
  // "Congrats Anna " + the lease rule ("Lease offer with approved credit…").
  // Stripping the rule would remove the surname before the redaction runs,
  // so the full name would publish unredacted. When a seam's own redaction
  // changes anything, that value keeps no exemption and is reviewed exactly
  // as written (the behaviour before canonical material was exempted).
  const seamSplitsProtectedName = function (valueParts) {
    for (let k = 1; k < valueParts.length; k += 2) {
      const piece = valueParts[k];
      const before = (valueParts[k - 1] || "").slice(-200);
      const after = (valueParts[k + 1] || "").slice(0, 200);
      const firstWord = (piece.match(/^[^\s,-]*/) || [""])[0];
      const lastWord = (piece.match(/[^\s,-]*$/) || [""])[0];
      // Compare each seam's redaction with the redaction of its free-text side
      // alone, so a full name already sitting in the free text (redacted either
      // way) does not count — only a name the seam itself forms does.
      const projected = review(
        protectedName,
        [before, after, before + firstWord, lastWord + after],
        allowedPhrases,
        false,
      ).projectedValues;
      if (projected[2] !== projected[0] + firstWord) return true;
      if (projected[3] !== lastWord + projected[1]) return true;
    }
    return false;
  };
  const parts = sources.map(function (source) {
    const valueParts = splitCanonicalDisclosures(source);
    return valueParts.length > 1 && seamSplitsProtectedName(valueParts)
      ? [source]
      : valueParts;
  });
  const remainders = parts.map(function (valueParts) {
    const freeText = [];
    for (let i = 0; i < valueParts.length; i += 2) freeText.push(valueParts[i]);
    return freeText.join(CANONICAL_DISCLOSURE_REPLACEMENT);
  });
  const result = review(protectedName, remainders, allowedPhrases, rejectUnnamed);
  const projectedValues = sources.map(function (source, index) {
    const projected = result.projectedValues[index] || "";
    // No canonical material: the guard saw the whole value.
    if (parts[index].length === 1) return projected;
    // Nothing redacted: keep the value exactly as written.
    if (projected === remainders[index]) return source;
    // Redact each free-text part on its own and put the legal copy back.
    const freeText = parts[index].filter(function (_part, partIndex) {
      return partIndex % 2 === 0;
    });
    const redacted = review(
      protectedName,
      freeText,
      allowedPhrases,
      false,
    ).projectedValues;
    return parts[index]
      .map(function (part, partIndex) {
        return partIndex % 2 === 0 ? redacted[partIndex / 2] || "" : part;
      })
      .join("");
  });
  return Object.assign({}, result, { projectedValues: projectedValues });
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
//
// WHY `version` STAYS 5 EVEN THOUGH THIS IS THE "v6" REQUEST SHAPE:
// `postImageReviewRequired` below compares a stored post's
// `model_policy_version` against this number by EXACT EQUALITY, and the
// reopen/deliver gates use that answer. Incrementing the number would mark
// every already-archived creative as reviewed-under-an-old-policy and force a
// re-review before it can be reopened or delivered — stranding real posts for
// a change that only *widens* what a request may carry. `systemInstruction`,
// `responseMimeType` and the server-side `responseJsonSchema` registry are
// additive: a client that never sends them is still valid, so no stored post
// needs revalidating. Bump the number only for a change that invalidates
// previously generated output.
const GEMINI_MODEL_POLICY_SNAPSHOT = {
  version: 5,
  versionPinNote:
    "Deliberately pinned at 5. Reopen/deliver gates compare a stored post's model_policy_version against this number by exact equality (postImageReviewRequired in pb_hooks/requestPolicies.js), so bumping it would strand every already-archived creative behind a forced re-review. The v6 request capabilities (systemInstruction, responseMimeType plus the server-side responseJsonSchema registry) are purely additive and backward compatible with clients that never send them, so they ship under version 5.",
  verifiedAt: "2026-10-05",
  models: {
    textQuality: "gemini-3.6-flash",
    textFast: "gemini-3.5-flash-lite",
    imageStandard: "gemini-3-pro-image",
    imageStudio: "gemini-3-pro-image",
    imageFallback: "gemini-3.1-flash-image",
    imageLite: "gemini-3.1-flash-lite-image",
    videoStandard: "veo-3.1-fast-generate-preview",
    videoQuality: "veo-3.1-generate-preview",
    videoFallback: "veo-3.1-lite-generate-preview",
  },
  thinkingLevels: {
    "gemini-3.6-flash": ["minimal", "low", "medium", "high"],
    "gemini-3.5-flash-lite": ["minimal", "low", "medium", "high"],
  },
  tasks: {
    caption: {
      kind: "text",
      tier: "quality",
      models: ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
      maxOutputTokens: 2048,
      thinkingLevel: "low",
    },
    caption_regenerate: {
      kind: "text",
      tier: "quality",
      models: ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
      maxOutputTokens: 2048,
      thinkingLevel: "low",
    },
    caption_edit: {
      kind: "text",
      tier: "fast",
      models: ["gemini-3.5-flash-lite", "gemini-3.6-flash"],
      maxOutputTokens: 2048,
      thinkingLevel: "minimal",
    },
    // The image quality-control review reads pixels and returns a strict
    // verdict; it is the one text call where reasoning quality is worth
    // paying for, so it keeps "medium" while captions run at "low"/"minimal".
    // A dedicated task also stops the usage ledger from counting QC reviews
    // as captions.
    vision_review: {
      kind: "text",
      tier: "quality",
      models: ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
      maxOutputTokens: 2048,
      thinkingLevel: "medium",
    },
    image_standard: {
      kind: "image",
      tier: "standard",
      models: [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
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
        "gemini-3-pro-image": "4K",
        "gemini-3.1-flash-image": "2K",
        "gemini-3.1-flash-lite-image": "1K",
      },
    },
    video_standard: {
      kind: "video",
      tier: "standard",
      models: ["veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"],
      resolution: "720p",
    },
    video_quality: {
      kind: "video",
      tier: "quality",
      models: ["veo-3.1-generate-preview", "veo-3.1-lite-generate-preview"],
      resolution: "1080p",
    },
  },
  // Veo runs against the Gemini Developer API (generativelanguage.googleapis.com
  // predictLongRunning), not Vertex. `negativePrompt` is accepted there and maps
  // to parameters.negativePrompt. `generateAudio` is deliberately absent: both
  // official Google SDKs raise "generateAudio parameter is only supported in
  // Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode"
  // (googleapis/python-genai _GenerateVideosConfig_to_mldev, googleapis/js-genai
  // _models_converters), so sending it on this endpoint risks a 400 on every
  // video. A silent clip is requested through negativePrompt instead.
  veoParameterNote:
    'Veo runs against the Gemini Developer API (generativelanguage.googleapis.com predictLongRunning), not Vertex. `negativePrompt` is accepted there and maps to parameters.negativePrompt. `generateAudio` is deliberately absent: both official Google SDKs raise "generateAudio parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode" (googleapis/python-genai _GenerateVideosConfig_to_mldev, googleapis/js-genai _models_converters), so sending it on this endpoint risks a 400 on every video. A silent clip is requested through negativePrompt instead.',
  allowedImageAspectRatios: ["1:1", "4:5", "9:16", "16:9", "4:3"],
  allowedResponseMimeTypes: ["application/json"],
  // Ids the browser may reference. The schema bodies live only in
  // GEMINI_RESPONSE_SCHEMAS below — never in the request.
  responseSchemaIds: ["vision_review_v1", "caption_pack_v1", "website_draft_v1"],
  allowedRequestFields: {
    // NOTE: `temperature`, `topP`, `topK` and `candidateCount` are absent on
    // purpose and must stay absent. Google deprecated them on Gemini 3.x on
    // 2026-07-21 and documents a 400 on the pinned 3.6-flash / 3.5-flash-lite
    // ids. Style and variation belong in `systemInstruction`, not in sampling
    // knobs the models no longer accept.
    generateContent: {
      topLevel: ["contents", "generationConfig", "systemInstruction"],
      // `topLevel` is the accepted set; only these are mandatory, so a client
      // that predates systemInstruction stays valid.
      requiredTopLevel: ["contents", "generationConfig"],
      systemInstruction: ["parts"],
      content: ["parts"],
      textPart: ["text"],
      imagePart: ["inlineData"],
      inlineData: ["mimeType", "data"],
      // `schemaId` is an id into the server registry, never a schema body.
      textGenerationConfig: [
        "maxOutputTokens",
        "thinkingConfig",
        "responseMimeType",
        "schemaId",
      ],
      thinkingConfig: ["thinkingLevel"],
      imageGenerationConfig: ["responseModalities", "imageConfig", "maxOutputTokens"],
      imageConfig: ["imageSize", "aspectRatio"],
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
      // `parameters` is the accepted set; `requiredParameters` is the mandatory
      // subset, so `negativePrompt` stays optional for clients that predate it.
      parameters: [
        "aspectRatio",
        "personGeneration",
        "durationSeconds",
        "resolution",
        "negativePrompt",
      ],
      requiredParameters: [
        "aspectRatio",
        "personGeneration",
        "durationSeconds",
        "resolution",
      ],
    },
  },
  requestLimits: {
    maxPromptChars: 20000,
    maxSystemInstructionChars: 8000,
    maxNegativePromptChars: 2000,
    maxInlineImageChars: 16 * 1024 * 1024,
    maxTotalInlineImageChars: 20 * 1024 * 1024,
    maxTextImages: 3,
    maxImageTaskImages: 2,
  },
  safetySettings: SERVER_SAFETY_SETTINGS,
};

function geminiModelPolicySnapshot() {
  return JSON.parse(JSON.stringify(GEMINI_MODEL_POLICY_SNAPSHOT));
}

/**
 * Server-side JSON response-schema registry.
 *
 * The browser sends only `generationConfig.schemaId`; the proxy looks the id
 * up here and injects the matching `responseJsonSchema`. A schema body is
 * never accepted from the client, so a tampered PWA cannot widen, replace, or
 * smuggle instructions through the response contract, and the shapes stay
 * reviewable in one server-owned place.
 *
 * Each entry mirrors the Zod schema that validates the parsed result in the
 * browser:
 *  - vision_review_v1  → GeneratedImageTextReviewSchema (services/geminiService.ts)
 *  - caption_pack_v1   → parsePlatformCaptionPack       (services/platformCopy.ts)
 *  - website_draft_v1  → WebsiteDraftAiSchema           (services/websitePublishing.ts)
 *
 * Ids are versioned (`_v1`). Changing a shape means adding a new id, never
 * editing one in place — an installed PWA may still be sending the old id.
 */
const VISION_REVIEW_VIOLATIONS = [
  "too_many_words",
  "too_many_characters",
  "full_sentence",
  "hashtag",
  "url_or_phone",
  "multiple_marketing_blocks",
  "unexpected_personal_name",
  "missing_dealership_identity",
  "incorrect_dealership_name",
  "fabricated_brand_mark",
  "supplied_logo_altered_or_replaced",
  "instruction_text",
  "social_ui_chrome",
  "unrequested_illustration",
  "subject_identity_changed",
  "vehicle_identity_changed",
  "source_composition_changed",
  "unflattering_or_disrespectful",
  "overdone_or_platform_inappropriate",
  "bland_or_unstyled",
  "below_campaign_quality",
  "unintegrated_3d_graphics",
  "malformed_or_misspelled_text",
  "unreadable_or_uncertain",
];

const WEBSITE_DRAFT_CATEGORIES = [
  "deliveries",
  "inventory",
  "service",
  "promotions",
  "community",
  "team",
];

const WEBSITE_DRAFT_PRIVACY_FLAGS = [
  "faces_visible",
  "license_plate_visible",
  "personal_information_visible",
  "minor_may_be_visible",
  "review_visual_privacy",
];

function booleanFields(names) {
  const fields = {};
  for (let i = 0; i < names.length; i++) {
    fields[names[i]] = { type: "boolean" };
  }
  return fields;
}

const GEMINI_RESPONSE_SCHEMAS = {
  vision_review_v1: {
    type: "object",
    properties: Object.assign(
      booleanFields([
        "compliant",
        "uncertain",
        "hasFullSentence",
        "hasHashtag",
        "hasUrlOrPhone",
        "logoPresent",
        "logoMatchesSuppliedAsset",
        "hasUnexpectedPersonalName",
        "dealershipNamePresent",
        "dealershipNameCorrect",
        "hasFabricatedBrandMark",
        "hasInstructionText",
        "hasSocialUiChrome",
        "isIllustrationOrCharacterRender",
        "preservesSourceSubjects",
        "preservesVehicleIdentity",
        "preservesSourceComposition",
        "isRespectfulAndFlattering",
        "isPlatformAppropriate",
        "hasDistinctStyleSignature",
        "hasEnvironmentalDepthIntegration",
        "hasCleanTypography",
      ]),
      {
        detectedMarketingText: { type: "array", items: { type: "string" } },
        detectedPersonalNames: { type: "array", items: { type: "string" } },
        marketingWordCount: { type: "integer", minimum: 0 },
        marketingCharacterCount: { type: "integer", minimum: 0 },
        visualQualityScore: { type: "integer", minimum: 1, maximum: 5 },
        violations: {
          type: "array",
          items: { type: "string", enum: VISION_REVIEW_VIOLATIONS },
        },
      },
    ),
    // Only the always-answerable fields are required. The conditional ones
    // (source comparison, logo, depth) must stay optional: the prompt tells
    // the reviewer to omit them when they do not apply, and forcing a value
    // would make it invent one.
    required: [
      "compliant",
      "uncertain",
      "detectedMarketingText",
      "marketingWordCount",
      "marketingCharacterCount",
      "hasFullSentence",
      "hasHashtag",
      "hasUrlOrPhone",
      "violations",
    ],
    additionalProperties: false,
  },
  caption_pack_v1: {
    type: "object",
    properties: {
      captions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            platformId: { type: "string" },
            caption: { type: "string" },
          },
          required: ["platformId", "caption"],
          additionalProperties: false,
        },
      },
    },
    required: ["captions"],
    additionalProperties: false,
  },
  website_draft_v1: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      altText: { type: "string" },
      category: { type: "string", enum: WEBSITE_DRAFT_CATEGORIES },
      privacyFlags: {
        type: "array",
        items: { type: "string", enum: WEBSITE_DRAFT_PRIVACY_FLAGS },
      },
    },
    required: ["title", "body", "altText", "category", "privacyFlags"],
    additionalProperties: false,
  },
};

/**
 * Registry ids in declaration order. `scripts/check-model-policy.mjs` compares
 * this against `responseSchemaIds` in the canonical policy JSON so the client
 * can never reference an id the server does not implement.
 */
function geminiResponseSchemaIds() {
  return Object.keys(GEMINI_RESPONSE_SCHEMAS);
}

function geminiResponseSchema(schemaId) {
  if (typeof schemaId !== "string" || !schemaId) return null;
  if (!Object.prototype.hasOwnProperty.call(GEMINI_RESPONSE_SCHEMAS, schemaId)) {
    return null;
  }
  if (GEMINI_MODEL_POLICY_SNAPSHOT.responseSchemaIds.indexOf(schemaId) === -1) {
    return null;
  }
  return JSON.parse(JSON.stringify(GEMINI_RESPONSE_SCHEMAS[schemaId]));
}

/**
 * A stored creative is reopenable/deliverable only when it was archived under
 * the current server policy. Version 5 introduced the required on-pixel
 * personal-name, source-fidelity, logo, and campaign-quality review. The
 * stored version is server-derived from same-session generation events; the
 * multipart client's model_policy_version field is never trusted.
 */
function postImageReviewRequired(record, currentPolicy) {
  if (!recordString(record, "creative_image")) return false;
  const currentVersion =
    currentPolicy && typeof currentPolicy === "object"
      ? (currentPolicy.version || "").toString()
      : (currentPolicy || "").toString();
  if (!currentVersion) return true;
  return recordString(record, "model_policy_version") !== currentVersion;
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
  "vision_review",
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
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/(files\/[a-z0-9._~-]+)(?::download)?(?:\?[^#\s\\]*)?$/i,
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
          normalizedKey === "video_uri" ||
          normalizedKey === "downloaduri" ||
          normalizedKey === "download_uri")
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
const MAX_SYSTEM_INSTRUCTION_CHARS = GEMINI_REQUEST_LIMITS.maxSystemInstructionChars;
const MAX_NEGATIVE_PROMPT_CHARS = GEMINI_REQUEST_LIMITS.maxNegativePromptChars;
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

/**
 * Optional Gemini 3.x thinking control for text tasks. Only `thinkingLevel`
 * from the pinned model's supported enum is admitted; the deprecated
 * `thinkingBudget` and `includeThoughts` are never forwarded. Returns
 * `undefined` when the client sent no thinkingConfig, the sanitized object
 * when it is valid, and `null` on any violation.
 */
function sanitizeTextThinkingConfig(model, generationConfig) {
  if (!Object.prototype.hasOwnProperty.call(generationConfig, "thinkingConfig")) {
    return undefined;
  }
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  const thinkingConfig = generationConfig.thinkingConfig;
  if (!hasOnlyKeys(thinkingConfig, fields.thinkingConfig, fields.thinkingConfig)) {
    return null;
  }
  const supportedLevels = GEMINI_MODEL_POLICY_SNAPSHOT.thinkingLevels[model];
  if (
    !Array.isArray(supportedLevels) ||
    typeof thinkingConfig.thinkingLevel !== "string" ||
    supportedLevels.indexOf(thinkingConfig.thinkingLevel) === -1
  ) {
    return null;
  }
  return { thinkingLevel: thinkingConfig.thinkingLevel };
}

/**
 * Optional top-level `systemInstruction` for text tasks. The static, per-task
 * invariant rules (compliance, identity, output shape) ride here instead of
 * being concatenated into the user turn. Accepts only `{ parts: [{ text }] }`
 * with the same text-part contract as `contents`, bounded by
 * `requestLimits.maxSystemInstructionChars`. Returns `undefined` when absent,
 * the sanitized object when valid, and `null` on any violation.
 */
function sanitizeSystemInstruction(input) {
  if (!Object.prototype.hasOwnProperty.call(input, "systemInstruction")) {
    return undefined;
  }
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  const systemInstruction = input.systemInstruction;
  if (
    !hasOnlyKeys(systemInstruction, fields.systemInstruction, fields.systemInstruction)
  ) {
    return null;
  }
  const rawParts = systemInstruction.parts;
  if (!Array.isArray(rawParts) || !rawParts.length) return null;

  const parts = [];
  let totalChars = 0;
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    // Text only: a system instruction never carries image bytes here.
    if (!hasOnlyKeys(part, fields.textPart, fields.textPart)) return null;
    if (typeof part.text !== "string" || !part.text.trim()) return null;
    totalChars += part.text.length;
    if (totalChars > MAX_SYSTEM_INSTRUCTION_CHARS) return null;
    parts.push({ text: part.text });
  }
  return { parts: parts };
}

/**
 * Optional structured-output contract for text tasks.
 *
 * The client sends `responseMimeType` plus a `schemaId`; the server resolves
 * the id against its own registry and injects `responseJsonSchema`. A schema
 * body from the browser is rejected outright — `responseSchema` and
 * `responseJsonSchema` are not in `textGenerationConfig`, so `hasOnlyKeys`
 * already refuses them, and an unknown id fails here. Returns `undefined`
 * when the client asked for no structured output, the sanitized fields when
 * valid, and `null` on any violation.
 */
function sanitizeTextResponseFormat(generationConfig) {
  const hasMimeType = Object.prototype.hasOwnProperty.call(
    generationConfig,
    "responseMimeType",
  );
  const hasSchemaId = Object.prototype.hasOwnProperty.call(
    generationConfig,
    "schemaId",
  );
  if (!hasMimeType && !hasSchemaId) return undefined;
  // Both or neither: a mime type without a server schema is an unbounded JSON
  // request, and a schema id without the mime type would be silently ignored.
  if (!hasMimeType || !hasSchemaId) return null;
  const responseMimeType = generationConfig.responseMimeType;
  if (
    typeof responseMimeType !== "string" ||
    GEMINI_MODEL_POLICY_SNAPSHOT.allowedResponseMimeTypes.indexOf(responseMimeType) ===
      -1
  ) {
    return null;
  }
  const responseJsonSchema = geminiResponseSchema(generationConfig.schemaId);
  if (!responseJsonSchema) return null;
  return {
    responseMimeType: responseMimeType,
    responseJsonSchema: responseJsonSchema,
  };
}

function buildGenerateContentRequest(model, input, requestedTaskName) {
  const fields = GEMINI_REQUEST_FIELDS.generateContent;
  // Deliberately omit `safetySettings` from the accepted client keys. The
  // canonical server policy below is the only safety configuration forwarded.
  if (!hasOnlyKeys(input, fields.topLevel, fields.requiredTopLevel)) {
    return null;
  }
  const systemInstruction = sanitizeSystemInstruction(input);
  if (systemInstruction === null) return null;

  const generationConfig = input.generationConfig;
  if (TEXT_GENERATE_CONTENT_MODELS.indexOf(model) !== -1) {
    const requiredMaxOutputTokens =
      GEMINI_MODEL_POLICY_SNAPSHOT.tasks.caption.maxOutputTokens;
    // `maxOutputTokens` stays mandatory; `thinkingConfig` is the only optional
    // extra key and is enum-checked by sanitizeTextThinkingConfig.
    if (
      !hasOnlyKeys(generationConfig, fields.textGenerationConfig, [
        "maxOutputTokens",
      ]) ||
      generationConfig.maxOutputTokens !== requiredMaxOutputTokens
    ) {
      return null;
    }
    const thinkingConfig = sanitizeTextThinkingConfig(model, generationConfig);
    if (thinkingConfig === null) return null;
    const responseFormat = sanitizeTextResponseFormat(generationConfig);
    if (responseFormat === null) return null;

    const contents = sanitizeGenerateContentContents(
      input.contents,
      0,
      GEMINI_REQUEST_LIMITS.maxTextImages,
    );
    if (!contents) return null;
    const sanitizedGenerationConfig = {
      maxOutputTokens: generationConfig.maxOutputTokens,
    };
    if (thinkingConfig) sanitizedGenerationConfig.thinkingConfig = thinkingConfig;
    if (responseFormat) {
      sanitizedGenerationConfig.responseMimeType = responseFormat.responseMimeType;
      // Server-owned schema body, resolved from the client's id.
      sanitizedGenerationConfig.responseJsonSchema = responseFormat.responseJsonSchema;
    }
    const sanitized = {
      contents: contents,
      generationConfig: sanitizedGenerationConfig,
      safetySettings: SERVER_SAFETY_SETTINGS,
    };
    if (systemInstruction) sanitized.systemInstruction = systemInstruction;
    return sanitized;
  }

  if (IMAGE_GENERATE_CONTENT_MODELS.indexOf(model) === -1) return null;
  // Image models run without a system instruction under this policy: nothing
  // in the product sends one, and admitting it would widen the image request
  // surface for no caller.
  if (systemInstruction) return null;
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
  const requestedTask = GEMINI_MODEL_POLICY_SNAPSHOT.tasks[requestedTaskName];
  const requestedImageTask =
    requestedTask &&
    requestedTask.kind === "image" &&
    requestedTask.models.indexOf(model) !== -1
      ? requestedTask
      : null;
  // Headerless legacy clients remain on the standard size contract. This is
  // important when Standard and Studio share a model ID but authorize a
  // different output size (2K versus 4K).
  const requiredSize = requestedImageTask
    ? requestedImageTask.imageSizes[model]
    : GEMINI_MODEL_POLICY_SNAPSHOT.tasks.image_standard.imageSizes[model] ||
      GEMINI_MODEL_POLICY_SNAPSHOT.tasks.image_studio.imageSizes[model];
  if (!requiredSize) return null;
  let requestedSize = "";
  let requestedAspectRatio = "";
  const hasImageConfig =
    generationConfig.imageConfig &&
    typeof generationConfig.imageConfig === "object" &&
    hasOnlyKeys(generationConfig.imageConfig, fields.imageConfig, ["imageSize"]);
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
    if (
      Object.prototype.hasOwnProperty.call(generationConfig.imageConfig, "aspectRatio")
    ) {
      requestedAspectRatio = generationConfig.imageConfig.aspectRatio;
      if (
        typeof requestedAspectRatio !== "string" ||
        GEMINI_MODEL_POLICY_SNAPSHOT.allowedImageAspectRatios.indexOf(
          requestedAspectRatio,
        ) === -1
      ) {
        return null;
      }
    }
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
  const sanitizedImageConfig = { imageSize: requiredSize };
  if (requestedAspectRatio) {
    sanitizedImageConfig.aspectRatio = requestedAspectRatio;
  }
  return {
    contents: contents,
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: sanitizedImageConfig,
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
    !hasOnlyKeys(parameters, fields.parameters, fields.requiredParameters) ||
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

  // Optional, and bounded separately from the prompt. `negativePrompt` is the
  // one Veo knob this proxy admits beyond the fixed four: it turns the prompt's
  // prose locks ("no second car, no morphing, no warped badges") and a silent
  // soundtrack choice into real request constraints. A present-but-malformed
  // value is a rejection, never a silently dropped field.
  const sanitizedParameters = {
    aspectRatio: parameters.aspectRatio,
    personGeneration: "allow_adult",
    durationSeconds: parameters.durationSeconds,
    resolution: parameters.resolution,
  };
  if (Object.prototype.hasOwnProperty.call(parameters, "negativePrompt")) {
    const negativePrompt = parameters.negativePrompt;
    if (
      typeof negativePrompt !== "string" ||
      !negativePrompt.trim() ||
      negativePrompt.length > MAX_NEGATIVE_PROMPT_CHARS
    ) {
      return null;
    }
    sanitizedParameters.negativePrompt = negativePrompt;
  }

  return {
    instances: [
      {
        prompt: instance.prompt,
        image: veoImage,
      },
    ],
    parameters: sanitizedParameters,
  };
}

function buildGeminiProxyRequest(path, input, requestedTaskName) {
  const normalized = (path || "").toString();
  const contentMatch = normalized.match(
    /^v1beta\/models\/([a-z0-9._-]+):generateContent$/i,
  );
  if (contentMatch && ALLOWED_GENERATE_CONTENT_MODELS.indexOf(contentMatch[1]) !== -1) {
    return buildGenerateContentRequest(contentMatch[1], input, requestedTaskName);
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

// The proxy accepts exactly one Claude id. `services/modelConfig.ts`
// CLAUDE_MODELS must advertise only ids listed here.
const ANTHROPIC_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
// The fallback replaces a Gemini text task, so it carries the same output
// budget the text contract already authorizes (2048 tokens).
const ANTHROPIC_FALLBACK_MAX_TOKENS =
  GEMINI_MODEL_POLICY_SNAPSHOT.tasks.caption.maxOutputTokens;
// Claude ingests JPEG, PNG, GIF, and WebP up to 5 MB per image; base64
// expands bytes by 4/3, so the encoded payload is bounded by the tighter of
// that and the proxy's existing inline-image limit. The caption fallback
// sends at most the one customer photo.
const ANTHROPIC_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const ANTHROPIC_MAX_IMAGE_CHARS = Math.min(
  MAX_INLINE_IMAGE_CHARS,
  Math.ceil((5 * 1024 * 1024) / 3) * 4,
);
const ANTHROPIC_MAX_IMAGE_BLOCKS = 1;

function sanitizeAnthropicImageBlock(block) {
  if (!hasOnlyKeys(block, ["type", "source"], ["type", "source"])) return null;
  const source = block.source;
  const sourceKeys = ["type", "media_type", "data"];
  if (!hasOnlyKeys(source, sourceKeys, sourceKeys)) return null;

  const mediaType = (source.media_type || "").toString().toLowerCase();
  const data = source.data;
  if (
    source.type !== "base64" ||
    ANTHROPIC_IMAGE_MEDIA_TYPES.indexOf(mediaType) === -1 ||
    typeof data !== "string" ||
    data.length < 4 ||
    data.length > ANTHROPIC_MAX_IMAGE_CHARS ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    return null;
  }
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: data },
  };
}

function buildAnthropicMessageRequest(input) {
  const data = input && typeof input === "object" ? input : {};
  if (
    (data.model && data.model !== ANTHROPIC_FALLBACK_MODEL) ||
    !Array.isArray(data.messages) ||
    data.messages.length !== 1
  ) {
    return null;
  }

  const message = data.messages[0] || {};
  if (message.role !== "user" || !Array.isArray(message.content)) return null;

  let totalTextLength = 0;
  let textBlocks = 0;
  let imageBlocks = 0;
  const content = [];
  for (let i = 0; i < message.content.length; i++) {
    const block = message.content[i] || {};
    if (block.type === "image") {
      const imageBlock = sanitizeAnthropicImageBlock(block);
      imageBlocks += 1;
      if (!imageBlock || imageBlocks > ANTHROPIC_MAX_IMAGE_BLOCKS) return null;
      content.push(imageBlock);
      continue;
    }
    if (block.type !== "text" || typeof block.text !== "string") return null;
    totalTextLength += block.text.length;
    textBlocks += 1;
    content.push({ type: "text", text: block.text });
  }
  if (!textBlocks || totalTextLength > 20000) return null;

  const system = typeof data.system === "string" ? data.system : "";
  if (system.length > 5000) return null;

  const requestedTokens =
    typeof data.max_tokens === "number" ? Math.floor(data.max_tokens) : 800;
  if (requestedTokens < 1 || requestedTokens > ANTHROPIC_FALLBACK_MAX_TOKENS) {
    return null;
  }

  const requestedTemperature =
    typeof data.temperature === "number" ? data.temperature : 0.8;
  if (requestedTemperature < 0 || requestedTemperature > 1) return null;

  const request = {
    model: ANTHROPIC_FALLBACK_MODEL,
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
  canonicalPostCompliance,
  canonicalPostComplianceSet,
  validatePostCompliance,
  validatePostComplianceSet,
  canonicalDisclosureMaterial,
  stripCanonicalDisclosures,
  reviewCustomerIdentityExcludingDisclosures,
  identityReviewExcludingDisclosures,
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
  geminiResponseSchemaIds,
  geminiResponseSchema,
  postImageReviewRequired,
};
