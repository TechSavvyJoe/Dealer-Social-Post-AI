import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostResult } from "../components/PostResult";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ToastProvider } from "../components/ui/Toast";
import { VideoStyle } from "../types";
import { useAppStore } from "../stores/appStore";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
const {
  mockGetPostApprovalStatus,
  mockMarkPostVideoGenerated,
  mockRenderFormat,
  mockPrepareMediaForSave,
  mockSavePreparedMediaToLibrary,
  mockValidateVideoMetadata,
  mockUpdatePostDraft,
} = vi.hoisted(() => ({
  mockGetPostApprovalStatus: vi.fn(),
  mockMarkPostVideoGenerated: vi.fn(),
  mockRenderFormat: vi.fn(async (source: string) => source),
  mockSavePreparedMediaToLibrary: vi.fn(
    async (): Promise<{
      method: "download" | "photos-share" | "cancelled" | "error";
      kind: "image" | "video";
    }> => ({
      method: "download",
      kind: "image",
    }),
  ),
  mockUpdatePostDraft: vi.fn(async () => ({ id: "post-1", updated: true as const })),
  mockValidateVideoMetadata: vi.fn(async () => ({
    width: 1080,
    height: 1920,
    durationSeconds: 8,
  })),
  mockPrepareMediaForSave: vi.fn(
    async (options: { kind: "image" | "video"; basename?: string }) => {
      const filename = `${options.basename || "dealer-social-post"}.${
        options.kind === "video" ? "mp4" : "jpg"
      }`;
      const contents =
        options.kind === "video"
          ? new Uint8Array([
              0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
              0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
            ])
          : "prepared";
      return {
        kind: options.kind,
        filename,
        file: new File([contents], filename, {
          type: options.kind === "video" ? "video/mp4" : "image/jpeg",
        }),
      };
    },
  ),
}));
vi.mock("../services/posts", () => ({
  getPostApprovalStatus: mockGetPostApprovalStatus,
  markPostVideoGenerated: mockMarkPostVideoGenerated,
  updatePostDraft: mockUpdatePostDraft,
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
vi.mock("../utils/multiFormatExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/multiFormatExport")>();
  return {
    ...actual,
    renderFormat: mockRenderFormat,
    renderFormatIfNeeded: mockRenderFormat,
  };
});
vi.mock("../utils/mediaSave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/mediaSave")>();
  return {
    ...actual,
    prepareMediaForSave: mockPrepareMediaForSave,
    savePreparedMediaToLibrary: mockSavePreparedMediaToLibrary,
    validateVideoMetadata: mockValidateVideoMetadata,
  };
});

const callbacks = {
  onStartOver: vi.fn(),
  onRemix: vi.fn(),
  onRegenerateImage: vi.fn(async () => undefined),
  onEditImage: vi.fn(async () => undefined),
  onRegenerateText: vi.fn(async () => undefined),
  onEditText: vi.fn(
    async (_prompt: string, originalText?: string) => originalText || "",
  ),
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
    mockUpdatePostDraft.mockResolvedValue({ id: "post-1", updated: true });
    mockSavePreparedMediaToLibrary.mockResolvedValue({
      method: "download",
      kind: "image",
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vi.fn(),
    });
    useAppStore.setState({
      currentDealer: null,
      selectedImage: "data:image/png;base64,b3JpZ2luYWw=",
    });
  });

  it("keeps delivery actions visible and mobile creative tools collapsed", () => {
    renderResult();

    const delivery = screen.getByLabelText("Post delivery actions");
    expect(
      within(delivery).getByRole("button", { name: "Copy caption" }),
    ).toBeInTheDocument();
    expect(
      within(delivery).getByRole("button", { name: "Share post" }),
    ).toBeInTheDocument();
    expect(
      within(delivery).getByRole("button", { name: "Save 1080×1920" }),
    ).toBeInTheDocument();

    const disclosure = screen.getByRole("button", { name: /creative tools/i });
    const panel = screen.getByTestId("creative-tools-panel");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");
    expect(panel).toHaveClass("hidden");
    expect(
      screen.queryByRole("button", { name: "Regenerate image" }),
    ).not.toBeInTheDocument();

    fireEvent.click(disclosure);
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
    expect(
      within(delivery).getByRole("button", { name: "Copy caption" }),
    ).toBeInTheDocument();
    expect(
      within(delivery).getByRole("button", { name: "Share post" }),
    ).toBeInTheDocument();
    expect(
      within(delivery).getByRole("button", { name: "Save 1080×1920" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /creative tools/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it.each([
    {
      destination: "facebook_feed",
      field: "facebook_page_tag",
      value: "Bob Maxey Ford of Howell",
      mention: "@Bob Maxey Ford of Howell",
    },
    {
      destination: "instagram_feed",
      field: "instagram_handle",
      value: "bobmaxeyford",
      mention: "@bobmaxeyford",
    },
    {
      destination: "linkedin",
      field: "linkedin_company_tag",
      value: "bob-maxey-ford",
      mention: "@bob-maxey-ford",
    },
  ])(
    "copies the $destination caption with its configured dealership attribution",
    async ({ destination, field, value, mention }) => {
      const user = userEvent.setup();
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      useAppStore.setState({
        currentDealer: {
          id: "dealer-social-copy",
          name: "Bob Maxey Ford",
          [field]: value,
        },
      });

      renderResult({
        post: {
          image: "data:image/png;base64,aGVsbG8=",
          text: "Delivery day!",
          platformIds: [destination],
          mediaOutputMode: "photo",
        },
      });

      await user.click(
        within(screen.getByLabelText("Post delivery actions")).getByRole("button", {
          name: "Copy caption",
        }),
      );
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(`Delivery day!\n\n${mention}`),
      );
    },
  );

  it("copies the visible Primary caption and only uses a platform caption on its active tab", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({
      currentDealer: {
        id: "dealer-visible-copy",
        name: "Bob Maxey Ford",
        facebook_page_tag: "Bob Maxey Ford of Howell",
      },
    });

    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Visible primary caption.",
        platformIds: ["facebook_feed"],
        platformCaptions: {
          facebook_feed: "Hidden Facebook caption.",
        },
        mediaOutputMode: "photo",
      },
    });

    await user.click(
      within(screen.getByLabelText("Post delivery actions")).getByRole("button", {
        name: "Copy caption",
      }),
    );
    expect(writeText.mock.calls[0]?.[0]).toContain(
      "Visible primary caption.\n\n@Bob Maxey Ford of Howell",
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain("Hidden Facebook caption.");

    await user.click(screen.getByRole("tab", { name: /Facebook/i }));
    await user.click(
      within(screen.getByLabelText("Post delivery actions")).getByRole("button", {
        name: "Copy caption",
      }),
    );
    expect(writeText.mock.calls[1]?.[0]).toContain(
      "Hidden Facebook caption.\n\n@Bob Maxey Ford of Howell",
    );
  });

  it("gates every delivery path while approval is pending", () => {
    renderResult({ requiresApproval: true });
    const delivery = screen.getByLabelText("Post delivery actions");

    expect(
      within(delivery).getByRole("button", {
        name: "Copy caption (approval pending)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Share post (approval pending)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Save image (approval pending)",
      }),
    ).toBeDisabled();
  });

  it("keeps teammate History view-only while allowing its unchanged copy to be shared", async () => {
    useAppStore.setState({ selectedImage: null });
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "A teammate's saved caption.",
        postId: "teammate-post",
        historyReadOnly: true,
      },
    });

    expect(screen.getByText("View-only history")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New caption" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Three caption ideas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();

    const delivery = screen.getByLabelText("Post delivery actions");
    expect(
      within(delivery).getByRole("button", { name: "Copy caption" }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(
        within(delivery).getByRole("button", { name: "Share post" }),
      ).toBeEnabled(),
    );
  });

  it("disables AI caption actions when reopened History has no original capture", () => {
    useAppStore.setState({ selectedImage: null });
    renderResult();

    expect(screen.getByRole("button", { name: "New caption" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Three caption ideas" })).toBeDisabled();
  });

  it("fails closed when a captured photo release was not stored", () => {
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "A customer delivery post.",
        releaseStatus: "save_failed",
      },
    });
    const delivery = screen.getByLabelText("Post delivery actions");

    expect(screen.getByRole("alert")).toHaveTextContent("Photo release not saved");
    expect(
      within(delivery).getByRole("button", {
        name: "Copy caption (release not saved)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Share post (release not saved)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Save image (release not saved)",
      }),
    ).toBeDisabled();
  });

  it("rescans direct caption edits and blocks prohibited delivery claims", () => {
    renderResult({ bannedPhrases: "lowest price guaranteed" });
    const delivery = screen.getByLabelText("Post delivery actions");

    const caption = screen.getByRole("textbox", {
      name: "Full caption text",
    });
    fireEvent.change(caption, {
      target: { value: "The LOWEST—PRICE GUARANTEED on every vehicle." },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Caption claim blocked");
    expect(caption).toHaveAttribute("aria-invalid", "true");
    expect(
      within(delivery).getByRole("button", {
        name: "Copy caption (claim blocked)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Share post (claim blocked)",
      }),
    ).toBeDisabled();
    expect(
      within(delivery).getByRole("button", {
        name: "Save image (claim blocked)",
      }),
    ).toBeDisabled();

    fireEvent.change(caption, {
      target: { value: "A polished delivery-day caption." },
    });

    expect(screen.queryByText("Caption claim blocked")).not.toBeInTheDocument();
    expect(
      within(delivery).getByRole("button", { name: "Copy caption" }),
    ).toBeEnabled();
  });

  it("sends the visible caption to AI editing and replaces it with the result", async () => {
    const user = userEvent.setup();
    callbacks.onEditText.mockResolvedValueOnce(
      "A warmer delivery-day caption with a personal thank-you.",
    );
    renderResult();

    const caption = screen.getByRole("textbox", {
      name: "Full caption text",
    });
    fireEvent.change(caption, {
      target: { value: "The salesperson's current manual caption." },
    });

    await user.click(screen.getByRole("button", { name: /creative tools/i }));
    await user.click(screen.getByRole("button", { name: "Edit text" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Edit Post Text with AI",
    });
    expect(dialog).toHaveTextContent("The salesperson's current manual caption.");

    await user.type(
      screen.getByRole("textbox", {
        name: "How would you like to change it?",
      }),
      "Make it warmer and add a thank-you.",
    );
    await user.click(screen.getByRole("button", { name: "Submit Edit" }));

    await waitFor(() =>
      expect(callbacks.onEditText).toHaveBeenCalledWith(
        "Make it warmer and add a thank-you.",
        "The salesperson's current manual caption.",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
        "A warmer delivery-day caption with a personal thank-you.",
      ),
    );
  });

  it("keeps a platform AI edit in that platform without replacing primary copy", async () => {
    const user = userEvent.setup();
    const ControlledResult = () => {
      const [post, setPost] = React.useState({
        image: "data:image/png;base64,aGVsbG8=",
        text: "Primary caption stays unchanged.",
        platformIds: ["facebook_feed"],
        platformCaptions: { facebook_feed: "Original Facebook caption." },
      });
      return (
        <ToastProvider>
          <PostResult
            post={post}
            {...callbacks}
            onEditText={async (_prompt, _original, platformId) => {
              const replacement = "Updated Facebook caption from AI.";
              if (platformId) {
                setPost((current) => ({
                  ...current,
                  platformCaptions: {
                    ...current.platformCaptions,
                    [platformId]: replacement,
                  },
                }));
              }
              return replacement;
            }}
            isDesktopLayout={false}
          />
        </ToastProvider>
      );
    };
    render(<ControlledResult />);

    await user.click(screen.getByRole("tab", { name: /Facebook/i }));
    await user.click(screen.getByRole("button", { name: /creative tools/i }));
    await user.click(screen.getByRole("button", { name: "Edit text" }));
    await user.type(
      screen.getByRole("textbox", {
        name: "How would you like to change it?",
      }),
      "Make this friendlier.",
    );
    await user.click(screen.getByRole("button", { name: "Submit Edit" }));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Facebook/i })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
      "Updated Facebook caption from AI.",
    );

    await user.click(screen.getByRole("tab", { name: "Primary" }));
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
      "Primary caption stays unchanged.",
    );
  });

  it("preserves and saves a primary caption edit across platform tab changes", async () => {
    const user = userEvent.setup();
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Original primary caption.",
        postId: "post-primary-edit",
        platformIds: ["facebook_feed"],
        platformCaptions: {
          facebook_feed: "Original Facebook caption.",
        },
      },
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Full caption text" }), {
      target: { value: "Primary caption edited by the salesperson." },
    });
    await user.click(screen.getByRole("tab", { name: /Facebook/i }));
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
      "Original Facebook caption.",
    );

    await user.click(screen.getByRole("tab", { name: "Primary" }));
    expect(screen.getByRole("textbox", { name: "Full caption text" })).toHaveValue(
      "Primary caption edited by the salesperson.",
    );
    await waitFor(() =>
      expect(mockUpdatePostDraft).toHaveBeenCalledWith(
        "post-primary-edit",
        expect.objectContaining({
          caption: expect.stringContaining(
            "Primary caption edited by the salesperson.",
          ),
        }),
      ),
    );
  });

  it("starts prepared media sharing before awaiting a pending History save", async () => {
    const order: string[] = [];
    let releaseDraft: (() => void) | undefined;
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Original caption",
        postId: "post-1",
        approvalStatus: "n_a",
      },
    });
    const saveButtons = await screen.findAllByRole("button", {
      name: "Save 1080×1920",
    });
    await waitFor(() => expect(saveButtons[0]).toBeEnabled());

    // Let the initial canonical-caption reconciliation finish, then measure
    // only the work started by this Save click.
    await waitFor(() => expect(mockUpdatePostDraft).toHaveBeenCalledTimes(1));
    mockUpdatePostDraft.mockClear();
    mockSavePreparedMediaToLibrary.mockClear();
    mockSavePreparedMediaToLibrary.mockImplementationOnce(async () => {
      order.push("media-share");
      return { method: "photos-share", kind: "image" };
    });
    mockUpdatePostDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          order.push("history-save");
          releaseDraft = () => resolve({ id: "post-1", updated: true });
        }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Full caption text" }), {
      target: { value: "Edited caption that should be saved to History." },
    });

    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(mockSavePreparedMediaToLibrary).toHaveBeenCalledTimes(1),
    );
    expect(mockUpdatePostDraft).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["media-share", "history-save"]);
    releaseDraft?.();
  });

  it("reselects a completed video and sends that MP4 through Save and Share", async () => {
    const user = userEvent.setup();
    const syntheticVideoUrl = "blob:synthetic-generated-video";
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: ({ files }: ShareData) =>
        Boolean(files?.length && files[0]?.type === "video/mp4"),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    callbacks.onGenerateVideo.mockResolvedValueOnce(syntheticVideoUrl);
    mockSavePreparedMediaToLibrary.mockResolvedValueOnce({
      method: "download",
      kind: "video",
    });

    renderResult();

    await user.click(screen.getByRole("button", { name: "Video" }));
    await user.click(
      await screen.findByRole("button", {
        name: /Golden Delivery/i,
      }),
    );

    expect(callbacks.onGenerateVideo).toHaveBeenCalledWith(
      VideoStyle.GoldenRadiance,
      expect.objectContaining({
        aspectPreference: "16:9",
        resolution: "720p",
      }),
    );
    expect(
      await screen.findByLabelText("Generated social media video preview"),
    ).toHaveAttribute("src", syntheticVideoUrl);

    await user.click(screen.getByRole("button", { name: "Back to photos" }));
    expect(
      screen.queryByLabelText("Generated social media video preview"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: `Show ${VideoStyle.GoldenRadiance} video`,
      }),
    );
    expect(
      await screen.findByLabelText("Generated social media video preview"),
    ).toHaveAttribute("src", syntheticVideoUrl);

    const delivery = screen.getByLabelText("Post delivery actions");
    const saveVideo = within(delivery).getByRole("button", {
      name: "Save video",
    });
    await waitFor(() => expect(saveVideo).toBeEnabled());
    await user.click(saveVideo);

    await waitFor(() =>
      expect(mockSavePreparedMediaToLibrary).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "video",
          filename: "dealer-social-video.mp4",
          file: expect.objectContaining({
            name: "dealer-social-video.mp4",
            type: "video/mp4",
          }),
        }),
      ),
    );
    expect(mockPrepareMediaForSave).toHaveBeenCalledWith({
      sourceUrl: syntheticVideoUrl,
      kind: "video",
      basename: "dealer-social-video",
    });

    await user.click(
      within(delivery).getByRole("button", {
        name: "Share post",
      }),
    );
    const shareDialog = await screen.findByRole("dialog", { name: "Share" });
    await user.click(
      within(shareDialog).getByRole("button", {
        name: "Share to Instagram Feed",
      }),
    );
    expect(
      await within(shareDialog).findByText("Instagram Feed is ready"),
    ).toBeInTheDocument();
    await user.click(
      within(shareDialog).getByRole("button", {
        name: "Share now",
      }),
    );

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            name: "dealer-social-video.mp4",
            type: "video/mp4",
          }),
        ],
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("A polished delivery-day caption."),
    );
  });

  it("builds exact photo/video rows and pins a requested platform video format", async () => {
    const user = userEvent.setup();
    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Platform-ready delivery.",
        platformIds: ["instagram_feed", "facebook_feed"],
        mediaOutputMode: "both",
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Select Instagram Feed image 4:5, 1080 by 1350 pixels",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Select Instagram Reel video 9:16, 1080 by 1920 pixels",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Select Facebook Feed video 16:9, 1920 by 1080 pixels",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Create Instagram Reel video 9:16",
      }),
    );
    expect(screen.getByText("Exact output pinned").parentElement).toHaveTextContent(
      "Instagram Reel · 9:16 · 1080p · 8 seconds",
    );

    await user.click(screen.getByRole("button", { name: /Golden Delivery/i }));
    expect(callbacks.onGenerateVideo).toHaveBeenCalledWith(
      VideoStyle.GoldenRadiance,
      expect.objectContaining({
        aspectPreference: "9:16",
        durationSeconds: 8,
        resolution: "1080p",
      }),
    );
  });

  it("does not let a video generated from an older image satisfy the current output", async () => {
    const user = userEvent.setup();
    callbacks.onGenerateVideo.mockResolvedValueOnce("blob:first-image-video");
    const originalPost = {
      image: "data:image/png;base64,Zmlyc3QtaW1hZ2U=",
      text: "Platform-ready delivery.",
      platformIds: ["instagram_feed"],
      mediaOutputMode: "both" as const,
    };
    const renderPost = (post: typeof originalPost) => (
      <ToastProvider>
        <PostResult post={post} {...callbacks} isDesktopLayout={false} />
      </ToastProvider>
    );
    const view = render(renderPost(originalPost));

    await user.click(
      screen.getByRole("button", {
        name: "Create Instagram Reel video 9:16",
      }),
    );
    await user.click(await screen.findByRole("button", { name: /Golden Delivery/i }));
    await waitFor(() => expect(callbacks.onGenerateVideo).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Save Instagram Reel video 9:16",
        }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByLabelText("Generated social media video preview"),
    ).toHaveAttribute("src", "blob:first-image-video");
    await user.click(
      screen.getByRole("button", {
        name: "Show Golden Radiance video",
      }),
    );

    view.rerender(
      renderPost({
        ...originalPost,
        image: "data:image/png;base64,c2Vjb25kLWltYWdl",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Create Instagram Reel video 9:16",
        }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("button", {
        name: "Save Instagram Reel video 9:16",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: "Show Golden Radiance video",
      }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Generated social media video preview"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps approved photo preparation available while explaining why video is locked", async () => {
    mockGetPostApprovalStatus.mockResolvedValue({
      id: "post-review-video",
      approval_status: "approved",
      approved_by: "Manager",
    });
    renderResult({
      requiresApproval: true,
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "The exact reviewed caption.",
        postId: "post-review-video",
        approvalStatus: "approved",
        platformIds: ["instagram_feed"],
        mediaOutputMode: "both",
      },
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Save Instagram Feed image 4:5",
        }),
      ).toBeEnabled(),
    );
    const createVideo = screen.getByRole("button", {
      name: "Create Instagram Reel video 9:16",
    });
    expect(createVideo).toBeDisabled();
    expect(createVideo).toHaveAttribute(
      "title",
      "This reviewed creative must stay unchanged. Start a new post to create a video.",
    );
    expect(
      screen.getByText(
        "This reviewed creative must stay unchanged. Start a new post to create a video.",
      ),
    ).toBeInTheDocument();
    expect(callbacks.onGenerateVideo).not.toHaveBeenCalled();
  });

  it("walks checked platform files through Share all without auto-posting", async () => {
    const user = userEvent.setup();
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });

    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Two-platform delivery.",
        platformIds: ["facebook_feed", "instagram_feed"],
        mediaOutputMode: "photo",
      },
    });

    await user.click(screen.getByRole("button", { name: "Share all 2" }));

    let dialog = await screen.findByRole("dialog", { name: "Share exact output" });
    expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    await within(dialog).findByText("Facebook is ready");
    await user.click(within(dialog).getByRole("button", { name: "Share now" }));
    expect(share).toHaveBeenCalledTimes(1);

    await user.click(
      await within(dialog).findByRole("button", {
        name: /Next selected: Instagram Feed/i,
      }),
    );

    dialog = await screen.findByRole("dialog", { name: "Share exact output" });
    expect(await within(dialog).findByText("2 of 2")).toBeInTheDocument();
    await within(dialog).findByText("Instagram Feed is ready");
    expect(share).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Share now" }));
    expect(share).toHaveBeenCalledTimes(2);
    await user.click(
      await within(dialog).findByRole("button", { name: "Finish sequence" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Share exact output" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("never reuses a manually previewed video for a selected photo delivery", async () => {
    const user = userEvent.setup();
    const share = vi.fn(async (_data?: ShareData): Promise<void> => undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });

    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Exact Instagram delivery.",
        platformIds: ["instagram_feed"],
        mediaOutputMode: "both",
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: "Create Instagram Reel video 9:16",
      }),
    );
    await user.click(await screen.findByRole("button", { name: /Golden Delivery/i }));
    await waitFor(() => expect(callbacks.onGenerateVideo).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Show Golden Radiance video",
        }),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Select Instagram Feed image 4:5, 1080 by 1350 pixels",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Save Instagram Feed image 4:5",
        }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Show Golden Radiance video",
      }),
    );
    await waitFor(() =>
      expect(mockPrepareMediaForSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "video" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Share selected 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Share exact output" });
    await within(dialog).findByText("Instagram Feed is ready");
    await user.click(within(dialog).getByRole("button", { name: "Share now" }));

    expect(share).toHaveBeenCalledTimes(1);
    const sharedFile = share.mock.calls[0]?.[0]?.files?.[0];
    expect(sharedFile).toBeInstanceOf(File);
    expect(sharedFile?.name).toMatch(/\.jpg$/);
    expect(sharedFile?.type).toBe("image/jpeg");
  });

  it("keeps a failed Share selected preparation recoverable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });

    renderResult({
      post: {
        image: "data:image/png;base64,aGVsbG8=",
        text: "Two-platform delivery.",
        platformIds: ["facebook_feed", "instagram_feed"],
        mediaOutputMode: "photo",
      },
    });

    await user.click(await screen.findByRole("button", { name: "Share all 2" }));
    let dialog = await screen.findByRole("dialog", { name: "Share exact output" });
    await within(dialog).findByText("Facebook is ready");
    await user.click(within(dialog).getByRole("button", { name: "Share now" }));

    mockPrepareMediaForSave.mockRejectedValueOnce(
      new Error("The exact Instagram file could not be prepared."),
    );
    await user.click(
      await within(dialog).findByRole("button", {
        name: /Next selected: Instagram Feed/i,
      }),
    );

    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveTextContent(
      "The exact Instagram file could not be prepared.",
    );
    expect(within(recovery).getByRole("button", { name: "Retry file" })).toBeEnabled();
    expect(
      within(recovery).getByRole("button", { name: "Skip this output" }),
    ).toBeEnabled();
    expect(
      within(recovery).getByRole("button", { name: "Cancel sequence" }),
    ).toBeEnabled();

    await user.click(within(recovery).getByRole("button", { name: "Retry file" }));
    dialog = await screen.findByRole("dialog", { name: "Share exact output" });
    expect(await within(dialog).findByText("2 of 2")).toBeInTheDocument();
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
    const delivery = screen.getByLabelText("Post delivery actions");

    await waitFor(() =>
      expect(
        within(delivery).getByRole("button", { name: "Share post" }),
      ).toBeEnabled(),
    );
    expect(screen.getByText("Manager approved")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(delivery).getByRole("button", { name: "Save 1080×1920" }),
      ).toBeEnabled(),
    );
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
