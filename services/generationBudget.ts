import type { NormalizedError } from "../utils/errorHandler";

// Leave two minutes before the outer queue's five-minute deadline for the
// completed caption, original-photo fallback and post persistence to finish.
export const POST_IMAGE_BUDGET_MS = 180_000;

export const createGenerationBudget = (
  parentSignal?: AbortSignal,
  timeoutMs = POST_IMAGE_BUDGET_MS,
) => {
  const controller = new AbortController();
  const deadlineError = new Error(
    "Image preparation reached its time limit.",
  ) as NormalizedError;
  deadlineError.name = "GenerationBudgetExceeded";
  deadlineError.kind = "timeout";
  deadlineError.retryable = false;
  const cancel = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) cancel();
  else parentSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(deadlineError), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", cancel);
    },
  };
};
