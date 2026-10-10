import { useEffect, useRef } from "react";
import { AppStep } from "../types";
import { useAppStore, type PostBusyReason } from "../stores/appStore";

const STEP_TO_HASH: Record<AppStep, string> = {
  [AppStep.LOGIN]: "#/login",
  [AppStep.HOME]: "#/home",
  [AppStep.DETAILS]: "#/details",
  [AppStep.CREATING]: "#/details",
  [AppStep.POST]: "#/post",
  [AppStep.ADMIN]: "#/admin",
  [AppStep.DEALER_ADMIN]: "#/dealership",
  [AppStep.WORK]: "#/work",
  [AppStep.VEHICLE_SPIN]: "#/vehicle-studio",
  [AppStep.WALKAROUND]: "#/walkaround-studio",
};
const HASH_TO_STEP = new Map<string, AppStep>([
  ["#/login", AppStep.LOGIN],
  ["#/home", AppStep.HOME],
  ["#/details", AppStep.DETAILS],
  ["#/post", AppStep.POST],
  ["#/work", AppStep.WORK],
  ["#/vehicle-studio", AppStep.VEHICLE_SPIN],
  ["#/walkaround-studio", AppStep.WALKAROUND],
  ["#/admin", AppStep.ADMIN],
  ["#/dealership", AppStep.DEALER_ADMIN],
  ["#/capture", AppStep.HOME],
  ["#/customize", AppStep.DETAILS],
  ["#/generating", AppStep.DETAILS],
  ["#/result", AppStep.POST],
]);

export const postHasWorkAtRisk = (): boolean => {
  const state = useAppStore.getState();
  return (
    state.postWorkAtRisk || Boolean(state.generatedPost && !state.generatedPost.postId)
  );
};

/** The original Post-screen busy toasts (amendments A4), word for word. */
export const POST_BUSY_MESSAGES: Record<Exclude<PostBusyReason, null>, string> = {
  website: "Wait for the final website handoff to finish before leaving this post.",
  image: "Wait for the current update to finish before leaving this post.",
};

/**
 * The toast to show instead of leaving the Post screen, or null when nothing
 * is running. Read at the moment of the exit so it is never stale.
 */
export const postBusyMessage = (): string | null => {
  const reason = useAppStore.getState().postBusy;
  return reason ? POST_BUSY_MESSAGES[reason] : null;
};

/** URL navigation uses the same workspace and role guards as visible controls. */
export const useUrlStepSync = (options?: {
  onBlockedResultBack?: () => void;
  /** Browser Back while a render or the website handoff is still running. */
  onBusyResultBack?: (message: string) => void;
  /** Browser Back to Home from Details that holds the customer's signature. */
  onBlockedDraftBack?: (target: AppStep) => void;
  managementDirty?: boolean;
  spinDirty?: boolean;
  onBlockedSpinBack?: (target: AppStep) => void;
  walkaroundDirty?: boolean;
  onBlockedWalkaroundBack?: (target: AppStep) => void;
  onBlockedManagementBack?: (target: AppStep) => void;
}) => {
  const step = useAppStore((s) => s.step);
  const blockedRef = useRef(options?.onBlockedResultBack);
  blockedRef.current = options?.onBlockedResultBack;
  const managementRef = useRef(options);
  managementRef.current = options;
  const applyingPop = useRef(false);
  useEffect(() => {
    window.history.replaceState(null, "", STEP_TO_HASH[useAppStore.getState().step]);
  }, []);
  useEffect(() => {
    const cameFromPop = applyingPop.current;
    applyingPop.current = false;
    const target = STEP_TO_HASH[step];
    if (cameFromPop || window.location.hash === target) return;
    if (step === AppStep.LOGIN || step === AppStep.CREATING)
      window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
  }, [step]);
  useEffect(() => {
    const onPopState = () => {
      // App owns public capability links outside the authenticated workspace.
      // Leave the hash intact so its route listener can open the customer view,
      // including same-document navigation from an already-open app tab.
      if (window.location.hash.startsWith("#/spin/")) return;
      const state = useAppStore.getState();
      const current = state.step;
      let target = HASH_TO_STEP.get(window.location.hash);
      if (target === undefined) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      if (target === current) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      const restore = () => window.history.pushState(null, "", STEP_TO_HASH[current]);
      if (current === AppStep.CREATING) {
        restore();
        return;
      }
      if (current === AppStep.POST) {
        const busy = postBusyMessage();
        if (busy) {
          restore();
          managementRef.current?.onBusyResultBack?.(busy);
          return;
        }
      }
      if (current === AppStep.POST && postHasWorkAtRisk()) {
        restore();
        blockedRef.current?.();
        return;
      }
      if (
        current === AppStep.LOGIN ||
        target === AppStep.LOGIN ||
        !state.currentDealer
      ) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      if (
        (target === AppStep.ADMIN && state.role !== "super_admin") ||
        (target === AppStep.DEALER_ADMIN &&
          state.role !== "dealer_admin" &&
          state.role !== "super_admin") ||
        (target === AppStep.POST && !state.generatedPost)
      ) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      if (current === AppStep.POST && state.postReturnStep !== null)
        target = state.postReturnStep;
      if (target === AppStep.DETAILS && (!state.selectedImage || !state.postDraft))
        target = AppStep.HOME;
      // Redirected onto the step already showing: nothing changes, so the step
      // effect never runs to consume applyingPop and it would swallow the next
      // real navigation's history entry. Just put the URL back.
      if (target === current) {
        window.history.replaceState(null, "", STEP_TO_HASH[current]);
        return;
      }
      // Home starts a fresh draft, so it would drop a signed release unasked.
      if (
        current === AppStep.DETAILS &&
        target === AppStep.HOME &&
        state.pendingRelease &&
        managementRef.current?.onBlockedDraftBack
      ) {
        restore();
        managementRef.current.onBlockedDraftBack(target);
        return;
      }
      if (current === AppStep.DEALER_ADMIN && managementRef.current?.managementDirty) {
        restore();
        managementRef.current.onBlockedManagementBack?.(target);
        return;
      }
      if (current === AppStep.VEHICLE_SPIN && managementRef.current?.spinDirty) {
        restore();
        managementRef.current.onBlockedSpinBack?.(target);
        return;
      }
      if (current === AppStep.WALKAROUND && managementRef.current?.walkaroundDirty) {
        restore();
        managementRef.current.onBlockedWalkaroundBack?.(target);
        return;
      }
      applyingPop.current = true;
      state.setStep(target);
      window.history.replaceState(null, "", STEP_TO_HASH[target]);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
};
