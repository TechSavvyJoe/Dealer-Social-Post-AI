import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyWorkPreview } from "../components/home/MyWorkPreview";
import type { PostRecord, PostShareSummary } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import type { Dealer } from "../types";

const sharedAt = new Date(2026, 9, 5, 15, 12).toISOString();

const post = (overrides: Partial<PostRecord> = {}): PostRecord => ({
  id: "post-1",
  dealer: "dealer-1",
  generated_at: "2026-10-05 12:00:00.000Z",
  scenario_id: "customer_delivery",
  customer_name: "Maria",
  creative_image_url: "/api/app/posts/post-1/creative",
  approval_status: "n_a",
  share_summary: null,
  ...overrides,
});

const summary = (overrides: Partial<PostShareSummary>): PostShareSummary => ({
  count: 1,
  last_shared_at: sharedAt,
  last_channel: "facebook_feed",
  last_via: "share_sheet",
  channels: ["facebook_feed"],
  sheet_count: 1,
  last_sheet_channel: "facebook_feed",
  last_sheet_at: sharedAt,
  ...overrides,
});

const renderPreview = (
  props: Partial<React.ComponentProps<typeof MyWorkPreview>> = {},
) => {
  const handlers = { onSeeAll: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn() };
  render(
    <MyWorkPreview
      posts={[post()]}
      loading={false}
      error={null}
      openingId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe("MyWorkPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 18, 0));
    useAppStore.setState({
      currentDealer: { id: "dealer-1", name: "Northline Motors" } as Dealer,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a plain My work header with See all and no studio eyebrow", () => {
    const { onSeeAll } = renderPreview();
    expect(screen.getByRole("heading", { level: 2, name: "My work" })).toBeVisible();
    expect(screen.queryByText(/studio/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("says Shared · channel · time for a share sheet, never which app received it", () => {
    renderPreview({ posts: [post({ share_summary: summary({}) })] });
    expect(screen.getByText("Delivery · Maria")).toBeVisible();
    expect(screen.getByText(/^Shared · Facebook · Today, 3:12\sPM$/)).toBeVisible();
    expect(screen.queryByText(/Shared to/)).not.toBeInTheDocument();
  });

  it("names Google and LinkedIn shares instead of Facebook", () => {
    renderPreview({
      posts: [
        post({
          id: "post-gbp",
          scenario_id: "service_promotion",
          share_summary: summary({
            last_channel: "gbp",
            last_sheet_channel: "gbp",
            channels: ["gbp"],
          }),
        }),
        post({
          id: "post-linkedin",
          scenario_id: "team_anniversary",
          share_summary: summary({
            last_channel: "linkedin",
            last_sheet_channel: "linkedin",
            channels: ["linkedin"],
          }),
        }),
      ],
    });
    expect(screen.getByText(/^Shared · Google · Today/)).toBeVisible();
    expect(screen.getByText(/^Shared · LinkedIn · Today/)).toBeVisible();
    expect(screen.queryByText(/Facebook/)).not.toBeInTheDocument();
  });

  it("names a download and a copied caption for what they were", () => {
    renderPreview({
      posts: [
        post({
          id: "post-download",
          share_summary: summary({
            last_via: "download",
            sheet_count: 0,
            last_sheet_channel: "",
            last_sheet_at: "",
          }),
        }),
        post({
          id: "post-copy",
          share_summary: summary({
            last_via: "copy",
            sheet_count: 0,
            last_sheet_channel: "",
            last_sheet_at: "",
          }),
        }),
      ],
    });
    expect(screen.getByText("Downloaded for Facebook")).toBeVisible();
    expect(screen.getByText("Caption copied")).toBeVisible();
    expect(screen.queryByText(/^Shared/)).not.toBeInTheDocument();
  });

  it("labels every Home category and the store's custom scenarios", () => {
    useAppStore.setState({
      currentDealer: {
        id: "dealer-1",
        name: "Northline Motors",
        custom_scenarios: JSON.stringify([
          {
            id: "custom_oil",
            label: "Oil change week",
            category: "service",
            promptAdditions: "Oil change promotion.",
          },
        ]),
      } as Dealer,
    });
    renderPreview({
      posts: [
        post({ id: "a", scenario_id: "model_year_end", customer_name: undefined }),
        post({ id: "b", scenario_id: "community_event", customer_name: undefined }),
        post({ id: "c", scenario_id: "custom_oil", customer_name: undefined }),
      ],
    });
    expect(screen.getByText("Promotion")).toBeVisible();
    expect(screen.getByText("Community")).toBeVisible();
    expect(screen.getByText("Oil change week")).toBeVisible();
    expect(screen.queryByText("Post")).not.toBeInTheDocument();
  });

  it("holds a post the client's identity check rejects, exactly as My work does", () => {
    renderPreview({
      posts: [
        post({
          caption: "Congrats to Michelle on her new Bronco!",
          customer_name: "",
          release_required: true,
          share_summary: summary({}),
        }),
      ],
    });
    expect(screen.getByText("Held for safety review")).toBeVisible();
    expect(screen.queryByText(/^Shared/)).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("grounds that check in the store's own name", () => {
    useAppStore.setState({
      currentDealer: { id: "dealer-1", name: "Bob Maxey Ford of Howell" } as Dealer,
    });
    renderPreview({
      posts: [
        post({
          caption:
            "Maxey Ford has done it again — another vehicle delivered with a smile.",
          customer_name: "",
          release_required: true,
          share_summary: summary({}),
        }),
      ],
    });
    expect(screen.getByText(/^Shared · Facebook · Today/)).toBeVisible();
    expect(document.querySelector("img")).not.toBeNull();
  });

  it("shows the latest three and opens the one tapped", () => {
    const posts = ["a", "b", "c", "d"].map((id) =>
      post({ id, customer_name: `Customer ${id}` }),
    );
    const { onOpen } = renderPreview({ posts });
    expect(screen.getAllByRole("button", { name: /^Open Delivery/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Open Delivery, Customer b" }));
    expect(onOpen).toHaveBeenCalledWith(posts[1]);
  });

  it("offers a working Try again on error and no empty claim", () => {
    const { onRetry } = renderPreview({
      posts: [],
      error: "Could not load your posts.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your posts.");
    expect(screen.queryByText("No posts yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows an honest empty state", () => {
    renderPreview({ posts: [] });
    expect(screen.getByText("No posts yet")).toBeVisible();
    expect(
      screen.getByText("Choose a category to make your first post."),
    ).toBeVisible();
  });
});
