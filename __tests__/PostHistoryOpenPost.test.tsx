import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostHistory } from "../components/PostHistory";

const hook = vi.hoisted(() => ({ options: [] as unknown[] }));

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
    };
  },
}));

describe("PostHistory reopen handler", () => {
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
});
