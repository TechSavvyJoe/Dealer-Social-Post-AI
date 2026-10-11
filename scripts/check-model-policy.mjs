import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = JSON.parse(
  readFileSync(resolve(root, "config/gemini-model-policy.json"), "utf8"),
);
const verifiedAt = Date.parse(`${canonical.verifiedAt}T00:00:00Z`);
const policyAgeDays = (Date.now() - verifiedAt) / 86_400_000;
assert.ok(
  Number.isFinite(verifiedAt),
  "Canonical Gemini policy verifiedAt must be an ISO calendar date",
);
assert.ok(
  policyAgeDays >= -1,
  "Canonical Gemini policy verifiedAt cannot be in the future",
);
/**
 * The hard gate. This script runs in `typecheck-and-test`, which playwright,
 * container-smoke and the whole deploy workflow depend on, so crossing this
 * threshold blocks every release until someone re-verifies the model catalog.
 */
const POLICY_MAX_AGE_DAYS = 45;
/**
 * The warning window. Without it the hard gate arrives with no notice: CI is
 * green on day 44 and every deploy is blocked on day 45, usually discovered by
 * whoever is trying to ship something unrelated and urgent. Warning from day 31
 * leaves two weeks to re-check Google's catalog on purpose rather than under
 * pressure. `.github/workflows/model-policy-freshness.yml` runs this daily so
 * the warning is seen even when nobody pushes.
 */
const POLICY_WARN_AGE_DAYS = 31;

if (policyAgeDays >= POLICY_WARN_AGE_DAYS && policyAgeDays <= POLICY_MAX_AGE_DAYS) {
  const daysLeft = Math.ceil(POLICY_MAX_AGE_DAYS - policyAgeDays);
  const message =
    `Gemini model policy is ${Math.floor(policyAgeDays)} days old (verified ` +
    `${canonical.verifiedAt}). Deploys are blocked in ${daysLeft} day(s). ` +
    `Re-check Google's live model catalog against config/gemini-model-policy.json, ` +
    `then refresh verifiedAt. Do NOT change the policy version to clear this.`;
  // GitHub Actions renders this as an annotation on the run.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${message}`);
  console.warn(`WARNING: ${message}`);
  if (process.env.MODEL_POLICY_FRESHNESS_STRICT === "true") {
    console.error(
      "MODEL_POLICY_FRESHNESS_STRICT is set, so the warning window is a failure here.",
    );
    process.exit(1);
  }
}

assert.ok(
  policyAgeDays <= POLICY_MAX_AGE_DAYS,
  `Canonical Gemini policy is ${Math.floor(
    policyAgeDays,
  )} days old; re-check Google's live model catalog and refresh verifiedAt`,
);

const policySource = readFileSync(resolve(root, "pb_hooks/requestPolicies.js"), "utf8");
const policyModule = { exports: {} };
new Function("module", "exports", policySource)(policyModule, policyModule.exports);

assert.equal(
  typeof policyModule.exports.geminiModelPolicySnapshot,
  "function",
  "PocketBase policy must export geminiModelPolicySnapshot()",
);
assert.equal(
  typeof policyModule.exports.geminiResponseSchemaIds,
  "function",
  "PocketBase policy must export geminiResponseSchemaIds()",
);
assert.deepEqual(
  policyModule.exports.geminiModelPolicySnapshot(),
  canonical,
  "PocketBase Gemini policy drifted from config/gemini-model-policy.json",
);

// The policy `version` is a data-migration contract, not a changelog. Stored
// posts carry the version they were reviewed under and the reopen/deliver
// gates compare it by exact equality, so a bump strands every archived
// creative behind a forced re-review. `versionPinNote` has to explain why the
// number sits where it does; keeping it mandatory stops the number from
// drifting silently.
assert.ok(
  typeof canonical.versionPinNote === "string" &&
    canonical.versionPinNote.trim().length >= 40,
  "Canonical Gemini policy must carry a versionPinNote explaining why `version` is where it is",
);
assert.equal(
  canonical.version,
  5,
  "Gemini policy `version` is pinned at 5. postImageReviewRequired compares a stored post's model_policy_version by exact equality, so bumping it strands every archived creative behind a forced re-review. New request capabilities must ship additively under version 5.",
);

const expectedTaskNames = [
  "caption",
  "caption_regenerate",
  "caption_edit",
  "vision_review",
  "image_standard",
  "image_studio",
  "video_standard",
  "video_quality",
];
assert.deepEqual(
  Object.keys(canonical.tasks),
  expectedTaskNames,
  "Canonical Gemini task inventory changed without a contract update",
);

const configuredModels = new Set(Object.values(canonical.models));

const THINKING_LEVELS = ["minimal", "low", "medium", "high"];
assert.ok(
  canonical.thinkingLevels && typeof canonical.thinkingLevels === "object",
  "Canonical Gemini policy must declare per-model thinkingLevels",
);
for (const [model, levels] of Object.entries(canonical.thinkingLevels)) {
  assert.ok(
    configuredModels.has(model),
    `thinkingLevels references undeclared model ${model}`,
  );
  assert.ok(
    Array.isArray(levels) && levels.length > 0,
    `${model} must list at least one supported thinking level`,
  );
  for (const level of levels) {
    assert.ok(
      THINKING_LEVELS.includes(level),
      `${model} lists unknown thinking level ${level}`,
    );
  }
}

for (const [taskName, task] of Object.entries(canonical.tasks)) {
  assert.ok(task.models.length > 0, `${taskName} must have at least one model`);
  assert.equal(
    new Set(task.models).size,
    task.models.length,
    `${taskName} contains a duplicate model`,
  );
  for (const model of task.models) {
    assert.ok(
      configuredModels.has(model),
      `${taskName} references undeclared model ${model}`,
    );
    assert.ok(
      !model.includes("gemini-2.5"),
      `${taskName} reintroduced the retired Gemini 2.5 fallback`,
    );
  }

  if (task.kind === "text") {
    assert.equal(
      task.maxOutputTokens,
      2048,
      `${taskName} must preserve the 2048-token caption contract`,
    );
    assert.ok(
      THINKING_LEVELS.includes(task.thinkingLevel),
      `${taskName} must pin a thinkingLevel from ${THINKING_LEVELS.join("|")}`,
    );
    for (const model of task.models) {
      assert.ok(
        canonical.thinkingLevels[model]?.includes(task.thinkingLevel),
        `${taskName} pins thinkingLevel "${task.thinkingLevel}" which ${model} does not support`,
      );
    }
  } else {
    assert.ok(
      !("thinkingLevel" in task),
      `${taskName} is not a text task and must not carry a thinkingLevel`,
    );
  }
  if (task.kind === "image") {
    assert.equal(
      task.maxOutputTokens,
      4096,
      `${taskName} must preserve the bounded image token contract`,
    );
    assert.deepEqual(
      Object.keys(task.imageSizes).sort(),
      [...task.models].sort(),
      `${taskName} must specify an output size for every model`,
    );
  }
}

// Thinking tokens bill as output tokens, so the split is a cost contract, not
// a style preference: the vision-QC review is the only text task that pays
// for "medium" reasoning, and every caption task stays below it.
assert.equal(
  canonical.tasks.vision_review.thinkingLevel,
  "medium",
  "vision_review must keep thinkingLevel medium — it is the QC read the plan pays for",
);
for (const captionTask of ["caption", "caption_regenerate", "caption_edit"]) {
  assert.ok(
    ["minimal", "low"].includes(canonical.tasks[captionTask].thinkingLevel),
    `${captionTask} must stay at minimal/low thinking; medium bills reasoning on every caption`,
  );
}

// Both output tiers use the stable Omni model. Retired Veo identifiers belong
// only to the server's installed-client adapter, never to an executable ladder.
const VIDEO_MODEL = "gemini-omni-1.1-flash";
for (const key of ["videoStandard", "videoQuality", "videoFallback"]) {
  assert.equal(canonical.models[key], VIDEO_MODEL);
}
assert.deepEqual(canonical.tasks.video_standard, {
  kind: "video",
  tier: "standard",
  models: [VIDEO_MODEL],
  resolution: "720p",
});
assert.deepEqual(canonical.tasks.video_quality, {
  kind: "video",
  tier: "quality",
  models: [VIDEO_MODEL],
  resolution: "1080p",
});

const generateFields = canonical.allowedRequestFields.generateContent;
assert.deepEqual(generateFields.topLevel, [
  "contents",
  "generationConfig",
  "systemInstruction",
]);
assert.deepEqual(
  generateFields.requiredTopLevel,
  ["contents", "generationConfig"],
  "systemInstruction must stay optional so clients that predate it remain valid",
);
assert.ok(
  generateFields.requiredTopLevel.every((field) =>
    generateFields.topLevel.includes(field),
  ),
  "Every required top-level field must also be an allowed top-level field",
);
assert.deepEqual(
  generateFields.systemInstruction,
  ["parts"],
  "systemInstruction must admit only `parts`",
);
assert.deepEqual(
  generateFields.textGenerationConfig,
  ["maxOutputTokens", "thinkingConfig", "responseMimeType", "schemaId"],
  "Text generationConfig allowlist drifted",
);
assert.deepEqual(
  generateFields.thinkingConfig,
  ["thinkingLevel"],
  "thinkingConfig must admit only thinkingLevel (never thinkingBudget or includeThoughts)",
);
assert.ok(
  !generateFields.topLevel.includes("safetySettings"),
  "Clients must not be allowed to submit safetySettings",
);

// Structured output is an id into a server-owned registry. Accepting a schema
// body from the browser would let a tampered PWA rewrite the response
// contract, so neither spelling may ever appear in an allowlist.
for (const [group, fieldSets] of Object.entries(canonical.allowedRequestFields)) {
  for (const [name, fields] of Object.entries(fieldSets)) {
    for (const field of fields) {
      assert.ok(
        !["responseSchema", "responseJsonSchema"].includes(field),
        `${group}.${name} must never accept a client-supplied ${field}`,
      );
      // Deprecated on Gemini 3.x since 2026-07-21; documented as a 400 on the
      // pinned 3.6-flash / 3.5-flash-lite ids. Style guidance belongs in
      // systemInstruction instead.
      assert.ok(
        !["temperature", "topP", "topK", "candidateCount"].includes(field),
        `${group}.${name} must never accept the deprecated sampling field ${field}`,
      );
    }
  }
}

// Veo request surface. `negativePrompt` is the only optional parameter and is
// verified against both official Google SDKs' Gemini-Developer-API converters
// (parameters.negativePrompt). `generateAudio` must never appear: those same
// converters raise on it outside Vertex/GEAP, so sending it on
// generativelanguage.googleapis.com risks a 400 on every video generation.
const veoFields = canonical.allowedRequestFields.veo;
assert.deepEqual(
  veoFields.parameters,
  [
    "aspectRatio",
    "personGeneration",
    "durationSeconds",
    "resolution",
    "negativePrompt",
  ],
  "Veo parameters allowlist drifted",
);
assert.deepEqual(
  veoFields.requiredParameters,
  ["aspectRatio", "personGeneration", "durationSeconds", "resolution"],
  "negativePrompt must stay optional so clients that predate it remain valid",
);
assert.ok(
  veoFields.requiredParameters.every((field) => veoFields.parameters.includes(field)),
  "Every required Veo parameter must also be an allowed Veo parameter",
);
assert.ok(
  !veoFields.parameters.includes("generateAudio"),
  "generateAudio is not accepted on the Gemini Developer API Veo endpoint this proxy calls",
);
assert.ok(
  typeof canonical.veoParameterNote === "string" &&
    canonical.veoParameterNote.includes("generateAudio"),
  "Canonical Gemini policy must record why generateAudio stays off the Veo allowlist",
);
assert.ok(
  Number.isInteger(canonical.requestLimits.maxNegativePromptChars) &&
    canonical.requestLimits.maxNegativePromptChars > 0 &&
    canonical.requestLimits.maxNegativePromptChars <=
      canonical.requestLimits.maxPromptChars,
  "maxNegativePromptChars must be a positive bound no larger than maxPromptChars",
);

assert.deepEqual(
  canonical.allowedResponseMimeTypes,
  ["application/json"],
  "Structured output is JSON-only",
);
assert.deepEqual(
  policyModule.exports.geminiResponseSchemaIds(),
  canonical.responseSchemaIds,
  "PocketBase response-schema registry drifted from responseSchemaIds in config/gemini-model-policy.json",
);
assert.ok(
  canonical.responseSchemaIds.length > 0 &&
    canonical.responseSchemaIds.every((id) => /^[a-z0-9_]+_v\d+$/.test(id)),
  "Every response schema id must be lowercase snake_case with a trailing _v<N>",
);
for (const schemaId of canonical.responseSchemaIds) {
  const schema = policyModule.exports.geminiResponseSchema(schemaId);
  assert.ok(schema && schema.type === "object", `${schemaId} must be an object schema`);
  assert.equal(
    schema.additionalProperties,
    false,
    `${schemaId} must forbid additional properties`,
  );
  for (const required of schema.required || []) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(schema.properties, required),
      `${schemaId} requires "${required}" but does not declare it`,
    );
  }
}
assert.equal(
  policyModule.exports.geminiResponseSchema("not_a_registered_schema_v1"),
  null,
  "Unknown schema ids must resolve to null",
);

assert.ok(
  Number.isInteger(canonical.requestLimits.maxSystemInstructionChars) &&
    canonical.requestLimits.maxSystemInstructionChars > 0 &&
    canonical.requestLimits.maxSystemInstructionChars <=
      canonical.requestLimits.maxPromptChars,
  "maxSystemInstructionChars must be a positive bound no larger than maxPromptChars",
);
assert.deepEqual(
  canonical.safetySettings.map((setting) => setting.category).sort(),
  [
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  ],
  "Server safety categories drifted",
);
for (const setting of canonical.safetySettings) {
  assert.equal(
    setting.threshold,
    "BLOCK_MEDIUM_AND_ABOVE",
    `${setting.category} must remain server-owned at BLOCK_MEDIUM_AND_ABOVE`,
  );
}

console.log(
  `Gemini model policy is in sync (version ${canonical.version}, verified ${canonical.verifiedAt}).`,
);
