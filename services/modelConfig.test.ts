import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  getFallbackChain,
  MODEL_POLICY,
  MODEL_POLICY_VERSION,
  TASKS,
  TASK_PARAMS,
  type ModelTaskName,
} from "./modelConfig";

const taskNames = Object.keys(MODEL_POLICY.tasks) as ModelTaskName[];

describe("canonical Gemini model policy", () => {
  it("pins the approved balanced-premium routing", () => {
    expect(MODEL_POLICY.tasks.caption.models).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
    expect(MODEL_POLICY.tasks.caption_edit.models).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
    ]);
    expect(MODEL_POLICY.tasks.image_standard.models).toEqual([
      "gemini-3-pro-image",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-lite-image",
    ]);
    expect(MODEL_POLICY.tasks.image_studio.models).toEqual([
      "gemini-3-pro-image",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-lite-image",
    ]);
    expect(MODEL_POLICY.tasks.image_standard.imageSizes).toMatchObject({
      "gemini-3-pro-image": "2K",
    });
    expect(MODEL_POLICY.tasks.image_studio.imageSizes).toMatchObject({
      "gemini-3-pro-image": "4K",
    });
    expect(MODEL_POLICY.tasks.video_standard).toMatchObject({
      models: ["gemini-omni-1.1-flash"],
      resolution: "720p",
    });
    expect(MODEL_POLICY.tasks.video_quality).toMatchObject({
      models: ["gemini-omni-1.1-flash"],
      resolution: "1080p",
    });
    expect(JSON.stringify(MODEL_POLICY)).not.toContain("gemini-2.5");
  });

  it.each(taskNames)("derives %s runtime routing from the artifact", (task) => {
    const policyTask = MODEL_POLICY.tasks[task];
    const runtimeTask = TASKS[task];

    expect(getFallbackChain(task)).toEqual(policyTask.models);
    expect(runtimeTask.primary).toBe(policyTask.models[0]);
    expect(runtimeTask.fallback).toBe(policyTask.models[1]);
    expect(runtimeTask.emergency).toBe(policyTask.models[2]);
    expect(runtimeTask.tier).toBe(policyTask.tier);
    expect(TASK_PARAMS[task].maxOutputTokens).toBe(policyTask.maxOutputTokens);
    expect(TASK_PARAMS[task].thinkingConfig).toEqual(
      policyTask.thinkingLevel
        ? { thinkingLevel: policyTask.thinkingLevel }
        : undefined,
    );
    expect(runtimeTask.resolution).toBe(policyTask.resolution);
    expect(runtimeTask.imageSizes).toEqual(policyTask.imageSizes);
  });

  it("pins a cheap Gemini 3.x thinking level on every text task", () => {
    expect(MODEL_POLICY.tasks.caption.thinkingLevel).toBe("low");
    expect(MODEL_POLICY.tasks.caption_regenerate.thinkingLevel).toBe("low");
    expect(MODEL_POLICY.tasks.caption_edit.thinkingLevel).toBe("minimal");
    expect(TASK_PARAMS.caption).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(TASK_PARAMS.caption_edit).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    for (const task of taskNames) {
      const policyTask = MODEL_POLICY.tasks[task];
      if (policyTask.kind === "text") {
        for (const model of policyTask.models) {
          expect(MODEL_POLICY.thinkingLevels[model]).toContain(
            policyTask.thinkingLevel,
          );
        }
      } else {
        expect(policyTask.thinkingLevel).toBeUndefined();
        expect(TASK_PARAMS[task]).not.toHaveProperty("thinkingConfig");
      }
    }
    expect(
      MODEL_POLICY.allowedRequestFields.generateContent.textGenerationConfig,
    ).toEqual([
      "maxOutputTokens",
      "thinkingConfig",
      // Structured output: the client sends an id, the proxy injects the
      // schema body from its own registry.
      "responseMimeType",
      "schemaId",
    ]);
    expect(MODEL_POLICY.allowedRequestFields.generateContent.thinkingConfig).toEqual([
      "thinkingLevel",
    ]);
  });

  it("advertises only Claude ids the proxy accepts", () => {
    expect(CLAUDE_MODELS).toEqual({ text_fast: "claude-haiku-4-5-20251001" });
    for (const task of taskNames) {
      const claudeFallback = TASKS[task].claudeFallback;
      if (claudeFallback) {
        expect(Object.values(CLAUDE_MODELS)).toContain(claudeFallback);
      }
    }
  });

  it("exports a stable version for generation metadata", () => {
    expect(MODEL_POLICY_VERSION).toBe(String(MODEL_POLICY.version));
    expect(MODEL_POLICY_VERSION).not.toBe("");
  });

  it("keeps server-owned safety fields out of the client allowlist", () => {
    expect(MODEL_POLICY.allowedRequestFields.generateContent.topLevel).toEqual([
      "contents",
      "generationConfig",
      "systemInstruction",
    ]);
    // systemInstruction is accepted but not required, so a client that
    // predates the prompt split stays valid.
    expect(MODEL_POLICY.allowedRequestFields.generateContent.requiredTopLevel).toEqual([
      "contents",
      "generationConfig",
    ]);
    expect(MODEL_POLICY.allowedRequestFields.generateContent.topLevel).not.toContain(
      "safetySettings",
    );
    expect(MODEL_POLICY.safetySettings).toHaveLength(4);
    expect(
      new Set(MODEL_POLICY.safetySettings.map((setting) => setting.category)).size,
    ).toBe(4);
    for (const setting of MODEL_POLICY.safetySettings) {
      expect(setting.threshold).toBe("BLOCK_MEDIUM_AND_ABOVE");
    }
  });
});
