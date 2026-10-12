import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPostCreativeDataUrl: vi.fn(),
  listPostsPage: vi.fn(),
  getWebsitePublication: vi.fn(),
  listWebsiteDestinations: vi.fn(),
  retryWebsitePublication: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../services/posts", () => ({
  fetchPostCreativeDataUrl: mocks.fetchPostCreativeDataUrl,
  listPostsPage: mocks.listPostsPage,
}));

vi.mock("../services/websitePublishing", () => ({
  getWebsitePublication: mocks.getWebsitePublication,
  listWebsiteDestinations: mocks.listWebsiteDestinations,
  retryWebsitePublication: mocks.retryWebsitePublication,
  websitePublicationIsSettled: (status: string) =>
    ["draft_ready", "failed", "published", "withdrawn"].includes(status),
  websitePublicationPollDelay: () => 5000,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

import { usePostHistoryList } from "./usePostHistoryList";
import { useAppStore } from "../stores/appStore";

const page = (id: string) => ({ id, generated_at: "2026-10-12T12:00:00Z" });
const fiftyPosts = Array.from({ length: 50 }, (_, index) => page(`post-${index}`));

describe("usePostHistoryList server query and paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      currentDealer: { id: "dealer-1", name: "Northstar" } as never,
      currentPerson: { id: "person-1" } as never,
      role: "salesperson",
      authEpoch: 1,
    });
    mocks.listPostsPage.mockResolvedValue({ items: [], total: 0 });
    mocks.listWebsiteDestinations.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it("searches server-side beyond the first 50 posts and reports the matching total", async () => {
    mocks.listPostsPage
      .mockResolvedValueOnce({ items: fiftyPosts, nextCursor: "older-page", total: 51 })
      .mockResolvedValueOnce({ items: [page("older-match")], total: 1 });

    const { result } = renderHook(() => usePostHistoryList());
    await waitFor(() => expect(result.current.items).toHaveLength(50));

    act(() => result.current.setQuery("rare VIN"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    await waitFor(() => expect(result.current.items).toEqual([page("older-match")]));
    expect(mocks.listPostsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 50,
        q: "rare VIN",
        cursor: undefined,
        grounding: expect.objectContaining({ dealerName: "Northstar" }),
      }),
    );
    expect(result.current.total).toBe(1);
    expect(result.current.nextCursor).toBeNull();
  });

  it("keeps the loaded page intact when the active archive filter is reselected", async () => {
    mocks.listPostsPage.mockResolvedValue({ items: [page("active-post")], total: 1 });
    const { result } = renderHook(() => usePostHistoryList());
    await waitFor(() => expect(result.current.items).toEqual([page("active-post")]));

    act(() => result.current.setArchived("active"));

    expect(result.current.items).toEqual([page("active-post")]);
    expect(result.current.loading).toBe(false);
    expect(mocks.listPostsPage).toHaveBeenCalledTimes(1);

    act(() => result.current.setArchived("archived"));
    await waitFor(() => expect(mocks.listPostsPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setArchived("archived"));

    expect(result.current.items).toEqual([page("active-post")]);
    expect(result.current.loading).toBe(false);
    expect(mocks.listPostsPage).toHaveBeenCalledTimes(2);
  });

  it("drops an in-flight older-page response when a new query resets the cursor", async () => {
    let resolveOlder!: (response: unknown) => void;
    mocks.listPostsPage.mockImplementation(
      (options: { cursor?: string; q?: string }) => {
        if (options.cursor) {
          return new Promise((resolve) => {
            resolveOlder = resolve;
          });
        }
        if (options.q)
          return Promise.resolve({ items: [page("query-match")], total: 1 });
        return Promise.resolve({
          items: fiftyPosts,
          nextCursor: "older-page",
          total: 70,
        });
      },
    );

    const { result } = renderHook(() => usePostHistoryList());
    await waitFor(() => expect(result.current.nextCursor).toBe("older-page"));

    act(() => void result.current.load("older-page"));
    act(() => result.current.setQuery("new query"));
    await act(async () => {
      resolveOlder({ items: [page("stale-older-result")], total: 70 });
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    await waitFor(() => expect(result.current.items).toEqual([page("query-match")]));
    expect(result.current.items.some((item) => item.id === "stale-older-result")).toBe(
      false,
    );
    expect(mocks.listPostsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "new query", cursor: undefined }),
    );
  });

  it("reloads when a query is cleared before its debounce settles", async () => {
    mocks.listPostsPage.mockResolvedValue({ items: fiftyPosts, total: 50 });
    const { result } = renderHook(() => usePostHistoryList());
    await waitFor(() => expect(result.current.items).toHaveLength(50));

    act(() => result.current.setQuery("temporary"));
    act(() => result.current.setQuery(""));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    await waitFor(() => expect(result.current.items).toHaveLength(50));
    expect(mocks.listPostsPage).toHaveBeenCalledTimes(2);
    expect(mocks.listPostsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined, cursor: undefined }),
    );
  });

  it("does not publish the prior dealer's response after a dealership switch", async () => {
    let resolveDealerOne!: (response: unknown) => void;
    mocks.listPostsPage.mockImplementation(
      (options: { grounding?: { dealerName?: string } }) => {
        if (options.grounding?.dealerName === "Northstar") {
          return new Promise((resolve) => {
            resolveDealerOne = resolve;
          });
        }
        return Promise.resolve({ items: [page("dealer-two-post")], total: 1 });
      },
    );

    const { result } = renderHook(() => usePostHistoryList());
    act(() => {
      useAppStore.setState({
        currentDealer: { id: "dealer-2", name: "Lakeside" } as never,
        currentPerson: { id: "person-2" } as never,
      });
    });
    await waitFor(() =>
      expect(result.current.items).toEqual([page("dealer-two-post")]),
    );

    await act(async () => {
      resolveDealerOne({ items: [page("dealer-one-stale")], total: 1 });
      await Promise.resolve();
    });
    expect(result.current.items).toEqual([page("dealer-two-post")]);
  });

  it("clears the list and drops a pending response when the session logs out", async () => {
    let resolvePending!: (response: unknown) => void;
    mocks.listPostsPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    const { result } = renderHook(() => usePostHistoryList());
    act(() => {
      useAppStore.setState({
        currentDealer: null,
        currentPerson: null,
        authEpoch: 2,
      });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      resolvePending({ items: [page("signed-out-post")], total: 1 });
      await Promise.resolve();
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBeUndefined();
  });

  it.each(["dealership switch", "logout"])(
    "drops a website retry response and notifications after %s",
    async (change) => {
      const post = {
        ...page("website-post"),
        dealer: "dealer-1",
        website_publication: { status: "failed" },
      };
      mocks.listPostsPage.mockImplementation(
        (options: { grounding?: { dealerName?: string } }) =>
          Promise.resolve(
            options.grounding?.dealerName === "Northstar"
              ? { items: [post], total: 1 }
              : { items: [], total: 0 },
          ),
      );
      let resolveRetry!: (publication: unknown) => void;
      mocks.retryWebsitePublication.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );
      const onWebsitePublication = vi.fn();
      const { result } = renderHook(() => usePostHistoryList({ onWebsitePublication }));
      await waitFor(() => expect(result.current.items).toEqual([post]));
      const retry = result.current.retryWebsite(post as never);
      if (change === "logout") {
        act(() =>
          useAppStore.setState({
            currentDealer: null,
            currentPerson: null,
            authEpoch: 2,
          }),
        );
      } else {
        act(() =>
          useAppStore.setState({
            currentDealer: { id: "dealer-2", name: "Lakeside" } as never,
            currentPerson: { id: "person-2" } as never,
            authEpoch: 2,
          }),
        );
      }
      await act(async () => {
        resolveRetry({ status: "draft_ready", reviewUrl: "/private/review" });
        await retry;
      });

      expect(result.current.items).toEqual([]);
      expect(onWebsitePublication).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(result.current.websiteRetryingId).toBeNull();
    },
  );

  it("drops an in-flight website publication poll after logout", async () => {
    const post = {
      ...page("website-post"),
      dealer: "dealer-1",
      website_publication: { status: "failed" },
    };
    mocks.listPostsPage.mockResolvedValue({ items: [post], total: 1 });
    mocks.retryWebsitePublication.mockResolvedValue({ status: "queued" });
    let resolvePoll!: (publication: unknown) => void;
    mocks.getWebsitePublication.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const onWebsitePublication = vi.fn();
    const { result } = renderHook(() => usePostHistoryList({ onWebsitePublication }));
    await waitFor(() => expect(result.current.items).toEqual([post]));
    vi.useFakeTimers();
    await act(async () => {
      await result.current.retryWebsite(post as never);
    });
    expect(onWebsitePublication).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.getWebsitePublication).toHaveBeenCalledTimes(1);
    act(() =>
      useAppStore.setState({
        currentDealer: null,
        currentPerson: null,
        authEpoch: 2,
      }),
    );
    await act(async () => {
      resolvePoll({ status: "draft_ready", reviewUrl: "/private/review" });
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
    expect(onWebsitePublication).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
