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
assert.ok(
  policyAgeDays <= 45,
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
assert.deepEqual(
  policyModule.exports.geminiModelPolicySnapshot(),
  canonical,
  "PocketBase Gemini policy drifted from config/gemini-model-policy.json",
);

const expectedTaskNames = [
  "caption",
  "caption_regenerate",
  "caption_edit",
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

assert.deepEqual(canonical.tasks.video_standard, {
  kind: "video",
  tier: "standard",
  models: [canonical.models.videoStandard],
  resolution: "720p",
});
assert.deepEqual(canonical.tasks.video_quality, {
  kind: "video",
  tier: "quality",
  models: [canonical.models.videoQuality],
  resolution: "1080p",
});

const generateFields = canonical.allowedRequestFields.generateContent;
assert.deepEqual(generateFields.topLevel, ["contents", "generationConfig"]);
assert.deepEqual(
  generateFields.textGenerationConfig,
  ["maxOutputTokens", "thinkingConfig"],
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
