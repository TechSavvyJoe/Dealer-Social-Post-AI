import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobilePublishStudio } from "../components/MobilePublishStudio";
import type { PlatformDeliveryOutput } from "../components/PlatformDeliveryBoard";

const outputs: PlatformDeliveryOutput[] = [
  {
    id: "instagram-reel",
    platformLabel: "Instagram Reel",
    mediaKind: "video",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    status: "ready",
    selected: true,
    batchSelected: true,
    batchEligible: true,
    actionsReady: true,
  },
  {
    id: "facebook-feed",
    platformLabel: "Facebook Feed",
    mediaKind: "image",
    ratio: "4:5",
    width: 1080,
    height: 1350,
    status: "ready",
    batchSelected: true,
    batchEligible: true,
  },
  {
    id: "tiktok",
    platformLabel: "TikTok",
    mediaKind: "video",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    status: "pending",
    batchSelected: false,
    batchEligible: false,
  },
];

const renderStudio = (
  overrides: Partial<React.ComponentProps<typeof MobilePublishStudio>> = {},
) => {
  const handlers = {
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    onToggleBatch: vi.fn(),
    onToggleAll: vi.fn(),
    onShareBatch: vi.fn(),
    onCopyCaption: vi.fn(),
    onEditCaption: vi.fn(),
    onBack: vi.fn(),
    onRemix: vi.fn(),
    onShowSettings: vi.fn(),
    onShowHistory: vi.fn(),
    onRequestLogout: vi.fn(),
  };

  render(
    <MobilePublishStudio
      outputs={outputs}
      title="Ready to publish"
      mediaPreview={<img src="/preview.jpg" alt="Focused output preview" />}
      caption="Another happy customer, another new beginning."
      postingAs="Jamie Rivera"
      captionNote="Caption and dealership tag are included when you share."
      {...handlers}
      {...overrides}
    />,
  );

  return handlers;
};

describe("MobilePublishStudio", () => {
  it("keeps active destination metadata, media, caption, and readiness together", () => {
    renderStudio();

    const studio = screen.getByTestId("mobile-publish-studio");
    expect(
      screen.getByRole("heading", { level: 1, name: "Instagram Reel" }),
    ).toBeVisible();
    expect(studio).toHaveTextContent("Instagram Reel");
    expect(screen.getByLabelText("Posting as Jamie Rivera")).toBeVisible();
    expect(studio).toHaveTextContent("Video · 9:16");
    expect(studio).toHaveTextContent("File ready. Caption is included when you share.");
    expect(screen.getByAltText("Focused output preview")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focused caption" })).toHaveTextContent(
      "Another happy customer, another new beginning.",
    );
    expect(
      screen.getByRole("list", { name: "Mobile platform outputs" }),
    ).toBeInTheDocument();
  });

  it("selects exact outputs and manages the guided sharing set", () => {
    const handlers = renderStudio();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select Facebook Feed image 4:5, 1080 by 1350 pixels",
      }),
    );
    expect(handlers.onSelect).toHaveBeenCalledWith("facebook-feed");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include Facebook Feed image 4:5 in Share selected",
      }),
    );
    expect(handlers.onToggleBatch).toHaveBeenCalledWith("facebook-feed", false);

    expect(
      screen.getByRole("checkbox", {
        name: "Include TikTok video 9:16 in Share selected",
      }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Share all 2" }));
    expect(handlers.onShareBatch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(handlers.onToggleAll).toHaveBeenCalledWith(false);
  });

  it("routes navigation and caption actions without bypassing parent gates", () => {
    const handlers = renderStudio();

    fireEvent.click(screen.getByRole("button", { name: "New photo" }));
    fireEvent.click(screen.getByRole("button", { name: "More publishing options" }));
    fireEvent.click(screen.getByRole("button", { name: "Remix this photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onRemix).toHaveBeenCalledTimes(1);
    expect(handlers.onEditCaption).toHaveBeenCalledTimes(1);
    expect(handlers.onCopyCaption).toHaveBeenCalledTimes(1);
  });

  it("keeps account, history, and settings reachable from the phone workspace", () => {
    const handlers = renderStudio();
    const openMenu = () =>
      fireEvent.click(screen.getByRole("button", { name: "More publishing options" }));

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "My work" }));
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(handlers.onShowHistory).toHaveBeenCalledTimes(1);
    expect(handlers.onShowSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onRequestLogout).toHaveBeenCalledTimes(1);
  });

  it("uses disclosure-popover semantics without claiming full menu behavior", () => {
    renderStudio();
    const trigger = screen.getByRole("button", {
      name: "More publishing options",
    });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const popover = screen.getByRole("group", { name: "Publishing options" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", popover.id);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("group", { name: "Publishing options" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lets a salesperson review the full destination caption", () => {
    renderStudio({
      caption:
        "A standout delivery deserves a standout moment. Congratulations on the new ride, and thank you for trusting our dealership team with your purchase.",
    });

    const caption = screen
      .getByRole("region", { name: "Focused caption" })
      .querySelector("p[id]");
    expect(caption).toHaveClass("line-clamp-2");

    const disclosure = screen.getByRole("button", { name: "Show full caption" });
    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(caption).not.toHaveClass("line-clamp-2");
    expect(screen.getByRole("button", { name: "Collapse full caption" })).toBeVisible();
  });

  it("offers Create for a pending selected video and respects recovery locks", () => {
    const pendingOutputs = outputs.map((output) => ({
      ...output,
      selected: output.id === "tiktok",
    }));
    const handlers = renderStudio({ outputs: pendingOutputs });

    const createButton = screen.getByRole("button", {
      name: "Create TikTok video 9:16",
    });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);
    expect(handlers.onRetry).toHaveBeenCalledWith("tiktok");
  });

  it("disables delivery and caption controls while approval is locked", () => {
    renderStudio({
      actionsDisabled: true,
      captionActionsDisabled: true,
    });

    expect(screen.getByRole("button", { name: "Share all 2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit with AI" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeDisabled();
  });

  it("keeps caption repair available when only delivery is blocked", () => {
    renderStudio({
      actionsDisabled: true,
      copyCaptionDisabled: true,
      editCaptionDisabled: false,
    });

    expect(screen.getByRole("button", { name: "Share all 2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit with AI" })).toBeEnabled();
  });
});
