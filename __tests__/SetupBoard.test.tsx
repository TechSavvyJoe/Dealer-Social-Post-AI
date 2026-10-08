import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../types";
import type { Person } from "../services/salespeople";

const mocks = vi.hoisted(() => ({
  getDealers: vi.fn(),
  updateDealerWithFile: vi.fn(),
  listPeoplePage: vi.fn(),
}));

vi.mock("../services/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/database")>()),
  getDealers: mocks.getDealers,
  updateDealerWithFile: mocks.updateDealerWithFile,
}));

vi.mock("../services/salespeople", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/salespeople")>()),
  listPeoplePage: mocks.listPeoplePage,
}));

vi.mock("../services/dealershipInvitations", () => ({
  dealershipInvitation: vi
    .fn()
    .mockResolvedValue({ required: false, hasInvitation: false }),
  dealershipInvitationLink: (token: string) => `https://example.test/join#${token}`,
}));

vi.mock("../components/SystemHealthPanel", () => ({
  SystemHealthPanel: () => <div>System health ready</div>,
}));

import { AdminDashboard } from "../components/AdminDashboard";
import { CREATIVE_SYSTEM_NOTE } from "../components/admin/SetupBoard";
import { ToastProvider } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";
import { dealerSetupStatus } from "../utils/dealerSetupStatus";

const complete: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  website: "https://www.northsidemotors.com/",
  phone: "(517) 555-0100",
  address: "12 Main St, Howell, MI",
  logo: "/api/files/dealers/dealer-1/logo.png",
  brand_color: "#1d4ed8",
  facebook_url: "https://facebook.com/northside",
  facebook_page_tag: "northside",
  instagram_handle: "northside",
  tiktok_handle: "",
  brand_voice: "Plain and friendly.",
  signature_look: "showroom",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  creative_system_v2: false,
  setup_notes: "",
};

/** Missing Instagram and Brand voice. */
const lakeside: Dealer = {
  ...complete,
  id: "dealer-2",
  name: "Lakeside Kia",
  website: "https://lakesidekia.com",
  instagram_handle: "",
  brand_voice: "",
  requires_approval: true,
  approval_policy: { mode: "per_category", categories: ["deliveries", "promotions"] },
  setup_notes: "Agency sends the Instagram handle this week.",
};

const everyPost: Dealer = {
  ...complete,
  id: "dealer-3",
  name: "Riverside Chevrolet",
  requires_approval: true,
  approval_policy: null,
};

const firstPosts: Dealer = {
  ...complete,
  id: "dealer-4",
  name: "Oakwood Toyota",
  requires_approval: true,
  approval_policy: { mode: "first_n", firstN: 3 },
};

const manager = (overrides: Partial<Person>): Person => ({
  id: "manager-1",
  dealer: "dealer-2",
  dealerName: "Lakeside Kia",
  name: "Dana Reyes",
  role: "manager",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
  hasManagerLogin: true,
  ...overrides,
});

const originalActions = {
  setManagerEntry: useAppStore.getState().setManagerEntry,
  impersonatePerson: useAppStore.getState().impersonatePerson,
};

const mount = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdminDashboard />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
};

const rowFor = async (name: string) =>
  (await screen.findByRole("rowheader", { name: new RegExp(name) })).closest(
    "tr",
  ) as HTMLElement;

/** Opens a store's row and returns its detail. */
const openStore = async (name: string) => {
  const row = await rowFor(name);
  const toggle = within(row).getByRole("button", { name: new RegExp(name) });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return document.getElementById(toggle.getAttribute("aria-controls") as string)!;
};

const notesField = (detail: HTMLElement) =>
  within(detail).getByRole("textbox", { name: "Setup notes" });

const setPhone = (phone: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        query.includes("prefers-reduced-motion: reduce") ||
        (phone && query.includes("max-width: 767px")),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  setPhone(false);
  mocks.getDealers.mockResolvedValue([complete, lakeside, everyPost, firstPosts]);
  mocks.updateDealerWithFile.mockResolvedValue({ id: "dealer-2" });
  mocks.listPeoplePage.mockResolvedValue({ items: [], total: 0 });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  useAppStore.setState({
    currentDealer: { id: "system-dealer", name: "SYSTEM ADMIN" },
    role: "super_admin",
    authEpoch: 1,
    managerEntry: null,
  });
});

afterEach(() => {
  setPhone(false);
  vi.unstubAllGlobals();
  useAppStore.setState({
    currentDealer: null,
    role: "salesperson",
    managerEntry: null,
    ...originalActions,
  });
});

describe("the setup board table", () => {
  it("counts what is missing in one sentence", async () => {
    mount();
    expect(
      await screen.findByText(
        "4 dealerships. 2 setup items are missing across 1 of them.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Setup board" }),
    ).toBeVisible();
  });

  it("has one column per counted row of the model and names each cell", async () => {
    mount();
    const row = await rowFor("Lakeside Kia");
    const table = row.closest("table") as HTMLElement;
    expect(
      within(table).getByText("Setup status for each dealership", {
        selector: "caption",
      }),
    ).toBeInTheDocument();
    const counted = dealerSetupStatus(lakeside).rows.filter((r) => r.counts);
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Dealership",
      "Profile",
      "Brand",
      "Facebook",
      "Instagram",
      "Voice",
      "Look",
      "Approval",
      "Creative system",
      "Details",
    ]);
    expect(headers.length - 4).toBe(counted.length);

    expect(
      within(row).getByRole("img", { name: "Instagram is missing" }),
    ).toBeVisible();
    expect(
      within(row).getByRole("img", { name: "Brand voice is missing" }),
    ).toBeVisible();
    expect(
      within(row).getByRole("img", { name: "Store profile is set up" }),
    ).toBeVisible();
    expect(within(row).queryByRole("img", { name: "Instagram is set up" })).toBeNull();
    const northside = await rowFor("Northside Motors");
    expect(
      within(northside).getByRole("img", { name: "Instagram is set up" }),
    ).toBeVisible();
    // The website as people say it.
    expect(within(northside).getByText("northsidemotors.com")).toBeVisible();
  });

  it("shows a dash, not a gap, for a field the list does not report", async () => {
    const legacy = { ...complete };
    delete legacy.creative_system_v2;
    delete legacy.signature_look;
    mocks.getDealers.mockResolvedValue([legacy]);
    mount();
    const row = await rowFor("Northside Motors");
    expect(
      within(row).getByRole("img", { name: "Signature look: not reported" }),
    ).toBeVisible();
    expect(screen.getByText("1 dealership.")).toBeVisible();
  });

  it("says the approval rule in words", async () => {
    mount();
    expect(
      within(await rowFor("Northside Motors")).getByText("Off", { selector: "td" }),
    ).toHaveClass("text-ink-2");
    expect(
      within(await rowFor("Riverside Chevrolet")).getByText("Every post"),
    ).toBeVisible();
    expect(
      within(await rowFor("Oakwood Toyota")).getByText("First 3 posts each"),
    ).toBeVisible();
    expect(
      within(await rowFor("Lakeside Kia")).getByText("Deliveries and Promotions"),
    ).toHaveClass("text-ink");
  });

  it("finds a dealership by name as you type and says when none matches", async () => {
    mount();
    await rowFor("Northside Motors");
    const search = screen.getByRole("searchbox", { name: "Find a dealership" });
    expect(search).toHaveAttribute("placeholder", "Find a dealership");
    fireEvent.change(search, { target: { value: "  lake " } });
    expect(screen.getByRole("rowheader", { name: /Lakeside Kia/ })).toBeVisible();
    expect(screen.queryByRole("rowheader", { name: /Northside Motors/ })).toBeNull();
    fireEvent.change(search, { target: { value: "Zephyr" } });
    expect(screen.getByText("No dealership matches “Zephyr”.")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("an open store", () => {
  it("lists exactly the missing counted rows with what each costs", async () => {
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(
      within(detail).getByRole("heading", { name: "2 things left to set up" }),
    ).toBeVisible();
    const items = within(detail)
      .getByRole("heading", { name: "2 things left to set up" })
      .parentElement!.querySelectorAll("li");
    expect([...items].map((item) => item.firstElementChild?.textContent)).toEqual([
      "InstagramInstagram captions cannot tag the store.",
      "Brand voiceCaptions are written without the store's voice.",
    ]);
    expect(within(detail).getByRole("button", { name: "Open Channels" })).toBeVisible();
    expect(within(detail).getByRole("button", { name: "Open Voice" })).toBeVisible();
    expect(
      within(detail).getByText(
        "Showroom Look. Posts use the classic styles while the creative system is off.",
      ),
    ).toBeVisible();
    expect(
      within(detail).getByRole("img", { name: "Sample photo with no Look applied" }),
    ).toBeVisible();
  });

  it("says everything is set up when nothing counted is missing", async () => {
    mount();
    const detail = await openStore("Northside Motors");
    expect(
      within(detail).getByRole("heading", { name: "Everything is set up." }),
    ).toBeVisible();
    expect(
      within(detail).queryByRole("button", {
        name: /^Open (Channels|Voice|Creative|Store profile)$/,
      }),
    ).toBeNull();
  });

  it("lists every saved value behind Everything on file", async () => {
    mount();
    const detail = await openStore("Lakeside Kia");
    const toggle = within(detail).getByRole("button", { name: "Everything on file" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const file = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(within(file).getByText("lakesidekia.com")).toBeVisible();
    expect(within(file).getByText("Tags @northside")).toBeVisible();
    expect(within(file).getByText("#1D4ED8")).toBeVisible();
    expect(
      within(file).getByText(
        "Selected post types: Deliveries and Promotions, plus any post with a customer",
      ),
    ).toBeVisible();
    const tiktok = within(file).getByText("TikTok").parentElement as HTMLElement;
    expect(within(tiktok).getByText("Optional")).toBeVisible();
  });
});

describe("opening a store's settings as its manager", () => {
  it("sets the section, then opens the store as its first active manager", async () => {
    const setManagerEntry = vi.fn();
    const impersonatePerson = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ setManagerEntry, impersonatePerson });
    mocks.listPeoplePage.mockResolvedValue({
      items: [
        manager({ id: "manager-0", name: "Former Manager", active: false }),
        manager({ id: "manager-1" }),
      ],
      total: 2,
    });
    mount();
    const detail = await openStore("Lakeside Kia");
    const open = within(detail).getByRole("button", { name: "Open Channels" });
    await waitFor(() => expect(open).toBeEnabled());
    expect(mocks.listPeoplePage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "manager",
        dealerId: "dealer-2",
        includeInactive: false,
      }),
    );
    fireEvent.click(open);
    await waitFor(() => expect(impersonatePerson).toHaveBeenCalledWith("manager-1"));
    expect(setManagerEntry).toHaveBeenCalledWith({ section: "channels" });
    expect(setManagerEntry.mock.invocationCallOrder[0]).toBeLessThan(
      impersonatePerson.mock.invocationCallOrder[0],
    );
    expect(
      within(detail).getByText(
        "These buttons open the store's settings as its manager, on the right section.",
      ),
    ).toBeVisible();
  });

  it("opens as the manager with no section from Open as manager", async () => {
    const setManagerEntry = vi.fn();
    const impersonatePerson = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ setManagerEntry, impersonatePerson });
    mocks.listPeoplePage.mockResolvedValue({ items: [manager({})], total: 1 });
    mount();
    const detail = await openStore("Lakeside Kia");
    const open = within(detail).getByRole("button", { name: "Open as manager" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    await waitFor(() => expect(impersonatePerson).toHaveBeenCalledWith("manager-1"));
    expect(setManagerEntry).toHaveBeenCalledWith(null);
  });

  it("says why the open buttons wait while the store's manager loads", async () => {
    mocks.listPeoplePage.mockReturnValue(new Promise(() => {}));
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(within(detail).getByText("Finding this store's manager…")).toHaveAttribute(
      "role",
      "status",
    );
    for (const name of ["Open Channels", "Open Voice", "Open as manager"]) {
      const button = within(detail).getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription("Finding this store's manager…");
    }
    // The same reason shows for a store with nothing missing.
    const northside = await openStore("Northside Motors");
    expect(within(northside).getByText("Finding this store's manager…")).toBeVisible();
    expect(
      within(northside).getByRole("button", { name: "Open as manager" }),
    ).toHaveAccessibleDescription("Finding this store's manager…");
  });

  it("explains a store with no active manager and offers the Admins tab", async () => {
    const impersonatePerson = vi.fn();
    useAppStore.setState({ impersonatePerson });
    mocks.listPeoplePage.mockResolvedValue({
      items: [manager({ active: false })],
      total: 1,
    });
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(
      await within(detail).findByText("This store has no active manager yet."),
    ).toBeVisible();
    for (const name of ["Open Channels", "Open Voice", "Open as manager"]) {
      const button = within(detail).getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(
        "This store has no active manager yet.",
      );
    }
    fireEvent.click(within(detail).getByRole("button", { name: "Add a manager" }));
    expect(screen.getByRole("tab", { name: "Admins" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Store", { selector: "select" })).toHaveValue(
      "dealer-2",
    );
    expect(impersonatePerson).not.toHaveBeenCalled();
  });

  it("clears the section and shows the error when the store cannot be opened", async () => {
    const setManagerEntry = vi.fn();
    const impersonatePerson = vi
      .fn()
      .mockRejectedValue(new Error("This manager's session could not be opened."));
    useAppStore.setState({ setManagerEntry, impersonatePerson });
    mocks.listPeoplePage.mockResolvedValue({ items: [manager({})], total: 1 });
    mount();
    const detail = await openStore("Lakeside Kia");
    const open = within(detail).getByRole("button", { name: "Open Voice" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    expect(await within(detail).findByRole("alert")).toHaveTextContent(
      "This manager's session could not be opened.",
    );
    expect(setManagerEntry.mock.calls).toEqual([[{ section: "voice" }], [null]]);
    await waitFor(() => expect(open).toBeEnabled());
  });
});

describe("setup notes", () => {
  it("shows the saved notes and only system admins see them", async () => {
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(notesField(detail)).toHaveValue(
      "Agency sends the Instagram handle this week.",
    );
    expect(notesField(detail)).toHaveAccessibleDescription(
      "Only system admins see these.",
    );
    expect(notesField(detail)).toHaveAttribute("maxLength", "4000");
  });

  it("saves only the notes and puts the saved text in the dealer list", async () => {
    const queryClient = mount();
    const detail = await openStore("Lakeside Kia");
    expect(within(detail).queryByRole("button", { name: "Save notes" })).toBeNull();
    fireEvent.change(notesField(detail), {
      target: { value: "Dana approves every delivery.\nTag the Howell page." },
    });
    expect(within(detail).getByText("Unsaved changes")).toBeVisible();
    const save = within(detail).getByRole("button", { name: "Save notes" });
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(within(detail).getByText(/^Saved /)).toBeVisible());
    expect(within(detail).queryByText("Unsaved changes")).toBeNull();
    // Save notes has left; focus is on the line that says the notes saved,
    // not dropped to the page.
    expect(save).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(within(detail).getByText(/^Saved /));
    const [dealerId, formData] = mocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe("dealer-2");
    expect([...formData.keys()]).toEqual(["setup_notes"]);
    expect(formData.get("setup_notes")).toBe(
      "Dana approves every delivery.\nTag the Howell page.",
    );
    const cached = queryClient.getQueryData<Dealer[]>(["dealers"]);
    expect(cached?.find((dealer) => dealer.id === "dealer-2")?.setup_notes).toBe(
      "Dana approves every delivery.\nTag the Howell page.",
    );
  });

  it("keeps the typed text and shows the error when the save fails", async () => {
    mocks.updateDealerWithFile.mockRejectedValue(
      new Error("Setup notes are too long."),
    );
    mount();
    const detail = await openStore("Lakeside Kia");
    fireEvent.change(notesField(detail), { target: { value: "Call Dana first." } });
    const save = within(detail).getByRole("button", { name: "Save notes" });
    save.focus();
    fireEvent.click(save);
    expect(await within(detail).findByRole("alert")).toHaveTextContent(
      "Setup notes are too long.",
    );
    // Focus stayed on the status line through the failed save.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveTextContent("Unsaved changes");
    expect(notesField(detail)).toHaveValue("Call Dana first.");
    expect(within(detail).getByText("Unsaved changes")).toBeVisible();
    expect(within(detail).getByRole("button", { name: "Save notes" })).toBeVisible();
  });

  it("keeps each store's draft when rows close and reopen", async () => {
    mount();
    let lakesideDetail = await openStore("Lakeside Kia");
    fireEvent.change(notesField(lakesideDetail), {
      target: { value: "Lakeside draft" },
    });
    let northsideDetail = await openStore("Northside Motors");
    // One store open at a time.
    expect(
      within(await rowFor("Lakeside Kia")).getByRole("button", {
        name: /Lakeside Kia/,
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(notesField(northsideDetail)).toHaveValue("");
    fireEvent.change(notesField(northsideDetail), {
      target: { value: "Northside draft" },
    });

    lakesideDetail = await openStore("Lakeside Kia");
    expect(notesField(lakesideDetail)).toHaveValue("Lakeside draft");
    expect(within(lakesideDetail).getByText("Unsaved changes")).toBeVisible();
    northsideDetail = await openStore("Northside Motors");
    expect(notesField(northsideDetail)).toHaveValue("Northside draft");
    expect(mocks.updateDealerWithFile).not.toHaveBeenCalled();
  });

  it("keeps a draft while the hub shows another tab", async () => {
    mount();
    const detail = await openStore("Lakeside Kia");
    fireEvent.change(notesField(detail), { target: { value: "Back in a minute" } });
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));
    fireEvent.click(screen.getByRole("tab", { name: "Dealers" }));
    expect(notesField(await openStore("Lakeside Kia"))).toHaveValue("Back in a minute");
  });

  it("refuses more than 4,000 characters", async () => {
    mount();
    const detail = await openStore("Lakeside Kia");
    fireEvent.change(notesField(detail), { target: { value: "x".repeat(4001) } });
    expect((notesField(detail) as HTMLTextAreaElement).value).toHaveLength(4000);
  });

  it("cannot be saved when the list does not carry the field", async () => {
    const older = { ...lakeside };
    delete older.setup_notes;
    mocks.getDealers.mockResolvedValue([older]);
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(notesField(detail)).toBeDisabled();
    expect(notesField(detail)).toHaveAccessibleDescription(
      "This server's dealer list doesn't include setup notes yet, so they can't be saved here.",
    );
  });
});

describe("the creative-system switch", () => {
  it("saves the switch for that store and holds the saved value", async () => {
    let resolveSave: (value: { id: string }) => void = () => {};
    mocks.updateDealerWithFile.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    mount();
    const row = await rowFor("Northside Motors");
    const toggle = within(row).getByRole("switch", {
      name: "Creative system Northside Motors",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(CREATIVE_SYSTEM_NOTE);
    const live = within(row).getByRole("status");
    expect(live).toBeEmptyDOMElement();

    fireEvent.click(toggle);
    await waitFor(() => expect(live).toHaveTextContent("Saving…"));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(
      within(await rowFor("Lakeside Kia")).getByRole("switch"),
    ).not.toHaveAttribute("aria-busy");
    const [dealerId, formData] = mocks.updateDealerWithFile.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(dealerId).toBe("dealer-1");
    expect([...formData.keys()].sort()).toEqual(["creative_system_v2", "name"]);
    expect(formData.get("creative_system_v2")).toBe("true");

    // The refetch never resolves: the switch must keep the saved value.
    mocks.getDealers.mockReturnValue(new Promise(() => {}));
    resolveSave({ id: "dealer-1" });
    await waitFor(() => expect(live).toBeEmptyDOMElement());
    expect(
      within(await rowFor("Northside Motors")).getByRole("switch", {
        name: "Creative system Northside Motors",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      await screen.findByText("Creative system turned on for Northside Motors."),
    ).toBeInTheDocument();
  });

  it("shows the error and the saved value when the save fails", async () => {
    mocks.updateDealerWithFile.mockRejectedValue(
      new Error("Only the system administrator can change this."),
    );
    mount();
    const row = await rowFor("Northside Motors");
    fireEvent.click(within(row).getByRole("switch"));
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Only the system administrator can change this.",
    );
    expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("is disabled, with the reason, when the list does not report the setting", async () => {
    const legacy = { ...complete };
    delete legacy.creative_system_v2;
    mocks.getDealers.mockResolvedValue([legacy]);
    mount();
    const row = await rowFor("Northside Motors");
    const toggle = within(row).getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription(
      `${CREATIVE_SYSTEM_NOTE} This server's dealer list doesn't report the creative system yet, so it can't be switched here.`,
    );
    fireEvent.click(toggle);
    expect(mocks.updateDealerWithFile).not.toHaveBeenCalled();
  });

  it("and the notes are never shown to anyone but a system administrator", async () => {
    useAppStore.setState({ role: "dealer_admin" });
    mount();
    const detail = await openStore("Lakeside Kia");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Creative system" })).toBeNull();
    expect(within(detail).queryByRole("textbox", { name: "Setup notes" })).toBeNull();
  });
});

describe("the setup board on a phone", () => {
  it("is a list whose rows open the same content, notes behind a disclosure", async () => {
    setPhone(true);
    mount();
    const row = await screen.findByRole("button", { name: /Lakeside Kia/ });
    expect(screen.queryByRole("table")).toBeNull();
    expect(row).toHaveTextContent("4 of 6 set up, 2 missing");
    expect(screen.getByRole("button", { name: /Northside Motors/ })).toHaveTextContent(
      "Everything is set up",
    );

    fireEvent.click(row);
    const detail = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(within(detail).getByRole("button", { name: "Open Channels" })).toBeVisible();
    expect(
      within(detail).getByText("Instagram captions cannot tag the store."),
    ).toBeVisible();
    expect(
      within(detail).getByRole("switch", { name: "Creative system Lakeside Kia" }),
    ).toBeVisible();
    expect(within(detail).getByText("Deliveries and Promotions")).toBeVisible();

    expect(within(detail).queryByRole("textbox", { name: "Setup notes" })).toBeNull();
    const notes = within(detail).getByRole("button", { name: "Setup notes" });
    expect(notes).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(notes);
    expect(notes).toHaveAttribute("aria-expanded", "true");
    const field = within(detail).getByRole("textbox", { name: "Setup notes" });
    expect(field).toHaveValue("Agency sends the Instagram handle this week.");
    fireEvent.change(field, { target: { value: "Phone draft" } });
    expect(within(detail).getByText("Unsaved changes")).toBeVisible();
    expect(within(detail).getByRole("button", { name: "Save notes" })).toBeVisible();
  });
});
