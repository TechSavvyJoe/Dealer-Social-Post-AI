import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerSetupWizard } from "../components/DealerSetupWizard";
import { StyleOption, type Dealer } from "../types";
import { defaultWeekHours, serializeHours } from "../utils/hoursFormat";

const dealer: Dealer = {
  id: "dealer123456789",
  name: "Northside Motors",
  website: "https://northside.example",
  phone: "517-555-0100",
  address: "Howell, MI",
};

const STEP_NAMES = [
  "Contact",
  "Social",
  "Voice",
  "Banned",
  "Color",
  "Hashtags",
  "Overlays",
  "Approval",
];

const renderWizard = (
  overrides: Partial<Dealer> = {},
  onSave = vi.fn().mockResolvedValue({ id: dealer.id }),
) => {
  const onDismiss = vi.fn();
  render(
    <DealerSetupWizard
      dealer={{ ...dealer, ...overrides }}
      onSave={onSave}
      onDismiss={onDismiss}
    />,
  );
  return { onSave, onDismiss };
};

const stepChip = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

/**
 * A dealer whose hours and overlay styles are already stored, so a Finish
 * setup with nothing typed has nothing at all to save.
 */
const storedDealer: Dealer = {
  ...dealer,
  hours: serializeHours(defaultWeekHours()),
  enabled_styles: Object.values(StyleOption).join(","),
};

afterEach(() => {
  vi.useRealTimers();
});

describe("DealerSetupWizard", () => {
  it("shows real completion and lets a manager jump directly to any setup step", () => {
    renderWizard();
    // Approval is a choice with a safe default, so seven tasks are counted.
    expect(screen.getByText(/1 of 7 complete/)).toBeInTheDocument();
    fireEvent.click(stepChip("Voice"));
    expect(screen.getByLabelText("Brand voice")).toBeInTheDocument();
  });

  it("counts the checklist from the saved record, not from unsaved typing", () => {
    renderWizard({ brand_voice: "Warm.", requires_approval: false });
    expect(screen.getByText(/2 of 7 complete/)).toBeInTheDocument();
    fireEvent.click(stepChip("Banned"));
    fireEvent.change(screen.getByLabelText("Banned phrases"), {
      target: { value: "no credit check" },
    });
    expect(screen.getByText(/2 of 7 complete/)).toBeInTheDocument();
  });

  it("offers only the real steps as chips, so no chip can claim the store is set up", () => {
    vi.useFakeTimers();
    const { onSave, onDismiss } = renderWizard();
    const steps = screen.getByRole("navigation", { name: "Setup steps" });
    expect(
      Array.from(steps.querySelectorAll("button")).map((chip) =>
        chip.textContent?.replace(/, complete$/, ""),
      ),
    ).toEqual(STEP_NAMES);
    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();
    // The check mark has a text alternative; an open step has none.
    expect(stepChip("Contact")).toHaveAccessibleName("Contact, complete");
    expect(stepChip("Social")).toHaveAccessibleName("Social");

    fireEvent.click(stepChip("Contact"));
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https://changed.example" },
    });
    for (const name of STEP_NAMES) {
      fireEvent.click(stepChip(name));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText(/is set up/)).toBeNull();
    }
    expect(onSave).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("shows success only after Finish setup's save resolves, then dismisses", async () => {
    vi.useFakeTimers();
    let resolveSave: (value: Dealer) => void = () => undefined;
    const onSave = vi.fn(
      (_fields: Record<string, string | boolean>) =>
        new Promise<Dealer>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { onDismiss } = renderWizard({}, onSave);
    fireEvent.click(stepChip("Voice"));
    fireEvent.change(screen.getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(stepChip("Approval"));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      brand_voice: "Plain and friendly.",
    });
    // Still saving: no success yet, and nothing dismisses the wizard.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Northside Motors is set up")).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave({ ...dealer, brand_voice: "Plain and friendly." });
    });
    expect(screen.getByText("Northside Motors is set up")).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the wizard open with an error when the save fails", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValue(new Error("Network down"));
    const { onDismiss } = renderWizard({}, onSave);
    fireEvent.click(stepChip("Voice"));
    fireEvent.change(screen.getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(stepChip("Approval"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/is set up/)).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("leaves at once from Later when nothing was typed", () => {
    const untouched = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(untouched.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("confirms before Later discards what was typed", () => {
    const { onDismiss } = renderWizard();
    fireEvent.click(stepChip("Voice"));
    fireEvent.change(screen.getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/has not been saved/);

    fireEvent.click(screen.getByRole("button", { name: "Keep setting up" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Brand voice")).toHaveValue("Plain and friendly.");

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("saves 'Manager approves first' as approval on for every post", async () => {
    const { onSave } = renderWizard();
    fireEvent.click(stepChip("Approval"));
    expect(screen.queryByText(/published/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Manager approves first/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      requires_approval: true,
      approval_policy: "",
    });
  });

  it("claims nothing when Finish setup has nothing to save and the store still needs a voice and color", async () => {
    vi.useFakeTimers();
    const { onSave, onDismiss } = renderWizard(storedDealer);
    fireEvent.click(stepChip("Approval"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing to save yet. Add your brand voice and brand color, or choose Later to finish another time.",
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/is set up/)).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("names only what is missing when Finish setup has nothing to save", async () => {
    renderWizard({ ...storedDealer, brand_voice: "Warm." });
    fireEvent.click(stepChip("Approval"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing to save yet. Add your brand color, or choose Later to finish another time.",
    );
  });

  it("confirms a store that already has its voice and color, even with nothing to save", async () => {
    vi.useFakeTimers();
    const { onSave, onDismiss } = renderWizard({
      ...storedDealer,
      brand_voice: "Warm.",
      brand_color: "#123456",
    });
    fireEvent.click(stepChip("Approval"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Northside Motors is set up")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("follows an outside save for untouched fields and keeps what was typed here", async () => {
    const onSave = vi.fn().mockResolvedValue({ id: dealer.id });
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DealerSetupWizard dealer={storedDealer} onSave={onSave} onDismiss={onDismiss} />,
    );
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https://typed.example" },
    });
    // The Settings tab saves while the wizard is open.
    rerender(
      <DealerSetupWizard
        dealer={{
          ...storedDealer,
          phone: "517-555-0199",
          website: "https://saved.example",
          requires_approval: true,
        }}
        onSave={onSave}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("517-555-0199");
    expect(screen.getByLabelText("Website")).toHaveValue("https://typed.example");

    fireEvent.click(stepChip("Voice"));
    fireEvent.change(screen.getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(stepChip("Approval"));
    expect(
      screen.getByRole("button", { name: /Manager approves first/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    });
    // Only what was entered here: no stale phone, and approval stays as saved.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      brand_voice: "Plain and friendly.",
      website: "https://typed.example",
    });
  });

  it("does not warn on Later about entries an outside save already stored", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DealerSetupWizard
        dealer={storedDealer}
        onSave={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    rerender(
      <DealerSetupWizard
        dealer={{ ...storedDealer, phone: "517-555-0199", tagline: "Since 1985" }}
        onSave={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
