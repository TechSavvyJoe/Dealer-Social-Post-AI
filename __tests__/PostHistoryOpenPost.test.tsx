import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHistory } from "../components/PostHistory";

const hook = vi.hoisted(() => ({
  options: [] as unknown[],
  state: {} as Record<string, unknown>,
}));

// Only the wiring is under test: what PostHistory hands its list hook.
vi.mock("../hooks/usePostHistoryList", () => ({
  usePostHistoryList: (options: unknown) => {
    hook.options.push(options);
    return {
      dealer: null,
      role: "dealer_admin",
      identityGrounding: {},
      items: [],
      filtered: [],
      loading: false,
      loadingMore: false,
      error: null,
      nextCursor: null,
      query: "",
      setQuery: vi.fn(),
      statusFilter: "all",
      setStatusFilter: vi.fn(),
      openingId: null,
      websiteRetryingId: null,
      load: vi.fn(),
      openCreative: vi.fn(),
      retryWebsite: vi.fn(),
      ...hook.state,
    };
  },
}));

describe("PostHistory reopen handler", () => {
  beforeEach(() => {
    hook.state = {};
  });
  it("hands its onPostReady to the list hook, so the caller opens the post", () => {
    const onPostReady = vi.fn();
    const onOpenCreative = vi.fn();
    render(<PostHistory onPostReady={onPostReady} onOpenCreative={onOpenCreative} />);
    expect(hook.options.at(-1)).toEqual({ onOpenCreative, onPostReady });
  });

  it("passes no handler when it has none, so the store opens the post as before", () => {
    render(<PostHistory />);
    expect(hook.options.at(-1)).toEqual({
      onOpenCreative: undefined,
      onPostReady: undefined,
    });
  });

  it("keeps older posts reachable when the loaded page has no search matches", () => {
    const load = vi.fn();
    hook.state = {
      items: [{ id: "newer-post" }],
      filtered: [],
      query: "older VIN",
      nextCursor: "older-cursor",
      load,
    };
    render(<PostHistory />);
    expect(screen.getByText(/Load older posts to search further/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load older posts" }));
    expect(load).toHaveBeenCalledWith("older-cursor");
  });

  it("does not describe a failed initial load as an empty archive", () => {
    hook.state = { error: "Could not load your posts." };
    render(<PostHistory />);
    expect(screen.getByText("Could not load your posts.")).toBeVisible();
    expect(screen.queryByText("No posts logged yet")).not.toBeInTheDocument();
  });
});
