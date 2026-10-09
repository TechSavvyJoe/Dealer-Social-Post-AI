import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWork } from "../components/MyWork";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  device: vi.fn(),
  store: vi.fn(),
  fetchCreative: vi.fn(),
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
}));
const post = (overrides: Record<string, unknown> = {}) => ({
  id: "post-1",
  dealer: "dealer-1",
  generated_at: "2026-09-30 12:00:00.000Z",
  scenario_id: "customer_delivery",
  creative_image_url: "data:image/jpeg;base64,abc",
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
  query: "",
  setQuery: vi.fn(),
  statusFilter: "all",
  setStatusFilter: vi.fn(),
  ...overrides,
});

const showPosts = (...posts: ReturnType<typeof post>[]) =>
  mocks.history.mockReturnValue(history({ filtered: posts, items: posts }));

const renderWork = (onOpenPost = vi.fn()) =>
  render(<MyWork onBack={vi.fn()} onOpenPost={onOpenPost} onReusePhoto={vi.fn()} />);

const at = "2026-10-05 15:00:00.000Z";

describe("MyWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCreative.mockResolvedValue("data:image/jpeg;base64,ready");
    mocks.store.mockReturnValue({
      authEpoch: 1,
      currentDealer: { id: "dealer-1", name: "Northstar" },
      currentPerson: { id: "person-1" },
      role: "salesperson",
    });
    mocks.history.mockReturnValue(history());
    mocks.device.mockReturnValue({
      records: [],
      previews: [],
      remove: vi.fn(),
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
  });

  it("shows category, thumbnail, and an honest draft status", () => {
    renderWork();
    expect(screen.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
    expect(screen.getByText("Delivery")).toBeVisible();
    expect(screen.getByText("Draft")).toBeVisible();
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,abc",
    );
    expect(screen.queryByText(/studio/i)).not.toBeInTheDocument();
  });

  it("shows share-sheet status without claiming destination publication", () => {
    showPosts(
      post({
        share_summary: {
          count: 1,
          last_shared_at: at,
          last_channel: "facebook_feed",
          last_via: "share_sheet",
          channels: ["facebook_feed"],
          sheet_count: 1,
          last_sheet_channel: "facebook_feed",
          last_sheet_at: at,
        },
      }),
    );
    renderWork();
    expect(screen.getByText("Shared · Facebook")).toBeVisible();
    expect(screen.getByText("sent to the share sheet")).toBeVisible();
    expect(screen.queryByText(/published|Shared to/i)).not.toBeInTheDocument();
  });

  it("names a download for its channel and never calls it shared", () => {
    showPosts(
      post({
        share_summary: {
          count: 1,
          last_shared_at: at,
          last_channel: "facebook_feed",
          last_via: "download",
          channels: ["facebook_feed"],
          sheet_count: 0,
          last_sheet_channel: "",
          last_sheet_at: "",
        },
      }),
    );
    renderWork();
    expect(screen.getByText("Downloaded for Facebook")).toBeVisible();
    expect(screen.queryByText(/^Shared/)).not.toBeInTheDocument();
    expect(screen.queryByText("sent to the share sheet")).not.toBeInTheDocument();
  });

  it("names a copied caption and never calls it shared", () => {
    showPosts(
      post({
        share_summary: {
          count: 1,
          last_shared_at: at,
          last_channel: "facebook_feed",
          last_via: "copy",
          channels: ["facebook_feed"],
          sheet_count: 0,
          last_sheet_channel: "",
          last_sheet_at: "",
        },
      }),
    );
    renderWork();
    expect(screen.getByText("Caption copied")).toBeVisible();
    expect(screen.queryByText(/^Shared/)).not.toBeInTheDocument();
    expect(screen.queryByText("sent to the share sheet")).not.toBeInTheDocument();
  });

  it("keeps an earlier share sheet after a later caption copy, on its own channel", () => {
    showPosts(
      post({
        share_summary: {
          count: 2,
          last_shared_at: "2026-10-05 16:00:00.000Z",
          last_channel: "instagram_feed",
          last_via: "copy",
          channels: ["instagram_feed", "facebook_feed"],
          sheet_count: 1,
          last_sheet_channel: "facebook_feed",
          last_sheet_at: at,
        },
      }),
    );
    renderWork();
    expect(screen.getByText("Shared · Facebook")).toBeVisible();
    expect(screen.getByText("sent to the share sheet")).toBeVisible();
    expect(screen.queryByText("Caption copied")).not.toBeInTheDocument();
  });

  it("names a Team post shared to LinkedIn and a Service post shared to Google", () => {
    const sheet = (channel: string) => ({
      count: 1,
      last_shared_at: at,
      last_channel: channel,
      last_via: "share_sheet",
      channels: [channel],
      sheet_count: 1,
      last_sheet_channel: channel,
      last_sheet_at: at,
    });
    showPosts(
      post({
        id: "post-team",
        scenario_id: "team_anniversary",
        share_summary: sheet("linkedin"),
      }),
      post({
        id: "post-service",
        scenario_id: "service_promotion",
        share_summary: sheet("gbp"),
      }),
    );
    renderWork();
    expect(screen.getByText("Team")).toBeVisible();
    expect(screen.getByText("Shared · LinkedIn")).toBeVisible();
    expect(screen.getByText("Service")).toBeVisible();
    expect(screen.getByText("Shared · Google")).toBeVisible();
    expect(screen.queryByText("Shared · Facebook")).not.toBeInTheDocument();
  });

  it("names a Promotion and a Community post instead of a bare Post", () => {
    showPosts(
      post({ id: "post-promo", scenario_id: "model_year_end" }),
      post({ id: "post-community", scenario_id: "community_event" }),
    );
    renderWork();
    expect(screen.getByText("Promotion")).toBeVisible();
    expect(screen.getByText("Community")).toBeVisible();
  });

  it("tells a screen reader whose post each Team work row is", () => {
    mocks.store.mockReturnValue({
      authEpoch: 1,
      currentDealer: { id: "dealer-1", name: "Northstar" },
      currentPerson: { id: "manager-1" },
      role: "manager",
    });
    showPosts(post({ salesperson_name: "Dana Ortiz" }));
    renderWork();
    expect(screen.getByRole("heading", { level: 1, name: "Team work" })).toBeVisible();
    expect(screen.getByText("Dana Ortiz")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open Delivery" }),
    ).toHaveAccessibleDescription(/Dana Ortiz.*Draft/);
  });

  it("does not name the salesperson on their own My work rows", () => {
    showPosts(post({ salesperson_name: "Dana Ortiz" }));
    renderWork();
    expect(screen.queryByText("Dana Ortiz")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Delivery" }),
    ).not.toHaveAccessibleDescription(/Dana Ortiz/);
  });

  it("does not claim an empty list after a failed load, and Try again reloads", () => {
    const load = vi.fn();
    mocks.history.mockReturnValue(
      history({
        filtered: [],
        items: [],
        error: "Could not load your posts.",
        load,
      }),
    );
    renderWork();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your posts.");
    expect(screen.queryByText("No posts yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows an honest empty state that points to Home", () => {
    showPosts();
    renderWork();
    expect(screen.getByText("No posts yet")).toBeVisible();
    expect(
      screen.getByText("Pick a category on Home to make your first post."),
    ).toBeVisible();
  });

  it("holds a quarantined post without offering to open it", () => {
    showPosts(post({ image_review_required: true }));
    renderWork();
    expect(screen.getByText("Held for safety review")).toBeVisible();
    expect(screen.getByText("This post can't be reopened.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Open/ })).not.toBeInTheDocument();
    expect(screen.queryByAltText("")).not.toBeInTheDocument();
  });

  it("shows a recoverable open error and retries the same post", async () => {
    mocks.fetchCreative.mockRejectedValueOnce(new Error("Network request failed"));
    const onOpenPost = vi.fn();
    renderWork(onOpenPost);
    fireEvent.click(screen.getByRole("button", { name: "Open Delivery" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onOpenPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onOpenPost).toHaveBeenCalledTimes(1));
  });

  it("does not reopen a post after leaving My work during its image load", async () => {
    let finish!: (image: string) => void;
    mocks.fetchCreative.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const onOpenPost = vi.fn();
    const view = renderWork(onOpenPost);
    fireEvent.click(screen.getByRole("button", { name: "Open Delivery" }));
    view.unmount();
    await act(async () => finish("data:image/jpeg;base64,ready"));
    expect(onOpenPost).not.toHaveBeenCalled();
  });

  it("asks for confirmation before deleting device recovery media", () => {
    const remove = vi.fn();
    const record = {
      id: "media-1",
      kind: "generated-image",
      createdAt: Date.now(),
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
    };
    mocks.device.mockReturnValue({
      records: [record],
      previews: [{ record, url: "blob:preview" }],
      remove,
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
    renderWork();
    fireEvent.click(screen.getByRole("button", { name: /^Delete post image from/ }));
    expect(screen.getByRole("dialog", { name: "Delete recovery copy" })).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
  });
});
