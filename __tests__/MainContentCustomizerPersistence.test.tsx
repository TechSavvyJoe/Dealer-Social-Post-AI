import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../stores/appStore";
import { AppStep, StyleOption, ToneOption } from "../types";
import { loadSession } from "../utils/persistence";

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
  it("keeps the photo, optional line, vehicle and exact signature object across Creating and Cancel", () => {
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
