import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostScreen } from "../components/PostScreen";
import { ToastProvider } from "../components/ui/Toast";
import { StyleOption, ToneOption, VideoStyle, type GeneratedPost } from "../types";
import { useAppStore } from "../stores/appStore";
import { derivePlatformDeliveryPlan } from "../services/platformOutputs";
import { DRAFT_CONFLICT_MESSAGE } from "../hooks/useDraftAutosave";
import { buildEmployeeDisclosure } from "../utils/complianceDisclosures";
import {
  fitPublishCaptionToBudget,
  type PublishContent,
} from "../services/publishTargets";
import type { WebsitePublication } from "../services/websitePublishing";

type ShareOptions = {
  channelId: string;
  channelLabel: string;
  content: PublishContent;
  blockedReason?: string;
};

type LeaveGuardOptions = {
  hasSavedMedia: boolean;
  imageBusy: boolean;
  textBusy: boolean;
  websiteSending: boolean;
};

type WebsiteHandoffOptions = {
  imageBusy: boolean;
  textBusy: boolean;
};

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
  usePostLeaveGuard: vi.fn(),
  useWebsiteHandoff: vi.fn(),
  useDraftAutosave: vi.fn(),
  creativeTryAnother: vi.fn(async () => undefined),
  creativeChangeLook: vi.fn(async () => undefined),
  creativeAddVideo: vi.fn(async () => undefined),
  creativeTogglePlayful: vi.fn(async () => undefined),
  retryRelease: vi.fn(async () => undefined),
  retryPreparation: vi.fn(),
  websiteSend: vi.fn(async () => undefined),
  websiteRetry: vi.fn(async () => undefined),
  autosaveStatus: "saved" as "idle" | "saving" | "saved" | "failed" | "conflict",
  shareState: {} as {
    preparationStatus?: "idle" | "preparing" | "ready" | "failed";
    preparationError?: string | null;
    prepared?: object | null;
    nativeFileShareAvailable?: boolean;
    fallbackActive?: boolean;
    feedback?: {
      title: string;
      detail: string;
      via: string;
      fallback?: boolean;
    } | null;
  },
  websiteState: {} as {
    sending?: boolean;
    reviewUrl?: string;
    handoffStarted?: boolean;
  },
  preparedState: {} as {
    websiteOnly?: boolean;
    mediaPreparationError?: string | null;
  },
  creativeState: {} as {
    busy?: boolean;
    tryAnotherUsed?: boolean;
  },
  videoState: {} as { isVideoLoading?: boolean },
  defaultsOverrides: {} as Record<string, unknown>,
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
    requiresApproval: false,
    websiteChannel: false,
    style: StyleOption.Modern,
    tone: ToneOption.Excited,
    ...mocks.defaultsOverrides,
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
vi.mock("../hooks/useDraftAutosave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useDraftAutosave")>();
  return {
    DRAFT_CONFLICT_MESSAGE: actual.DRAFT_CONFLICT_MESSAGE,
    useDraftAutosave: (options: unknown) => {
      mocks.useDraftAutosave(options);
      return {
        status: mocks.autosaveStatus,
        flush: vi.fn(async () => true),
        retry: vi.fn(async () => true),
        stage: vi.fn(),
        lastRevisionRef: { current: "revision-1" },
      };
    },
  };
});
vi.mock("../hooks/useWebsiteHandoff", () => ({
  useWebsiteHandoff: (options: WebsiteHandoffOptions & { post: GeneratedPost }) => {
    mocks.useWebsiteHandoff(options);
    const { post } = options;
    return {
      websiteDraft: post.websiteDraft,
      publication:
        post.websitePublication ??
        (post.websiteDraft?.enabled
          ? ({ status: "not_requested" } as WebsitePublication)
          : undefined),
      checkError: null,
      sending: mocks.websiteState.sending ?? false,
      retrying: false,
      reviewUrl: mocks.websiteState.reviewUrl,
      handoffStarted: mocks.websiteState.handoffStarted ?? false,
      send: mocks.websiteSend,
      retry: mocks.websiteRetry,
    };
  },
}));
vi.mock("../hooks/useVideoJobs", () => ({
  useVideoJobs: () => ({
    videoJobs: [],
    videoUrl: null,
    adoptVideoUrl: vi.fn(),
    manualVideoSelected: false,
    setManualVideoSelected: vi.fn(),
    isVideoLoading: mocks.videoState.isVideoLoading ?? false,
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
  usePreparedDelivery: ({ post }: { post: GeneratedPost }) => ({
    deliveryPlan: derivePlatformDeliveryPlan(
      post.platformIds ?? ["instagram_feed"],
      "photo",
      "test",
    ),
    websiteOnly: mocks.preparedState.websiteOnly ?? false,
    selectDelivery: mocks.selectDelivery,
    selectedDelivery: { mediaKind: "photo" },
    activePreparedSave: {
      file: new File(["image"], "facebook.jpg", { type: "image/jpeg" }),
    },
    mediaPreparationError: mocks.preparedState.mediaPreparationError ?? null,
    retryPreparation: mocks.retryPreparation,
  }),
}));
vi.mock("../hooks/usePostShare", () => ({
  usePostShare: (options: ShareOptions) => {
    mocks.usePostShare(options);
    const preparationStatus = mocks.shareState.preparationStatus ?? "ready";
    return {
      preparationStatus,
      preparationError: mocks.shareState.preparationError ?? null,
      prepared:
        mocks.shareState.prepared === undefined ? {} : mocks.shareState.prepared,
      shareDisabled: Boolean(options.blockedReason) || preparationStatus !== "ready",
      nativeFileShareAvailable: mocks.shareState.nativeFileShareAvailable ?? true,
      fallbackActive: mocks.shareState.fallbackActive ?? false,
      feedback: mocks.shareState.feedback ?? null,
      share: mocks.share,
      copyCaption: mocks.copyCaption,
      download: mocks.download,
      openTarget: mocks.openTarget,
    };
  },
}));
vi.mock("../hooks/usePostCreativeTools", () => ({
  usePostCreativeTools: () => ({
    busy: mocks.creativeState.busy ?? false,
    busyLabel: "",
    selectedLookId: "showroom",
    tryAnotherUsed: mocks.creativeState.tryAnotherUsed ?? false,
    playfulPair: null,
    tryAnother: mocks.creativeTryAnother,
    changeLook: mocks.creativeChangeLook,
    addVideo: mocks.creativeAddVideo,
    togglePlayful: mocks.creativeTogglePlayful,
    selectCreative: vi.fn(),
  }),
}));
vi.mock("../hooks/usePostLeaveGuard", () => ({
  usePostLeaveGuard: (options: LeaveGuardOptions) => {
    mocks.usePostLeaveGuard(options);
    return { atRisk: !options.hasSavedMedia, requestLeave: vi.fn(() => "go") };
  },
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
  onShowHistory: vi.fn(),
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

const dealer = {
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  oem_affiliation: "Ford",
};

const websiteDraft = {
  enabled: true as const,
  kind: "customer_story" as const,
  category: "deliveries" as const,
  title: "Maria's new Bronco",
  body: "Congratulations to Maria on her new Bronco from the whole team.",
  altText: "Maria with her new Bronco",
  privacyFlags: ["faces_visible" as const, "review_visual_privacy" as const],
  schemaVersion: 1 as const,
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

const lastShareOptions = (): ShareOptions =>
  mocks.usePostShare.mock.lastCall?.[0] as ShareOptions;

const lastLeaveGuardOptions = (): LeaveGuardOptions =>
  mocks.usePostLeaveGuard.mock.lastCall?.[0] as LeaveGuardOptions;

const lastWebsiteOptions = (): WebsiteHandoffOptions =>
  mocks.useWebsiteHandoff.mock.lastCall?.[0] as WebsiteHandoffOptions;

/** A promise the test settles by hand, to hold work in flight. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const outboundParts = () =>
  Array.from(
    screen
      .getByTestId("post-outbound-preview")
      .querySelectorAll<HTMLElement>("[data-outbound-part]"),
  ).map((node) => ({ part: node.dataset.outboundPart, text: node.textContent }));

describe("PostScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectDelivery.mockReturnValue(true);
    mocks.autosaveStatus = "saved";
    mocks.shareState = {};
    mocks.websiteState = {};
    mocks.preparedState = {};
    mocks.creativeState = {};
    mocks.videoState = {};
    mocks.defaultsOverrides = {};
    useAppStore.setState({
      currentDealer: dealer,
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
      error: null,
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
    expect(screen.getByText("This image needs to be remade")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry saving release" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Share to single-select and re-prepares the selected destination", async () => {
    const user = userEvent.setup();
    renderScreen();
    const channels = screen.getByRole("group", { name: "Share to" });
    const facebook = within(channels).getByRole("button", { name: "Facebook" });
    const instagram = within(channels).getByRole("button", { name: "Instagram" });
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

  it("announces a shared channel in the chip's name without a nested label", () => {
    renderScreen({
      post: {
        ...basePost,
        sharedTo: [
          { channel: "instagram_feed", via: "share_sheet", at: "2026-10-01T00:00:00Z" },
        ],
      },
    });
    expect(
      screen.getByRole("button", { name: "Instagram, shared" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Shared")).toBeNull();
  });

  it("shows Download, Copy caption and a Done for a saved post on desktop", async () => {
    const user = userEvent.setup();
    renderScreen({ isDesktopLayout: true });
    expect(screen.getByRole("heading", { name: "Ready to share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download for Facebook" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(1);
  });

  it("offers no Done before the post is saved", () => {
    renderScreen({
      isDesktopLayout: true,
      post: { ...basePost, postId: undefined, postRevision: undefined },
    });
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it.each(["saving", "failed"] as const)(
    "blocks every delivery action while the draft is %s",
    (status) => {
      mocks.autosaveStatus = status;
      renderScreen({ isDesktopLayout: true });

      expect(
        screen.getByRole("button", { name: /Copy caption unavailable/ }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /Download for Facebook unavailable/ }),
      ).toBeDisabled();
      const reason =
        status === "saving"
          ? "Saving your changes…"
          : "Your changes didn't save. Tap Retry save.";
      expect(lastShareOptions().blockedReason).toBe(reason);
      expect(screen.getByText(reason)).toBeInTheDocument();
    },
  );

  it("blocks Share, Copy and Download after an identity-breaking caption edit", async () => {
    const user = userEvent.setup();
    renderScreen({ isDesktopLayout: true });
    await user.click(screen.getByRole("button", { name: "Edit caption" }));
    const textarea = screen.getByRole("textbox", { name: "Caption" });
    await user.clear(textarea);
    await user.type(textarea, "Congratulations to Michelle on her new Bronco.");
    fireEvent.blur(textarea);
    expect(await screen.findByText("Check the customer's name")).toBeInTheDocument();
    expect(screen.getAllByTestId("post-status-banner")).toHaveLength(1);
    expect(lastShareOptions().blockedReason).toContain("someone other than Maria");
    expect(
      screen.getByRole("button", { name: /Copy caption unavailable/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Download for Facebook unavailable/ }),
    ).toBeDisabled();
  });

  it("locks the phone Share with its reason and no spinner", async () => {
    const user = userEvent.setup();
    // An approval-pending post is not editable, so autosave never runs.
    mocks.autosaveStatus = "idle";
    renderScreen({
      requiresApproval: true,
      post: { ...basePost, approvalStatus: "pending" },
    });
    const locked = screen.getByRole("button", {
      name: "Share to Facebook unavailable. Waiting for approval.",
    });
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent("Waiting for approval");
    expect(locked.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByText("Getting it ready…")).toBeNull();
    expect(
      screen.getByText("Saved to My work · waiting for approval"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(1);
  });

  it("never calls a sent-back post one that is waiting for approval", () => {
    mocks.autosaveStatus = "idle";
    renderScreen({
      requiresApproval: true,
      post: {
        ...basePost,
        approvalStatus: "rejected",
        rejectionReason: "Please remove the pricing claim.",
      },
    });
    const banner = screen.getByTestId("post-status-banner");
    expect(banner).toHaveTextContent("Changes requested");
    expect(banner).toHaveTextContent(
      "Your manager asked for a change: Please remove the pricing claim. Start a new post to make it.",
    );
    expect(screen.queryByText("Waiting for approval")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Share to Facebook unavailable. Start a new post to share.",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Saved to My work")).toBeInTheDocument();
  });

  it("names the fix on a caption-locked phone Share", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Edit caption" }));
    const textarea = screen.getByRole("textbox", { name: "Caption" });
    await user.clear(textarea);
    await user.type(textarea, "Congratulations to Michelle on her new Bronco.");
    fireEvent.blur(textarea);
    expect(
      await screen.findByRole("button", {
        name: "Share to Facebook unavailable. Fix the caption to share.",
      }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
  });

  it("shows the spinner only while the file is being prepared", () => {
    mocks.shareState = { preparationStatus: "preparing", prepared: null };
    renderScreen();
    const preparing = screen.getByRole("button", {
      name: "Share to Facebook unavailable. Getting it ready",
    });
    expect(preparing).toBeDisabled();
    expect(preparing).toHaveTextContent("Getting it ready…");
    expect(preparing.querySelector(".animate-spin")).not.toBeNull();
  });

  it("turns a failed preparation into an enabled Try again", async () => {
    const user = userEvent.setup();
    mocks.shareState = {
      preparationStatus: "failed",
      preparationError: "Couldn't get the image ready.",
      prepared: null,
    };
    const { unmount } = renderScreen();
    const banner = screen.getByTestId("post-status-banner");
    expect(banner).toHaveTextContent("Couldn't share yet");
    // The phone bar carries Try again, so the banner does not repeat it.
    expect(within(banner).queryByRole("button")).toBeNull();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    expect(mocks.retryPreparation).toHaveBeenCalledTimes(1);
    expect(mocks.share).not.toHaveBeenCalled();
    unmount();

    // Desktop has no bar, so the banner keeps the only Try again.
    renderScreen({ isDesktopLayout: true });
    await user.click(
      within(screen.getByTestId("post-status-banner")).getByRole("button", {
        name: "Try again",
      }),
    );
    expect(mocks.retryPreparation).toHaveBeenCalledTimes(2);
  });

  it("retries the share itself when the file is ready but the share failed", async () => {
    const user = userEvent.setup();
    mocks.shareState = {
      preparationStatus: "failed",
      preparationError: "You're offline.",
      prepared: { file: "ready" },
    };
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.retryPreparation).not.toHaveBeenCalled();
  });

  it("renders Save image, Copy caption and Open {channel} without file sharing", async () => {
    const user = userEvent.setup();
    mocks.shareState = { nativeFileShareAvailable: false };
    renderScreen();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save image" }));
    await user.click(screen.getByRole("button", { name: "Copy caption" }));
    await user.click(screen.getByRole("button", { name: "Open Facebook" }));
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.copyCaption).toHaveBeenCalledTimes(1);
    expect(mocks.openTarget).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("swaps to the fallback controls when the share sheet did not open", () => {
    mocks.shareState = {
      fallbackActive: true,
      feedback: {
        title: "Share sheet didn't open",
        detail: "Save the image and copy the caption below, then open Facebook.",
        via: "copy",
        fallback: true,
      },
    };
    renderScreen();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save image" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Facebook" })).toBeEnabled();
  });

  it("keeps the fallback controls after Save image replaces the share-sheet message", () => {
    mocks.shareState = {
      fallbackActive: true,
      feedback: {
        title: "Image downloaded",
        detail: "Copy the caption, then post both in Facebook.",
        via: "download",
      },
    };
    renderScreen();
    expect(screen.getByTestId("post-status-banner")).toHaveTextContent(
      "Image downloaded",
    );
    expect(screen.getByRole("button", { name: "Save image" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Facebook" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Share to Facebook" })).toBeNull();
  });

  it("keeps the fallback controls out while the post is locked or unsaved", () => {
    mocks.shareState = { nativeFileShareAvailable: false };
    mocks.autosaveStatus = "failed";
    const { unmount } = renderScreen();
    expect(screen.queryByRole("button", { name: "Save image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Facebook" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Share to Facebook unavailable/ }),
    ).toBeDisabled();
    unmount();

    mocks.autosaveStatus = "saved";
    renderScreen({
      requiresApproval: true,
      post: { ...basePost, approvalStatus: "pending" },
    });
    expect(screen.queryByRole("button", { name: "Save image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy caption" })).toBeNull();
  });

  it("offers Copy caption and a primary Done after a share-sheet share", async () => {
    const user = userEvent.setup();
    mocks.shareState = {
      feedback: {
        title: "Shared · Facebook",
        detail:
          "Caption copied. Paste it into your Facebook post, then tap Post there.",
        via: "share_sheet",
      },
    };
    renderScreen();
    expect(screen.getByText("Shared · Facebook")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Copy caption" }));
    expect(mocks.copyCaption).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(1);
  });

  it("explains a draft conflict and sends the salesperson to My work", async () => {
    const user = userEvent.setup();
    mocks.autosaveStatus = "conflict";
    renderScreen();
    const banner = screen.getByTestId("post-status-banner");
    expect(banner).toHaveTextContent("This post changed somewhere else");
    expect(banner).toHaveTextContent(DRAFT_CONFLICT_MESSAGE);
    expect(banner).not.toHaveTextContent("Retry when the connection is ready");
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Share to Facebook/ })).toBeNull();
    expect(within(banner).queryByRole("button")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open My work" }));
    expect(callbacks.onShowHistory).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(1);
    expect(lastShareOptions().blockedReason).toBe(DRAFT_CONFLICT_MESSAGE);
    expect(lastLeaveGuardOptions().hasSavedMedia).toBe(false);
  });

  it("keeps Open My work in the conflict banner on desktop", async () => {
    const user = userEvent.setup();
    mocks.autosaveStatus = "conflict";
    renderScreen({ isDesktopLayout: true });
    await user.click(
      within(screen.getByTestId("post-status-banner")).getByRole("button", {
        name: "Open My work",
      }),
    );
    expect(callbacks.onShowHistory).toHaveBeenCalledTimes(1);
  });

  it("lets a failed draft save outrank the starter-caption offer", () => {
    mocks.autosaveStatus = "failed";
    renderScreen({ post: { ...basePost, isBasicFallback: true } });
    const banner = screen.getByTestId("post-status-banner");
    expect(banner).toHaveTextContent("Draft not saved");
    expect(banner).not.toHaveTextContent("Using a safe starter caption");
    expect(within(banner).getByRole("button", { name: "Retry save" })).toBeEnabled();
    expect(
      screen.getByText("Your changes didn't save. Tap Retry save."),
    ).toBeInTheDocument();
  });

  it("keeps the phone bar to one row while a draft save runs", () => {
    mocks.autosaveStatus = "saving";
    const { container } = renderScreen();
    expect(screen.queryByText("Saving your changes…")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Share to Facebook unavailable. Saving your changes…",
      }),
    ).toBeDisabled();
    expect(container.querySelector('[class*="pb-[calc(160px"]')).toBeNull();
  });

  it("gives a failed image update its own dismissible message", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ error: "Failed to regenerate image. Try again." });
    renderScreen({ error: "Failed to regenerate image. Try again." });
    const banner = screen.getByTestId("post-status-banner");
    expect(banner).toHaveTextContent("Post not updated");
    expect(banner).not.toHaveTextContent("Couldn't share yet");
    await user.click(within(banner).getByRole("button", { name: "Dismiss" }));
    expect(useAppStore.getState().error).toBeNull();
    expect(mocks.retryPreparation).not.toHaveBeenCalled();
  });

  it("does not count a running video as a busy render for leaving", () => {
    mocks.creativeState = { busy: true };
    mocks.videoState = { isVideoLoading: true };
    const { unmount } = renderScreen();
    expect(lastLeaveGuardOptions().imageBusy).toBe(false);
    unmount();

    mocks.videoState = { isVideoLoading: false };
    renderScreen();
    expect(lastLeaveGuardOptions().imageBusy).toBe(true);
  });

  /** What a caption rewrite needs besides the photo: the brief it ran with. */
  const rewriteParams = {
    style: StyleOption.Modern,
    tone: ToneOption.Excited,
    customerName: "",
  };

  it.each([
    ["succeeds", (rewrite: ReturnType<typeof deferred>) => rewrite.resolve()],
    [
      "fails",
      (rewrite: ReturnType<typeof deferred>) =>
        rewrite.reject(new Error("Failed to regenerate text.")),
    ],
  ] as const)(
    "holds leaving and the website send while a starter-caption rewrite runs, until it %s",
    async (_outcome, settle) => {
      const user = userEvent.setup();
      useAppStore.setState({ generationParams: rewriteParams });
      const rewrite = deferred();
      const onRegenerateText = vi.fn(() => rewrite.promise);
      renderScreen({
        onRegenerateText,
        post: { ...basePost, isBasicFallback: true, websiteDraft },
      });
      expect(lastLeaveGuardOptions().textBusy).toBe(false);
      expect(lastWebsiteOptions().textBusy).toBe(false);

      const banner = screen.getByTestId("post-status-banner");
      expect(banner).toHaveTextContent("Using a safe starter caption");
      await user.click(within(banner).getByRole("button", { name: "Try AI again" }));
      expect(onRegenerateText).toHaveBeenCalledTimes(1);
      expect(lastLeaveGuardOptions().textBusy).toBe(true);
      expect(lastWebsiteOptions().textBusy).toBe(true);
      // One update at a time: the rewrite holds its own button (shown as
      // running) and the tools that would change the post underneath it.
      const tryAgain = within(banner).getByRole("button", { name: "Try AI again" });
      expect(tryAgain).toBeDisabled();
      expect(tryAgain).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Try another" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Send website draft" })).toBeDisabled();

      settle(rewrite);
      await waitFor(() => expect(lastLeaveGuardOptions().textBusy).toBe(false));
      expect(lastWebsiteOptions().textBusy).toBe(false);
      expect(screen.getByRole("button", { name: "Try another" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Send website draft" })).toBeEnabled();
    },
  );

  it.each([
    ["a render (Try another) runs", () => (mocks.creativeState = { busy: true })],
    ["the website draft is sending", () => (mocks.websiteState = { sending: true })],
  ])(
    "holds Try AI again while %s without showing a rewrite as running",
    async (_case, startOther) => {
      const user = userEvent.setup();
      useAppStore.setState({ generationParams: rewriteParams });
      startOther();
      const onRegenerateText = vi.fn(() => Promise.resolve());
      renderScreen({ onRegenerateText, post: { ...basePost, isBasicFallback: true } });
      const banner = screen.getByTestId("post-status-banner");
      expect(banner).toHaveTextContent("Using a safe starter caption");
      const tryAgain = within(banner).getByRole("button", { name: "Try AI again" });
      // No rewrite is running, so the button is not busy (no spinner, no
      // aria-busy); pressing it explains the wait and starts nothing.
      expect(tryAgain).not.toHaveAttribute("aria-busy");
      await user.click(tryAgain);
      expect(onRegenerateText).not.toHaveBeenCalled();
      expect(
        await screen.findByText("Wait for the current update to finish first."),
      ).toBeInTheDocument();
      expect(lastLeaveGuardOptions().textBusy).toBe(false);
    },
  );

  it.each([
    [
      "a post reopened from My work (no original photo)",
      () =>
        useAppStore.setState({ selectedImage: null, generationParams: rewriteParams }),
      {},
      "The AI caption was unavailable. You can keep this copy or edit it.",
    ],
    [
      "a post with no brief to rewrite from",
      () => useAppStore.setState({ generationParams: null }),
      {},
      "The AI caption was unavailable. You can keep this copy or edit it.",
    ],
    [
      "a read-only post",
      () => useAppStore.setState({ generationParams: rewriteParams }),
      { historyReadOnly: true },
      "The AI caption was unavailable.",
    ],
    [
      "a reopened post while its website draft is sending (caption locked)",
      () => {
        useAppStore.setState({ selectedImage: null, generationParams: rewriteParams });
        mocks.websiteState = { sending: true };
      },
      {},
      "The AI caption was unavailable.",
    ],
  ] as const)(
    "offers no caption rewrite on %s and promises none",
    (_case, arrange, postOverrides, message) => {
      arrange();
      renderScreen({ post: { ...basePost, isBasicFallback: true, ...postOverrides } });
      const banner = screen.getByTestId("post-status-banner");
      expect(banner).toHaveTextContent("Using a safe starter caption");
      expect(within(banner).getByText(message)).toBeInTheDocument();
      expect(within(banner).queryByRole("button", { name: "Try AI again" })).toBeNull();
      expect(banner).not.toHaveTextContent("try once more");
      // The sentence offers an edit exactly when the caption can be edited.
      const editCaption = screen.queryByRole("button", { name: "Edit caption" });
      if (message.includes("edit it")) expect(editCaption).not.toBeNull();
      else expect(editCaption).toBeNull();
    },
  );

  it("hides creative tools during approval and keeps read-only posts non-editable", () => {
    const { rerender } = renderScreen({
      requiresApproval: true,
      post: { ...basePost, approvalStatus: "pending" },
    });
    expect(screen.queryByRole("button", { name: "Try another" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Look" })).toBeNull();

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
    expect(screen.queryByRole("button", { name: "Edit caption" })).toBeNull();
    const body = outboundParts().find((part) => part.part === "body")?.text;
    expect(body).toContain(basePost.text);
    expect(body).toBe(lastShareOptions().content.text);
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeEnabled();
  });

  it("offers the Look as pills and changes it on tap", async () => {
    const user = userEvent.setup();
    renderScreen();
    const looks = screen.getByRole("radiogroup", { name: "Look" });
    const clean = within(looks).getByRole("radio", { name: "Clean" });
    const bold = within(looks).getByRole("radio", { name: "Bold" });
    expect(clean).toHaveAttribute("aria-checked", "true");
    expect(bold).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Creative style")).toBeNull();
    await user.click(clean);
    expect(mocks.creativeChangeLook).not.toHaveBeenCalled();
    await user.click(bold);
    expect(mocks.creativeChangeLook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "turbo" }),
    );
  });

  it("falls back to a labelled Look select when a store offers more than four", () => {
    mocks.defaultsOverrides = {
      looks: [
        { id: "showroom", label: "Clean", style: StyleOption.Modern },
        { id: "turbo", label: "Bold", style: StyleOption.Sporty },
        { id: "golden", label: "Warm", style: StyleOption.Modern },
        { id: "night", label: "Night", style: StyleOption.Sporty },
        { id: "studio", label: "Studio", style: StyleOption.Modern },
      ],
    };
    renderScreen();
    expect(screen.queryByRole("radiogroup", { name: "Look" })).toBeNull();
    const select = screen.getByRole("combobox", { name: "Look" });
    fireEvent.change(select, { target: { value: "golden" } });
    expect(mocks.creativeChangeLook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "golden" }),
    );
  });

  it("gives the phone page a heading and drops the old eyebrows", () => {
    renderScreen();
    expect(
      screen.getByRole("heading", { level: 1, name: "Your post" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your creative")).toBeNull();
    expect(screen.queryByText("Your next great post")).toBeNull();
  });

  it("hides the Look when there is no original photo to re-render", () => {
    useAppStore.setState({ selectedImage: null });
    renderScreen();
    expect(screen.queryByRole("radiogroup", { name: "Look" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Look" })).toBeNull();
  });

  it("says why Try another is off after its one use", () => {
    mocks.creativeState = { tryAnotherUsed: true };
    renderScreen();
    expect(
      screen.getByRole("button", {
        name: "Try another unavailable. Already used once on this post.",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Try another is available once per post.")).toBeVisible();
  });

  describe("what is previewed is what ships", () => {
    it("tags the store on every channel, even when the post has no per-channel captions", async () => {
      const user = userEvent.setup();
      useAppStore.setState({
        currentDealer: {
          ...dealer,
          facebook_page_tag: "BobMaxeyFordHowell",
          instagram_handle: "bobmaxeyford",
        },
      });
      // basePost has no platformCaptions: one caption, no pack.
      renderScreen();
      await waitFor(() => expect(lastShareOptions().channelId).toBe("facebook_feed"));
      const facebook = lastShareOptions().content.text;
      expect(facebook).toContain("Congratulations to Maria on her new Bronco.");
      expect(facebook.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);
      expect(outboundParts().find((part) => part.part === "body")?.text).toBe(facebook);

      await user.click(screen.getByRole("button", { name: "Instagram" }));
      await waitFor(() => expect(lastShareOptions().channelId).toBe("instagram_feed"));
      const instagram = lastShareOptions().content.text;
      expect(instagram.endsWith("\n\n@bobmaxeyford")).toBe(true);
      expect(instagram).not.toContain("@BobMaxeyFordHowell");
    });

    it("asks for a caption when it is cleared, instead of sharing brand-kit filler", async () => {
      const user = userEvent.setup();
      renderScreen({ isDesktopLayout: true });
      await user.click(screen.getByRole("button", { name: "Edit caption" }));
      const textarea = screen.getByRole("textbox", { name: "Caption" });
      await user.clear(textarea);
      fireEvent.blur(textarea);
      expect(
        await screen.findByText("Write a caption to share this post."),
      ).toBeInTheDocument();
      // The real usePostShare prepares nothing for empty text, so Share, Copy
      // and Download all lock; before, the scanned fallback was filler.
      expect(lastShareOptions().content.text).toBe("");
      expect(screen.getByTestId("post-outbound-preview")).not.toHaveTextContent("#");
    });

    it("derives every channel from the caption on screen, not an unseen AI variant", async () => {
      const user = userEvent.setup();
      renderScreen({
        post: {
          ...basePost,
          platformCaptions: {
            facebook_feed: basePost.text,
            instagram_feed:
              "Maria just drove off in her new Bronco! #BroncoNation #NewRide",
          },
        },
      });
      await user.click(screen.getByRole("button", { name: "Instagram" }));
      await waitFor(() => expect(lastShareOptions().channelId).toBe("instagram_feed"));
      const content = lastShareOptions().content;
      expect(content.text).toContain("Congratulations to Maria on her new Bronco.");
      expect(content.text).not.toContain("#BroncoNation");
      expect(outboundParts().find((part) => part.part === "body")?.text).toBe(
        content.text,
      );
    });

    it("opens an older post with saved per-channel captions and ships the caption on screen to every channel", async () => {
      const user = userEvent.setup();
      // Saved before the app stopped writing a caption per channel.
      const savedCaptions = {
        facebook_feed: "Maria picked up her Bronco today at Bob Maxey Ford of Howell!",
        instagram_feed:
          "Maria just drove off in her new Bronco! #BroncoNation #NewRide",
      };
      renderScreen({ post: { ...basePost, platformCaptions: savedCaptions } });

      // Autosave and the website step still read the saved captions as before.
      expect(mocks.useDraftAutosave).toHaveBeenLastCalledWith(
        expect.objectContaining({
          effectivePack: {
            facebook_feed: basePost.text,
            instagram_feed: basePost.text,
          },
        }),
      );
      expect(mocks.useWebsiteHandoff).toHaveBeenLastCalledWith(
        expect.objectContaining({
          captions: expect.objectContaining({
            effectivePack: {
              facebook_feed: basePost.text,
              instagram_feed: basePost.text,
            },
          }),
        }),
      );

      await waitFor(() => expect(lastShareOptions().channelId).toBe("facebook_feed"));
      const facebook = lastShareOptions().content.text;
      expect(facebook).toContain("Congratulations to Maria on her new Bronco.");
      expect(facebook).not.toContain("picked up her Bronco today");

      await user.click(screen.getByRole("button", { name: "Instagram" }));
      await waitFor(() => expect(lastShareOptions().channelId).toBe("instagram_feed"));
      const instagram = lastShareOptions().content.text;
      expect(instagram).toContain("Congratulations to Maria on her new Bronco.");
      expect(instagram).not.toContain("#BroncoNation");
    });

    it("hands the employee disclosure and the analysed disclosures to every share", () => {
      const text =
        "Congratulations to Maria! Ask us about 0.9% APR financing on a Bronco.";
      renderScreen({ post: { ...basePost, text } });
      const content = lastShareOptions().content;
      expect(content.requiredPrefix).toBe(buildEmployeeDisclosure(dealer));
      expect(content.requiredPrefix).toBe(
        "Posted by a Bob Maxey Ford of Howell team member.",
      );
      expect(content.disclosures).toContain(
        "Financing subject to credit approval through dealer-participating lenders.",
      );
    });

    it("previews the disclosure first, then the caption, then the disclosures", () => {
      const text =
        "Congratulations to Maria! Ask us about 0.9% APR financing on a Bronco.";
      renderScreen({ post: { ...basePost, text } });
      const content = lastShareOptions().content;
      const parts = outboundParts();
      expect(parts.map((part) => part.part)).toEqual(["prefix", "body", "disclosures"]);
      // The preview, read top to bottom, is the caption the destination gets.
      expect(parts.map((part) => part.text).join("\n\n")).toBe(
        fitPublishCaptionToBudget(content, 100_000),
      );
      expect(parts[0].text).toBe(content.requiredPrefix);
      expect(parts[1].text).toBe(content.text);
      expect(parts[2].text).toMatch(/^— Disclosures —\nFinancing subject to credit/);
    });

    it("omits the team-member line when the dealership turned it off", () => {
      useAppStore.setState({
        currentDealer: { ...dealer, employee_disclosure_disabled: true },
      });
      renderScreen();
      expect(lastShareOptions().content.requiredPrefix).toBeUndefined();
      expect(outboundParts().map((part) => part.part)).toEqual(["body"]);
    });
  });

  describe("dealership website", () => {
    it("lets a social post that also goes to the website send its draft", async () => {
      const user = userEvent.setup();
      renderScreen({ post: { ...basePost, websiteDraft } });
      expect(screen.getByRole("group", { name: "Share to" })).toBeInTheDocument();
      const website = screen.getByRole("group", { name: "Dealership website" });
      expect(within(website).getByText("Not sent yet")).toBeInTheDocument();
      await user.click(
        within(website).getByRole("button", { name: "Send website draft" }),
      );
      expect(mocks.websiteSend).toHaveBeenCalledTimes(1);
      expect(mocks.websiteSend).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryLocked: false }),
      );
    });

    it("keeps the website send locked while the post is locked or busy", () => {
      mocks.creativeState = { busy: true };
      const { unmount } = renderScreen({ post: { ...basePost, websiteDraft } });
      expect(screen.getByRole("button", { name: "Send website draft" })).toBeDisabled();
      unmount();

      mocks.creativeState = {};
      renderScreen({
        requiresApproval: true,
        post: { ...basePost, approvalStatus: "pending", websiteDraft },
      });
      const send = screen.getByRole("button", {
        name: /^Send website draft unavailable\. /,
      });
      expect(send).toBeDisabled();
    });

    it("keeps the website retry locked while the post is locked", () => {
      mocks.websiteState = { handoffStarted: true };
      renderScreen({
        requiresApproval: true,
        post: {
          ...basePost,
          approvalStatus: "pending",
          websiteDraft,
          websitePublication: { status: "failed", lastError: "queue_unavailable" },
        },
      });
      expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    });

    it("links to the website draft review once it exists, and offers a retry when it failed", () => {
      mocks.websiteState = {
        reviewUrl: "https://example.com/studio/updates#draft-1",
        handoffStarted: true,
      };
      const { unmount } = renderScreen({
        post: {
          ...basePost,
          websiteDraft,
          websitePublication: { status: "draft_ready" },
        },
      });
      expect(
        screen.getByRole("link", { name: "Review website draft" }),
      ).toHaveAttribute("href", "https://example.com/studio/updates#draft-1");
      expect(screen.getByText("Private draft ready")).toBeInTheDocument();
      unmount();

      mocks.websiteState = { handoffStarted: true };
      renderScreen({
        post: {
          ...basePost,
          websiteDraft,
          websitePublication: { status: "failed", lastError: "queue_unavailable" },
        },
      });
      expect(screen.getByText("Draft didn't send")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(mocks.websiteRetry).toHaveBeenCalledTimes(1);
    });

    it("shows the privacy note for the website draft", () => {
      renderScreen({ post: { ...basePost, websiteDraft } });
      expect(
        screen.getByText(
          "Review the entire image for faces and anything private before it goes on the website.",
        ),
      ).toBeInTheDocument();
    });

    it("keeps a website-only post on its single Send, with the same status and note", async () => {
      const user = userEvent.setup();
      mocks.preparedState = { websiteOnly: true };
      renderScreen({ post: { ...basePost, websiteDraft } });
      expect(screen.queryByRole("group", { name: "Share to" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Share to/ })).toBeNull();
      expect(screen.getByText("Not sent yet")).toBeInTheDocument();
      expect(
        screen.getByText(/^Review the entire image for faces/),
      ).toBeInTheDocument();
      const send = screen.getAllByRole("button", { name: "Send website draft" });
      expect(send).toHaveLength(1);
      await user.click(send[0]);
      expect(mocks.websiteSend).toHaveBeenCalledTimes(1);
    });
  });
  it("keeps unsaved media at risk after only the caption was copied", () => {
    renderScreen({
      post: {
        ...basePost,
        postId: undefined,
        sharedTo: [
          { channel: "facebook_feed", via: "copy", at: "2026-10-07T14:00:00Z" },
        ],
      },
    });
    expect(lastLeaveGuardOptions().hasSavedMedia).toBe(false);
  });

  it("uses saved delivery destinations even if the store defaults have since changed", () => {
    mocks.defaultsOverrides = {
      channels: [{ id: "instagram_feed", label: "Instagram" }],
    };
    renderScreen({ post: { ...basePost, platformIds: ["facebook_feed"] } });
    expect(lastShareOptions().channelId).toBe("facebook_feed");
    expect(screen.queryByRole("button", { name: "Instagram" })).toBeNull();
  });

  it("does not offer caption editing during a creative update", () => {
    mocks.creativeState = { busy: true };
    renderScreen();
    expect(screen.queryByRole("button", { name: "Edit caption" })).toBeNull();
  });

  it("checks only the visible single caption and stages it over hidden legacy variants", () => {
    renderScreen({
      post: {
        ...basePost,
        platformCaptions: { instagram_feed: "Guaranteed credit approval for everyone" },
      },
    });
    expect(lastShareOptions().blockedReason).toBeUndefined();
    expect(mocks.useDraftAutosave).toHaveBeenLastCalledWith(
      expect.objectContaining({ effectivePack: { instagram_feed: basePost.text } }),
    );
  });

  it("previews the exact fitted Google caption before delivery", () => {
    renderScreen({
      post: {
        ...basePost,
        platformIds: ["gbp"],
        scenarioId: "new_arrival",
        customerIdentityRequired: false,
        customerDisplayName: undefined,
        text: "A new arrival on the lot. ".repeat(110),
      },
    });
    const content = lastShareOptions().content;
    const preview = outboundParts()
      .map((part) => part.text)
      .join("\n\n");
    expect(preview).toBe(fitPublishCaptionToBudget(content, 1500));
    expect(preview.length).toBeLessThanOrEqual(1500);
  });
});
