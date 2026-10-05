import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  it("uses a clickable setup checklist to reveal one focused section at a time", () => {
    renderSettings();
    const creative = screen.getByRole("button", { name: /Creative/ });
    expect(creative).not.toHaveAttribute("aria-current");
    fireEvent.click(creative);
    expect(creative).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Brand" })).not.toHaveClass("hidden");
    // Four setup areas: Workflow has safe defaults, so it is not a task.
    expect(
      screen.getByRole("progressbar", { name: "Store setup progress" }),
    ).toHaveAttribute("aria-valuemax", "4");
  });

  it("persists team feature access through the validated server field", async () => {
    const { onSaved } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    fireEvent.click(screen.getByRole("switch", { name: /Playful/ }));

    const payload = await save(onSaved);
    expect(JSON.parse(String(payload.feature_permissions))).toEqual({
      playful: { team: false, people: {} },
    });
    expect(payload).not.toHaveProperty("category_destinations");
  });

  it("drops the free text editing switch but keeps whatever is stored for it", async () => {
    const { onSaved } = renderSettings({
      ...baseDealer,
      feature_permissions: {
        freeTextEdit: { team: false, people: { "person-1": true } },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    expect(screen.queryByRole("switch", { name: /Free text/ })).toBeNull();
    expect(screen.getAllByRole("switch").map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Playful", "Video"]),
    );
    // No promise the UI cannot keep: nothing sets per-person overrides.
    expect(screen.queryByText(/individual override/)).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: /Video/ }));
    const payload = await save(onSaved);
    expect(JSON.parse(String(payload.feature_permissions))).toEqual({
      freeTextEdit: { team: false, people: { "person-1": true } },
      video: { team: false, people: {} },
    });
  });

  it("explains channels by post type in plain words", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    expect(
      screen.getByText(/^Salespeople only see the channels you leave checked\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/creative resolver/)).toBeNull();
  });

  it("states that each device still uses its own image quality", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Creative/ }));
    expect(
      screen.getByText(
        "Your choice is saved for the store. For now, each device still uses its own image quality setting.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/higher-cost tier/)).toBeNull();
  });

  it("reports the active streamlined resolver when the dealer flag is on", () => {
    renderSettings({ ...baseDealer, creative_system_v2: true });
    fireEvent.click(screen.getByRole("button", { name: /Creative/ }));
    expect(screen.getByText(/^Active for your store\./)).toBeInTheDocument();
  });

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

  it("accurately explains the classic resolver until the creative system is enabled", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Creative/ }));

    const brand = screen.getByRole("region", { name: "Brand" });
    expect(
      within(brand).getByText(
        /One house style for every post: salespeople never pick image style, tone, or video look themselves\./,
      ),
    ).toBeInTheDocument();
    const note = within(brand).getByText(/^Your store is using the classic/);
    expect(note).toHaveTextContent(
      /ask your system administrator to enable the streamlined creative system/,
    );
  });

  it("says the legacy overlay styles are the ones in charge today", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Creative/ }));

    const overlay = screen.getByText(/^Pick which design styles your team can use/);
    expect(overlay).toHaveTextContent(/Set one as the default to preselect it/);
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

  // The bar is sticky, so the settings column has to reserve room for it or
  // the last control sits permanently underneath.
  it("reserves bottom padding at least as tall as the sticky save bar", () => {
    renderSettings();

    const bar = screen.getByTestId("dealer-settings-save-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("min-h-14");

    const column = bar.parentElement as HTMLElement;
    expect(column.className).toContain("pb-20");
    // No responsive padding may win the bottom padding back.
    expect(column.className).not.toMatch(/\bsm:p(?:b|y)?-/);
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
    // Approval is off, so the policy is always sent cleared; untouched
    // destinations and permissions are not sent, so the server keeps them.
    expect(payload.approval_policy).toBe("");
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

const openWorkflow = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Workflow/ }));
const requireApproval = () =>
  fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
const reviewScope = (name: string) => screen.getByRole("radio", { name });
const policyOf = (payload: SavedFields) =>
  payload.approval_policy === "" ? null : JSON.parse(String(payload.approval_policy));

// The server (pb_hooks/requestPolicies.js initialApprovalStatus) treats
// requires_approval as the switch and approval_policy as a narrowing that only
// applies while it is on. Every option below has to save exactly that pair.
// Each case renders the full settings card; give it room on a loaded machine.
describe("manager approval", { timeout: 90_000 }, () => {
  it("shows the review choice only while approval is required, directly under the switch", () => {
    renderSettings();
    openWorkflow();
    expect(screen.queryByRole("radio", { name: "Every post" })).toBeNull();
    // Nothing about approval hides behind the advanced disclosure any more.
    expect(screen.queryByLabelText("Policy")).toBeNull();

    requireApproval();
    for (const name of [
      "Every post",
      "Each person's first posts",
      "Selected post types",
    ]) {
      expect(reviewScope(name)).toBeInTheDocument();
    }
    expect(reviewScope("Every post")).toBeChecked();
    expect(screen.queryByText(/simple (?:choice|setting) above/)).toBeNull();
  });

  it("saves no approval with the policy cleared", async () => {
    const { onSaved } = renderSettings({
      ...baseDealer,
      requires_approval: true,
      approval_policy: { mode: "first_n", firstN: 4 },
    });
    openWorkflow();
    fireEvent.click(screen.getByRole("radio", { name: "No approval required" }));

    const payload = await save(onSaved);
    expect(payload.requires_approval).toBe(false);
    expect(payload.approval_policy).toBe("");
  });

  it("saves every post as approval on with the policy cleared", async () => {
    const { onSaved } = renderSettings();
    openWorkflow();
    requireApproval();

    const payload = await save(onSaved);
    expect(payload.requires_approval).toBe(true);
    expect(policyOf(payload)).toBeNull();
  });

  it("saves each person's first posts with the number to approve", async () => {
    const { onSaved } = renderSettings();
    openWorkflow();
    requireApproval();
    fireEvent.click(reviewScope("Each person's first posts"));
    const count = screen.getByLabelText("Approved posts per person");
    expect(count).toHaveValue(3);
    expect(
      screen.getByText(
        "Each person's posts are reviewed until you have approved this many.",
      ),
    ).toBeInTheDocument();
    // An out-of-range entry is clamped when the field is left, not mid-typing.
    fireEvent.change(count, { target: { value: "500" } });
    expect(count).toHaveValue(500);
    fireEvent.blur(count);
    expect(count).toHaveValue(100);
    // Backspace can empty the field, so typing a new number replaces the old
    // one instead of being appended to it ("3" then "10" is 10, not 310).
    fireEvent.change(count, { target: { value: "" } });
    expect(count).toHaveValue(null);
    fireEvent.change(count, { target: { value: "1" } });
    fireEvent.change(count, { target: { value: "10" } });
    expect(count).toHaveValue(10);
    fireEvent.change(count, { target: { value: "" } });
    fireEvent.blur(count);
    expect(count).toHaveValue(10);
    fireEvent.change(count, { target: { value: "5" } });

    const payload = await save(onSaved);
    expect(payload.requires_approval).toBe(true);
    expect(policyOf(payload)).toEqual({ mode: "first_n", firstN: 5 });
  });

  it("saves selected post types and never lets the last one be cleared", async () => {
    const { onSaved } = renderSettings();
    openWorkflow();
    requireApproval();
    fireEvent.click(reviewScope("Selected post types"));
    expect(
      screen.getByText(
        "Posts that involve a customer are always reviewed when Deliveries is checked. Review follows the post type the salesperson picks.",
      ),
    ).toBeInTheDocument();
    const types = screen.getByRole("group", { name: "Post types to review" });
    const deliveries = within(types).getByRole("checkbox", { name: "Deliveries" });
    expect(deliveries).toBeChecked();
    // The only checked type cannot be cleared; an empty list would mean every post.
    expect(deliveries).toBeDisabled();
    fireEvent.click(within(types).getByRole("checkbox", { name: "Service" }));
    expect(deliveries).toBeEnabled();
    fireEvent.click(deliveries);
    fireEvent.click(within(types).getByRole("checkbox", { name: "Team" }));

    const payload = await save(onSaved);
    expect(payload.requires_approval).toBe(true);
    expect(policyOf(payload)).toEqual({
      mode: "per_category",
      categories: ["service", "team"],
    });
  });

  it("never sends the none or always modes", async () => {
    for (const choice of [
      "Every post",
      "Each person's first posts",
      "Selected post types",
    ]) {
      const { onSaved } = renderSettings();
      openWorkflow();
      requireApproval();
      fireEvent.click(reviewScope(choice));
      const payload = await save(onSaved);
      expect(String(payload.approval_policy)).not.toMatch(/"(?:none|always)"/);
      cleanup();
    }
  });

  it("reads a saved narrowing back and starts clean", () => {
    const { onDirtyChange } = renderSettings({
      ...baseDealer,
      requires_approval: true,
      approval_policy: { mode: "per_category", categories: ["team", "deliveries"] },
    });
    openWorkflow();
    expect(reviewScope("Selected post types")).toBeChecked();
    const types = screen.getByRole("group", { name: "Post types to review" });
    expect(within(types).getByRole("checkbox", { name: "Deliveries" })).toBeChecked();
    expect(within(types).getByRole("checkbox", { name: "Team" })).toBeChecked();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("shows stored policies the server treats as every post as every post, without a phantom edit", () => {
    for (const approval_policy of [
      { mode: "always" as const },
      { mode: "none" as const },
      { mode: "per_category" as const, categories: [] },
    ]) {
      const { onDirtyChange } = renderSettings({
        ...baseDealer,
        requires_approval: true,
        approval_policy,
      });
      openWorkflow();
      expect(reviewScope("Every post")).toBeChecked();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      cleanup();
    }
  });
});

describe("store setup progress", () => {
  const readyArea = (name: RegExp) =>
    within(
      screen.getByRole("navigation", { name: "Dealership settings sections" }),
    ).getByRole("button", { name });

  it("counts areas from the saved record, not from unsaved typing", () => {
    renderSettings(unsavedDealer);
    expect(screen.getByText("0 of 4 areas ready")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https://southside.example" },
    });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0100" } });
    fireEvent.change(screen.getByLabelText("Address (one line)"), {
      target: { value: "1 Main St" },
    });
    expect(screen.getByText("0 of 4 areas ready")).toBeInTheDocument();
    expect(readyArea(/^Store profile/)).not.toHaveAccessibleName(/ready/);
  });

  it("marks saved areas ready, never counts Workflow, and does not count the website as a channel", () => {
    renderSettings({
      ...unsavedDealer,
      website: "https://southside.example",
      phone: "555-0100",
      address: "1 Main St",
      brand_voice: "Plain and friendly.",
      requires_approval: false,
      employee_disclosure_text: "I work at {dealer}.",
    });
    expect(screen.getByText("2 of 4 areas ready")).toBeInTheDocument();
    expect(readyArea(/^Store profile/)).toHaveAccessibleName(/^Store profile, ready/);
    expect(readyArea(/^Voice/)).toHaveAccessibleName(/^Voice, ready/);
    expect(readyArea(/^Channels/)).not.toHaveAccessibleName(/ready/);
    expect(readyArea(/^Workflow/)).not.toHaveAccessibleName(/ready/);
  });

  it("shows the per-area check at every width", () => {
    renderSettings({ ...unsavedDealer, brand_voice: "Plain and friendly." });
    const voice = readyArea(/^Voice/);
    const check = voice.querySelector("svg");
    expect(check).not.toBeNull();
    expect(check?.getAttribute("class") || "").not.toMatch(/\bhidden\b/);
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

  it("keeps what was typed while a save was in flight", async () => {
    let finishSave: () => void = () => undefined;
    const onSaved = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(
      <DealerSettingsCard
        dealer={baseDealer}
        onSaved={onSaved}
        onDirtyChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "  https://northside.example  " },
    });
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "517-555-0100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    // Typed after the request left: not part of this save.
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "517-555-0177" },
    });
    await act(async () => {
      finishSave();
    });

    // A submitted field re-bases onto its stored (trimmed) form ...
    expect(screen.getByLabelText("Website")).toHaveValue("https://northside.example");
    // ... but the later typing survives instead of snapping back.
    expect(screen.getByLabelText("Phone")).toHaveValue("517-555-0177");
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
    // The selected pill used ramp ink (success-100 / warning-100) that fell to
    // about 1.5:1 in light theme. Light Table tokens resolve per theme, so the
    // selected state is ink on the brand tint, with no per-theme override.
    renderSettings();
    for (const name of [/add the disclosure/i, /no approval required/i]) {
      const selected = screen.getByRole("radio", { name });
      expect(selected).toHaveAttribute("aria-checked", "true");
      expect(selected.className).toContain("text-ink");
      expect(selected.className).toContain("bg-brand-tint");
    }
    fireEvent.click(screen.getByRole("radio", { name: /turn it off/i }));
    const off = screen.getByRole("radio", { name: /turn it off/i });
    expect(off.className).toContain("text-ink");
    expect(off.className).toContain("bg-brand-tint");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.className).not.toContain("theme-light");
      expect(radio.className).not.toMatch(/text-(?:success|warning)-\d/);
    }
  });
});
