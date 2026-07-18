import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostResult } from "../components/PostResult";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ToastProvider } from "../components/ui/Toast";
import { VideoStyle } from "../types";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
const { mockGetPostApprovalStatus, mockMarkPostVideoGenerated } = vi.hoisted(() => ({
  mockGetPostApprovalStatus: vi.fn(),
  mockMarkPostVideoGenerated: vi.fn(),
}));
vi.mock("../services/posts", () => ({
  getPostApprovalStatus: mockGetPostApprovalStatus,
  markPostVideoGenerated: mockMarkPostVideoGenerated,
}));
vi.mock("../components/ui/ProgressiveImage", () => ({
  ProgressiveImage: ({
    src,
    alt,
    className,
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

const callbacks = {
  onStartOver: vi.fn(),
  onRemix: vi.fn(),
  onRegenerateImage: vi.fn(async () => undefined),
  onEditImage: vi.fn(async () => undefined),
  onRegenerateText: vi.fn(async () => undefined),
  onEditText: vi.fn(async () => undefined),
  onFunMode: vi.fn(async () => undefined),
  onGenerateVideo: vi.fn(async (_style: VideoStyle) => "blob:video"),
  onGenerateCaptionVariant: vi.fn(async () => "Alternative caption"),
};

const renderResult = (
  overrides: Partial<React.ComponentProps<typeof PostResult>> = {},
) =>
  render(
    <ToastProvider>
      <PostResult
        post={{
          image: "data:image/png;base64,aGVsbG8=",
          text: "A polished delivery-day caption.",
          disclosures: "Offer subject to approved credit.",
          disclosureCategories: ["finance"],
        }}
        {...callbacks}
        isDesktopLayout={false}
        {...overrides}
      />
    </ToastProvider>,
  );

describe("PostResult job-first flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPostApprovalStatus.mockResolvedValue({
      id: "post-review-1",
      approval_status: "pending",
    });
    mockMarkPostVideoGenerated.mockResolvedValue({
      id: "post-review-1",
      has_video: true,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("keeps delivery actions visible and mobile creative tools collapsed", async () => {
    const user = userEvent.setup();
    renderResult();

    expect(screen.getByRole("button", { name: "Copy caption" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share post" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save image" })).toBeInTheDocument();

    const disclosure = screen.getByRole("button", { name: /creative tools/i });
    const panel = screen.getByTestId("creative-tools-panel");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");
    expect(panel).toHaveClass("hidden");
    expect(
      screen.queryByRole("button", { name: "Regenerate image" }),
    ).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).not.toHaveClass("hidden");
    expect(
      screen.getByRole("button", { name: "Regenerate image" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerate caption" }),
    ).toBeInTheDocument();
  });

  it("supports roving keyboard navigation across platform caption tabs", async () => {
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Primary caption",
        platformIds: ["facebook_feed", "instagram_feed"],
        platformCaptions: {
          facebook_feed: "Facebook caption",
          instagram_feed: "Instagram caption",
        },
      },
    });

    const primaryTab = screen.getByRole("tab", { name: "Primary" });
    primaryTab.focus();
    fireEvent.keyDown(primaryTab, { key: "ArrowRight" });

    const facebookTab = screen.getByRole("tab", { name: /Facebook/i });
    await waitFor(() => expect(facebookTab).toHaveFocus());
    expect(facebookTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      facebookTab.id,
    );
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
      "Facebook caption",
    );

    fireEvent.keyDown(facebookTab, { key: "End" });
    const instagramTab = screen.getByRole("tab", { name: "IG Feed" });
    await waitFor(() => expect(instagramTab).toHaveFocus());
    expect(instagramTab).toHaveAttribute("tabindex", "0");
  });

  it("confirms before replacing work with another post", async () => {
    const user = userEvent.setup();
    renderResult();

    await user.click(screen.getByRole("button", { name: "New photo" }));
    expect(callbacks.onStartOver).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Create another post?" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard and continue" }));
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(1);
    expect(callbacks.onRemix).not.toHaveBeenCalled();
  });

  it("confirms before remixing the same photo when work is at risk", async () => {
    const user = userEvent.setup();
    renderResult();

    await user.click(screen.getByRole("button", { name: /Remix this photo/i }));
    expect(callbacks.onRemix).not.toHaveBeenCalled();
    // Dialog may still be mid-enter animation (opacity 0); presence is enough.
    expect(
      await screen.findByRole("dialog", { name: "Remix this photo?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard and continue" }));
    expect(callbacks.onRemix).toHaveBeenCalledTimes(1);
    expect(callbacks.onStartOver).not.toHaveBeenCalled();
  });

  it("exposes sticky mobile delivery actions while creative tools stay collapsed", () => {
    renderResult({ isDesktopLayout: false });

    const delivery = screen.getByLabelText("Post delivery actions");
    expect(delivery).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share post" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save image" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /creative tools/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("gates every delivery path while approval is pending", () => {
    renderResult({ requiresApproval: true });

    expect(
      screen.getByRole("button", { name: "Copy caption (approval pending)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Share post (approval pending)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save image (approval pending)" }),
    ).toBeDisabled();
  });

  it("fails closed when a captured photo release was not stored", () => {
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "A customer delivery post.",
        releaseStatus: "save_failed",
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Photo release not saved");
    expect(
      screen.getByRole("button", { name: "Copy caption (release not saved)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Share post (release not saved)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save image (release not saved)" }),
    ).toBeDisabled();
  });

  it("rescans direct caption edits and blocks prohibited delivery claims", () => {
    renderResult({ bannedPhrases: "lowest price guaranteed" });

    const caption = screen.getByRole("textbox", {
      name: "Full caption text",
    });
    fireEvent.change(caption, {
      target: { value: "The LOWEST—PRICE GUARANTEED on every vehicle." },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Caption claim blocked");
    expect(caption).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: "Copy caption (claim blocked)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Share post (claim blocked)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save image (claim blocked)" }),
    ).toBeDisabled();

    fireEvent.change(caption, {
      target: { value: "A polished delivery-day caption." },
    });

    expect(screen.queryByText("Caption claim blocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
  });

  it("polls owner status, unlocks delivery, and keeps approved creative frozen", async () => {
    const user = userEvent.setup();
    mockGetPostApprovalStatus.mockResolvedValueOnce({
      id: "post-review-1",
      approval_status: "approved",
      approved_by: "Manager",
    });

    renderResult({
      requiresApproval: true,
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "The exact reviewed caption.",
        postId: "post-review-1",
        approvalStatus: "pending",
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Share post" })).toBeEnabled(),
    );
    expect(screen.getByText("Manager approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save image" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /creative tools/i }));
    expect(screen.getByRole("button", { name: "Regenerate image" })).toBeDisabled();
    expect(mockGetPostApprovalStatus).toHaveBeenCalledWith(
      "post-review-1",
      expect.any(AbortSignal),
    );
  });
});

describe("LoadingOverlay", () => {
  it("announces the live generation stage and exposes determinate progress", () => {
    render(<LoadingOverlay progress={62} message="Checking caption tone" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Building your post");
    expect(status).toHaveTextContent("Checking caption tone");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    expect(
      screen.getByRole("list", { name: "Post generation stages" }),
    ).toBeInTheDocument();
  });
});
