import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import {
  AppStep,
  type Dealer,
  type GeneratedPost,
  type ImageSelection,
} from "../types";
import { useAppStore } from "../stores/appStore";
import type { MainContentProps } from "../components/MainContent";
import type { Header as HeaderComponent } from "../components/Header";
import { usePostLeaveGuard } from "../hooks/usePostLeaveGuard";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import type { PostRecord } from "../services/posts";

/**
 * The app shell's navigation (amendments A4, B5, B10, B13) with the real App,
 * store, controller, URL sync, leave guard and history hook. Only the header
 * and the screens are stand-ins, so each exit is driven exactly as the real
 * controls drive it, and generation is a stub so Cancel's outcome is chosen.
 */
type HeaderProps = React.ComponentProps<typeof HeaderComponent>;

const mocks = vi.hoisted(() => ({
  toast: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    showToast: vi.fn(),
  },
  cancelGeneration: vi.fn(),
  supersedeGeneration: vi.fn(),
  listPostsPage: vi.fn(),
  fetchPostCreativeDataUrl: vi.fn(),
  ui: {
    Header: (() => null) as (props: HeaderProps) => React.ReactNode,
    MainContent: (() => null) as (props: MainContentProps) => React.ReactNode,
  },
}));

vi.mock("../components/Header", () => ({
  Header: (props: HeaderProps) => mocks.ui.Header(props),
}));
vi.mock("../components/MainContent", () => ({
  MainContent: (props: MainContentProps) => mocks.ui.MainContent(props),
}));
vi.mock("../components/ui/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../hooks/useGeneration", () => ({
  useGeneration: () => ({
    cancelGeneration: mocks.cancelGeneration,
    supersedeGeneration: mocks.supersedeGeneration,
    generationStage: "idle",
    partsReady: { image: false, caption: false },
    generationProgress: 0,
    progressMessage: "",
  }),
}));
vi.mock("../hooks/useGemini", () => ({
  useGemini: () => ({}),
  loadGeminiService: vi.fn(async () => ({})),
}));
vi.mock("../hooks/useDealerTheme", () => ({ useDealerTheme: () => undefined }));
vi.mock("../services/publishPipeline", () => ({
  loadPublishPipeline: vi.fn(async () => ({})),
}));
vi.mock("../components/PwaUpdatePrompt", () => ({ PwaUpdatePrompt: () => null }));
vi.mock("../components/OfflineBanner", () => ({ OfflineBanner: () => null }));
vi.mock("../utils/creativeStorage", () => ({
  archiveDealerMedia: vi.fn(async () => null),
  clearAllCreatives: vi.fn(async () => true),
  clearDealerCreatives: vi.fn(async () => undefined),
  loadDealerCreative: vi.fn(async () => null),
  saveDealerCreative: vi.fn(async () => undefined),
}));
vi.mock("../utils/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/telemetry")>()),
  logEvent: vi.fn(),
  logError: vi.fn(),
  logWarning: vi.fn(),
}));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  listPostsPage: mocks.listPostsPage,
  fetchPostCreativeDataUrl: mocks.fetchPostCreativeDataUrl,
}));
vi.mock("../services/websitePublishing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/websitePublishing")>()),
  listWebsiteDestinations: vi.fn(async () => []),
}));

const IMAGE_BUSY = "Wait for the current update to finish before leaving this post.";
const WEBSITE_BUSY =
  "Wait for the final website handoff to finish before leaving this post.";

const dealer = { id: "dealer-1", name: "Example Motors" } as Dealer;
const release = {
  customerName: "Maria Lopez",
  signaturePngDataUrl: "data:image/png;base64,c2lnbmF0dXJl",
};
const workPost: GeneratedPost = {
  image: "data:image/png;base64,d29yaw==",
  text: "A saved post from My work",
  postId: "post-work-1",
  scenarioId: "new_arrival",
};
const homePost: GeneratedPost = {
  image: "data:image/png;base64,aG9tZQ==",
  text: "A saved post from Home",
  postId: "post-home-1",
  scenarioId: "customer_delivery",
};
const reuseSelection: ImageSelection = {
  workingImage: "data:image/jpeg;base64,cmV1c2U=",
  originalSource: "data:image/jpeg;base64,cmV1c2U=",
  originalFilename: "reuse.jpg",
};
const dashboardRecord: PostRecord = {
  id: "post-dash-1",
  dealer: "dealer-1",
  generated_at: "2026-10-01T10:00:00.000Z",
  caption: "Fresh arrivals on the lot this week.",
  scenario_id: "new_arrival",
  creative_image_url: "/api/app/posts/post-dash-1/creative",
};

const FakeHeader = (props: HeaderProps) => (
  <div>
    <p data-testid="flow-title">{props.flowTitle ?? ""}</p>
    {props.onBack && (
      <button type="button" onClick={props.onBack} disabled={props.navigationDisabled}>
        Back
      </button>
    )}
    <button type="button" onClick={props.onShowHistory}>
      My work
    </button>
    <button type="button" onClick={props.onLogout}>
      Log out
    </button>
  </div>
);

/** Stands in for PostScreen: the real leave guard with controllable work. */
const PostProbe = ({ onDone }: { onDone: () => void }) => {
  const [busy, setBusy] = useState<"none" | "image" | "website">("none");
  usePostLeaveGuard({
    hasSavedMedia: true,
    hasCopiedCaption: true,
    captionWasEdited: false,
    imageEditPromptDirty: false,
    videoJobCount: 0,
    imageBusy: busy === "image",
    textBusy: false,
    websiteSending: busy === "website",
  });
  return (
    <section aria-label="Post screen">
      <button type="button" onClick={() => setBusy("image")}>
        Try another
      </button>
      <button type="button" onClick={() => setBusy("website")}>
        Send website draft
      </button>
      <button type="button" onClick={() => setBusy("none")}>
        Finish update
      </button>
      <button type="button" onClick={onDone}>
        Done
      </button>
    </section>
  );
};

/** The dealership dashboard's history list: the real hook, no onPostReady. */
const DashboardHistory = () => {
  const history = usePostHistoryList();
  return (
    <section aria-label="Dealership dashboard">
      <button type="button" onClick={() => void history.openCreative(dashboardRecord)}>
        Open history post
      </button>
    </section>
  );
};

const FakeMain = (props: MainContentProps) => {
  switch (props.displayedStep) {
    case AppStep.HOME:
      return (
        <section aria-label="Home screen">
          <button type="button" onClick={() => props.onOpenPost?.(homePost)}>
            Open preview post
          </button>
        </section>
      );
    case AppStep.DETAILS:
      // The real MainContent renders nothing without a photo: a blank page.
      return props.selectedImage ? <section aria-label="Details screen" /> : null;
    case AppStep.CREATING:
      return (
        <button type="button" onClick={() => props.onCancelGeneration?.()}>
          Cancel
        </button>
      );
    case AppStep.WORK:
      return (
        <section aria-label="My work screen">
          <button type="button" onClick={() => props.onOpenPost?.(workPost)}>
            Open saved post
          </button>
          <button type="button" onClick={() => props.onReusePhoto?.(reuseSelection)}>
            Reuse photo
          </button>
        </section>
      );
    case AppStep.POST:
      return props.generatedPost ? <PostProbe onDone={props.onReset} /> : null;
    case AppStep.DEALER_ADMIN:
      return <DashboardHistory />;
    default:
      return null;
  }
};

mocks.ui.Header = FakeHeader;
mocks.ui.MainContent = FakeMain;

const state = () => useAppStore.getState();
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const popTo = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

const startSignedDetails = () =>
  useAppStore.setState({
    step: AppStep.DETAILS,
    selectedImage: "data:image/jpeg;base64,cGhvdG8=",
    postDraft: {
      categoryId: "deliveries",
      scenarioId: "customer_delivery",
      personalLine: "Congratulations on the new truck",
    },
    pendingRelease: release,
  });

let fetchSpy: ReturnType<typeof vi.spyOn>;

describe("App navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "#/");
    mocks.listPostsPage.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchPostCreativeDataUrl.mockResolvedValue("data:image/png;base64,ZGFzaA==");
    mocks.cancelGeneration.mockReturnValue({ status: "idle" });
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    useAppStore.setState({
      currentDealer: dealer,
      currentPerson: null,
      role: "salesperson",
      isImpersonating: false,
      step: AppStep.HOME,
      selectedImage: null,
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      generatedPost: null,
      generationParams: null,
      postWorkAtRisk: false,
      postBusy: null,
      postReturnStep: null,
      error: null,
      theme: "dark",
      isRestoringSession: false,
      restoreSession: async () => undefined,
    });
  });

  it("refuses every exit from the Post screen while a render or the website handoff runs (A4)", () => {
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: workPost,
      postReturnStep: AppStep.WORK,
    });
    render(<App />);
    click("Try another");
    expect(state().postBusy).toBe("image");

    const exits: Array<[string, () => void]> = [
      ["header Back", () => click("Back")],
      ["My work", () => click("My work")],
      ["Log out", () => click("Log out")],
      ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
      ["Done", () => click("Done")],
      ["browser Back", () => popTo("#/work")],
    ];
    for (const [exit, leave] of exits) {
      mocks.toast.warning.mockClear();
      leave();
      expect(state().step, exit).toBe(AppStep.POST);
      expect(mocks.toast.warning, exit).toHaveBeenCalledExactlyOnceWith(IMAGE_BUSY);
    }
    expect(window.location.hash).toBe("#/post");
    expect(state().currentDealer).toBe(dealer);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    click("Send website draft");
    for (const leave of [() => click("Back"), () => popTo("#/home")]) {
      mocks.toast.warning.mockClear();
      leave();
      expect(state().step).toBe(AppStep.POST);
      expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith(WEBSITE_BUSY);
    }

    // Once it settles, the reopened post goes back where it came from.
    click("Finish update");
    expect(state().postBusy).toBeNull();
    click("Back");
    expect(state().step).toBe(AppStep.WORK);
  });

  it("header Back from a fresh unsaved post confirms, then remixes on Details (B10)", () => {
    useAppStore.setState({
      step: AppStep.POST,
      selectedImage: "data:image/jpeg;base64,cGhvdG8=",
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      generatedPost: { image: "data:image/png;base64,ZnJlc2g=", text: "Fresh" },
    });
    render(<App />);
    expect(screen.getByTestId("flow-title")).toHaveTextContent("Delivery");
    click("Back");
    expect(screen.getByRole("dialog", { name: "Leave this post?" })).toBeVisible();
    click("Leave anyway");
    expect(state().step).toBe(AppStep.DETAILS);
    expect(state().generatedPost).toBeNull();
    expect(screen.getByTestId("flow-title")).toHaveTextContent("Delivery");
  });

  it("Details -> My work -> My work -> Back returns to Details with the photo and signature intact", () => {
    startSignedDetails();
    render(<App />);
    expect(screen.getByTestId("flow-title")).toHaveTextContent("Delivery");
    click("My work");
    expect(state().step).toBe(AppStep.WORK);
    expect(screen.getByTestId("flow-title")).toHaveTextContent("My work");
    click("My work");
    expect(state().step).toBe(AppStep.WORK);
    click("Back");
    expect(state().step).toBe(AppStep.DETAILS);
    expect(screen.getByRole("region", { name: "Details screen" })).toBeInTheDocument();
    expect(state().selectedImage).toBe("data:image/jpeg;base64,cGhvdG8=");
    expect(state().pendingRelease).toBe(release);
    expect(state().postDraft?.personalLine).toBe("Congratulations on the new truck");
  });

  it("opening a saved post over a signed Details draft asks to discard it first (B13)", () => {
    startSignedDetails();
    render(<App />);
    click("My work");
    click("Open saved post");
    const dialog = screen.getByRole("dialog", {
      name: "Discard the post in progress?",
    });
    expect(dialog).toHaveAccessibleDescription(
      "Your photo, details and the customer's signature will be cleared.",
    );
    expect(state().step).toBe(AppStep.WORK);
    expect(state().pendingRelease).toBe(release);

    click("Keep working");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state().pendingRelease).toBe(release);
    expect(state().generatedPost).toBeNull();

    click("Open saved post");
    click("Discard post");
    expect(state().step).toBe(AppStep.POST);
    expect(state().generatedPost).toBe(workPost);
    expect(state().pendingRelease).toBeNull();
    expect(state().selectedImage).toBeNull();
    expect(screen.getByTestId("flow-title")).toHaveTextContent("New arrival");

    // Back, Back: My work, then Home. Never the emptied Details.
    click("Back");
    expect(state().step).toBe(AppStep.WORK);
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
  });

  it("reusing a photo over a signed Details draft asks to discard it first (B13)", () => {
    startSignedDetails();
    render(<App />);
    click("My work");
    click("Reuse photo");
    expect(
      screen.getByRole("dialog", { name: "Discard the post in progress?" }),
    ).toBeVisible();
    expect(mocks.supersedeGeneration).not.toHaveBeenCalled();
    click("Discard post");
    expect(mocks.supersedeGeneration).toHaveBeenCalled();
    expect(state().step).toBe(AppStep.HOME);
    expect(state().pendingPhoto).toBe(reuseSelection);
    expect(state().pendingRelease).toBeNull();
  });

  it("a post reopened over a finished post forgets the old return: My work, then Home (B13)", () => {
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: homePost,
      postReturnStep: null,
    });
    render(<App />);
    click("My work");
    click("Open saved post");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state().generatedPost).toBe(workPost);
    click("Back");
    expect(state().step).toBe(AppStep.WORK);
    // Not back round to the post just left, which is no longer the workspace.
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
  });

  it("header Back, Escape and browser Back from a signed Details ask before clearing it (B13)", () => {
    startSignedDetails();
    render(<App />);
    const exits: Array<[string, () => void]> = [
      ["header Back", () => click("Back")],
      ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
      ["browser Back", () => popTo("#/home")],
    ];
    for (const [exit, leave] of exits) {
      leave();
      expect(
        screen.getByRole("dialog", { name: "Discard the post in progress?" }),
        exit,
      ).toHaveAccessibleDescription(
        "Your photo, details and the customer's signature will be cleared.",
      );
      click("Keep working");
      expect(state().step, exit).toBe(AppStep.DETAILS);
      expect(state().pendingRelease, exit).toBe(release);
      expect(window.location.hash, exit).toBe("#/details");
    }

    click("Back");
    click("Discard post");
    expect(state().step).toBe(AppStep.HOME);
    expect(state().pendingRelease).toBeNull();
    expect(state().postDraft).toBeNull();
  });

  it("header Back from an unsigned Details goes straight Home", () => {
    useAppStore.setState({
      step: AppStep.DETAILS,
      selectedImage: "data:image/jpeg;base64,cGhvdG8=",
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
    });
    render(<App />);
    click("Back");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state().step).toBe(AppStep.HOME);
  });

  it("browser Back out of My work spends its return step, so Back never bounces to the post", () => {
    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: workPost,
      postReturnStep: AppStep.WORK,
    });
    render(<App />);
    click("My work");
    expect(state().step).toBe(AppStep.WORK);
    popTo("#/post");
    expect(state().step).toBe(AppStep.POST);
    click("Back");
    expect(state().step).toBe(AppStep.WORK);
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
  });

  it("opens a saved post straight away when there is no draft to lose", () => {
    render(<App />);
    click("My work");
    click("Open saved post");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state().step).toBe(AppStep.POST);
    expect(state().postReturnStep).toBe(AppStep.WORK);
  });

  it("a stale return never renders a blank Details or an empty Post", () => {
    startSignedDetails();
    const { unmount } = render(<App />);
    click("My work");
    // The draft went away while My work was open.
    act(() => state().setSelectedImage(null));
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
    expect(screen.getByRole("region", { name: "Home screen" })).toBeInTheDocument();
    unmount();

    useAppStore.setState({
      step: AppStep.POST,
      generatedPost: workPost,
      postReturnStep: null,
    });
    render(<App />);
    click("My work");
    act(() => state().setGeneratedPost(null));
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
  });

  it("a post opened from the dealership dashboard's history returns to the dashboard", async () => {
    useAppStore.setState({ role: "dealer_admin", step: AppStep.DEALER_ADMIN });
    render(<App />);
    click("Open history post");
    await waitFor(() => expect(state().step).toBe(AppStep.POST));
    expect(state().postReturnStep).toBe(AppStep.DEALER_ADMIN);
    expect(state().generatedPost?.postId).toBe("post-dash-1");
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Post reopened. Share it without making a new one.",
    );
    expect(screen.getByTestId("flow-title")).toHaveTextContent("New arrival");
    click("Back");
    expect(state().step).toBe(AppStep.DEALER_ADMIN);
  });

  it("a post opened from Home's My work preview returns to Home", () => {
    render(<App />);
    click("Open preview post");
    expect(state().step).toBe(AppStep.POST);
    expect(screen.getByTestId("flow-title")).toHaveTextContent("Delivery");
    click("Back");
    expect(state().step).toBe(AppStep.HOME);
  });

  it.each([
    [false, undefined, "Saved to My work as a draft"],
    [true, undefined, "Saved to My work · waiting for approval"],
    [true, { mode: "always" }, "Saved to My work · waiting for approval"],
    [true, { mode: "per_category", categories: ["deliveries"] }, "Saved to My work"],
    [true, { mode: "first_n", firstN: 3 }, "Saved to My work"],
    [true, '{"mode":"first_n","firstN":3}', "Saved to My work"],
    [
      false,
      { mode: "per_category", categories: ["deliveries"] },
      "Saved to My work as a draft",
    ],
  ] as const)(
    "Cancel after the save started (requiresApproval %s, policy %j) ends with %j (B5)",
    async (requiresApproval, policy, outcome) => {
      useAppStore.setState({
        step: AppStep.CREATING,
        currentDealer: {
          ...dealer,
          requires_approval: requiresApproval,
          approval_policy: policy as Dealer["approval_policy"],
        },
        selectedImage: "data:image/jpeg;base64,cGhvdG8=",
        postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      });
      mocks.cancelGeneration.mockReturnValue({
        status: "saving",
        requiresApproval,
        saved: Promise.resolve(true),
      });
      render(<App />);
      click("Cancel");
      expect(mocks.cancelGeneration).toHaveBeenCalledTimes(1);
      expect(mocks.toast.info).toHaveBeenCalledWith("Finishing the save in My work…");
      await waitFor(() => expect(mocks.toast.info).toHaveBeenLastCalledWith(outcome));
      expect(mocks.toast.info).toHaveBeenCalledTimes(2);
      expect(mocks.toast.warning).not.toHaveBeenCalled();
    },
  );

  it("Cancel says so when the save it left running fails, and nothing when nothing ran (B5)", async () => {
    useAppStore.setState({
      step: AppStep.CREATING,
      selectedImage: "data:image/jpeg;base64,cGhvdG8=",
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
    });
    mocks.cancelGeneration.mockReturnValueOnce({
      status: "saving",
      requiresApproval: true,
      saved: Promise.resolve(false),
    });
    render(<App />);
    click("Cancel");
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        "The post could not be saved. Your photo is still in Details.",
      ),
    );
    expect(mocks.toast.info).toHaveBeenCalledTimes(1);

    mocks.toast.info.mockClear();
    mocks.cancelGeneration.mockReturnValueOnce({ status: "cancelled" });
    click("Cancel");
    await act(async () => undefined);
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("titles each flow screen by its category tile, falling back to Post", () => {
    useAppStore.setState({
      step: AppStep.DETAILS,
      selectedImage: "data:image/jpeg;base64,cGhvdG8=",
      postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
    });
    const { unmount } = render(<App />);
    expect(screen.getByTestId("flow-title")).toHaveTextContent("New arrival");
    unmount();
    useAppStore.setState({
      step: AppStep.DETAILS,
      postDraft: { categoryId: "deliveries", scenarioId: "not_a_home_tile" },
    });
    render(<App />);
    expect(screen.getByTestId("flow-title")).toHaveTextContent(/^Post$/);
  });
  it("asks before logging out and discarding a customer's signed Details draft", () => {
    startSignedDetails();
    render(<App />);
    click("Log out");
    expect(
      screen.getByRole("dialog", { name: "Discard the post in progress?" }),
    ).toBeInTheDocument();
    expect(state().pendingRelease).toBe(release);
    click("Keep working");
    expect(state().step).toBe(AppStep.DETAILS);
    expect(state().pendingRelease).toBe(release);
  });
});
