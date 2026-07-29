import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMocks = vi.hoisted(() => ({
  preparePublishShare: vi.fn(),
  sharePrepared: vi.fn(),
  copyPreparedCaption: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

vi.mock("../services/publishTargets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/publishTargets")>();
  const visibleIds = new Set(["instagram_feed", "facebook_feed"]);
  return {
    ...actual,
    CORE_PUBLISH_IDS: ["instagram_feed", "facebook_feed"],
    orderPublishTargets: () =>
      actual.PUBLISH_TARGETS.filter((target) => visibleIds.has(target.id)),
    preparePublishShare: publishMocks.preparePublishShare,
    sharePrepared: publishMocks.sharePrepared,
    copyPreparedCaption: publishMocks.copyPreparedCaption,
    copyTextToClipboard: publishMocks.copyTextToClipboard,
  };
});

import { ShareDialog } from "../components/ShareDialog";
import { PUBLISH_TARGETS, type PreparedPublishShare } from "../services/publishTargets";

const preparedFor = (targetId: string): PreparedPublishShare => {
  const target = PUBLISH_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Missing test target ${targetId}`);
  return {
    target,
    content: { text: "Delivery day" },
    caption: "Delivery day",
    file: null,
    webUrl: target.webIntentUrl?.({ text: "Delivery day" }) ?? null,
  };
};

describe("ShareDialog media preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishMocks.sharePrepared.mockResolvedValue({
      kind: "shared",
      via: "web-share",
      pasteRequired: true,
    });
    publishMocks.copyPreparedCaption.mockResolvedValue(true);
    publishMocks.copyTextToClipboard.mockResolvedValue(true);
  });

  it("settles destinations independently and offers a per-target retry", async () => {
    let facebookAttempts = 0;
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) => {
      if (targetId === "facebook_feed" && facebookAttempts++ === 0) {
        throw new Error("Image rendering failed.");
      }
      return preparedFor(targetId);
    });

    render(<ShareDialog isOpen onClose={vi.fn()} content={{ text: "Delivery day" }} />);

    const instagramTile = screen.getByRole("button", {
      name: "Share to Instagram Feed",
    });
    expect(instagramTile).toHaveAttribute("aria-pressed", "false");
    expect(publishMocks.preparePublishShare).not.toHaveBeenCalled();
    fireEvent.click(instagramTile);
    expect(instagramTile).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Instagram Feed is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share now" })).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Share to Facebook",
      }),
    );
    expect(
      await screen.findByText(/Facebook media could not be prepared/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Preparing media…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry media preparation" }));
    expect(await screen.findByText("Facebook is ready")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Share to Instagram Feed" }),
    ).not.toHaveAccessibleName(/media ready/i);
    await waitFor(() =>
      expect(publishMocks.preparePublishShare).toHaveBeenCalledTimes(3),
    );
  });

  it("never claims a failed clipboard write succeeded", async () => {
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) =>
      preparedFor(targetId),
    );
    publishMocks.copyPreparedCaption.mockResolvedValue(false);

    render(<ShareDialog isOpen onClose={vi.fn()} content={{ text: "Delivery day" }} />);

    const facebookTile = screen.getByRole("button", {
      name: "Share to Facebook",
    });
    fireEvent.click(facebookTile);

    expect(await screen.findByText("Facebook is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
    expect(
      await screen.findByText(/browser did not allow clipboard access/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/caption copied/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Share now" }));

    expect(
      await screen.findByText(/Tap Copy caption below, then paste it in Facebook/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/confirmed on your clipboard/i)).not.toBeInTheDocument();
  });
});
