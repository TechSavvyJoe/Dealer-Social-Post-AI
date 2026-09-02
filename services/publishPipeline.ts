// Loader for the publish/compliance pipeline that runs after Generate:
// consent gating (photo releases), caption compliance and quality checks,
// platform copy, export rendering, website drafting, and post persistence.
// The implementation lives in ./publishPipelineModules so the login screen's
// entry chunk never statically pulls that graph; callers await
// loadPublishPipeline() inside the same guards where the work happens.
export type PublishPipelineModule = typeof import("./publishPipelineModules");

let publishPipelineModulePromise: Promise<PublishPipelineModule> | null = null;

// Mirrors loadGeminiService in hooks/useGemini.ts: memoize the in-flight
// import so warm-up and use share one download, but never cache a failed
// import — a preload that lost the network race must not poison every later
// Generate until a full page reload.
export const loadPublishPipeline = (): Promise<PublishPipelineModule> => {
  if (!publishPipelineModulePromise) {
    publishPipelineModulePromise = import("./publishPipelineModules").catch((error) => {
      publishPipelineModulePromise = null;
      throw error;
    });
  }
  return publishPipelineModulePromise;
};
