import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStep } from "../types";
import { useAppStore } from "../stores/appStore";
import { useUrlStepSync } from "../hooks/useUrlStepSync";
const Harness = ({
  onBlocked,
  managementDirty,
  onManagement,
}: {
  onBlocked?: () => void;
  managementDirty?: boolean;
  onManagement?: (target: AppStep) => void;
}) => {
  useUrlStepSync({
    onBlockedResultBack: onBlocked,
    managementDirty,
    onBlockedManagementBack: onManagement,
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
      postWorkAtRisk: false,
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
