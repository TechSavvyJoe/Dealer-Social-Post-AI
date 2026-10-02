import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostScreen } from "../components/PostScreen";
import { ToastProvider } from "../components/ui/Toast";
import { StyleOption, ToneOption, VideoStyle, type GeneratedPost } from "../types";
import { useAppStore } from "../stores/appStore";

const mocks = vi.hoisted(() => ({
  selectDelivery: vi.fn(),
  share: vi.fn(async () => ({
    kind: "shared" as const,
    via: "web-share" as const,
    pasteRequired: true,
  })),
  copyCaption: vi.fn(async () => true),
  download: vi.fn(() => true),
  openTarget: vi.fn(() => "native" as const),
  usePostShare: vi.fn(),
  creativeTryAnother: vi.fn(async () => undefined),
  creativeChangeLook: vi.fn(async () => undefined),
  creativeAddVideo: vi.fn(async () => undefined),
  creativeTogglePlayful: vi.fn(async () => undefined),
  retryRelease: vi.fn(async () => undefined),
  autosaveStatus: "saved" as "idle" | "saving" | "saved" | "failed",
}));

vi.mock("../services/storeDefaults", () => ({
  resolveStoreDefaults: () => ({
    releaseRequired: true,
    vehicleRelevant: true,
    channels: [
      { id: "facebook_feed", label: "Facebook" },
      { id: "instagram_feed", label: "Instagram" },
    ],
    defaultChannelId: "facebook_feed",
    generationPlatformIds: ["facebook_feed", "instagram_feed"],
    primaryProfile: {
      primaryFormatId: "feed_portrait",
      imageAspectRatio: "4:5",
      label: "Feed portrait · 4:5",
    },
    looks: [
      { id: "showroom", label: "Clean", style: StyleOption.Modern },
      { id: "turbo", label: "Bold", style: StyleOption.Sporty },
    ],
    defaultLookId: "showroom",
    videoAllowed: true,
    motion: {
      style: VideoStyle.GoldenRadiance,
      aspects: ["9:16"],
      audio: "cinematic",
    },
    playfulStyleId: null,
    facebookTag: "",
    employeeDisclosure: "",
    requiresApproval: false,
    websiteChannel: false,
    style: StyleOption.Modern,
    tone: ToneOption.Excited,
  }),
}));
vi.mock("../hooks/useApprovalStatus", () => ({
  useApprovalStatus: ({
    post,
    requiresApproval,
  }: {
    post: GeneratedPost;
    requiresApproval: boolean;
  }) => ({
    reviewRequired:
      post.approvalStatus !== undefined
        ? post.approvalStatus !== "n_a"
        : requiresApproval,
    approvalStatus: post.approvalStatus || (requiresApproval ? "pending" : "n_a"),
    rejectionReason: post.rejectionReason || "",
    imageReviewRequired: Boolean(post.imageReviewRequired),
    approvalCheckError: null,
  }),
}));
vi.mock("../hooks/useReleaseRepair", () => ({
  useReleaseRepair: ({ post }: { post: GeneratedPost }) => ({
    releaseStatus: post.releaseStatus,
    releaseLinkStatus: post.releaseLinkStatus,
    releaseLinkRepairable: Boolean(
      post.releaseStatus === "save_failed" &&
      post.releaseLinkStatus === "link_failed" &&
      post.releaseId &&
      post.postId,
    ),
    retrying: false,
    notice: null,
    retry: mocks.retryRelease,
  }),
}));
vi.mock("../hooks/useDraftAutosave", () => ({
  useDraftAutosave: () => ({
    status: mocks.autosaveStatus,
    flush: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    stage: vi.fn(),
    lastRevisionRef: { current: "revision-1" },
  }),
}));
vi.mock("../hooks/useWebsiteHandoff", () => ({
  useWebsiteHandoff: ({ post }: { post: GeneratedPost }) => ({
    websiteDraft: post.websiteDraft,
    publication: post.websitePublication,
    checkError: null,
    sending: false,
    retrying: false,
    reviewUrl: undefined,
    handoffStarted: false,
    send: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  }),
}));
vi.mock("../hooks/useVideoJobs", () => ({
  useVideoJobs: () => ({
    videoJobs: [],
    videoUrl: null,
    adoptVideoUrl: vi.fn(),
    manualVideoSelected: false,
    setManualVideoSelected: vi.fn(),
    isVideoLoading: false,
    videoLoadingMessage: "",
    isVideoBuffering: false,
    setIsVideoBuffering: vi.fn(),
    videoPlayError: null,
    setVideoPlayError: vi.fn(),
    videoMuted: true,
    setVideoMuted: vi.fn(),
    videoGenerationActiveRef: { current: false },
    currentVideoCreativeKey: "post-1:0",
    videoJobForDelivery: vi.fn(),
    startVideoJob: vi.fn(async () => undefined),
    retryVideoJob: vi.fn(async () => undefined),
    removeVideoJob: vi.fn(),
    houseMotionOptions: {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "9:16",
      resolution: "720p",
      pacing: "cinematic",
    },
    atRisk: false,
  }),
}));
vi.mock("../hooks/usePreparedDelivery", () => ({
  usePreparedDelivery: () => ({
    websiteOnly: false,
    selectDelivery: mocks.selectDelivery,
    selectedDelivery: { mediaKind: "photo" },
    activePreparedSave: {
      file: new File(["image"], "facebook.jpg", { type: "image/jpeg" }),
    },
    mediaPreparationError: null,
    retryPreparation: vi.fn(),
  }),
}));
vi.mock("../hooks/usePostShare", () => ({
  usePostShare: (options: { blockedReason?: string }) => {
    mocks.usePostShare(options);
    return {
      preparationStatus: "ready",
      preparationError: null,
      prepared: {},
      shareDisabled: Boolean(options.blockedReason),
      nativeFileShareAvailable: true,
      feedback: null,
      share: mocks.share,
      copyCaption: mocks.copyCaption,
      download: mocks.download,
      openTarget: mocks.openTarget,
    };
  },
}));
vi.mock("../hooks/usePostCreativeTools", () => ({
  usePostCreativeTools: () => ({
    busy: false,
    busyLabel: "",
    selectedLookId: "showroom",
    tryAnotherUsed: false,
    playfulPair: null,
    tryAnother: mocks.creativeTryAnother,
    changeLook: mocks.creativeChangeLook,
    addVideo: mocks.creativeAddVideo,
    togglePlayful: mocks.creativeTogglePlayful,
    selectCreative: vi.fn(),
  }),
}));

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
  onGenerateVideo: vi.fn(async () => "blob:video"),
};

const basePost: GeneratedPost = {
  postId: "post-1",
  postRevision: "revision-1",
  image: "data:image/jpeg;base64,aW1hZ2U=",
  text: "Congratulations to Maria on her new Bronco.",
  customerDisplayName: "Maria",
  customerIdentityRequired: true,
  scenarioId: "customer_delivery",
  releaseStatus: "saved",
  approvalStatus: "n_a",
  platformIds: ["facebook_feed", "instagram_feed"],
};

const renderScreen = (
  overrides: Partial<React.ComponentProps<typeof PostScreen>> = {},
) =>
  render(
    <ToastProvider>
      <PostScreen
        post={basePost}
        {...callbacks}
        isDesktopLayout={false}
        {...overrides}
      />
    </ToastProvider>,
  );

describe("PostScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autosaveStatus = "saved";
    useAppStore.setState({
      currentDealer: {
        id: "dealer-1",
        name: "Bob Maxey Ford of Howell",
        oem_affiliation: "Ford",
      },
      currentPerson: {
        id: "person-1",
        dealer: "dealer-1",
        name: "Joe Gallant",
        role: "salesperson",
        active: true,
      },
      selectedImage: "data:image/jpeg;base64,b3JpZ2luYWw=",
      generatedPost: basePost,
      postDraft: {
        categoryId: "deliveries",
        scenarioId: "customer_delivery",
      },
      generationParams: null,
      postWorkAtRisk: false,
    });
  });

  it("renders only the precedence-selected lock banner and one repair action", () => {
    renderScreen({
      requiresApproval: true,
      post: {
        ...basePost,
        imageReviewRequired: true,
        approvalStatus: "pending",
        releaseStatus: "save_failed",
        releaseLinkStatus: "link_failed",
        releaseId: "release-1",
      },
    });
    expect(screen.getAllByTestId("post-status-banner")).toHaveLength(1);
    expect(screen.getByText("Image safety review required")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry saving release" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Post to single-select and re-prepares the selected destination", async () => {
    const user = userEvent.setup();
    renderScreen();
    const facebook = screen.getByRole("button", { name: "Facebook" });
    const instagram = screen.getByRole("button", { name: "Instagram" });
    expect(facebook).toHaveAttribute("aria-pressed", "true");
    expect(instagram).toHaveAttribute("aria-pressed", "false");

    await user.click(instagram);
    expect(instagram).toHaveAttribute("aria-pressed", "true");
    expect(facebook).toHaveAttribute("aria-pressed", "false");
    expect(mocks.selectDelivery).toHaveBeenLastCalledWith("instagram_feed", "photo");
    await waitFor(() =>
      expect(mocks.usePostShare).toHaveBeenLastCalledWith(
        expect.objectContaining({
          channelId: "instagram_feed",
          channelLabel: "Instagram",
        }),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Copy and Download on desktop", () => {
    renderScreen({ isDesktopLayout: true });
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download for Facebook" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
  });

  it.each(["saving", "failed"] as const)(
    "blocks every delivery action while the exact draft is %s",
    (status) => {
      mocks.autosaveStatus = status;
      renderScreen({ isDesktopLayout: true });

      expect(
        screen.getByRole("button", { name: /Copy caption unavailable/ }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /Download for Facebook unavailable/ }),
      ).toBeDisabled();
      expect(mocks.usePostShare).toHaveBeenLastCalledWith(
        expect.objectContaining({
          blockedReason: expect.stringMatching(
            status === "saving" ? /Saving the current caption/ : /must be saved/,
          ),
        }),
      );
    },
  );

  it("re-runs identity protection for edited caption copy", async () => {
    const user = userEvent.setup();
    renderScreen({ isDesktopLayout: true });
    const textarea = screen.getByRole("textbox", { name: "Caption" });
    await user.clear(textarea);
    await user.type(textarea, "Congratulations to Michelle on her new Bronco.");
    fireEvent.blur(textarea);
    expect(await screen.findByText("Customer name blocked")).toBeInTheDocument();
    expect(screen.getAllByTestId("post-status-banner")).toHaveLength(1);
  });

  it("hides creative tools during approval and keeps read-only posts non-editable", () => {
    const { rerender } = renderScreen({
      requiresApproval: true,
      post: { ...basePost, approvalStatus: "pending" },
    });
    expect(screen.queryByRole("button", { name: "Try another" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Look" })).toBeNull();

    rerender(
      <ToastProvider>
        <PostScreen
          post={{ ...basePost, historyReadOnly: true }}
          {...callbacks}
          isDesktopLayout
        />
      </ToastProvider>,
    );
    expect(screen.queryByRole("textbox", { name: "Caption" })).toBeNull();
    expect(screen.getByText(basePost.text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
  });
});
