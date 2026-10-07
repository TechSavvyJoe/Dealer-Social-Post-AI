import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "../components/SettingsModal";
import { useAppStore } from "../stores/appStore";
import { AppStep } from "../types";

const renderModal = (
  onClose = vi.fn(),
  onOpenDealerSetup?: () => void,
  onImageQualityTierChange = vi.fn(),
) => {
  render(
    <SettingsModal
      isOpen
      onClose={onClose}
      imageQualityTier="standard"
      onImageQualityTierChange={onImageQualityTierChange}
      theme="system"
      onThemeChange={vi.fn()}
      onOpenDealerSetup={onOpenDealerSetup}
    />,
  );
  return onClose;
};

const qualityOption = (name: "Standard" | "Studio") =>
  within(screen.getByRole("group", { name: "Image quality" })).getByRole("button", {
    name: new RegExp(`^${name}`),
  });

const STORE_SETS_QUALITY =
  "Your store sets image quality. A manager can change it in Dealership settings.";

describe("SettingsModal", () => {
  beforeEach(() => {
    useAppStore.setState({
      role: "salesperson",
      currentDealer: {
        id: "dealer123456789",
        name: "Northside Motors",
        image_quality_tier: "studio",
      },
      step: AppStep.HOME,
    });
  });

  it("shows the store's image quality as fixed when the store has chosen one", () => {
    // The store chose Studio; this device's own choice is Standard. Generation
    // uses the store's tier, so the modal shows that one and locks the choice.
    const onImageQualityTierChange = vi.fn();
    renderModal(vi.fn(), undefined, onImageQualityTierChange);
    expect(screen.getByText("Saved only on this device.")).toBeInTheDocument();
    expect(screen.getByText(STORE_SETS_QUALITY)).toBeInTheDocument();
    expect(screen.queryByText("Your device preference.")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Image quality" }),
    ).toHaveAccessibleDescription(STORE_SETS_QUALITY);
    expect(qualityOption("Studio")).toHaveAttribute("aria-pressed", "true");
    expect(qualityOption("Standard")).toHaveAttribute("aria-pressed", "false");
    expect(qualityOption("Studio")).toBeDisabled();
    expect(qualityOption("Standard")).toBeDisabled();
    fireEvent.click(qualityOption("Standard"));
    expect(onImageQualityTierChange).not.toHaveBeenCalled();
    // Locked choices describe each tier; neither advises when to pick it.
    expect(qualityOption("Studio")).toHaveTextContent(
      "Studio (4K) takes longer to generate and shows more detail.",
    );
    expect(qualityOption("Standard")).toHaveTextContent(
      "Standard (2K) is quicker and looks sharp on social feeds.",
    );
    expect(screen.queryByText(/use it when/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Open dealership setup/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { label: "an empty store choice", image_quality_tier: "" as const },
    { label: "no store choice", image_quality_tier: undefined },
  ])(
    "lets this device choose image quality when the store has $label",
    ({ image_quality_tier }) => {
      useAppStore.setState({
        currentDealer: {
          id: "dealer123456789",
          name: "Northside Motors",
          image_quality_tier,
        },
      });
      const onImageQualityTierChange = vi.fn();
      renderModal(vi.fn(), undefined, onImageQualityTierChange);
      expect(screen.getByText("Your device preference.")).toBeInTheDocument();
      expect(screen.queryByText(STORE_SETS_QUALITY)).toBeNull();
      expect(qualityOption("Standard")).toHaveAttribute("aria-pressed", "true");
      expect(qualityOption("Studio")).toHaveAttribute("aria-pressed", "false");
      expect(qualityOption("Studio")).toBeEnabled();
      fireEvent.click(qualityOption("Studio"));
      expect(onImageQualityTierChange).toHaveBeenCalledWith("studio");
    },
  );

  it("lets an authorized manager leave device settings for dealership setup", () => {
    useAppStore.setState({ role: "dealer_admin" });
    const onClose = vi.fn();
    const onOpenDealerSetup = vi.fn();
    renderModal(onClose, onOpenDealerSetup);
    fireEvent.click(screen.getByRole("button", { name: /Open dealership setup/ }));
    expect(onOpenDealerSetup).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().step).toBe(AppStep.HOME);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer manager setup for the system-admin pseudo store", () => {
    useAppStore.setState({
      role: "super_admin",
      currentDealer: { id: "system", name: "SYSTEM ADMIN" },
    });
    renderModal(vi.fn(), vi.fn());
    expect(
      screen.queryByRole("button", { name: /Open dealership setup/ }),
    ).not.toBeInTheDocument();
  });
});
