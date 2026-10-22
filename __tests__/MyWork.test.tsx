import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWork } from "../components/MyWork";
import { ContentWorkspace } from "../components/workspace/ContentWorkspace";
import { loadedPostMetadataCsv } from "../components/workspace/workspacePresentation";
import type { PostRecord } from "../services/posts";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  device: vi.fn(),
  store: vi.fn(),
  fetchCreative: vi.fn(),
  detail: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  approval: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../hooks/usePostHistoryList", () => ({ usePostHistoryList: mocks.history }));
vi.mock("../hooks/useDeviceMedia", () => ({ useDeviceMedia: mocks.device }));
vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mocks.store()),
    { getState: () => mocks.store() },
  ),
}));
vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  fetchPostCreativeDataUrl: mocks.fetchCreative,
  getPostDetail: mocks.detail,
  bulkArchivePosts: mocks.archive,
  bulkRestorePosts: mocks.restore,
  setApprovalStatus: mocks.approval,
}));

const post = (overrides: Record<string, unknown> = {}) => ({
  id: "post-1",
  updated: "rev-1",
  workspace_revision: 0,
  archived: false,
  dealer: "dealer-1",
  salesperson_id: "person-1",
  owner_person_id: "person-1",
  attribution_authoritative: true,
  generated_at: "2026-09-30 12:00:00.000Z",
  scenario_id: "customer_delivery",
  creative_image_url: "/api/app/posts/post-1/creative",
  caption: "A fresh arrival, ready for its next adventure.",
  approval_status: "n_a",
  share_summary: null,
  ...overrides,
});
const history = (overrides: Record<string, unknown> = {}) => ({
  dealer: { id: "dealer-1" },
  role: "salesperson",
  identityGrounding: {},
  filtered: [post()],
  items: [post()],
  loading: false,
  loadingMore: false,
  error: null,
  nextCursor: null,
  load: vi.fn(),
  openingId: null,
  websiteRetryingId: null,
  retryWebsite: vi.fn(),
  openCreative: mocks.open,
  query: "",
  setQuery: vi.fn(),
  statusFilter: "all",
  setStatusFilter: vi.fn(),
  total: 1,
  mediaFilter: "any",
  setMediaFilter: vi.fn(),
  websiteStatus: "all",
  setWebsiteStatus: vi.fn(),
  archived: "active",
  setArchived: vi.fn(),
  ownerPersonId: "",
  setOwnerPersonId: vi.fn(),
  sort: "newest_updated",
  setSort: vi.fn(),
  since: undefined,
  setSince: vi.fn(),
  setUntil: vi.fn(),
  ...overrides,
});
const renderWork = () =>
  render(<MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />);
const inspect = async (name = "Inspect Delivery") => {
  fireEvent.click(screen.getByRole("button", { name }));
  await screen.findByRole("button", { name: "View saved photo" });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.mockReturnValue({
    authEpoch: 1,
    currentDealer: { id: "dealer-1", name: "Northstar" },
    currentPerson: { id: "person-1", name: "Joe" },
    role: "salesperson",
  });
  mocks.history.mockReturnValue(history());
  mocks.detail.mockResolvedValue(post());
  mocks.fetchCreative.mockResolvedValue("data:image/jpeg;base64,ready");
  mocks.archive.mockResolvedValue({
    results: [
      {
        id: "post-1",
        ok: true,
        receipt: {
          id: "post-1",
          archived: true,
          post_revision: "rev-1",
          workspace_revision: 1,
        },
      },
    ],
  });
  mocks.restore.mockResolvedValue({
    results: [
      {
        id: "post-1",
        ok: true,
        receipt: {
          id: "post-1",
          archived: false,
          post_revision: "rev-1",
          workspace_revision: 2,
        },
      },
    ],
  });
  mocks.approval.mockResolvedValue(undefined);
  mocks.device.mockReturnValue({
    records: [],
    reload: vi.fn().mockResolvedValue(undefined),
    previews: [],
    remove: vi.fn(),
    save: vi.fn(),
    toDataUrl: vi.fn(),
  });
});

describe("Content workspace", () => {
  it("keeps keyboard focus inside mobile details and returns it to the inspected row", async () => {
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 760px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      renderWork();
      const trigger = screen.getByRole("button", { name: "Inspect Delivery" });
      await inspect();
      const surface = screen.getByRole("dialog", { name: "Content details" });
      const back = within(surface).getByRole("button", { name: "Back to results" });
      const archive = within(surface).getByRole("button", { name: "Archive post" });
      expect(back).toHaveFocus();
      archive.focus();
      fireEvent.keyDown(archive, { key: "Tab" });
      expect(back).toHaveFocus();
      fireEvent.click(back);
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(document.body.style.overflow).not.toBe("hidden");
    } finally {
      media.mockRestore();
    }
  });
  it("shows authoritative totals and opens the inspector without selecting a bulk checkbox", async () => {
    mocks.history.mockReturnValue(history({ total: 142 }));
    renderWork();
    expect(screen.getByRole("heading", { name: "My work" })).toBeVisible();
    expect(screen.getByText("142 posts")).toBeVisible();
    await inspect();
    expect(
      screen.getByRole("checkbox", { name: "Select Delivery for bulk actions" }),
    ).not.toBeChecked();
    expect(mocks.detail).toHaveBeenCalledWith("post-1", {});
    fireEvent.click(screen.getByRole("button", { name: "Open post" }));
    expect(mocks.open).toHaveBeenCalledWith(post());
  });
  it("binds server search and media/archive filters instead of filtering loaded results", () => {
    const h = history();
    mocks.history.mockReturnValue(h);
    renderWork();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search saved posts" }), {
      target: { value: "truck" },
    });
    expect(h.setQuery).toHaveBeenCalledWith("truck");
    fireEvent.change(screen.getByRole("combobox", { name: "Media type" }), {
      target: { value: "video_generated" },
    });
    expect(h.setMediaFilter).toHaveBeenCalledWith("video_generated");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(h.setArchived).toHaveBeenCalledWith("archived");
  });
  it("binds the website filter and clears it with the other server filters", () => {
    const h = history({ websiteStatus: "failed" });
    mocks.history.mockReturnValue(h);
    renderWork();
    screen.getByText("More filters and actions").closest("details")!.open = true;
    fireEvent.change(screen.getByRole("combobox", { name: "Website status" }), {
      target: { value: "draft_ready" },
    });
    expect(h.setWebsiteStatus).toHaveBeenCalledWith("draft_ready");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(h.setWebsiteStatus).toHaveBeenCalledWith("all");
    expect(screen.getByRole("button", { name: "Export loaded results" })).toBeEnabled();
    expect(screen.getByText(/Metadata for 1 loaded posts only/)).toBeVisible();
  });
  it("exports only safe loaded metadata and escapes spreadsheet formulas", () => {
    const csv = loadedPostMetadataCsv(
      [
        post({
          salesperson_name: '  =HYPERLINK("https://example.invalid")',
          customer_name: "Private Customer",
          vin: "private-vin",
          caption: "PRIVATE CAPTION",
          image_review_required: true,
          creative_image_url: "/private-image-url",
          website_publication: {
            status: "published",
            reviewUrl: "https://private-review.invalid",
          },
        }) as PostRecord,
      ],
      {},
    );
    expect(csv).toContain("Held for safety review");
    expect(csv).toContain("Withheld for safety review");
    expect(csv).toContain("\"'  =HYPERLINK");
    expect(csv).not.toMatch(
      /Private Customer|private-vin|PRIVATE CAPTION|private-image-url|private-review/,
    );
    expect(csv.split("\n")).toHaveLength(2);
  });
  it("preserves share-sheet wording without claiming social publication", () => {
    const p = post({
      share_summary: {
        count: 2,
        last_via: "copy",
        last_channel: "instagram_feed",
        sheet_count: 1,
        last_sheet_channel: "facebook_feed",
        last_sheet_at: "2026-10-05 15:00:00.000Z",
      },
    });
    mocks.history.mockReturnValue(history({ filtered: [p], items: [p] }));
    renderWork();
    expect(
      screen.getByText(/Shared · Facebook · sent to the share sheet/),
    ).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Saved posts" })).queryByText(
        /published|Shared to/i,
      ),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["download", "Downloaded for LinkedIn"],
    ["copy", "Caption copied"],
  ])("labels %s as its actual recorded action", (via, label) => {
    const p = post({
      share_summary: {
        count: 1,
        last_via: via,
        last_channel: "linkedin",
        sheet_count: 0,
      },
    });
    mocks.history.mockReturnValue(history({ filtered: [p], items: [p] }));
    renderWork();
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText(/^Shared/)).not.toBeInTheDocument();
  });
  it("does not expose quarantined image or caption, including through detail fetch", async () => {
    const held = post({
      image_review_required: true,
      caption: "WITHHELD_PRIVATE_COPY",
    });
    mocks.history.mockReturnValue(history({ filtered: [held], items: [held] }));
    mocks.detail.mockResolvedValue(held);
    renderWork();
    expect(screen.queryByText("WITHHELD_PRIVATE_COPY")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Delivery" }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());
    expect(mocks.fetchCreative).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open post" })).not.toBeInTheDocument();
    expect(screen.queryByText("WITHHELD_PRIVATE_COPY")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("withholds client-detected unsafe copy even without a server quarantine flag", () => {
    const p = post({
      identity_review_required: true,
      caption: "WITHHELD_PRIVATE_COPY",
    });
    mocks.history.mockReturnValue(history({ filtered: [p], items: [p] }));
    renderWork();
    expect(screen.queryByText("WITHHELD_PRIVATE_COPY")).not.toBeInTheDocument();
    expect(screen.getByText("Held for safety review")).toBeVisible();
  });
  it("explains historical video unavailability and does not render a video player", async () => {
    const p = post({ has_video: true });
    mocks.detail.mockResolvedValue(p);
    mocks.history.mockReturnValue(history({ filtered: [p], items: [p] }));
    const view = renderWork();
    await inspect();
    expect(screen.getByText(/Video generated — saved clip unavailable/)).toBeVisible();
    expect(view.container.querySelector("video")).toBeNull();
  });
  it("confirms archive and submits both CAS revisions for explicit selected IDs", async () => {
    renderWork();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Delivery for bulk actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    const dialog = screen.getByRole("dialog", { name: "Archive 1 post?" });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText(/does not remove content already shared or published/),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive posts" }));
    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith([
        { id: "post-1", expectedPostRevision: "rev-1", expectedWorkspaceRevision: 0 },
      ]),
    );
    expect(await screen.findByText("1 archived.")).toBeVisible();
  });
  it("keeps failed selected items on partial bulk failure", async () => {
    const second = post({ id: "post-2", scenario_id: "model_year_end" });
    mocks.history.mockReturnValue(
      history({ filtered: [post(), second], items: [post(), second], total: 2 }),
    );
    mocks.archive.mockResolvedValue({
      results: [
        { id: "post-1", ok: true, receipt: { id: "post-1", archived: true } },
        {
          id: "post-2",
          ok: false,
          status: 409,
          code: "revision_conflict",
          message: "Post changed. Reload before trying again.",
        },
      ],
    });
    renderWork();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select up to 50 loaded posts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive posts" }));
    expect(
      await screen.findByText("1 archived · 1 couldn’t be archived."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Select Promotion for bulk actions" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Delivery for bulk actions" }),
    ).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Post changed");
  });
  it("restores archived posts without turning restore into approval", async () => {
    const p = post({ archived: true });
    mocks.history.mockReturnValue(
      history({ archived: "archived", filtered: [p], items: [p] }),
    );
    renderWork();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Delivery for bulk actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore posts" }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalled());
    expect(mocks.approval).not.toHaveBeenCalled();
  });
  it("does not offer archive when either revision is missing", () => {
    const p = post({ workspace_revision: undefined });
    mocks.history.mockReturnValue(history({ filtered: [p], items: [p] }));
    renderWork();
    expect(
      screen.getByRole("checkbox", { name: "Select Delivery for bulk actions" }),
    ).toBeDisabled();
  });
  it("does not claim empty results after a failed request and can retry", () => {
    const h = history({ filtered: [], items: [], error: "Could not load your posts." });
    mocks.history.mockReturnValue(h);
    renderWork();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your posts.");
    expect(screen.queryByText("No posts yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.load).toHaveBeenCalled();
  });
  it("ignores a detail response after the authenticated session changes", async () => {
    let finish!: (value: ReturnType<typeof post>) => void;
    mocks.detail.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = renderWork();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Delivery" }));
    mocks.store.mockReturnValue({
      authEpoch: 2,
      currentDealer: { id: "dealer-2" },
      currentPerson: { id: "person-2" },
      role: "salesperson",
    });
    await act(async () => finish(post()));
    expect(mocks.fetchCreative).not.toHaveBeenCalled();
    view.unmount();
  });
  it("defaults managers to pending review and uses the current detail revision for decisions", async () => {
    mocks.store.mockReturnValue({
      authEpoch: 1,
      currentDealer: { id: "dealer-1" },
      currentPerson: { id: "manager-1", name: "Dana" },
      role: "dealer_admin",
    });
    const pending = post({
      approval_status: "pending",
      salesperson_name: "Avery",
      updated: "detail-rev",
    });
    mocks.detail.mockResolvedValue(pending);
    const h = history({ filtered: [pending], items: [pending] });
    mocks.history.mockReturnValue(h);
    render(<ContentWorkspace mode="manager" />);
    expect(h.setStatusFilter).toHaveBeenCalledWith("pending");
    expect(h.setSort).toHaveBeenCalledWith("oldest_created");
    await inspect("Inspect Delivery by Avery");
    expect(screen.queryByRole("button", { name: "Open post" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mocks.approval).toHaveBeenCalledWith(
        "post-1",
        "approved",
        "Dana",
        undefined,
        "detail-rev",
      ),
    );
  });
  it("requires a changes note before sending a rejection", async () => {
    mocks.store.mockReturnValue({
      authEpoch: 1,
      currentDealer: { id: "dealer-1" },
      currentPerson: { id: "manager-1", name: "Dana" },
      role: "dealer_admin",
    });
    mocks.detail.mockResolvedValue(post({ approval_status: "pending" }));
    render(<ContentWorkspace mode="manager" />);
    await inspect("Inspect Delivery by Creator unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const dialog = screen.getByRole("dialog", { name: "Request changes" });
    const send = within(dialog).getByRole("button", { name: "Send changes request" });
    expect(send).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "What should change?" }),
      { target: { value: "Use the correct inventory photo." } },
    );
    fireEvent.click(send);
    await waitFor(() =>
      expect(mocks.approval).toHaveBeenCalledWith(
        "post-1",
        "rejected",
        "Dana",
        "Use the correct inventory photo.",
        "rev-1",
      ),
    );
  });
  it("uses collection buttons as genuine navigation callbacks", () => {
    const spins = vi.fn();
    const walkarounds = vi.fn();
    render(<ContentWorkspace onOpenSpins={spins} onOpenWalkarounds={walkarounds} />);
    fireEvent.click(screen.getByRole("button", { name: "360 spins" }));
    fireEvent.click(screen.getByRole("button", { name: "Walkaround studio" }));
    expect(spins).toHaveBeenCalledOnce();
    expect(walkarounds).toHaveBeenCalledOnce();
  });
  it("waits for the device read before declaring the recovery collection empty", async () => {
    let finish: () => void = () => {};
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.device.mockReturnValue({
      records: [],
      previews: [],
      reload,
      remove: vi.fn(),
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: "On this device" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking recovery copies on this device",
    );
    expect(
      screen.queryByRole("heading", {
        name: "No recovery copies available on this device",
      }),
    ).not.toBeInTheDocument();
    await act(async () => finish());
    expect(
      screen.getByRole("heading", {
        name: "No recovery copies available on this device",
      }),
    ).toBeVisible();
  });
  it("offers a retry if the explicit device collection read fails", async () => {
    const reload = vi
      .fn()
      .mockRejectedValueOnce(new Error("local read failed"))
      .mockResolvedValue(undefined);
    mocks.device.mockReturnValue({
      records: [],
      previews: [],
      reload,
      remove: vi.fn(),
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: "On this device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read recovery copies",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", {
        name: "No recovery copies available on this device",
      }),
    ).toBeVisible();
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("keeps recovery-media deletion confirmation available in its device collection", () => {
    const record = {
      id: "media-1",
      kind: "generated-image",
      createdAt: Date.now(),
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
    };
    mocks.device.mockReturnValue({
      records: [record],
      reload: vi.fn().mockResolvedValue(undefined),
      previews: [{ record, url: "blob:preview" }],
      remove: vi.fn(),
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: "On this device" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete post image from/ }));
    expect(screen.getByRole("dialog", { name: "Delete recovery copy" })).toBeVisible();
  });
});

describe("Content inspector website publication", () => {
  const failed = () =>
    post({
      website_publication: { status: "failed", lastError: "Transport unavailable" },
    });
  const publish = (
    publication: { status: string; lastError?: string; reviewUrl?: string },
    id = "post-1",
  ) => {
    const options = mocks.history.mock.calls.at(-1)![0];
    act(() => options.onWebsitePublication(id, publication));
  };

  it("updates failed to queued to ready without replacing private detail or needing a listed post", async () => {
    mocks.detail.mockResolvedValue(failed());
    const h = history({ filtered: [failed()], items: [failed()] });
    mocks.history.mockReturnValue(h);
    const view = renderWork();
    await inspect();
    fireEvent.click(screen.getByRole("button", { name: "Retry website draft" }));
    expect(h.retryWebsite).toHaveBeenCalledWith(failed());
    publish({ status: "queued", lastError: "" });
    expect(
      screen.queryByRole("button", { name: "Retry website draft" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Content details")).toHaveTextContent(
      "A fresh arrival, ready for its next adventure.",
    );
    mocks.history.mockReturnValue({ ...h, filtered: [], items: [] });
    view.rerender(
      <MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />,
    );
    publish({ status: "draft_ready" });
    expect(screen.getByLabelText("Content details")).toHaveTextContent(
      "Website draft · Ready for review",
    );
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    publish({ status: "failed", lastError: "Unrelated post" }, "post-2");
    expect(screen.getByLabelText("Content details")).toHaveTextContent(
      "Website draft · Ready for review",
    );
  });

  it("keeps the newer publication when a detail response started before the retry completes", async () => {
    let finish!: (post: unknown) => void;
    mocks.detail.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Delivery" }));
    publish({ status: "draft_ready" });
    await act(async () => finish(failed()));
    expect(screen.getByLabelText("Content details")).toHaveTextContent(
      "Website draft · Ready for review",
    );
    expect(
      screen.queryByRole("button", { name: "Retry website draft" }),
    ).not.toBeInTheDocument();
  });

  it("allows a manager to retry a teammate's draft independently of reopening it", async () => {
    mocks.store.mockReturnValue({
      authEpoch: 1,
      currentDealer: { id: "dealer-1" },
      currentPerson: { id: "manager-1" },
      role: "dealer_admin",
    });
    mocks.history.mockReturnValue(history({ filtered: [failed()], items: [failed()] }));
    mocks.detail.mockResolvedValue(failed());
    render(<ContentWorkspace mode="manager" />);
    await inspect("Inspect Delivery by Creator unavailable");
    expect(screen.queryByRole("button", { name: "Open post" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry website draft" })).toBeEnabled();
  });

  it.each([
    { archived: true },
    { dealer: "other-dealer" },
    { owner_person_id: "other-person" },
  ])(
    "blocks retry when detail is outside allowed active ownership: %s",
    async (overrides) => {
      mocks.detail.mockResolvedValue({ ...failed(), ...overrides });
      renderWork();
      await inspect();
      expect(
        screen.getByRole("button", { name: "Retry website draft" }),
      ).toBeDisabled();
    },
  );

  it("positions the mobile inspector below the measured header and follows chrome changes", async () => {
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 760px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      render(
        <div>
          <header aria-label="Application header" />
          <MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />
        </div>,
      );
      const header = screen.getByLabelText("Application header");
      const bounds = vi
        .spyOn(header, "getBoundingClientRect")
        .mockReturnValue({ bottom: 151 } as DOMRect);
      await inspect();
      const surface = screen.getByRole("dialog", { name: "Content details" });
      expect(surface.style.getPropertyValue("--cw-header-bottom")).toBe("151px");
      bounds.mockReturnValue({ bottom: 184 } as DOMRect);
      fireEvent(window, new Event("resize"));
      expect(surface.style.getPropertyValue("--cw-header-bottom")).toBe("184px");
    } finally {
      media.mockRestore();
    }
  });
});

describe("Content workspace requested changes", () => {
  it("shows the full reason as the inspection description in list and grid", () => {
    const reason = "Remove the price and use the correct inventory photo. "
      .repeat(4)
      .trim();
    const rejected = post({ approval_status: "rejected", rejection_reason: reason });
    mocks.history.mockReturnValue(history({ filtered: [rejected], items: [rejected] }));
    renderWork();
    const assertReason = () => {
      const inspectButton = screen.getByRole("button", { name: "Inspect Delivery" });
      expect(inspectButton).toHaveAccessibleDescription(reason);
      const visibleReason = within(inspectButton).getByText(reason);
      expect(visibleReason).toBeVisible();
      expect(visibleReason).toHaveClass("cw-row-reason");
      expect(visibleReason).toHaveAttribute("title", reason);
    };
    assertReason();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    assertReason();
  });

  it("withholds a rejected reason when the post is held for safety review", async () => {
    const reason = "PRIVATE requested changes";
    const rejected = post({
      approval_status: "rejected",
      rejection_reason: reason,
      image_review_required: true,
    });
    mocks.history.mockReturnValue(history({ filtered: [rejected], items: [rejected] }));
    mocks.detail.mockResolvedValue(rejected);
    renderWork();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect Delivery" }),
    ).not.toHaveAttribute("aria-describedby");
    fireEvent.click(screen.getByRole("button", { name: "Inspect Delivery" }));
    // The details label is mounted while getPostDetail is still loading, and
    // the list row already says the caption is withheld. Wait for the
    // inspector-only held copy, which renders only after the detail arrives.
    await screen.findByText(/Create a corrected post before sharing it/);
    expect(screen.getByLabelText("Content details")).not.toHaveTextContent(reason);
  });
});
