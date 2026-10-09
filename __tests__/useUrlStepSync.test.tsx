import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStep } from "../types";
import { useAppStore } from "../stores/appStore";
import { useUrlStepSync } from "../hooks/useUrlStepSync";
const Harness = ({
  onBlocked,
  onBusy,
  managementDirty,
  onManagement,
  onDraft,
  walkaroundDirty,
  onWalkaround,
}: {
  onBlocked?: () => void;
  onBusy?: (message: string) => void;
  managementDirty?: boolean;
  onManagement?: (target: AppStep) => void;
  onDraft?: (target: AppStep) => void;
  walkaroundDirty?: boolean;
  onWalkaround?: (target: AppStep) => void;
}) => {
  useUrlStepSync({
    onBlockedResultBack: onBlocked,
    onBusyResultBack: onBusy,
    managementDirty,
    onBlockedManagementBack: onManagement,
    onBlockedDraftBack: onDraft,
    walkaroundDirty,
    onBlockedWalkaroundBack: onWalkaround,
  });
  return null;
};
const popTo = (hash: string) => {
  window.location.hash = hash;
  window.dispatchEvent(new PopStateEvent("popstate"));
};
describe("streamlined URL navigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/");
    useAppStore.setState({
      step: AppStep.HOME,
      currentDealer: { id: "dealer-1", name: "Example Motors" },
      role: "salesperson",
      selectedImage: "photo",
      generatedPost: null,
      postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
      pendingRelease: null,
      postWorkAtRisk: false,
      postBusy: null,
      postReturnStep: null,
    });
  });
  it("writes Home and Details, with no extra history entry for Creating", () => {
    render(<Harness />);
    expect(window.location.hash).toBe("#/home");
    act(() => useAppStore.getState().setStep(AppStep.DETAILS));
    expect(window.location.hash).toBe("#/details");
    const push = vi.spyOn(window.history, "pushState");
    act(() => useAppStore.getState().setStep(AppStep.CREATING));
    expect(push).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/details");
    push.mockRestore();
  });
  it("normalizes old routes and keeps following transitions in history", () => {
    render(<Harness />);
    act(() => popTo("#/customize"));
    expect(useAppStore.getState().step).toBe(AppStep.DETAILS);
    expect(window.location.hash).toBe("#/details");
    act(() => popTo("#/capture"));
    expect(window.location.hash).toBe("#/home");
    act(() => useAppStore.getState().setStep(AppStep.WORK));
    expect(window.location.hash).toBe("#/work");
  });
  it("maps the Walkaround Studio to its direct route", () => {
    render(<Harness />);
    act(() => useAppStore.getState().setStep(AppStep.WALKAROUND));
    expect(window.location.hash).toBe("#/walkaround-studio");
    act(() => popTo("#/home"));
    expect(useAppStore.getState().step).toBe(AppStep.HOME);
    act(() => popTo("#/walkaround-studio"));
    expect(useAppStore.getState().step).toBe(AppStep.WALKAROUND);
  });
  it("preserves unsaved Walkaround work on browser Back", () => {
    const onWalkaround = vi.fn();
    useAppStore.setState({ step: AppStep.WALKAROUND });
    render(<Harness walkaroundDirty onWalkaround={onWalkaround} />);
    act(() => popTo("#/home"));
    expect(useAppStore.getState().step).toBe(AppStep.WALKAROUND);
    expect(window.location.hash).toBe("#/walkaround-studio");
    expect(onWalkaround).toHaveBeenCalledWith(AppStep.HOME);
  });
  it("refuses an unprepared Details page and unauthorized admin routes", () => {
    render(<Harness />);
    act(() => useAppStore.setState({ postDraft: null, selectedImage: null }));
    for (const hash of ["#/details", "#/admin", "#/dealership", "#/post"]) {
      act(() => popTo(hash));
      expect(useAppStore.getState().step).toBe(AppStep.HOME);
      expect(window.location.hash).toBe("#/home");
    }
  });
  it("blocks Back during creation", () => {
    useAppStore.setState({ step: AppStep.CREATING });
    render(<Harness />);
    act(() => popTo("#/home"));
    expect(useAppStore.getState().step).toBe(AppStep.CREATING);
    expect(window.location.hash).toBe("#/details");
  });
  it("guards unsaved work and pending edits even when a post already has an id", () => {
    const blocked = vi.fn();
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: { image: "photo", text: "caption" },
    });
    render(<Harness onBlocked={blocked} />);
    act(() => popTo("#/home"));
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/post");
    act(() =>
      useAppStore.setState({
        generatedPost: { image: "photo", text: "caption", postId: "post-1" },
        postWorkAtRisk: true,
      }),
    );
    act(() => popTo("#/work"));
    expect(blocked).toHaveBeenCalledTimes(2);
  });
  it("restores a Back pressed while a render or the website handoff is running (A4)", () => {
    const blocked = vi.fn();
    const busy = vi.fn();
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: { image: "photo", text: "caption", postId: "post-1" },
      postReturnStep: AppStep.WORK,
      postBusy: "image",
    });
    render(<Harness onBlocked={blocked} onBusy={busy} />);
    act(() => popTo("#/work"));
    expect(useAppStore.getState().step).toBe(AppStep.POST);
    expect(window.location.hash).toBe("#/post");
    expect(busy).toHaveBeenLastCalledWith(
      "Wait for the current update to finish before leaving this post.",
    );
    // Busy wins over the at-risk confirm, exactly as the old screen's guard.
    act(() => useAppStore.setState({ postBusy: "website", postWorkAtRisk: true }));
    act(() => popTo("#/home"));
    expect(useAppStore.getState().step).toBe(AppStep.POST);
    expect(window.location.hash).toBe("#/post");
    expect(busy).toHaveBeenLastCalledWith(
      "Wait for the final website handoff to finish before leaving this post.",
    );
    expect(busy).toHaveBeenCalledTimes(2);
    expect(blocked).not.toHaveBeenCalled();
    // Once it settles the saved post leaves normally.
    act(() => useAppStore.setState({ postBusy: null, postWorkAtRisk: false }));
    act(() => popTo("#/work"));
    expect(useAppStore.getState().step).toBe(AppStep.WORK);
    expect(busy).toHaveBeenCalledTimes(2);
  });
  it("a Back redirected onto the current step does not swallow the next history entry", () => {
    render(<Harness />);
    act(() => useAppStore.setState({ postDraft: null, selectedImage: null }));
    // A stale Details entry with no draft lands back on Home, unchanged.
    act(() => popTo("#/details"));
    expect(useAppStore.getState().step).toBe(AppStep.HOME);
    expect(window.location.hash).toBe("#/home");
    // The next real navigation still writes its own entry.
    const push = vi.spyOn(window.history, "pushState");
    act(() => {
      useAppStore.setState({
        selectedImage: "photo",
        postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
      });
      useAppStore.getState().setStep(AppStep.DETAILS);
    });
    expect(window.location.hash).toBe("#/details");
    expect(push).toHaveBeenCalledWith(null, "", "#/details");
    push.mockRestore();
  });
  it("allows saved work to leave and returns reopened posts to their source", () => {
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: { image: "photo", text: "caption", postId: "post-1" },
      postReturnStep: AppStep.WORK,
    });
    render(<Harness />);
    act(() => popTo("#/details"));
    expect(useAppStore.getState().step).toBe(AppStep.WORK);
    expect(window.location.hash).toBe("#/work");
  });
  it("asks before browser Back to Home drops a signed release from Details", () => {
    const onDraft = vi.fn();
    const release = { customerName: "Maria Lopez", signaturePngDataUrl: "signature" };
    useAppStore.setState({ step: AppStep.DETAILS, pendingRelease: release });
    render(<Harness onDraft={onDraft} />);
    act(() => popTo("#/home"));
    expect(onDraft).toHaveBeenCalledWith(AppStep.HOME);
    expect(useAppStore.getState().step).toBe(AppStep.DETAILS);
    expect(useAppStore.getState().pendingRelease).toBe(release);
    expect(window.location.hash).toBe("#/details");
    // Unsigned, Back goes Home as before.
    act(() => useAppStore.setState({ pendingRelease: null }));
    act(() => popTo("#/home"));
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().step).toBe(AppStep.HOME);
  });
  it("preserves unsaved dealership settings on browser Back", () => {
    const onManagement = vi.fn();
    useAppStore.setState({ step: AppStep.DEALER_ADMIN, role: "dealer_admin" });
    render(<Harness managementDirty onManagement={onManagement} />);
    act(() => popTo("#/work"));
    expect(useAppStore.getState().step).toBe(AppStep.DEALER_ADMIN);
    expect(window.location.hash).toBe("#/dealership");
    expect(onManagement).toHaveBeenCalledWith(AppStep.WORK);
  });
  it("never signs users in or out through the URL", () => {
    render(<Harness />);
    act(() => popTo("#/login"));
    expect(useAppStore.getState().step).toBe(AppStep.HOME);
    act(() => useAppStore.setState({ step: AppStep.LOGIN, currentDealer: null }));
    act(() => popTo("#/home"));
    expect(useAppStore.getState().step).toBe(AppStep.LOGIN);
  });
});
