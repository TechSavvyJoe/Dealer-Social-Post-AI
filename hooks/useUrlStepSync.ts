import { useEffect, useRef } from "react";
import { AppStep } from "../types";
import { useAppStore } from "../stores/appStore";

/**
 * Hash-based history sync for the AppStep state machine.
 *
 * The platform Back gesture used to exit the installed PWA because the app
 * never wrote history entries. This hook mirrors the store's step into
 * `#/step` URLs and translates popstate back through the same guards the UI
 * enforces, so Back steps through the flow instead of discarding it.
 *
 * Hash (not path) routing is deliberate: the SPA is served from two origins
 * (Vercel and the Fly PocketBase static mount) and hash URLs need no SPA
 * fallback configuration on either. The URL is wayfinding, not authorization —
 * session restore remains authoritative on boot, and auth-gated steps degrade
 * to whatever the restored session allows.
 */
const STEP_TO_HASH: Record<AppStep, string> = {
  [AppStep.LOGIN]: "#/login",
  [AppStep.CAPTURE]: "#/capture",
  [AppStep.CUSTOMIZE]: "#/customize",
  [AppStep.GENERATING]: "#/generating",
  [AppStep.RESULT]: "#/result",
  [AppStep.ADMIN]: "#/admin",
  [AppStep.DEALER_ADMIN]: "#/dealership",
};

const HASH_TO_STEP = new Map<string, AppStep>(
  (Object.entries(STEP_TO_HASH) as Array<[string, string]>).map(([step, hash]) => [
    hash,
    Number(step) as AppStep,
  ]),
);

/** Transient or entry steps never become their own history entries. */
const REPLACE_STEPS = new Set<AppStep>([AppStep.LOGIN, AppStep.GENERATING]);

export const useUrlStepSync = (options?: { onBlockedResultBack?: () => void }) => {
  const step = useAppStore((s) => s.step);
  const applyingPop = useRef(false);
  const blockedRef = useRef(options?.onBlockedResultBack);
  blockedRef.current = options?.onBlockedResultBack;

  // Boot: normalize whatever URL we were opened with to the restored step.
  useEffect(() => {
    window.history.replaceState(null, "", STEP_TO_HASH[useAppStore.getState().step]);
  }, []);

  // Forward sync: store → URL.
  useEffect(() => {
    const target = STEP_TO_HASH[step];
    if (window.location.hash === target.slice(1) || window.location.hash === target) {
      return;
    }
    if (applyingPop.current) {
      applyingPop.current = false;
      return;
    }
    if (REPLACE_STEPS.has(step)) {
      window.history.replaceState(null, "", target);
    } else {
      window.history.pushState(null, "", target);
    }
  }, [step]);

  // Back/forward sync: URL → store, through the flow's guards.
  useEffect(() => {
    const onPopState = () => {
      const state = useAppStore.getState();
      const current = state.step;
      const target = HASH_TO_STEP.get(window.location.hash);
      if (target === undefined || target === current) return;

      const restoreUrl = () =>
        window.history.pushState(null, "", STEP_TO_HASH[current]);

      // Never bypass the result screen's leave confirmation: an expensive
      // creative must be discarded explicitly, not by a swipe.
      if (current === AppStep.RESULT) {
        restoreUrl();
        blockedRef.current?.();
        return;
      }
      // A generation in flight owns the screen, exactly like the UI.
      if (current === AppStep.GENERATING) {
        restoreUrl();
        return;
      }
      // The URL never signs anyone in or out.
      if (current === AppStep.LOGIN || target === AppStep.LOGIN) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      // Forward-navigation into RESULT only makes sense with a creative.
      if (
        (target === AppStep.RESULT || target === AppStep.GENERATING) &&
        !state.generatedPost
      ) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      applyingPop.current = true;
      state.setStep(target);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
};
