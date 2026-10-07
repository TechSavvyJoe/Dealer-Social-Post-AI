import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  triggerHapticFeedback: vi.fn(),
}));

vi.mock("../utils/haptics", () => ({
  triggerHapticFeedback: mocks.triggerHapticFeedback,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ warning: mocks.toastWarning, success: vi.fn(), error: vi.fn() }),
}));

import { usePostLeaveGuard } from "./usePostLeaveGuard";
import { useAppStore } from "../stores/appStore";

const baseOptions = {
  hasSavedMedia: true,
  hasCopiedCaption: true,
  captionWasEdited: false,
  imageEditPromptDirty: false,
  videoJobCount: 0,
  imageBusy: false,
  textBusy: false,
  websiteSending: false,
};

describe("usePostLeaveGuard", () => {
  beforeEach(() => {
    mocks.toastWarning.mockReset();
    mocks.triggerHapticFeedback.mockReset();
    useAppStore.setState({ postBusy: null });
  });

  it("is not at risk once media is saved and the caption is copied unedited", () => {
    const { result } = renderHook(() => usePostLeaveGuard(baseOptions));
    expect(result.current.atRisk).toBe(false);
    expect(result.current.requestLeave("startOver")).toBe("go");
  });

  it("is at risk when the caption was edited, unsaved media, or a video job exists", () => {
    expect(
      renderHook(() => usePostLeaveGuard({ ...baseOptions, hasSavedMedia: false }))
        .result.current.atRisk,
    ).toBe(true);
    expect(
      renderHook(() => usePostLeaveGuard({ ...baseOptions, captionWasEdited: true }))
        .result.current.atRisk,
    ).toBe(true);
    expect(
      renderHook(() => usePostLeaveGuard({ ...baseOptions, videoJobCount: 1 })).result
        .current.atRisk,
    ).toBe(true);
  });

  it("blocks leaving with a busy toast instead of confirming, while busy", () => {
    const { result } = renderHook(() =>
      usePostLeaveGuard({ ...baseOptions, imageBusy: true, hasSavedMedia: false }),
    );
    expect(result.current.requestLeave("remix")).toBe("blocked");
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Wait for the current update to finish before remixing this photo.",
    );
    expect(mocks.triggerHapticFeedback).toHaveBeenCalled();
  });

  it("uses the website-handoff specific busy message over the other reasons", () => {
    const { result } = renderHook(() =>
      usePostLeaveGuard({ ...baseOptions, websiteSending: true, textBusy: true }),
    );
    expect(result.current.requestLeave("startOver")).toBe("blocked");
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Wait for the final website handoff to finish before leaving this post.",
    );
  });

  it("publishes what is running to the store while mounted and clears it on unmount (A4)", () => {
    const { rerender, unmount } = renderHook(
      (options: typeof baseOptions) => usePostLeaveGuard(options),
      { initialProps: baseOptions },
    );
    expect(useAppStore.getState().postBusy).toBeNull();

    rerender({ ...baseOptions, imageBusy: true });
    expect(useAppStore.getState().postBusy).toBe("image");

    rerender({ ...baseOptions, textBusy: true });
    expect(useAppStore.getState().postBusy).toBe("image");

    // The website handoff names itself even while a render also runs.
    rerender({ ...baseOptions, imageBusy: true, websiteSending: true });
    expect(useAppStore.getState().postBusy).toBe("website");

    rerender(baseOptions);
    expect(useAppStore.getState().postBusy).toBeNull();

    rerender({ ...baseOptions, websiteSending: true });
    expect(useAppStore.getState().postBusy).toBe("website");
    // Leaving the screen never strands the shell in a busy state.
    unmount();
    expect(useAppStore.getState().postBusy).toBeNull();
  });

  it("asks the caller to confirm when at risk and not busy", () => {
    const { result } = renderHook(() =>
      usePostLeaveGuard({ ...baseOptions, hasCopiedCaption: false }),
    );
    expect(result.current.requestLeave("startOver")).toBe("confirm");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
