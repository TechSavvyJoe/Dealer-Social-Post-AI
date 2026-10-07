import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSession,
  resolveRestoredCustomerIdentityRequired,
  resolveRestoredImageReviewRequired,
  resolveRestoredStep,
  useAppStore,
} from "../stores/appStore";
import { proxyCapabilities, setProxyCapabilities } from "../services/proxyCapabilities";
import { MODEL_POLICY_VERSION } from "../services/modelConfig";
import { AppStep, StyleOption, ToneOption } from "../types";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } satisfies Storage;
})();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useAppStore.setState({
    currentDealer: null,
    selectedImage: null,
    generatedPost: null,
    generationParams: null,
    step: AppStep.LOGIN,
  });
});

describe("session restore navigation", () => {
  it("fails legacy identity flags closed while preserving explicit non-customer posts", () => {
    expect(resolveRestoredCustomerIdentityRequired(undefined, undefined)).toBe(true);
    expect(resolveRestoredCustomerIdentityRequired(undefined, false)).toBe(false);
    expect(resolveRestoredCustomerIdentityRequired(false, undefined)).toBe(false);
    expect(resolveRestoredCustomerIdentityRequired(true, false)).toBe(true);
  });

  it("quarantines browser-restored creatives without current on-pixel provenance", () => {
    expect(resolveRestoredImageReviewRequired(undefined, undefined)).toBe(true);
    expect(resolveRestoredImageReviewRequired(undefined, "4")).toBe(true);
    expect(resolveRestoredImageReviewRequired(undefined, MODEL_POLICY_VERSION)).toBe(
      false,
    );
    expect(resolveRestoredImageReviewRequired(true, MODEL_POLICY_VERSION)).toBe(true);
    expect(resolveRestoredImageReviewRequired(false, undefined)).toBe(false);
  });

  it("never restores a result step without a complete generated post", () => {
    expect(resolveRestoredStep("salesperson", AppStep.RESULT, false, false)).toBe(
      AppStep.CAPTURE,
    );
    expect(resolveRestoredStep("salesperson", AppStep.RESULT, true, false)).toBe(
      AppStep.CUSTOMIZE,
    );
  });

  it("recovers interrupted generation to the retained customization", () => {
    expect(resolveRestoredStep("salesperson", AppStep.GENERATING, true, false)).toBe(
      AppStep.CUSTOMIZE,
    );
  });

  it("restores a complete result and clamps admin steps to server roles", () => {
    expect(resolveRestoredStep("salesperson", AppStep.RESULT, true, true)).toBe(
      AppStep.RESULT,
    );
    expect(resolveRestoredStep("salesperson", AppStep.ADMIN, false, false)).toBe(
      AppStep.CAPTURE,
    );
    expect(resolveRestoredStep("dealer_admin", AppStep.RESULT, true, true)).toBe(
      AppStep.DEALER_ADMIN,
    );
    expect(resolveRestoredStep("super_admin", AppStep.CAPTURE, false, false)).toBe(
      AppStep.ADMIN,
    );
  });

  it("aborts a session request that exceeds its startup budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          });
        });
      }),
    );

    await expect(fetchSession({ method: "GET" }, 5)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("starts a clean workflow when a different dealer signs in", async () => {
    localStorage.setItem(
      "dealer-social-post-ai.session",
      JSON.stringify({
        dealerId: "dealer-a",
        step: AppStep.RESULT,
        generatedPost: {
          image: "data:image/png;base64,tenant-a",
          text: "Dealer A customer",
        },
      }),
    );
    useAppStore.setState({
      currentDealer: { id: "dealer-a", name: "Dealer A" },
      selectedImage: "data:image/png;base64,tenant-a-photo",
      generatedPost: {
        image: "data:image/png;base64,tenant-a",
        text: "Dealer A customer",
      },
      step: AppStep.RESULT,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            role: "salesperson",
            dealer: { id: "dealer-b", name: "Dealer B" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      useAppStore.getState().login({ authType: "code", dealerCode: "2222" }),
    ).resolves.toEqual({
      ok: true,
    });

    const state = useAppStore.getState();
    expect(state.currentDealer?.id).toBe("dealer-b");
    expect(state.selectedImage).toBeNull();
    expect(state.generatedPost).toBeNull();
    expect(state.generationParams).toBeNull();
    expect(state.step).toBe(AppStep.CAPTURE);

    const persisted = JSON.parse(
      localStorage.getItem("dealer-social-post-ai.session") || "{}",
    );
    expect(persisted.dealerId).toBe("dealer-b");
    expect(persisted.selectedImage).toBeUndefined();
    expect(persisted.generatedPost).toBeUndefined();
    expect(persisted.generationParams).toBeUndefined();
  });

  it("does not resurrect a previous generation plan after returning to Capture", async () => {
    const previousPlan = {
      style: StyleOption.Luxury,
      tone: ToneOption.Promotional,
      customerName: "Previous Customer",
      platformIds: ["facebook_feed", "instagram_reel"],
      mediaOutputMode: "both" as const,
      primaryFormatId: "story_vertical" as const,
      imageAspectRatio: "9:16" as const,
    };
    const dealer = { id: "dealer-a", name: "Dealer A" };
    useAppStore.setState({
      currentDealer: dealer,
      role: "salesperson",
      selectedImage: "data:image/png;base64,previous-photo",
      generatedPost: {
        image: "data:image/png;base64,previous-result",
        text: "Previous post",
      },
      generationParams: null,
      step: AppStep.RESULT,
    });
    useAppStore.getState().setGenerationParams(previousPlan);

    useAppStore.getState().setStep(AppStep.CAPTURE);
    expect(useAppStore.getState().generationParams).toBeNull();
    const persistedAfterBack = JSON.parse(
      localStorage.getItem("dealer-social-post-ai.session") || "{}",
    );
    expect(persistedAfterBack.generationParams).toBeUndefined();

    useAppStore.getState().setSelectedImage("data:image/png;base64,new-customer-photo");
    useAppStore.getState().setStep(AppStep.CUSTOMIZE);
    const persistedAfterNewCapture = JSON.parse(
      localStorage.getItem("dealer-social-post-ai.session") || "{}",
    );
    expect(persistedAfterNewCapture.generationParams).toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            role: "salesperson",
            dealer,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    useAppStore.setState({
      currentDealer: null,
      selectedImage: null,
      generatedPost: null,
      generationParams: previousPlan,
      step: AppStep.LOGIN,
    });

    await useAppStore.getState().restoreSession();

    expect(useAppStore.getState().generationParams).toBeNull();
    const persistedAfterReload = JSON.parse(
      localStorage.getItem("dealer-social-post-ai.session") || "{}",
    );
    expect(persistedAfterReload.generationParams).toBeUndefined();
  });
});

describe("proxy capability negotiation", () => {
  afterEach(() => setProxyCapabilities(undefined));

  const sessionBody = (capabilities?: unknown) => ({
    role: "salesperson",
    dealer: { id: "dealer-capability", name: "Capability Motors" },
    is_impersonation: false,
    ...(capabilities === undefined ? {} : { capabilities }),
  });
  const stubSession = (body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

  it("adopts the advertisement from a restored cookie session (PWA reopen)", async () => {
    stubSession(sessionBody({ veoNegativePrompt: true }));
    await useAppStore.getState().restoreSession();
    expect(proxyCapabilities().veoNegativePrompt).toBe(true);
  });

  it("clears the advertisement when an older backend restores the session", async () => {
    setProxyCapabilities({ veoNegativePrompt: true });
    stubSession(sessionBody());
    await useAppStore.getState().restoreSession();
    expect(proxyCapabilities().veoNegativePrompt).toBeUndefined();
  });

  it("replaces the advertisement on every applyAuthPayload", () => {
    const dealer = { id: "dealer-capability", name: "Capability Motors" } as never;
    useAppStore.getState().applyAuthPayload({
      role: "salesperson",
      dealer,
      capabilities: { veoNegativePrompt: true },
    });
    expect(proxyCapabilities().veoNegativePrompt).toBe(true);
    useAppStore.getState().applyAuthPayload({ role: "salesperson", dealer });
    expect(proxyCapabilities()).toEqual({});
  });
});

describe("a teammate's open app picks up the store's image settings", () => {
  const signedIn = {
    id: "dealer-1",
    name: "Northside Motors",
    logo: "/api/files/dealers/dealer-1/logo_old.png",
    logo_placement: null,
    image_quality_tier: "studio" as const,
  };
  const workPost = { image: "data:image/png;base64,d29yaw==", text: "Draft caption" };
  /** What a manager's save left on the server. */
  const managerChanged = {
    ...signedIn,
    name: "Northside Motors (renamed)",
    logo: "/api/files/dealers/dealer-1/logo_new.png",
    logo_placement: { corner: "top_left", scale: 0.25 },
    image_quality_tier: "standard",
  };
  const sessionAnswer = (body: Record<string, unknown>, status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const salesperson = {
    role: "salesperson",
    person: { id: "person-1" },
    is_impersonation: false,
  };

  const signIn = () =>
    useAppStore.setState({
      currentDealer: { ...signedIn },
      currentPerson: { id: "person-1", name: "Sam", role: "salesperson" } as never,
      role: "salesperson",
      isImpersonating: false,
      isRestoringSession: false,
      generatedPost: workPost,
      step: AppStep.POST,
    });

  it("adopts the new image quality, logo corner and size, and logo, and nothing else", async () => {
    signIn();
    const fetchMock = sessionAnswer({ ...salesperson, dealer: managerChanged });

    await useAppStore.getState().refreshStoreImageSettings();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/session",
      expect.objectContaining({ method: "GET" }),
    );
    const state = useAppStore.getState();
    expect(state.currentDealer).toEqual({
      ...signedIn,
      logo: managerChanged.logo,
      logo_placement: managerChanged.logo_placement,
      image_quality_tier: "standard",
    });
    // The work on screen is untouched.
    expect(state.generatedPost).toBe(workPost);
    expect(state.step).toBe(AppStep.POST);
  });

  it("reads once when the screen and the window both report the app is back", async () => {
    signIn();
    const fetchMock = sessionAnswer({ ...salesperson, dealer: managerChanged });

    await Promise.all([
      useAppStore.getState().refreshStoreImageSettings(),
      useAppStore.getState().refreshStoreImageSettings(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().currentDealer?.image_quality_tier).toBe("standard");
  });

  it.each([
    {
      label: "the session was rejected",
      body: { error: "Invalid session" },
      status: 401,
    },
    { label: "the server failed", body: { error: "UNAVAILABLE" }, status: 503 },
    {
      label: "the cookie now belongs to another person",
      body: { ...salesperson, person: { id: "person-2" }, dealer: managerChanged },
      status: 200,
    },
    {
      label: "the cookie now has another role",
      body: { ...salesperson, role: "dealer_admin", dealer: managerChanged },
      status: 200,
    },
    {
      label: "the cookie now belongs to another store",
      body: { ...salesperson, dealer: { ...managerChanged, id: "dealer-2" } },
      status: 200,
    },
  ])("changes nothing when $label", async ({ body, status }) => {
    signIn();
    const before = useAppStore.getState().currentDealer;
    sessionAnswer(body, status);

    await useAppStore.getState().refreshStoreImageSettings();

    expect(useAppStore.getState().currentDealer).toBe(before);
  });

  it("lets a local save or a sign-out during the read win", async () => {
    signIn();
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    const read = useAppStore.getState().refreshStoreImageSettings();
    // This manager saved Studio while the read was in flight.
    const saved = { ...signedIn, image_quality_tier: "studio" as const };
    useAppStore.setState({ currentDealer: saved });
    answer(
      new Response(JSON.stringify({ ...salesperson, dealer: managerChanged }), {
        status: 200,
      }),
    );
    await read;
    expect(useAppStore.getState().currentDealer).toBe(saved);

    signIn();
    const secondRead = useAppStore.getState().refreshStoreImageSettings();
    useAppStore.setState({ authEpoch: useAppStore.getState().authEpoch + 1 });
    answer(
      new Response(JSON.stringify({ ...salesperson, dealer: managerChanged }), {
        status: 200,
      }),
    );
    await secondRead;
    expect(useAppStore.getState().currentDealer?.image_quality_tier).toBe("studio");
  });

  it("does not read while signed out or while the session is being restored", async () => {
    const fetchMock = sessionAnswer({ ...salesperson, dealer: managerChanged });
    useAppStore.setState({ currentDealer: null });
    await useAppStore.getState().refreshStoreImageSettings();
    signIn();
    useAppStore.setState({ isRestoringSession: true });
    await useAppStore.getState().refreshStoreImageSettings();
    expect(fetchMock).not.toHaveBeenCalled();
    useAppStore.setState({ isRestoringSession: false });
  });
});
