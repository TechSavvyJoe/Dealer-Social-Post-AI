import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerAdminDashboard } from "../components/DealerAdminDashboard";
import { useAppStore } from "../stores/appStore";
import { StyleOption, type Dealer } from "../types";

/**
 * The manager's dashboard shell and the rebuilt Dealership settings, driven
 * through the real dashboard: the rail, the live sample post, per-section
 * unsaved state, Discard, the channel rows, Replace logo, the admin's deep
 * link, and the reopen path from the Overview's history.
 */
const dbMocks = vi.hoisted(() => ({ updateDealerWithFile: vi.fn() }));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  ...dbMocks,
}));
vi.mock("../services/websitePublishing", () => ({
  listWebsiteDestinations: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  listSalespeople: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  getLeaderboard: vi.fn().mockResolvedValue([]),
}));
vi.mock("../components/Leaderboard", () => ({ Leaderboard: () => null }));
vi.mock("../components/ApprovalQueue", () => ({ ApprovalQueue: () => null }));
// The history list has its own suite; this stand-in reopens one post through
// whatever the dashboard hands it.
vi.mock("../components/PostHistory", () => ({
  PostHistory: ({ onPostReady }: { onPostReady?: (post: unknown) => void }) => (
    <button type="button" onClick={() => onPostReady?.({ postId: "post-9" })}>
      Open saved post
    </button>
  ),
}));
vi.mock("../components/YouTubeConnectionCard", () => ({
  YouTubeConnectionCard: () => null,
}));
vi.mock("../components/CustomScenarioManager", () => ({
  CustomScenarioManager: () => <div>Scenario manager</div>,
}));

/** Every area set up but Instagram and the brand voice. */
const dealer: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  website: "https://northside.example",
  phone: "517-555-0100",
  address: "1 Main St, Howell, MI 48843",
  facebook_url: "https://www.facebook.com/northside",
  facebook_page_tag: "NorthsideMotors",
  instagram_handle: "",
  brand_voice: "",
  brand_color: "#1d4ed8",
  logo: "/api/files/dealers/dealer-1/logo_old.png",
  signature_look: "showroom",
  creative_system_v2: true,
  default_footer: "See you soon.",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  brand_voice_do: [],
  brand_voice_dont: [],
  motion_signature: null,
  logo_placement: null,
};

const DISMISSED_KEY = `dsp.dealerSetupDismissed.v1.${dealer.id}`;

const renderDashboard = (record: Dealer = dealer) => {
  useAppStore.setState({ role: "dealer_admin", currentDealer: { ...record } });
  const onSettingsDirtyChange = vi.fn();
  const onOpenPost = vi.fn();
  render(
    <DealerAdminDashboard
      onSettingsDirtyChange={onSettingsDirtyChange}
      onOpenPost={onOpenPost}
    />,
  );
  return { onSettingsDirtyChange, onOpenPost };
};

const openSettings = () =>
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
const rail = () =>
  within(screen.getByRole("navigation", { name: "Dealership settings sections" }));
const railButton = (name: string) =>
  rail().getByRole("button", { name: new RegExp(`^${name}`) });
const openSection = (name: string) => fireEvent.click(railButton(name));
const sample = () => screen.getByRole("complementary", { name: "Sample post" });
const part = (name: string) => sample().querySelector(`[data-part="${name}"]`);
const saveBar = () => within(screen.getByTestId("dealer-settings-save-bar"));
const saveButton = () => screen.getByRole("button", { name: "Save changes" });

/**
 * jsdom applies no Tailwind CSS, so it honours the `hidden` attribute alone.
 * In a browser a display utility such as `flex` outranks the `[hidden]`
 * preflight rule, so the panel's class must hide it as well.
 */
const expectPanelShown = (toggle: HTMLElement, shown: boolean) => {
  expect(toggle).toHaveAttribute("aria-expanded", String(shown));
  const panel = document.getElementById(toggle.getAttribute("aria-controls") || "");
  expect(panel).not.toBeNull();
  expect(panel?.hidden).toBe(!shown);
  expect(panel?.classList.contains("hidden")).toBe(!shown);
  expect(panel?.classList.contains("flex")).toBe(shown);
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateDealerWithFile.mockResolvedValue({ id: dealer.id });
  localStorage.setItem(DISMISSED_KEY, "1");
  useAppStore.setState({ managerEntry: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(DISMISSED_KEY);
  useAppStore.setState({ currentDealer: null, managerEntry: null });
});

describe("manager dashboard shell", { timeout: 90_000 }, () => {
  it("titles each tab with its h1 in one row with the tabs, and no identity block", () => {
    renderDashboard();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Manager dashboard");
    // Hidden on phones (the app header names the store), shown from sm.
    expect(h1.className).toMatch(/\bsr-only\b/);
    expect(h1.className).toContain("sm:not-sr-only");
    // Title and tabs share one row.
    expect(h1.parentElement).toBe(screen.getByRole("tablist").parentElement);
    // The logo, the dealership name and the caption block are gone.
    expect(screen.queryByRole("img", { name: `${dealer.name} logo` })).toBeNull();
    expect(screen.getAllByText("Manager dashboard")).toHaveLength(1);
    expect(screen.queryByText(dealer.name)).toBeNull();

    openSettings();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Dealership settings",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your team");
  });

  it("still moves between tabs with the arrow keys, Home and End", () => {
    renderDashboard();
    const tab = (name: string) => screen.getByRole("tab", { name });
    fireEvent.keyDown(tab("Overview"), { key: "ArrowRight" });
    expect(tab("Settings")).toHaveAttribute("aria-selected", "true");
    expect(tab("Settings")).toHaveAttribute("aria-controls", "manager-panel-settings");
    fireEvent.keyDown(tab("Settings"), { key: "ArrowLeft" });
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Overview"), { key: "End" });
    expect(tab("Team")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Team"), { key: "Home" });
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });

  it("opens a saved post from the Overview through the app's guarded path", () => {
    const { onOpenPost } = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Open saved post" }));
    expect(onOpenPost).toHaveBeenCalledTimes(1);
    expect(onOpenPost).toHaveBeenCalledWith({ postId: "post-9" });
  });

  it("opens Settings on the section the admin's setup board linked to, once", () => {
    useAppStore.setState({ managerEntry: { section: "voice" } });
    renderDashboard();
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(railButton("Voice")).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("heading", { level: 2, name: "Voice" }),
    ).toBeInTheDocument();
    expect(useAppStore.getState().managerEntry).toBeNull();

    // Consumed: a later visit to Settings starts on Store profile.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    openSettings();
    expect(railButton("Store profile")).toHaveAttribute("aria-current", "page");
  });
});

describe("settings rail", { timeout: 90_000 }, () => {
  it("marks ready, partial, empty and Workflow sections from the saved record", () => {
    renderDashboard();
    openSettings();
    expect(railButton("Store profile")).toHaveAccessibleName("Store profile, ready");
    expect(railButton("Channels")).toHaveAccessibleName("Channels, 1 of 2 ready");
    expect(rail().getByText("1 of 2").className).toContain("text-warning-ink");
    expect(railButton("Voice")).toHaveAccessibleName("Voice, not started");
    expect(rail().getByText("Not started").className).toContain("text-warning-ink");
    expect(railButton("Creative")).toHaveAccessibleName("Creative, ready");
    expect(railButton("Workflow")).toHaveAccessibleName("Workflow");
    expect(railButton("Store profile")).toHaveAttribute("aria-current", "page");

    expect(screen.getByText("2 of 4 areas ready")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Store setup progress" }),
    ).toHaveAttribute("aria-valuenow", "2");
  });

  it("follows the saved record, never unsaved edits", () => {
    renderDashboard();
    openSettings();
    openSection("Voice");
    fireEvent.change(screen.getByLabelText("How captions should sound"), {
      target: { value: "Warm and direct." },
    });
    expect(screen.getByText("2 of 4 areas ready")).toBeInTheDocument();
    expect(railButton("Voice")).toHaveAccessibleName("Voice, not started");
  });
});

describe("the sample post", { timeout: 90_000 }, () => {
  it("shows a page tag as it is typed, before anything is saved", () => {
    renderDashboard({ ...dealer, facebook_page_tag: "" });
    openSettings();
    openSection("Channels");
    expect(part("mention")).toBeNull();
    fireEvent.change(screen.getByLabelText("Page tag for captions"), {
      target: { value: "@NorthsideMotors" },
    });
    expect(part("mention")).toHaveTextContent("@NorthsideMotors");
    expect(dbMocks.updateDealerWithFile).not.toHaveBeenCalled();
  });

  it("drops the disclosure line when the switch goes off", () => {
    renderDashboard();
    openSettings();
    openSection("Workflow");
    expect(part("disclosure")).toHaveTextContent(
      "Posted by a Northside Motors team member.",
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Add the disclosure to every post" }),
    );
    expect(part("disclosure")).toBeNull();
  });

  it("drops the Waiting for you strip when the rule no longer holds a delivery", () => {
    renderDashboard();
    openSettings();
    openSection("Workflow");
    const waiting = () => sample().querySelector("[data-sample-waiting]");
    expect(waiting()).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
    expect(waiting()).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Selected post types" }));
    expect(waiting()).not.toBeNull();
    const types = within(screen.getByRole("group", { name: "Post types to review" }));
    fireEvent.click(types.getByRole("checkbox", { name: "Service" }));
    fireEvent.click(types.getByRole("checkbox", { name: "Deliveries" }));
    expect(waiting()).toBeNull();
  });

  it("marks the part of the post the open section controls", () => {
    renderDashboard();
    openSettings();
    const marks = () => sample().querySelectorAll("[data-mark]");

    expect(marks()).toHaveLength(0);

    openSection("Channels");
    expect(part("mention")?.querySelector("[data-mark]")).not.toBeNull();
    expect(marks()).toHaveLength(1);

    openSection("Voice");
    expect(part("footer")?.querySelector("[data-mark]")).not.toBeNull();
    expect(part("hashtags")?.querySelector("[data-mark]")).not.toBeNull();
    expect(part("mention")?.querySelector("[data-mark]")).toBeNull();

    openSection("Creative");
    expect(sample().querySelector('[data-mark="headline"]')).not.toBeNull();
    expect(part("footer")?.querySelector("[data-mark]")).toBeNull();

    openSection("Workflow");
    expect(part("disclosure")?.querySelector("[data-mark]")).not.toBeNull();
    expect(sample().querySelector('[data-mark="headline"]')).toBeNull();
  });

  it("collapses below lg into one strip that opens the full sample in place", () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    const strip = screen.getByRole("button", { name: /^On a post/ });
    expect(strip).toHaveAttribute("aria-expanded", "false");
    expect(strip).toHaveTextContent("Your Facebook page tag is @NorthsideMotors");
    const prints = () => document.querySelectorAll("[data-sample-print]").length;
    expect(prints()).toBe(1);
    fireEvent.click(strip);
    expect(strip).toHaveAttribute("aria-expanded", "true");
    expect(prints()).toBe(2);
  });
});

describe("saving and discarding", { timeout: 90_000 }, () => {
  const editIn: Record<string, () => void> = {
    "Store profile": () =>
      fireEvent.change(screen.getByLabelText("Phone"), {
        target: { value: "517-555-0199" },
      }),
    Channels: () =>
      fireEvent.change(screen.getByLabelText("Instagram handle"), {
        target: { value: "northside" },
      }),
    Voice: () =>
      fireEvent.change(screen.getByLabelText("Footer"), {
        target: { value: "Call us." },
      }),
    Creative: () =>
      fireEvent.change(screen.getByLabelText("Store color"), {
        target: { value: "#123456" },
      }),
    Workflow: () =>
      fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" })),
  };

  for (const [section, edit] of Object.entries(editIn)) {
    it(`names ${section} when it holds the only unsaved edit`, () => {
      renderDashboard();
      openSettings();
      expect(saveBar().getByText("Up to date")).toBeInTheDocument();
      openSection(section);
      edit();
      expect(saveBar().getByText(`Unsaved changes in ${section}`)).toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });
  }

  it("names every section with unsaved edits", () => {
    renderDashboard();
    openSettings();
    editIn["Store profile"]();
    openSection("Voice");
    editIn.Voice();
    expect(
      saveBar().getByText("Unsaved changes in Store profile and Voice"),
    ).toBeInTheDocument();
    openSection("Workflow");
    editIn.Workflow();
    expect(
      saveBar().getByText("Unsaved changes in Store profile, Voice and Workflow"),
    ).toBeInTheDocument();
  });

  it("discards a text field, a switch, the approval choice and a Look, and stays on the section", async () => {
    const { onSettingsDirtyChange } = renderDashboard();
    openSettings();
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https://other.example" },
    });
    openSection("Voice");
    fireEvent.click(
      screen.getByRole("switch", { name: "Always include every hashtag above" }),
    );
    openSection("Workflow");
    fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
    openSection("Creative");
    const looks = () =>
      within(screen.getByRole("radiogroup", { name: "Signature Look" }));
    fireEvent.click(looks().getByRole("radio", { name: "Hometown" }));
    expect(
      saveBar().getByText(
        "Unsaved changes in Store profile, Voice, Creative and Workflow",
      ),
    ).toBeInTheDocument();

    // Keep editing keeps everything.
    fireEvent.click(saveBar().getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(looks().getByRole("radio", { name: "Hometown" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(saveBar().getByRole("button", { name: "Discard" }));
    expect(screen.getByText("Discard unsaved settings?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(railButton("Creative")).toHaveAttribute("aria-current", "page");
    const title = screen.getByRole("heading", { level: 2, name: "Creative" });
    expect(title).toHaveFocus();
    // The global :focus-visible ring shows where a keyboard Discard landed;
    // nothing on the heading may switch it off.
    expect(title.className).not.toMatch(/outline-none|outline-0/);
    expect(looks().getByRole("radio", { name: "Hometown" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(looks().getByRole("radio", { name: "Showroom" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(saveBar().getByText("Up to date")).toBeInTheDocument();
    expect(saveBar().queryByRole("button", { name: "Discard" })).toBeNull();
    await waitFor(() => expect(onSettingsDirtyChange).toHaveBeenLastCalledWith(false));

    openSection("Voice");
    expect(
      screen.getByRole("switch", { name: "Always include every hashtag above" }),
    ).toHaveAttribute("aria-checked", "false");
    openSection("Workflow");
    expect(screen.getByRole("radio", { name: "No approval required" })).toBeChecked();
    openSection("Store profile");
    expect(screen.getByLabelText("Website")).toHaveValue(dealer.website);
    expect(dbMocks.updateDealerWithFile).not.toHaveBeenCalled();
  });

  it("steps the first-posts count between 1 and 100", () => {
    renderDashboard();
    openSettings();
    openSection("Workflow");
    fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
    fireEvent.click(screen.getByRole("radio", { name: "Each person's first posts" }));
    const count = screen.getByLabelText("Posts to approve first");
    expect(count).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "One more post" }));
    expect(count).toHaveValue(4);
    const fewer = screen.getByRole("button", { name: "One fewer post" });
    for (let i = 0; i < 3; i += 1) fireEvent.click(fewer);
    expect(count).toHaveValue(1);
    expect(fewer).toBeDisabled();
  });
});

describe("channel rows", { timeout: 90_000 }, () => {
  const optionalToggle = (action: "Add" | "Edit") =>
    screen.getByRole("button", {
      name: `${action} Google Business Profile, TikTok, X and LinkedIn`,
    });

  it("opens the first row that is not ready and shows a ready row's saved handle", () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    const facebook = screen.getByRole("button", { name: "Edit Facebook" });
    expect(facebook).toHaveAttribute("aria-expanded", "false");
    const facebookRow = within(facebook.closest(".border-b") as HTMLElement);
    expect(facebookRow.getByText("@NorthsideMotors")).toBeInTheDocument();
    expect(facebookRow.getByText("Ready")).toBeInTheDocument();
    // Closed: its fields are out of the way.
    expect(screen.queryByRole("textbox", { name: "Page address" })).toBeNull();

    const instagram = screen.getByRole("button", { name: "Add Instagram" });
    expect(instagram).toHaveAttribute("aria-expanded", "true");
    expect(instagram).toHaveAttribute("aria-controls");
    expect(
      document.getElementById(instagram.getAttribute("aria-controls") || ""),
    ).toContainElement(screen.getByRole("textbox", { name: "Instagram handle" }));

    fireEvent.click(facebook);
    expect(facebook).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Page address" })).toBeInTheDocument();
  });

  it("shows the saved value or status under the name only while a row is closed", () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    const header = (toggle: HTMLElement) => within(toggle.parentElement as HTMLElement);

    // Open (the first row not ready): the name and a "Missing" mark, as the
    // phone artboard draws it; the reason sentence waits for the closed row.
    const instagram = screen.getByRole("button", { name: "Add Instagram" });
    expect(instagram).toHaveAttribute("aria-expanded", "true");
    expect(header(instagram).getByText("Missing")).toHaveClass("text-warning-ink");
    expect(
      screen.queryByText("Missing. Instagram captions cannot tag the store."),
    ).toBeNull();
    fireEvent.click(instagram);
    expect(
      header(instagram).getByText("Missing. Instagram captions cannot tag the store."),
    ).toHaveClass("text-warning-ink");
    expect(header(instagram).queryByText("Missing")).toBeNull();

    // A ready row: the handle while closed; open, the field holds it instead.
    const facebook = screen.getByRole("button", { name: "Edit Facebook" });
    expect(header(facebook).getByText("@NorthsideMotors")).toBeInTheDocument();
    fireEvent.click(facebook);
    expect(header(facebook).queryByText("@NorthsideMotors")).toBeNull();
    expect(header(facebook).getByText("Ready")).toBeInTheDocument();
    expect(header(facebook).queryByText("Missing")).toBeNull();
  });

  it("hides a closed row's fields in the browser too, not only for assistive tech", () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    const facebook = screen.getByRole("button", { name: "Edit Facebook" });
    const instagram = screen.getByRole("button", { name: "Add Instagram" });
    expectPanelShown(facebook, false);
    expectPanelShown(instagram, true);
    expectPanelShown(
      screen.getByRole("button", {
        name: "Add Google Business Profile, TikTok, X and LinkedIn",
      }),
      false,
    );
    fireEvent.click(facebook);
    fireEvent.click(instagram);
    expectPanelShown(facebook, true);
    expectPanelShown(instagram, false);
  });

  it("never calls the optional row missing, and lists what it holds", () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    const toggle = optionalToggle("Add");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const row = toggle.closest(".border-b") as HTMLElement;
    expect(row).toHaveTextContent("Optional. Add them only if your store uses them.");
    expect(row.textContent).not.toMatch(/Missing/);
    // Nor styled as missing: nothing in the row is in warning ink.
    expect(row.querySelector(".text-warning-ink")).toBeNull();
  });

  it("offers Edit on the optional row once one of them is saved", () => {
    renderDashboard({ ...dealer, tiktok_handle: "northside" });
    openSettings();
    openSection("Channels");
    expect(optionalToggle("Edit")).toBeInTheDocument();
    expect(screen.getByText("Saved: TikTok @northside.")).toBeInTheDocument();
  });

  it("opens no row when every counted channel is ready", () => {
    renderDashboard({ ...dealer, instagram_handle: "northside" });
    openSettings();
    openSection("Channels");
    expect(screen.getByRole("button", { name: "Edit Facebook" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Edit Instagram" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps a row open after its edit is saved", async () => {
    renderDashboard();
    openSettings();
    openSection("Channels");
    fireEvent.change(screen.getByLabelText("Instagram handle"), {
      target: { value: "northside" },
    });
    fireEvent.click(saveButton());
    await screen.findByText(/^Saved /);
    const instagram = screen.getByRole("button", { name: "Edit Instagram" });
    expect(instagram).toHaveAttribute("aria-expanded", "true");
  });
});

describe("disclosures, groups and targets", { timeout: 90_000 }, () => {
  it("keeps both advanced disclosures closed in the browser until opened", () => {
    renderDashboard();
    openSettings();
    openSection("Creative");
    const creative = screen.getByRole("button", { name: "Video and advanced" });
    expectPanelShown(creative, false);
    fireEvent.click(creative);
    expectPanelShown(creative, true);

    openSection("Workflow");
    const workflow = screen.getByRole("button", { name: "Advanced workflow controls" });
    expectPanelShown(workflow, false);
    fireEvent.click(workflow);
    expectPanelShown(workflow, true);
  });

  it("keeps the approval group to its two radios, with the scope choices beside it", () => {
    renderDashboard();
    openSettings();
    openSection("Workflow");
    const approval = screen.getByRole("radiogroup", {
      name: "Manager approval requirement",
    });
    expect(
      screen.queryByRole("group", { name: "Which posts need approval?" }),
    ).toBeNull();
    fireEvent.click(
      within(approval).getByRole("radio", { name: "Require manager approval" }),
    );
    const scope = screen.getByRole("group", { name: "Which posts need approval?" });
    expect(within(approval).getAllByRole("radio")).toHaveLength(2);
    expect(approval).not.toContainElement(scope);
    expect(within(scope).getAllByRole("radio")).toHaveLength(3);
  });

  it("gives a phrase chip's remove button a 44 px hit area around its 32 px circle", () => {
    renderDashboard({ ...dealer, brand_voice_do: ["Family owned"] });
    openSettings();
    openSection("Voice");
    const remove = screen.getByRole("button", {
      name: "Remove do phrase Family owned",
    });
    // h-8 w-8 drawn; the ::before reaches 6 px (1.5) past it on every side.
    expect(remove).toHaveClass(
      "relative",
      "h-8",
      "w-8",
      "before:absolute",
      "before:-inset-1.5",
    );
  });
});

describe("replace logo", { timeout: 90_000 }, () => {
  const fileInput = () => screen.getByTestId("logo-file-input");

  it("refuses a file over 5 MB before any request", () => {
    renderDashboard();
    openSettings();
    openSection("Creative");
    const big = new File(["x"], "logo.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [big] } });
    expect(screen.getByRole("alert")).toHaveTextContent("larger than 5 MB");
    expect(dbMocks.updateDealerWithFile).not.toHaveBeenCalled();
  });

  it("uploads the logo alone, then shows the new logo everywhere", async () => {
    const newLogo = "/api/files/dealers/dealer-1/logo_new_x1.png";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ dealer: { id: dealer.id, logo: newLogo } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderDashboard();
    openSettings();
    openSection("Creative");
    expect(
      screen.getByRole("img", { name: "Current logo for Northside Motors" }),
    ).toHaveAttribute("src", dealer.logo);
    const file = new File(["png"], "new-logo.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(await screen.findByText("Logo updated")).toBeInTheDocument();
    expect(dbMocks.updateDealerWithFile).toHaveBeenCalledTimes(1);
    const [dealerId, body] = dbMocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe(dealer.id);
    expect(Array.from(body.keys())).toEqual(["logo"]);
    expect(body.get("logo")).toBe(file);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/app/session",
      expect.objectContaining({ method: "GET" }),
    );
    // The session dealer (and so the app header) carries the new logo.
    expect(useAppStore.getState().currentDealer?.logo).toBe(newLogo);
    expect(
      screen.getByRole("img", { name: "Current logo for Northside Motors" }),
    ).toHaveAttribute("src", newLogo);
    // It saved at once; the settings form has nothing unsaved.
    expect(saveButton()).toBeDisabled();
  });
});

describe("every control that existed is still there", { timeout: 90_000 }, () => {
  const textbox = (name: string) => screen.getByRole("textbox", { name });

  it("keeps a control for every saved field, by role and name, in each section", () => {
    renderDashboard();
    openSettings();

    // Store profile
    for (const name of ["Website", "Phone", "Address", "Tagline", "OEM affiliation"]) {
      expect(textbox(name)).toBeEnabled();
    }
    expect(screen.getByRole("group", { name: "Hours" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Monday opens" })).toBeInTheDocument();

    // Channels (open the rows that start closed)
    openSection("Channels");
    fireEvent.click(screen.getByRole("button", { name: "Edit Facebook" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Google Business Profile, TikTok, X and LinkedIn",
      }),
    );
    for (const name of [
      "Page address",
      "Page tag for captions",
      "Instagram handle",
      "Google Business Profile link",
      "TikTok handle",
      "X handle",
      "LinkedIn company tag",
    ]) {
      expect(textbox(name)).toBeEnabled();
    }

    // Voice
    openSection("Voice");
    for (const name of [
      "How captions should sound",
      "Do phrase",
      "Don't phrase",
      "Default hashtags, one per line",
      "Footer",
      "Phrases captions must never use, one per line",
    ]) {
      expect(textbox(name)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("switch", { name: "Always include every hashtag above" }),
    ).toBeInTheDocument();

    // Creative (and its advanced controls)
    openSection("Creative");
    fireEvent.click(screen.getByRole("button", { name: "Video and advanced" }));
    expect(
      screen.getByRole("radiogroup", { name: "Signature Look" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Second Look" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Playful style" })).toBeInTheDocument();
    expect(textbox("Store color")).toBeInTheDocument();
    expect(screen.getByLabelText("Pick store color")).toHaveAttribute("type", "color");
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Placement on photos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Motion style" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "9:16 Vertical" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Audio" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Logo size" })).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Image quality" }),
    ).toBeInTheDocument();
    const styles = within(screen.getByRole("group", { name: "Styles that are on" }));
    for (const style of Object.values(StyleOption)) {
      expect(styles.getByRole("checkbox", { name: style })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("combobox", { name: "Default classic style" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Scenario manager")).toBeInTheDocument();

    // Workflow (and its advanced controls)
    openSection("Workflow");
    expect(screen.getByRole("radio", { name: "No approval required" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Require manager approval" }));
    for (const name of [
      "Every post",
      "Each person's first posts",
      "Selected post types",
    ]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("radio", { name: "Each person's first posts" }));
    expect(
      screen.getByRole("spinbutton", { name: "Posts to approve first" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "Selected post types" }));
    expect(
      screen.getByRole("group", { name: "Post types to review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Add the disclosure to every post" }),
    ).toBeInTheDocument();
    const wording = textbox(
      "Wording (optional). Use {dealer} for your dealership name.",
    );
    expect(wording).toBeEnabled();
    // Legally operative: the default disclosure, shown as the placeholder.
    expect(wording).toHaveAttribute("placeholder", "Posted by a {dealer} team member.");
    fireEvent.click(screen.getByRole("button", { name: "Advanced workflow controls" }));
    expect(screen.getByRole("switch", { name: "Playful style" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Video" })).toBeInTheDocument();
    for (const type of [
      "Deliveries",
      "Inventory",
      "Service",
      "Promotions",
      "Community",
      "Team",
    ]) {
      expect(
        screen.getByRole("group", { name: `${type} channels` }),
      ).toBeInTheDocument();
    }
  });
});
