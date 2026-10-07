import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../stores/appStore";
import { AppStep, StyleOption, ToneOption } from "../types";
import { loadSession } from "../utils/persistence";
import { MainContent, type MainContentProps } from "../components/MainContent";

describe("Details draft persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      currentDealer: { id: "dealer1", name: "Example Motors" },
      role: "salesperson",
      step: AppStep.HOME,
      selectedImage: null,
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      generationParams: null,
      generatedPost: null,
    });
  });
  // Only step changes: setStep leaves the draft alone for every non-Home
  // target. The real Cancel path (cancelGeneration and its toasts) is covered
  // by __tests__/AppNavigation.test.tsx and hooks/useGeneration.test.tsx.
  it("step changes through Creating keep the photo, personal line and the exact signature object", () => {
    const state = useAppStore.getState();
    const release = {
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signature",
      vin: "VIN123",
    };
    state.setSelectedImage("photo");
    state.setPostDraft({
      categoryId: "deliveries",
      scenarioId: "customer_delivery",
      personalLine: "A wonderful day",
    });
    state.setPendingRelease(release);
    state.setStep(AppStep.DETAILS);
    state.setStep(AppStep.CREATING);
    state.setStep(AppStep.DETAILS);
    expect(useAppStore.getState().pendingRelease).toBe(release);
    expect(useAppStore.getState().postDraft?.personalLine).toBe("A wonderful day");
    expect(useAppStore.getState().selectedImage).toBe("photo");
  });
  it("never persists signature bytes or an unposted personal line", () => {
    const state = useAppStore.getState();
    state.setPendingRelease({
      customerName: "Maria Lopez",
      signaturePngDataUrl: "PRIVATE_SIGNATURE",
    });
    state.setPostDraft({
      categoryId: "deliveries",
      scenarioId: "customer_delivery",
      personalLine: "PRIVATE_LINE",
    });
    state.setStep(AppStep.DETAILS);
    expect(JSON.stringify(loadSession())).not.toMatch(
      /PRIVATE_SIGNATURE|PRIVATE_LINE|Maria Lopez/,
    );
    expect(loadSession()?.postDraft?.scenarioId).toBe("customer_delivery");
  });
  it("starts a fresh draft on Home without carrying the previous signature", () => {
    const state = useAppStore.getState();
    state.setPostDraft({ categoryId: "deliveries", scenarioId: "customer_delivery" });
    state.setPendingRelease({
      customerName: "Maria",
      signaturePngDataUrl: "signature",
    });
    state.setStep(AppStep.HOME);
    expect(useAppStore.getState().postDraft).toBeNull();
    expect(useAppStore.getState().pendingRelease).toBeNull();
    expect(loadSession()?.postDraft).toBeUndefined();
  });
  it("keeps the draft during My work navigation and same-photo remix", () => {
    const state = useAppStore.getState();
    state.setSelectedImage("photo");
    state.setPostDraft({
      categoryId: "inventory",
      scenarioId: "new_arrival",
      personalLine: "Just arrived",
    });
    state.setGenerationParams({
      style: StyleOption.Modern,
      tone: ToneOption.Excited,
      customerName: "",
      platformIds: ["gbp"],
      primaryFormatId: "gbp",
      imageAspectRatio: "4:3",
    });
    state.setStep(AppStep.WORK);
    state.setStep(AppStep.POST);
    state.startRemix();
    expect(useAppStore.getState().step).toBe(AppStep.DETAILS);
    expect(useAppStore.getState().postDraft?.personalLine).toBe("Just arrived");
    expect(useAppStore.getState().generationParams?.platformIds).toEqual(["gbp"]);
  });
});

describe("MainContent on Creating", () => {
  it("drives the Creating screen from the generation stage and wires Cancel to App's handler", () => {
    const onCancelGeneration = vi.fn();
    render(
      <MainContent
        {...({
          displayedStep: AppStep.CREATING,
          step: AppStep.CREATING,
          currentDealer: { id: "dealer1", name: "Example Motors" },
          selectedImage: "data:image/jpeg;base64,cGhvdG8=",
          generatedPost: null,
          error: null,
          generationStage: "checks",
          partsReady: { image: true, caption: true },
          onCancelGeneration,
        } as unknown as MainContentProps)}
      />,
    );
    expect(screen.getByRole("img", { name: "Your source photo" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,cGhvdG8=",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Running a final check on the caption and image…",
    );
    const current = within(screen.getByRole("list", { name: "Post generation stages" }))
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "step");
    expect(current.map((item) => item.textContent)).toEqual(["Final check"]);
    expect(onCancelGeneration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelGeneration).toHaveBeenCalledTimes(1);
  });
});
