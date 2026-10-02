import { useEffect, useRef } from "react";
import { AppStep } from "../types";
import { useAppStore } from "../stores/appStore";

const STEP_TO_HASH: Record<AppStep, string> = {
  [AppStep.LOGIN]: "#/login",
  [AppStep.HOME]: "#/home",
  [AppStep.DETAILS]: "#/details",
  [AppStep.CREATING]: "#/details",
  [AppStep.POST]: "#/post",
  [AppStep.ADMIN]: "#/admin",
  [AppStep.DEALER_ADMIN]: "#/dealership",
  [AppStep.WORK]: "#/work",
};
const HASH_TO_STEP = new Map<string, AppStep>([
  ["#/login", AppStep.LOGIN],
  ["#/home", AppStep.HOME],
  ["#/details", AppStep.DETAILS],
  ["#/post", AppStep.POST],
  ["#/work", AppStep.WORK],
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

/** URL navigation uses the same workspace and role guards as visible controls. */
export const useUrlStepSync = (options?: {
  onBlockedResultBack?: () => void;
  managementDirty?: boolean;
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
      if (current === AppStep.DEALER_ADMIN && managementRef.current?.managementDirty) {
        restore();
        managementRef.current.onBlockedManagementBack?.(target);
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
