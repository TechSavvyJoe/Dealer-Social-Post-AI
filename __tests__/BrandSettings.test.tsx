import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerSettingsCard } from "../components/DealerAdminDashboard";
import { PersonEditModal } from "../components/PersonEditModal";
import type { Person } from "../services/salespeople";
import { StyleOption, VideoStyle, type Dealer } from "../types";
import { defaultWeekHours, serializeHours } from "../utils/hoursFormat";

const serviceMocks = vi.hoisted(() => ({
  updatePerson: vi.fn(),
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  ...serviceMocks,
}));

// The settings card embeds two large editors that have their own suites; keep
// this one focused on the brand controls so it stays fast on a loaded machine.
vi.mock("../components/CustomScenarioManager", () => ({
  CustomScenarioManager: () => <div>Scenario manager</div>,
}));
vi.mock("../components/HoursPicker", () => ({
  HoursPicker: ({ preview }: { preview: string }) => <div>{preview}</div>,
}));

const baseDealer: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  brand_voice: "Warm and direct.",
  brand_color: "#1d4ed8",
};

/** A dealership that has never opened settings: every column is unset. */
const unsavedDealer: Dealer = {
  id: "dealer-2",
  name: "Southside Motors",
};

type SavedFields = Record<string, string | boolean>;

const renderSettings = (dealer: Dealer = baseDealer) => {
  const onSaved = vi.fn<(fields: SavedFields) => Promise<unknown>>();
  onSaved.mockResolvedValue(undefined);
  const onDirtyChange = vi.fn();
  render(
    <DealerSettingsCard
      dealer={dealer}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />,
  );
  return { onSaved, onDirtyChange };
};

const save = async (onSaved: ReturnType<typeof vi.fn>): Promise<SavedFields> => {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  return onSaved.mock.calls[0][0] as SavedFields;
};

const hashtagLock = () =>
  screen.getByRole("switch", { name: "Always include every hashtag above" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dealer Brand section", () => {
  it("renders every phase-1 brand control with its label", () => {
    renderSettings();

    const brand = screen.getByRole("region", { name: "Brand" });
    expect(
      within(brand).getByRole("radiogroup", { name: "Signature look" }),
    ).toBeInTheDocument();
    for (const look of ["Showroom", "Hometown", "Turbo"]) {
      expect(within(brand).getByRole("radio", { name: look })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    }
    expect(within(brand).getByLabelText("Alternate look")).toHaveValue("");
    expect(within(brand).getByLabelText("Playful style")).toHaveValue("");
    expect(
      within(brand).getByText("Shown to salespeople as a single Playful option"),
    ).toBeInTheDocument();
    expect(within(brand).getByLabelText("Motion style")).toHaveValue("");
    expect(within(brand).getByLabelText("9:16 Vertical")).toBeDisabled();
    expect(within(brand).getByLabelText("Audio")).toBeDisabled();
    expect(
      within(brand).getByRole("radiogroup", { name: "Logo corner" }),
    ).toBeInTheDocument();
    expect(within(brand).getByLabelText("Logo size")).toBeDisabled();
    expect(
      within(brand).getByRole("radiogroup", { name: "Image quality" }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText("Do phrase")).toBeInTheDocument();
    expect(screen.getByLabelText("Don't phrase")).toBeInTheDocument();
    expect(hashtagLock()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/Discovery hashtags only fill the remaining slots/),
    ).toBeInTheDocument();
  });

  // Phase 1 ships dark, so the Brand copy must not claim to govern behavior
  // while the legacy overlay-style picker below is the section that actually
  // does. The two sections used to state opposite things on the same card.
  it("scopes the Brand promise to the creative system being switched on", () => {
    renderSettings();

    const brand = screen.getByRole("region", { name: "Brand" });
    expect(
      within(brand).getByText(
        /One house style for every post: salespeople never pick image style, tone, or video look themselves\./,
      ),
    ).toBeInTheDocument();
    const note = within(brand).getByText(/^Not turned on yet\./);
    expect(note).toHaveTextContent(
      /they take over once the new creative system is switched on for your store/,
    );
    expect(note).toHaveTextContent(
      /the image overlay styles further down are what your team actually sees/,
    );
  });

  it("says the legacy overlay styles are the ones in charge today", () => {
    renderSettings();

    const overlay = screen.getByText(/^Pick which design styles your team can use/);
    expect(overlay).toHaveTextContent(
      /These stay in charge until the Brand section above is switched on\./,
    );
    // The legacy section itself is untouched: Phase 1 must not silently drop
    // the control that governs today.
    expect(screen.getByText("Image overlay styles")).toBeInTheDocument();
    expect(screen.getAllByText("available to salespeople").length).toBeGreaterThan(0);
  });

  // Sentence case is the single rule for every label in this section: "look"
  // is no longer title-cased while "style" and "signature" stay lowercase.
  it("labels every brand control in sentence case", () => {
    renderSettings();

    const brand = screen.getByRole("region", { name: "Brand" });
    for (const label of [
      "Signature look",
      "Alternate look",
      "Playful style",
      "Motion signature",
      "Motion style",
      "Logo placement",
      "Logo size",
      "Image quality",
    ]) {
      expect(within(brand).getByText(label)).toBeInTheDocument();
    }
    for (const titleCased of ["Signature Look", "Alternate Look", "Motion Style"]) {
      expect(within(brand).queryByText(titleCased)).toBeNull();
    }
    expect(
      within(brand).getByText(
        "Optional second look a manager may enable for the team.",
      ),
    ).toBeInTheDocument();
    expect(
      within(brand).getByText(
        "Percent of the image width. The look decides the rest of the layout.",
      ),
    ).toBeInTheDocument();
  });

  // The two phrase columns sit side by side at desktop width: the placeholder
  // has to fit its own field and both helper lines have to wrap the same way.
  it("keeps the do and don't columns balanced", () => {
    renderSettings();

    expect(screen.getByLabelText("Do phrase")).toHaveAttribute(
      "placeholder",
      "Use first names",
    );
    expect(screen.getByLabelText("Don't phrase")).toHaveAttribute(
      "placeholder",
      "No exclamation points",
    );

    const doHelp = "Up to 3 phrases captions always use.";
    const dontHelp = "Up to 3 phrases captions never use.";
    expect(screen.getByText(doHelp)).toBeInTheDocument();
    expect(screen.getByText(dontHelp)).toBeInTheDocument();
    // Within one character of each other, so neither column wraps alone.
    expect(Math.abs(doHelp.length - dontHelp.length)).toBeLessThanOrEqual(1);
  });

  // The bar is sticky, so the card has to reserve room for it or the last
  // control sits permanently underneath.
  it("reserves bottom padding at least as tall as the sticky save bar", () => {
    renderSettings();

    const bar = screen.getByTestId("dealer-settings-save-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("min-h-14");

    const card = bar.parentElement as HTMLElement;
    expect(card.className).toContain("pb-20");
    // sm:p-6 would otherwise win back the bottom padding at desktop width.
    expect(card.className).toContain("sm:pb-20");
  });

  it("marks the form dirty when a look is chosen and saves signature_look with its tone", async () => {
    const { onSaved, onDirtyChange } = renderSettings();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Hometown" }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("radio", { name: "Hometown" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    const payload = await save(onSaved);
    expect(payload.signature_look).toBe("hometown");
    expect(payload.default_tone).toBe("Family-Friendly");
    expect(payload.alternate_look).toBe("");
    expect(payload.brand_voice_do).toBe("[]");
    expect(payload.brand_voice_dont).toBe("[]");
    expect(payload.required_hashtags_locked).toBe(false);
    expect(payload.playful_style).toBe("");
    expect(payload.motion_signature).toBe("");
    expect(payload.logo_placement).toBe("");
    expect(payload.image_quality_tier).toBe("");
    // Phase 2 fields are never sent, so the server leaves them untouched.
    expect(payload).not.toHaveProperty("approval_policy");
    expect(payload).not.toHaveProperty("category_destinations");
    expect(payload).not.toHaveProperty("feature_permissions");
    // Existing fields still ride along through the same PATCH.
    expect(payload.brand_voice).toBe("Warm and direct.");
    expect(payload.brand_color).toBe("#1d4ed8");
  });

  it("keeps the alternate look distinct from the signature look and skips default_tone when the look is unchanged", async () => {
    const { onSaved } = renderSettings({
      ...baseDealer,
      signature_look: "showroom",
      default_tone: "Professional",
    });
    expect(screen.getByRole("radio", { name: "Showroom" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const alternate = screen.getByLabelText("Alternate look");
    expect(within(alternate).queryByRole("option", { name: "Showroom" })).toBeNull();

    fireEvent.change(alternate, { target: { value: "turbo" } });
    expect(alternate).toHaveValue("turbo");

    const payload = await save(onSaved);
    expect(payload.signature_look).toBe("showroom");
    expect(payload.alternate_look).toBe("turbo");
    expect(payload).not.toHaveProperty("default_tone");
  });

  it("clears the alternate look when the house look moves onto it", () => {
    renderSettings({
      ...baseDealer,
      signature_look: "showroom",
      alternate_look: "turbo",
    });
    expect(screen.getByLabelText("Alternate look")).toHaveValue("turbo");

    fireEvent.click(screen.getByRole("radio", { name: "Turbo" }));

    expect(screen.getByLabelText("Alternate look")).toHaveValue("");
    expect(
      within(screen.getByLabelText("Alternate look")).getByRole("option", {
        name: "Showroom",
      }),
    ).toBeInTheDocument();
  });

  it("round-trips the required hashtags lock in both directions", async () => {
    const locked = renderSettings({ ...baseDealer, required_hashtags_locked: true });
    expect(hashtagLock()).toHaveAttribute("aria-checked", "true");
    expect(locked.onDirtyChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(hashtagLock());
    expect(hashtagLock()).toHaveAttribute("aria-checked", "false");
    expect(locked.onDirtyChange).toHaveBeenLastCalledWith(true);
    expect((await save(locked.onSaved)).required_hashtags_locked).toBe(false);

    // Toggling straight back reads as clean again.
    fireEvent.click(hashtagLock());
    expect(locked.onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("locks hashtags from an unlocked dealer and sends true", async () => {
    const { onSaved } = renderSettings();
    fireEvent.click(hashtagLock());
    expect((await save(onSaved)).required_hashtags_locked).toBe(true);
  });

  it("caps brand voice chips at three phrases of sixty characters", async () => {
    const { onSaved } = renderSettings({
      ...baseDealer,
      brand_voice_dont: ["Never shout"],
    });
    const doInput = screen.getByLabelText("Do phrase");
    const addDo = screen.getByRole("button", { name: "Add do phrase" });

    fireEvent.change(doInput, { target: { value: "x".repeat(61) } });
    fireEvent.click(addDo);
    expect(screen.getByText("Keep each phrase to 60 characters.")).toBeInTheDocument();

    for (const phrase of [
      "Use first names",
      "  Mention   the  town ",
      "Keep it short",
    ]) {
      fireEvent.change(doInput, { target: { value: phrase } });
      fireEvent.keyDown(doInput, { key: "Enter" });
    }
    const doList = screen.getByRole("list", { name: "Do phrases" });
    expect(
      within(doList)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Use first names", "Mention the town", "Keep it short"]);
    expect(doInput).toBeDisabled();
    expect(addDo).toBeDisabled();
    expect(screen.getByText("All 3 slots used")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove don't phrase Never shout" }),
    );
    expect(
      within(screen.getByRole("list", { name: "Don't phrases" })).getByText("None yet"),
    ).toBeInTheDocument();

    const payload = await save(onSaved);
    expect(JSON.parse(String(payload.brand_voice_do))).toEqual([
      "Use first names",
      "Mention the town",
      "Keep it short",
    ]);
    expect(JSON.parse(String(payload.brand_voice_dont))).toEqual([]);
  });

  it("saves the playful style, motion signature, logo placement, and image quality as structured fields", async () => {
    const { onSaved } = renderSettings({ ...baseDealer, signature_look: "turbo" });

    fireEvent.change(screen.getByLabelText("Playful style"), {
      target: { value: "lego" },
    });
    expect(screen.getByLabelText("Playful style")).toHaveValue("lego");

    expect(screen.getByText("Suggested for Turbo: Paint Sheen")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motion style"), {
      target: { value: VideoStyle.LiquidChrome },
    });
    const wide = screen.getByLabelText("16:9 Wide");
    expect(wide).toBeEnabled();
    fireEvent.click(wide);
    fireEvent.change(screen.getByLabelText("Audio"), {
      target: { value: "celebration" },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Top left" }));
    const size = screen.getByLabelText("Logo size");
    expect(size).toBeEnabled();
    fireEvent.change(size, { target: { value: "25" } });
    expect(screen.getByText("25%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Studio" }));

    const payload = await save(onSaved);
    expect(payload.playful_style).toBe("lego");
    expect(JSON.parse(String(payload.motion_signature))).toEqual({
      style: "Liquid Chrome",
      aspects: ["9:16", "16:9"],
      audio: "celebration",
    });
    expect(JSON.parse(String(payload.logo_placement))).toEqual({
      corner: "top_left",
      scale: 0.25,
    });
    expect(payload.image_quality_tier).toBe("studio");
  });

  it("reports an empty motion aspect list inline instead of sending it", async () => {
    const { onSaved } = renderSettings({
      ...baseDealer,
      motion_signature: { style: "Golden Radiance", aspects: ["9:16"], audio: "none" },
    });
    expect(screen.getByLabelText("Motion style")).toHaveValue("Golden Radiance");
    expect(screen.getByLabelText("Audio")).toHaveValue("none");

    fireEvent.click(screen.getByLabelText("9:16 Vertical"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick at least one video aspect for the motion signature.",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("starts clean when the saved brand settings are already populated", () => {
    const { onDirtyChange } = renderSettings({
      ...baseDealer,
      signature_look: "hometown",
      alternate_look: "showroom",
      playful_style: "pixar",
      brand_voice_do: ["Use first names"],
      brand_voice_dont: ["Never shout"],
      required_hashtags_locked: true,
      motion_signature: { style: "Spotlight", aspects: ["9:16"], audio: "cinematic" },
      logo_placement: { corner: "bottom_right", scale: 0.18 },
      image_quality_tier: "standard",
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Bottom right" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

const salesperson: Person = {
  id: "person-1",
  dealer: "dealer-1",
  name: "Taylor Morgan",
  role: "salesperson",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
  hasManagerLogin: false,
};

const playfulDefault = () => screen.getByRole("checkbox", { name: /^Playful default/ });
const managerScope = () =>
  screen.queryByRole("checkbox", { name: /^Sales manager scope/ });

describe("dealer settings dirty tracking", () => {
  it("stays clean on mount when hours and overlay styles have never been saved", () => {
    const { onDirtyChange } = renderSettings(unsavedDealer);

    // Both fields derive a non-empty default (a full week, every style), so a
    // baseline read straight from the empty column reported a phantom edit.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("still persists the derived hours and overlay styles on the next real save", async () => {
    const { onSaved } = renderSettings(unsavedDealer);

    fireEvent.click(hashtagLock());
    const fields = await save(onSaved);

    expect(fields.hours).toBe(serializeHours(defaultWeekHours()));
    expect(fields.enabled_styles).toBe(Object.values(StyleOption).join(","));
  });
});

describe("person profile fields", () => {
  beforeEach(() => {
    serviceMocks.updatePerson.mockResolvedValue(salesperson);
  });

  it("shows manager scope only when the editor may grant it", () => {
    const { unmount } = render(
      <PersonEditModal
        isOpen
        person={salesperson}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(managerScope()).toBeNull();
    expect(screen.getByLabelText("Signature line")).toHaveValue("");
    expect(screen.getByLabelText("Default category")).toHaveValue("");
    expect(playfulDefault()).not.toBeChecked();
    unmount();

    render(
      <PersonEditModal
        isOpen
        person={{ ...salesperson, managerScope: true }}
        allowManagerScopeEdit
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(managerScope()).toBeChecked();
  });

  it("saves the personal fields and manager scope through updatePerson", async () => {
    const onSaved = vi.fn();
    render(
      <PersonEditModal
        isOpen
        person={salesperson}
        allowManagerScopeEdit
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Signature line"), {
      target: { value: "  Ask for   Taylor.  " },
    });
    fireEvent.change(screen.getByLabelText("Default category"), {
      target: { value: "deliveries" },
    });
    fireEvent.click(playfulDefault());
    const scope = managerScope();
    expect(scope).not.toBeNull();
    fireEvent.click(scope as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(serviceMocks.updatePerson).toHaveBeenCalledWith("person-1", {
        name: "Taylor Morgan",
        active: true,
        signatureLine: "Ask for Taylor.",
        defaultCategory: "deliveries",
        playfulDefault: true,
        managerScope: true,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureLine: "Ask for Taylor.",
        defaultCategory: "deliveries",
        playfulDefault: true,
        managerScope: true,
      }),
    );
  });

  it("never sends manager scope when the editor cannot grant it", async () => {
    render(
      <PersonEditModal
        isOpen
        person={salesperson}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(serviceMocks.updatePerson).toHaveBeenCalledTimes(1));
    expect(serviceMocks.updatePerson.mock.calls[0][1]).not.toHaveProperty(
      "managerScope",
    );
  });
});

describe("FTC team-member disclosure setting", () => {
  it("defaults to ON for a dealership that has never touched the setting", () => {
    renderSettings();
    expect(screen.getByRole("radio", { name: /add the disclosure/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The live preview proves the wording a salesperson's post will carry.
    expect(screen.getByText(/Preview: Posted by a .* team member\./)).toBeTruthy();
  });

  it("reads the stored opt-out rather than an enabled flag", () => {
    // PocketBase reports an unset bool as false, so the column has to be the
    // opt-OUT. If this ever flips to `..._enabled`, every existing dealership
    // silently loses its disclosure and this test fails.
    renderSettings({ ...baseDealer, employee_disclosure_disabled: true });
    expect(screen.getByRole("radio", { name: /turn it off/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/Preview: No disclosure will be added\./)).toBeTruthy();
  });

  it("warns before a manager saves an opt-out", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: /turn it off/i }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /no material-connection disclosure/i,
    );
  });

  it("saves the opt-out and custom wording", async () => {
    const { onSaved } = renderSettings();
    fireEvent.change(screen.getByLabelText(/wording/i), {
      target: { value: "I work at {dealer}. #ad" },
    });
    const saved = await save(onSaved);
    expect(saved.employee_disclosure_disabled).toBe(false);
    expect(saved.employee_disclosure_text).toBe("I work at {dealer}. #ad");
  });

  it("keeps selected-state pills readable in Sunlight (light) theme", () => {
    // success-100 / warning-100 ink on a pale tinted fill measures about 1.5:1
    // in light theme, which made the selected pill render as an empty capsule.
    renderSettings();
    for (const name of [/add the disclosure/i, /no approval required/i]) {
      expect(screen.getByRole("radio", { name }).className).toContain(
        "[.theme-light_&]:text-success-900",
      );
    }
    fireEvent.click(screen.getByRole("radio", { name: /turn it off/i }));
    expect(screen.getByRole("radio", { name: /turn it off/i }).className).toContain(
      "[.theme-light_&]:text-warning-900",
    );
  });
});
