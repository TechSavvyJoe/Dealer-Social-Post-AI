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

  it("asks the caller to confirm when at risk and not busy", () => {
    const { result } = renderHook(() =>
      usePostLeaveGuard({ ...baseOptions, hasCopiedCaption: false }),
    );
    expect(result.current.requestLeave("startOver")).toBe("confirm");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
