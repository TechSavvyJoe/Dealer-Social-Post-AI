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
  generated_at: "2026-09-30T12:00:00.000Z",
  scenario_id: "delivery",
  creative_image_url: "data:image/jpeg;base64,abc",
  approval_status: "n_a",
  share_summary: null,
  ...overrides,
});

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
    mocks.history.mockReturnValue({
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
    });
    mocks.device.mockReturnValue({
      records: [],
      previews: [],
      remove: vi.fn(),
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
  });

  it("shows category, date, thumbnail, and an honest draft status", () => {
    render(<MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "My work" })).toBeVisible();
    expect(screen.getByText("Delivery")).toBeVisible();
    expect(screen.getByText("Draft")).toBeVisible();
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,abc",
    );
  });

  it("shows share-sheet status without claiming destination publication", () => {
    mocks.history.mockReturnValueOnce({
      ...mocks.history(),
      filtered: [
        post({
          share_summary: {
            count: 1,
            last_channel: "facebook_feed",
            last_via: "share_sheet",
          },
        }),
      ],
      items: [
        post({
          share_summary: {
            count: 1,
            last_channel: "facebook_feed",
            last_via: "share_sheet",
          },
        }),
      ],
    });
    render(<MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />);
    expect(screen.getByText("Shared · Facebook")).toBeVisible();
    expect(screen.getByText("sent to the share sheet")).toBeVisible();
    expect(screen.queryByText(/published/i)).not.toBeInTheDocument();
  });

  it("shows a recoverable load error and retries the same post", async () => {
    mocks.fetchCreative.mockRejectedValueOnce(new Error("Network request failed"));
    const onOpenPost = vi.fn();
    render(<MyWork onBack={vi.fn()} onOpenPost={onOpenPost} onReusePhoto={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Delivery" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onOpenPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Try again|Retry/ }));
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
    const view = render(
      <MyWork onBack={vi.fn()} onOpenPost={onOpenPost} onReusePhoto={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Delivery" }));
    view.unmount();
    await act(async () => finish("data:image/jpeg;base64,ready"));
    expect(onOpenPost).not.toHaveBeenCalled();
  });

  it("asks for confirmation before deleting device recovery media", () => {
    const remove = vi.fn();
    mocks.device.mockReturnValue({
      records: [
        {
          id: "media-1",
          kind: "generated-image",
          createdAt: Date.now(),
          blob: new Blob(["x"], { type: "image/jpeg" }),
          previewBlob: new Blob(["x"], { type: "image/jpeg" }),
          mimeType: "image/jpeg",
        },
      ],
      previews: [
        {
          record: {
            id: "media-1",
            kind: "generated-image",
            createdAt: Date.now(),
            blob: new Blob(["x"]),
            mimeType: "image/jpeg",
          },
          url: "blob:preview",
        },
      ],
      remove,
      save: vi.fn(),
      toDataUrl: vi.fn(),
    });
    render(<MyWork onBack={vi.fn()} onOpenPost={vi.fn()} onReusePhoto={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete recovery copy" }));
    expect(screen.getByRole("dialog", { name: "Delete recovery copy" })).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
  });
});
