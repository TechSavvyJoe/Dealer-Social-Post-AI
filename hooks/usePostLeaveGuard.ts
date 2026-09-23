import { useCallback } from "react";
import { triggerHapticFeedback } from "../utils/haptics";
import { useToast } from "../components/ui/Toast";

export interface UsePostLeaveGuardOptions {
  hasSavedMedia: boolean;
  hasCopiedCaption: boolean;
  captionWasEdited: boolean;
  /** imageEditPrompt.trim().length > 0 */
  imageEditPromptDirty: boolean;
  videoJobCount: number;
  imageBusy: boolean;
  textBusy: boolean;
  websiteSending: boolean;
}

export type LeaveOutcome = "blocked" | "confirm" | "go";

export interface UsePostLeaveGuardResult {
  /** hasWorkAtRisk — leaving now would lose unsaved local edits. This is
   * PR2b's `canLeavePost` as `atRisk === false`, never `Boolean(postId)`. */
  atRisk: boolean;
  /**
   * Runs the exact original decision procedure (haptic, then the busy
   * check/toast, then the at-risk check) and reports what the caller should
   * do: "blocked" (a toast already fired, stay put), "confirm" (show the
   * leave-confirm dialog for this mode), or "go" (safe to leave immediately).
   */
  requestLeave: (mode: "startOver" | "remix") => LeaveOutcome;
}

/**
 * Leave guard extracted verbatim from components/PostResult.tsx
 * (hasWorkAtRisk / requestLeaveResult). Busy checks (imageBusy, textBusy,
 * websiteSending) block leaving immediately with a toast; otherwise unsaved
 * work (hasWorkAtRisk) requires confirmation before starting over or
 * remixing.
 *
 * `useDraftAutosave`'s in-flight/failed status and a future
 * `useVideoJobs.atRisk` are documented inputs for a fuller "at risk" signal,
 * but are not wired into `atRisk` here: PR2-0 is an invisible extraction, and
 * widening this formula would change when the confirm dialog appears, which
 * is a user-visible behavior change out of scope for this unit.
 */
export const usePostLeaveGuard = ({
  hasSavedMedia,
  hasCopiedCaption,
  captionWasEdited,
  imageEditPromptDirty,
  videoJobCount,
  imageBusy,
  textBusy,
  websiteSending,
}: UsePostLeaveGuardOptions): UsePostLeaveGuardResult => {
  const toast = useToast();

  const atRisk =
    !hasSavedMedia ||
    !hasCopiedCaption ||
    captionWasEdited ||
    imageEditPromptDirty ||
    videoJobCount > 0;

  const requestLeave = useCallback(
    (mode: "startOver" | "remix"): LeaveOutcome => {
      triggerHapticFeedback();
      if (imageBusy || textBusy || websiteSending) {
        toast.warning(
          websiteSending
            ? "Wait for the final website handoff to finish before leaving this post."
            : mode === "remix"
              ? "Wait for the current update to finish before remixing this photo."
              : "Wait for the current update to finish before starting another post.",
        );
        return "blocked";
      }
      if (atRisk) return "confirm";
      return "go";
    },
    [atRisk, imageBusy, textBusy, toast, websiteSending],
  );

  return { atRisk, requestLeave };
};
