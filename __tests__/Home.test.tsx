import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "../components/Home";
import { useAppStore } from "../stores/appStore";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));

vi.mock("../hooks/usePostHistoryList", () => ({
  usePostHistoryList: mocks.history,
}));

describe("Home", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    useAppStore.setState({
      currentDealer: { id: "dealer123456789", name: "Bob Maxey Ford" },
      currentPerson: null,
      pendingPhoto: null,
    });
    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: null,
      openingId: null,
      load: vi.fn(),
      openCreative: vi.fn(),
    });
  });

  it("renders the approved six categories and exact mobile lead copy", () => {
    render(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "What are you posting?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick one and the camera opens.")).toBeInTheDocument();
    for (const label of [
      "Delivery",
      "New arrival",
      "Service",
      "Promotion",
      "Community",
      "Team",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
  });

  it("opens the matching tile camera input synchronously", () => {
    render(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={vi.fn()} />,
    );
    const input = screen.getByLabelText("Take a photo for Delivery");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /^Delivery/ }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("routes a quarantined recent record through the guarded history opener", () => {
    const openCreative = vi.fn();
    const quarantined = {
      id: "post12345678901",
      dealer: "dealer123456789",
      generated_at: "2026-10-01T12:00:00.000Z",
      scenario_id: "customer_delivery",
      customer_name: "Protected customer",
      caption: "Unsafe legacy copy",
      creative_image_url: "/api/app/posts/post12345678901/creative",
      image_review_required: true,
    };
    mocks.history.mockReturnValue({
      filtered: [quarantined],
      loading: false,
      error: null,
      openingId: null,
      load: vi.fn(),
      openCreative,
    });
    const onOpenPost = vi.fn();

    render(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={onOpenPost} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Delivery.*Protected customer/ }),
    );

    expect(openCreative).toHaveBeenCalledWith(quarantined);
    expect(onOpenPost).not.toHaveBeenCalled();
  });

  it("shows useful empty, loading, and retry states for recent work", () => {
    const retry = vi.fn();
    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: "Could not load your posts.",
      openingId: null,
      load: retry,
      openCreative: vi.fn(),
    });
    const { rerender } = render(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: null,
      openingId: null,
      load: retry,
      openCreative: vi.fn(),
    });
    rerender(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={vi.fn()} />,
    );
    expect(screen.getByText("Your recent posts will show here.")).toBeInTheDocument();
  });
});
