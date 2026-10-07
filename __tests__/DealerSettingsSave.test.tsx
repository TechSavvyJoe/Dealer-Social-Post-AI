import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerAdminDashboard } from "../components/DealerAdminDashboard";
import { useAppStore } from "../stores/appStore";
import type { Dealer } from "../types";

/**
 * Saving goes through the real dashboard wiring: DealerSettingsCard encodes
 * structured brand fields as JSON text for the multipart PATCH, and the route
 * answers with only { id }. The dashboard must merge decoded values back into
 * the session dealer, or the form compares against JSON text forever (Save
 * stays enabled, every exit asks "Discard unsaved settings?") and reopening
 * Settings crashes on `brand_voice_do.map`.
 */
const dbMocks = vi.hoisted(() => ({
  updateDealerWithFile: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  ...dbMocks,
}));
vi.mock("../services/websitePublishing", () => ({
  listWebsiteDestinations: vi.fn().mockResolvedValue([]),
}));
// The overview panels and the heavy editors have their own suites.
vi.mock("../components/Leaderboard", () => ({ Leaderboard: () => null }));
vi.mock("../components/ApprovalQueue", () => ({ ApprovalQueue: () => null }));
vi.mock("../components/PostHistory", () => ({ PostHistory: () => null }));
vi.mock("../components/YouTubeConnectionCard", () => ({
  YouTubeConnectionCard: () => null,
}));
vi.mock("../components/CustomScenarioManager", () => ({
  CustomScenarioManager: () => null,
}));

const dealer: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  brand_voice: "Warm and direct.",
  brand_color: "#1d4ed8",
  phone: "517-555-0100",
  brand_voice_do: ["Use first names"],
  brand_voice_dont: [],
  motion_signature: null,
  logo_placement: null,
  approval_policy: null,
  requires_approval: false,
};

const saveButton = () => screen.getByRole("button", { name: "Save changes" });

const renderDashboard = () => {
  const onSettingsDirtyChange = vi.fn();
  render(<DealerAdminDashboard onSettingsDirtyChange={onSettingsDirtyChange} />);
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  return { onSettingsDirtyChange };
};

const savedForm = () => dbMocks.updateDealerWithFile.mock.calls.at(-1)?.[1] as FormData;

const DISMISSED_KEY = `dsp.dealerSetupDismissed.v1.${dealer.id}`;
const WIZARD_NAME = `Set up ${dealer.name}`;
const queryWizard = () => screen.queryByRole("region", { name: WIZARD_NAME });
const wizard = () => within(screen.getByRole("region", { name: WIZARD_NAME }));
/** The open tab's panel; the setup wizard sits outside it, above the tabs. */
const panel = () => within(screen.getByRole("tabpanel"));

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateDealerWithFile.mockResolvedValue({ id: dealer.id });
  useAppStore.setState({ role: "dealer_admin", currentDealer: { ...dealer } });
  localStorage.removeItem(DISMISSED_KEY);
});

afterEach(() => {
  useAppStore.setState({ currentDealer: null });
});

describe("dealership settings save", { timeout: 90_000 }, () => {
  it("leaves the form clean and the session dealer decoded after a save", async () => {
    const { onSettingsDirtyChange } = renderDashboard();
    expect(saveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "  517-555-0199  " },
    });
    expect(saveButton()).toBeEnabled();
    expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(saveButton());

    await waitFor(() => expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(1));
    // The wire format really is encoded text — that is what must not leak back.
    expect(savedForm().get("phone")).toBe("517-555-0199");
    expect(savedForm().get("brand_voice_do")).toBe('["Use first names"]');
    expect(savedForm().get("motion_signature")).toBe("");

    // "Saved hh:mm" shows only once the save resolved and nothing is dirty.
    await screen.findByText(/^Saved /);
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).not.toHaveAttribute("aria-busy");
    // The dirty report travels through two effects (card -> dashboard -> app).
    await waitFor(() => expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText("Phone")).toHaveValue("517-555-0199");

    const saved = useAppStore.getState().currentDealer!;
    expect(saved.phone).toBe("517-555-0199");
    expect(saved.brand_voice_do).toEqual(["Use first names"]);
    expect(Array.isArray(saved.brand_voice_dont)).toBe(true);
    expect(saved.motion_signature).toBeNull();
    expect(saved.logo_placement).toBeNull();
    expect(saved.approval_policy).toBeNull();
    expect(saved.requires_approval).toBe(false);
    expect(saved.required_hashtags_locked).toBe(false);

    // Leaving is not blocked by a phantom edit, and coming back does not crash
    // on a JSON-string phrase list.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.queryByText("Discard unsaved settings?")).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Dealership settings" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Voice/ }));
    expect(
      within(screen.getByRole("list", { name: "Do phrases" })).getByText(
        "Use first names",
      ),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it.each(["different store", "new login in the same store"])(
    "does not merge an old settings reply into a %s",
    async (boundary) => {
      let resolve!: (value: { id: string }) => void;
      dbMocks.updateDealerWithFile.mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      );
      renderDashboard();
      fireEvent.change(screen.getByLabelText("Phone"), {
        target: { value: "517-555-0199" },
      });
      fireEvent.click(saveButton());
      await waitFor(() => expect(dbMocks.updateDealerWithFile).toHaveBeenCalledOnce());
      const newDealer = {
        ...dealer,
        id: boundary === "different store" ? "dealer-2" : dealer.id,
        name: "Other session",
        phone: "517-555-0123",
      };
      act(() =>
        useAppStore.setState({
          currentDealer: newDealer,
          authEpoch: useAppStore.getState().authEpoch + 1,
        }),
      );
      await act(async () => {
        resolve({ id: dealer.id });
        await Promise.resolve();
      });
      expect(useAppStore.getState().currentDealer).toEqual(newDealer);
    },
  );

  it("keeps the open section after a save", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /^Voice/ }));
    fireEvent.change(screen.getByLabelText("How captions should sound"), {
      target: { value: "Warm, direct and local. " },
    });
    fireEvent.click(saveButton());
    await screen.findByText(/^Saved /);
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Voice/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(useAppStore.getState().currentDealer?.brand_voice).toBe(
      "Warm, direct and local.",
    );
  });

  it("round-trips an approval narrowing as an object the form reads back clean", async () => {
    const { onSettingsDirtyChange } = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /^Workflow/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
    fireEvent.click(screen.getByRole("radio", { name: "Each person's first posts" }));
    fireEvent.change(screen.getByLabelText("Posts to approve first"), {
      target: { value: "4" },
    });
    fireEvent.click(saveButton());

    await screen.findByText(/^Saved /);
    expect(saveButton()).toBeDisabled();
    expect(savedForm().get("requires_approval")).toBe("true");
    expect(savedForm().get("approval_policy")).toBe('{"mode":"first_n","firstN":4}');
    const saved = useAppStore.getState().currentDealer!;
    expect(saved.requires_approval).toBe(true);
    expect(saved.approval_policy).toEqual({ mode: "first_n", firstN: 4 });
    await waitFor(() => expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(false));

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /^Workflow/ }));
    expect(
      screen.getByRole("radio", { name: "Each person's first posts" }),
    ).toBeChecked();
    expect(screen.getByLabelText("Posts to approve first")).toHaveValue(4);
    expect(saveButton()).toBeDisabled();
  });
});

describe("structured workflow fields after a save", { timeout: 90_000 }, () => {
  it("keeps category destinations and feature permissions as objects the form reads back clean", async () => {
    const { onSettingsDirtyChange } = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /^Workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    fireEvent.click(screen.getByRole("switch", { name: "Video" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Service channels" })).getByRole(
        "checkbox",
        { name: "Google Business" },
      ),
    );
    fireEvent.click(saveButton());
    await screen.findByText(/^Saved /);

    // The wire format is JSON text ...
    expect(JSON.parse(String(savedForm().get("feature_permissions")))).toEqual({
      video: { team: false, people: {} },
    });
    expect(
      JSON.parse(String(savedForm().get("category_destinations"))).service.platformIds,
    ).toEqual(["facebook_feed"]);
    // ... and the session dealer holds the decoded objects, never that text.
    const saved = useAppStore.getState().currentDealer!;
    expect(saved.feature_permissions).toEqual({ video: { team: false, people: {} } });
    expect(typeof saved.category_destinations).toBe("object");
    expect(saved.category_destinations?.service?.platformIds).toEqual([
      "facebook_feed",
    ]);
    expect(saveButton()).toBeDisabled();
    await waitFor(() => expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(false));

    // Coming back, the form reads them as saved.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /^Workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    expect(screen.getByRole("switch", { name: "Video" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      within(screen.getByRole("group", { name: "Service channels" })).getByRole(
        "checkbox",
        { name: "Google Business" },
      ),
    ).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
  });
});

describe("setup wizard beside the settings form", { timeout: 90_000 }, () => {
  it("goes away when a Settings save completes the store", async () => {
    useAppStore.setState({
      currentDealer: { ...dealer, brand_voice: "", brand_color: "" },
    });
    renderDashboard();
    expect(queryWizard()).not.toBeNull();

    // Store color lives under Creative now; the edit survives the section switch.
    fireEvent.click(panel().getByRole("button", { name: /^Creative/ }));
    fireEvent.change(panel().getByLabelText("Store color"), {
      target: { value: "#123456" },
    });
    fireEvent.click(panel().getByRole("button", { name: /^Voice/ }));
    fireEvent.change(panel().getByLabelText("How captions should sound"), {
      target: { value: "Warm and direct." },
    });
    fireEvent.click(saveButton());
    await screen.findByText(/^Saved /);

    const saved = useAppStore.getState().currentDealer!;
    expect(saved.brand_voice).toBe("Warm and direct.");
    expect(saved.brand_color).toBe("#123456");
    // No wizard is left holding the old empty entries, so nothing can send
    // them back over this save.
    expect(queryWizard()).toBeNull();
    expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(1);
    // Hidden because the store is set up, not dismissed for good.
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it("shows its own success after Finish setup completes the store, then dismisses", async () => {
    useAppStore.setState({
      currentDealer: { ...dealer, brand_voice: "", brand_color: "" },
    });
    render(<DealerAdminDashboard />);
    fireEvent.click(wizard().getByRole("button", { name: /^Voice/ }));
    fireEvent.change(wizard().getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(wizard().getByRole("button", { name: /^Color/ }));
    fireEvent.change(wizard().getByLabelText("Hex value"), {
      target: { value: "#123456" },
    });
    fireEvent.click(wizard().getByRole("button", { name: /^Approval/ }));
    fireEvent.click(wizard().getByRole("button", { name: "Finish setup" }));

    // The saved record completes the store; the wizard still stays for its
    // success state instead of vanishing the moment that record arrives.
    expect(await screen.findByText(`${dealer.name} is set up`)).toBeInTheDocument();
    expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(1);
    expect(savedForm().get("brand_voice")).toBe("Plain and friendly.");
    expect(savedForm().get("brand_color")).toBe("#123456");
    const saved = useAppStore.getState().currentDealer!;
    expect(saved.brand_voice).toBe("Plain and friendly.");
    expect(saved.brand_color).toBe("#123456");

    await waitFor(() => expect(queryWizard()).toBeNull(), { timeout: 5000 });
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
    expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(1);
  });

  it("never writes its stale entries back over a Settings save", async () => {
    // Colour is set but voice is not, so the wizard stays up after this save.
    useAppStore.setState({ currentDealer: { ...dealer, brand_voice: "" } });
    renderDashboard();
    fireEvent.change(panel().getByLabelText("Phone"), {
      target: { value: "517-555-0199" },
    });
    fireEvent.click(saveButton());
    await screen.findByText(/^Saved /);
    expect(useAppStore.getState().currentDealer?.phone).toBe("517-555-0199");

    // The wizard's untouched Phone follows the saved record ...
    await waitFor(() =>
      expect(wizard().getByLabelText("Phone")).toHaveValue("517-555-0199"),
    );
    fireEvent.click(wizard().getByRole("button", { name: /^Voice/ }));
    fireEvent.change(wizard().getByLabelText("Brand voice"), {
      target: { value: "Plain and friendly." },
    });
    fireEvent.click(wizard().getByRole("button", { name: /^Approval/ }));
    fireEvent.click(wizard().getByRole("button", { name: "Finish setup" }));
    await screen.findByText(`${dealer.name} is set up`);

    // ... so Finish setup sends only what was entered in the wizard.
    expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(2);
    expect(savedForm().get("brand_voice")).toBe("Plain and friendly.");
    expect(savedForm().has("phone")).toBe(false);
    expect(useAppStore.getState().currentDealer?.phone).toBe("517-555-0199");
  });
});
