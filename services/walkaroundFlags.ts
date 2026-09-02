// Kept apart from services/walkarounds.ts so the eagerly loaded app shell
// (components/MainContent.tsx) can evaluate the feature flag without
// statically dragging the whole walkaround service — upload sessions, YouTube
// connect flows, production polling — into the boot-critical entry chunk.
export const isWalkaroundStudioEnabled = (value: unknown): boolean => value === "true";
