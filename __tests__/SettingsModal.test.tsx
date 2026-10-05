import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "../components/SettingsModal";
import { useAppStore } from "../stores/appStore";
import { AppStep } from "../types";

const renderModal = (onClose = vi.fn(), onOpenDealerSetup?: () => void) => {
  render(
    <SettingsModal
      isOpen
      onClose={onClose}
      imageQualityTier="standard"
      onImageQualityTierChange={vi.fn()}
      theme="system"
      onThemeChange={vi.fn()}
      onOpenDealerSetup={onOpenDealerSetup}
    />,
  );
  return onClose;
};

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

  it("describes image quality as the device preference it is", () => {
    // Generation reads the device choice only; the store's saved tier is not
    // applied, so the modal must not claim the store manages it.
    renderModal();
    expect(screen.getByText("Saved only on this device.")).toBeInTheDocument();
    expect(screen.getByText("Your device preference.")).toBeInTheDocument();
    expect(screen.queryByText(/manages the store default/)).toBeNull();
    expect(screen.queryByText(/team-wide default/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Open dealership setup/ }),
    ).not.toBeInTheDocument();
  });

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
