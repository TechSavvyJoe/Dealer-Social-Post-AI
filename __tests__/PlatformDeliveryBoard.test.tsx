import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PlatformDeliveryBoard,
  type PlatformDeliveryOutput,
} from "../components/PlatformDeliveryBoard";

const outputs: PlatformDeliveryOutput[] = [
  {
    id: "instagram-reel",
    platformLabel: "Instagram Reel",
    mediaKind: "video",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    status: "ready",
    thumbnail: "blob:instagram-reel",
    poster: "data:image/jpeg;base64,instagram-reel-poster",
    selected: true,
  },
  {
    id: "facebook-feed",
    platformLabel: "Facebook Feed",
    mediaKind: "image",
    ratio: "4:5",
    width: 1080,
    height: 1350,
    status: "generating",
    selected: false,
  },
  {
    id: "youtube-short",
    platformLabel: "YouTube Short",
    mediaKind: "video",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    status: "failed",
    selected: false,
  },
];

const callbacks = () => ({
  onSelect: vi.fn(),
  onSave: vi.fn(),
  onShare: vi.fn(),
  onRetry: vi.fn(),
});

describe("PlatformDeliveryBoard", () => {
  it("presents exact platform formats and progress with static card posters", () => {
    const handlers = callbacks();
    const { container } = render(
      <PlatformDeliveryBoard outputs={outputs} {...handlers} />,
    );

    const board = screen.getByRole("region", { name: "Platform delivery" });
    expect(board).toHaveTextContent(
      "Every file is prepared at the exact size selected for its destination.",
    );
    expect(screen.getByRole("list", { name: "Platform-ready deliverables" })).toBe(
      board.querySelector("ul"),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("1 of 3 prepared")).toHaveAttribute("role", "status");
    expect(
      screen.getByText("Swipe sideways to review every platform output."),
    ).toBeInTheDocument();

    expect(board).toHaveTextContent("1,080 × 1,920 px");
    expect(board).toHaveTextContent("1,080 × 1,350 px");
    expect(
      screen.getByRole("button", {
        name: "Select Instagram Reel video 9:16, 1080 by 1920 pixels",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByAltText("Instagram Reel video 9:16 poster")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,instagram-reel-poster",
    );
    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("uses a still image for a pending video without mounting a player", () => {
    const handlers = callbacks();
    const pendingVideo: PlatformDeliveryOutput = {
      id: "instagram-story",
      platformLabel: "Instagram Story",
      mediaKind: "video",
      ratio: "9:16",
      width: 1080,
      height: 1920,
      status: "pending",
      thumbnail: "data:image/jpeg;base64,original-photo",
    };
    const { container } = render(
      <PlatformDeliveryBoard outputs={[pendingVideo]} {...handlers} />,
    );

    expect(screen.getByAltText("Instagram Story video 9:16 poster")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,original-photo",
    );
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Create Instagram Story video 9:16",
      }),
    ).toBeEnabled();
  });

  it("locks duplicate Create actions while a shared video format is rendering", () => {
    const handlers = callbacks();
    const lockedVideo: PlatformDeliveryOutput = {
      id: "facebook-story",
      platformLabel: "Facebook Story",
      mediaKind: "video",
      ratio: "9:16",
      width: 1080,
      height: 1920,
      status: "pending",
      poster: "data:image/jpeg;base64,original-photo",
    };
    render(
      <PlatformDeliveryBoard outputs={[lockedVideo]} {...handlers} recoveryDisabled />,
    );

    const createButton = screen.getByRole("button", {
      name: "Create Facebook Story video 9:16",
    });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute(
      "title",
      "Another destination is already preparing this video format",
    );
    fireEvent.click(createButton);
    expect(handlers.onRetry).not.toHaveBeenCalled();
  });

  it("explains a review-locked video without blocking photo preparation recovery", () => {
    const handlers = callbacks();
    const reviewLockReason =
      "This reviewed creative must stay unchanged. Start a new post to create a video.";
    render(
      <PlatformDeliveryBoard
        outputs={[
          {
            id: "instagram-reel",
            platformLabel: "Instagram Reel",
            mediaKind: "video",
            ratio: "9:16",
            width: 1080,
            height: 1920,
            status: "pending",
            recoveryDisabled: true,
            recoveryDisabledReason: reviewLockReason,
          },
          {
            id: "instagram-photo",
            platformLabel: "Instagram Feed",
            mediaKind: "image",
            ratio: "4:5",
            width: 1080,
            height: 1350,
            status: "failed",
          },
        ]}
        {...handlers}
      />,
    );

    const createVideo = screen.getByRole("button", {
      name: "Create Instagram Reel video 9:16",
    });
    expect(createVideo).toBeDisabled();
    expect(createVideo).toHaveAttribute("title", reviewLockReason);
    expect(screen.getByText(reviewLockReason)).toBeInTheDocument();

    const retryPhoto = screen.getByRole("button", {
      name: "Retry Instagram Feed image 4:5",
    });
    expect(retryPhoto).toBeEnabled();
    fireEvent.click(retryPhoto);
    expect(handlers.onRetry).toHaveBeenCalledWith("instagram-photo");
  });

  it("routes selection, save, share, and retry to the exact deliverable", () => {
    const handlers = callbacks();
    render(<PlatformDeliveryBoard outputs={outputs} {...handlers} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select Facebook Feed image 4:5, 1080 by 1350 pixels",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Save Instagram Reel video 9:16",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Share Instagram Reel video 9:16",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry YouTube Short video 9:16",
      }),
    );

    expect(handlers.onSelect).toHaveBeenCalledWith("facebook-feed");
    expect(handlers.onSave).toHaveBeenCalledWith("instagram-reel");
    expect(handlers.onShare).toHaveBeenCalledWith("instagram-reel");
    expect(handlers.onRetry).toHaveBeenCalledWith("youtube-short");
  });

  it("selects and clears the complete guided sharing queue", () => {
    const handlers = callbacks();
    const onToggleAll = vi.fn();
    const onShareBatch = vi.fn();
    const allSelected = outputs.map((output) => ({
      ...output,
      batchSelected: true,
    }));

    const { rerender } = render(
      <PlatformDeliveryBoard
        outputs={allSelected}
        {...handlers}
        onToggleAll={onToggleAll}
        onShareBatch={onShareBatch}
      />,
    );

    const shareAll = screen.getByRole("button", { name: "Share all 3" });
    expect(shareAll).toBeEnabled();
    fireEvent.click(shareAll);
    expect(onShareBatch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onToggleAll).toHaveBeenCalledWith(false);

    rerender(
      <PlatformDeliveryBoard
        outputs={outputs.map((output, index) => ({
          ...output,
          batchSelected: index === 0,
        }))}
        {...handlers}
        onToggleAll={onToggleAll}
        onShareBatch={onShareBatch}
      />,
    );

    expect(screen.getByRole("button", { name: "Select all" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Share selected 1" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onToggleAll).toHaveBeenLastCalledWith(true);
  });

  it("routes each inclusion checkbox to its exact output", () => {
    const handlers = callbacks();
    const onToggleBatch = vi.fn();
    render(
      <PlatformDeliveryBoard
        outputs={[
          { ...outputs[0], batchSelected: true },
          { ...outputs[1], batchSelected: false },
        ]}
        {...handlers}
        onToggleBatch={onToggleBatch}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include Instagram Reel video 9:16 in Share selected",
      }),
    );
    expect(onToggleBatch).toHaveBeenCalledWith("instagram-reel", false);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include Facebook Feed image 4:5 in Share selected",
      }),
    );
    expect(onToggleBatch).toHaveBeenCalledWith("facebook-feed", true);
  });

  it("keeps compact batch selection accessible without a full-width control row", () => {
    const handlers = callbacks();
    const onToggleBatch = vi.fn();
    render(
      <PlatformDeliveryBoard
        outputs={[{ ...outputs[0], batchSelected: true }]}
        {...handlers}
        onToggleBatch={onToggleBatch}
        compact
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Include Instagram Reel video 9:16 in Share selected",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox.closest("label")).toHaveAttribute(
      "title",
      "Include Instagram Reel video 9:16 in guided sharing",
    );
    expect(screen.queryByText("Include in Share selected")).not.toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(onToggleBatch).toHaveBeenCalledWith("instagram-reel", false);
  });

  it("keeps an uncreated video out of Share selected until it is ready", () => {
    const handlers = callbacks();
    const onToggleBatch = vi.fn();
    render(
      <PlatformDeliveryBoard
        outputs={[
          {
            ...outputs[0],
            status: "pending",
            batchSelected: false,
            batchEligible: false,
          },
          {
            ...outputs[1],
            status: "ready",
            batchSelected: true,
            batchEligible: true,
          },
        ]}
        {...handlers}
        onToggleBatch={onToggleBatch}
        onShareBatch={vi.fn()}
      />,
    );

    const pendingVideo = screen.getByRole("checkbox", {
      name: "Include Instagram Reel video 9:16 in Share selected",
    });
    expect(pendingVideo).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share all 1" })).toBeEnabled();
    fireEvent.click(pendingVideo);
    expect(onToggleBatch).not.toHaveBeenCalled();
  });

  it("disables batch sharing when nothing is selected or the queue is busy", () => {
    const handlers = callbacks();
    const onShareBatch = vi.fn();
    const noneSelected = outputs.map((output) => ({
      ...output,
      batchSelected: false,
    }));

    const { rerender } = render(
      <PlatformDeliveryBoard
        outputs={noneSelected}
        {...handlers}
        onShareBatch={onShareBatch}
      />,
    );

    const emptySelection = screen.getByRole("button", {
      name: "Share selected 0",
    });
    expect(emptySelection).toBeDisabled();
    fireEvent.click(emptySelection);
    expect(onShareBatch).not.toHaveBeenCalled();

    rerender(
      <PlatformDeliveryBoard
        outputs={[{ ...outputs[0], batchSelected: true }]}
        {...handlers}
        onShareBatch={onShareBatch}
        batchActionDisabled
      />,
    );
    expect(screen.getByRole("button", { name: "Share all 1" })).toBeDisabled();
  });

  it("prevents premature delivery actions while retaining the correct recovery path", () => {
    const handlers = callbacks();
    render(<PlatformDeliveryBoard outputs={outputs} {...handlers} />);

    expect(
      screen.getByRole("button", {
        name: "Save Facebook Feed image 4:5",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Share Facebook Feed image 4:5",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Retry Facebook Feed image 4:5",
      }),
    ).toBeDisabled();

    expect(
      screen.getByRole("button", {
        name: "Save YouTube Short video 9:16",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Share YouTube Short video 9:16",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Retry YouTube Short video 9:16",
      }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Save Facebook Feed image 4:5",
      }),
    );
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("renders an actionable empty state without dropping the region context", () => {
    const handlers = callbacks();
    render(<PlatformDeliveryBoard outputs={[]} {...handlers} />);

    expect(screen.getByRole("region", { name: "Platform delivery" })).toHaveTextContent(
      "Choose a platform and format to create a deliverable.",
    );
    expect(screen.getByText("No outputs yet")).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("list", { name: "Platform-ready deliverables" }),
    ).not.toBeInTheDocument();
  });
});
