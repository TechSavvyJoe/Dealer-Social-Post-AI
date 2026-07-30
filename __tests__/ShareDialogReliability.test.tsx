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
  const visibleIds = new Set(["instagram_feed", "facebook_feed", "linkedin"]);
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

  it("opens a platform delivery row already focused and prepared for a fresh share tap", async () => {
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) =>
      preparedFor(targetId),
    );

    render(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        content={{ text: "Delivery day", videoUrl: "blob:exact-video" }}
        focusedTargetId="instagram_feed"
        selectedPlatformIds={["instagram_feed"]}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Share exact output" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Share to Facebook" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Instagram Feed is ready")).toBeInTheDocument();
    expect(publishMocks.preparePublishShare).toHaveBeenCalledWith(
      "instagram_feed",
      expect.objectContaining({ videoUrl: "blob:exact-video" }),
    );
    expect(screen.getByRole("button", { name: "Share now" })).toBeEnabled();
  });

  it("shows guided queue progress and advances only after another explicit tap", async () => {
    const onQueueAdvance = vi.fn();
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) =>
      preparedFor(targetId),
    );

    render(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        content={{ text: "Delivery day" }}
        focusedTargetId="instagram_feed"
        selectedPlatformIds={["instagram_feed"]}
        queueProgress={{ current: 1, total: 2, nextLabel: "Facebook · 4:5 photo" }}
        onQueueAdvance={onQueueAdvance}
      />,
    );

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Selected output sequence" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(
      screen.queryByRole("button", { name: /Next selected/i }),
    ).not.toBeInTheDocument();

    await screen.findByText("Instagram Feed is ready");
    fireEvent.click(screen.getByRole("button", { name: "Share now" }));

    const nextButton = await screen.findByRole("button", {
      name: "Next selected: Facebook · 4:5 photo",
    });
    expect(publishMocks.sharePrepared).toHaveBeenCalledTimes(1);
    expect(onQueueAdvance).not.toHaveBeenCalled();

    fireEvent.click(nextButton);
    expect(onQueueAdvance).toHaveBeenCalledTimes(1);
    expect(publishMocks.sharePrepared).toHaveBeenCalledTimes(1);
  });

  it("offers Finish sequence after a cancelled final share without claiming success", async () => {
    const onQueueAdvance = vi.fn();
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) =>
      preparedFor(targetId),
    );
    publishMocks.sharePrepared.mockResolvedValue({
      kind: "cancelled",
      message: "Share sheet closed.",
    });

    render(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        content={{ text: "Delivery day" }}
        focusedTargetId="facebook_feed"
        selectedPlatformIds={["facebook_feed"]}
        queueProgress={{ current: 2, total: 2 }}
        onQueueAdvance={onQueueAdvance}
      />,
    );

    await screen.findByText("Facebook is ready");
    fireEvent.click(screen.getByRole("button", { name: "Share now" }));

    const finishButton = await screen.findByRole("button", {
      name: "Finish sequence",
    });
    expect(onQueueAdvance).not.toHaveBeenCalled();
    fireEvent.click(finishButton);
    expect(onQueueAdvance).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "facebook_feed",
      "@BobMaxeyFord",
      /Dealership Page mention text is included in the caption/i,
      /Facebook may show a Page suggestion/i,
    ],
    [
      "linkedin",
      "@bob-maxey-ford",
      /Dealership company mention text is included in the caption/i,
      /LinkedIn may show a company suggestion/i,
    ],
  ])(
    "explains how to activate a configured dealership tag for %s",
    async (targetId, mention, includedCopy, suggestionCopy) => {
      publishMocks.preparePublishShare.mockImplementation(
        async (preparedTargetId: string, targetContent: { text: string }) => ({
          ...preparedFor(preparedTargetId),
          caption: targetContent.text,
        }),
      );

      render(
        <ShareDialog
          isOpen
          onClose={vi.fn()}
          content={{ text: "Delivery day" }}
          platformCaptions={{ [targetId]: `Delivery day\n\n${mention}` }}
          focusedTargetId={targetId}
          selectedPlatformIds={[targetId]}
          dealershipMention={mention}
        />,
      );

      expect(await screen.findByText(includedCopy)).toBeInTheDocument();
      expect(screen.getByText(suggestionCopy)).toBeInTheDocument();
    },
  );

  it("does not show dealership guidance for an unrelated mention", async () => {
    publishMocks.preparePublishShare.mockImplementation(
      async (preparedTargetId: string, targetContent: { text: string }) => ({
        ...preparedFor(preparedTargetId),
        caption: targetContent.text,
      }),
    );

    render(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        content={{ text: "Delivery day" }}
        platformCaptions={{
          facebook_feed: "Delivery day\n\n@AnotherDealer",
        }}
        focusedTargetId="facebook_feed"
        selectedPlatformIds={["facebook_feed"]}
        dealershipMention="@BobMaxeyFord"
      />,
    );

    await screen.findByText("Facebook is ready");
    expect(
      screen.queryByText(/Dealership Page mention text is included/i),
    ).not.toBeInTheDocument();
  });

  it("labels a fallback as a skip, not a successful next share", async () => {
    const onQueueAdvance = vi.fn();
    publishMocks.preparePublishShare.mockImplementation(async (targetId: string) =>
      preparedFor(targetId),
    );
    publishMocks.sharePrepared.mockResolvedValue({
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message: "Use the manual steps.",
    });

    render(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        content={{ text: "Delivery day" }}
        focusedTargetId="facebook_feed"
        selectedPlatformIds={["facebook_feed"]}
        queueProgress={{ current: 1, total: 2, nextLabel: "LinkedIn photo" }}
        onQueueAdvance={onQueueAdvance}
      />,
    );

    await screen.findByText("Facebook is ready");
    fireEvent.click(screen.getByRole("button", { name: "Share now" }));
    expect(
      await screen.findByRole("button", { name: "Skip to: LinkedIn photo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Next selected/i }),
    ).not.toBeInTheDocument();
  });
});
