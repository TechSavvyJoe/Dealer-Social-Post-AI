import { describe, expect, it } from "vitest";
import {
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
      models: ["veo-3.1-fast-generate-preview"],
      resolution: "720p",
    });
    expect(MODEL_POLICY.tasks.video_quality).toMatchObject({
      models: ["veo-3.1-generate-preview"],
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
    expect(runtimeTask.resolution).toBe(policyTask.resolution);
    expect(runtimeTask.imageSizes).toEqual(policyTask.imageSizes);
  });

  it("exports a stable version for generation metadata", () => {
    expect(MODEL_POLICY_VERSION).toBe(String(MODEL_POLICY.version));
    expect(MODEL_POLICY_VERSION).not.toBe("");
  });

  it("keeps server-owned safety fields out of the client allowlist", () => {
    expect(MODEL_POLICY.allowedRequestFields.generateContent.topLevel).toEqual([
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
