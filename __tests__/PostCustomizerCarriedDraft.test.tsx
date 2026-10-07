/**
 * C2: the Details draft survives the remount a Cancel or a failed attempt
 * sends Details through, the signed release and the personal line included.
 *
 * The release is in memory only. useGeneration's onMutate writes it onto the
 * store's generationParams (hooks/useGeneration.test.tsx proves that payload),
 * and Details reads it back from pendingRelease and postDraft when it
 * remounts. These tests drive the real PostDetails and the real store. Only
 * the release sheet is replaced (a canvas cannot be drawn on in jsdom) and the
 * A1 "already linked" lookup is made controllable (its real bookkeeping is
 * proven in the hook's tests; PostDetails.test.tsx proves Details drops a
 * linked release).
 *
 * The file keeps its old name; the retired customizer's own cases were deleted
 * with that screen.
 */
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostDetails } from "../components/PostDetails";
import { useAppStore } from "../stores/appStore";
import type { CapturedRelease } from "../services/photoReleases";
import { AppStep, StyleOption, ToneOption, type Dealer } from "../types";

const mocks = vi.hoisted(() => ({
  linked: new WeakSet<object>(),
  nextRelease: null as CapturedRelease | null,
}));

vi.mock("../hooks/useGeneration", () => ({
  isReleaseAlreadyLinked: (release: CapturedRelease | null | undefined) =>
    Boolean(release && mocks.linked.has(release)),
}));

vi.mock("../components/details/ReleaseSheet", () => ({
  ReleaseSheet: ({
    onCaptured,
    onCancel,
  }: {
    onCaptured: (release: CapturedRelease) => void;
    onCancel: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (mocks.nextRelease) onCaptured(mocks.nextRelease);
        onCancel();
      }}
    >
      Sign release
    </button>
  ),
}));

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
Object.assign(global.navigator, { vibrate: vi.fn() });

const STORAGE_KEY = "dealer-social-post-ai.session";
const SIGNATURE = "data:image/png;base64,c2lnbmF0dXJlLXN0cm9rZXM=";
const PERSONAL_LINE = "Stop by and say hi on the lot.";

/** Creative system on, so the personal line control renders. */
const CREATIVE_DEALER = {
  id: "dealer-brand",
  name: "Test Motors",
  creative_system_v2: true,
  signature_look: "hometown",
  playful_style: "pixar",
} as Dealer;

const signedRelease = (): CapturedRelease => ({
  customerName: "Alex Johnson",
  signaturePngDataUrl: SIGNATURE,
});

type OnGenerate = React.ComponentProps<typeof PostDetails>["onGenerate"];

/**
 * What useGeneration's onMutate records before the step leaves Details: the
 * storable choices plus, in memory only, the release and the personal line.
 */
const recordLikeOnMutate: OnGenerate = async (
  style,
  tone,
  customerName,
  customText,
  creativeBrief,
  meta,
) => {
  const carried = meta as
    | { scenarioId?: string; capturedRelease?: CapturedRelease; personalLine?: string }
    | undefined;
  useAppStore.getState().setStep(AppStep.GENERATING);
  useAppStore.getState().setGenerationParams({
    style,
    tone,
    customerName,
    customText,
    creativeBrief,
    scenarioId: carried?.scenarioId,
    ...(carried?.capturedRelease ? { capturedRelease: carried.capturedRelease } : {}),
    ...(carried?.personalLine ? { personalLine: carried.personalLine } : {}),
  });
};

const storedSession = () => localStorage.getItem(STORAGE_KEY) ?? "";

beforeEach(() => {
  mocks.linked = new WeakSet<object>();
  mocks.nextRelease = null;
  localStorage.clear();
  useAppStore.setState({
    currentDealer: CREATIVE_DEALER,
    role: "salesperson",
    selectedImage: null,
    generatedPost: null,
    generationParams: null,
    error: null,
    step: AppStep.CUSTOMIZE,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useAppStore.setState({
    currentDealer: null,
    generationParams: null,
    step: AppStep.LOGIN,
  });
});

/** The Details signature row: a "Signed" badge and the customer's name. */
const signatureRow = () =>
  screen.getByRole("button", { name: /^Customer's signature/ });
const expectSignedBy = (name: string) => {
  const row = within(signatureRow());
  expect(row.getByText("Signed")).toBeInTheDocument();
  expect(row.getByText(name)).toBeInTheDocument();
};

describe("Details draft carried through a Cancel or failed-attempt remount", () => {
  it("hands the signed release and the personal line back after Generate then Cancel, without re-signing", async () => {
    const onGenerate = vi.fn(recordLikeOnMutate);
    useAppStore.setState({
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      pendingRelease: null,
    });
    const renderDetails = () => (
      <PostDetails
        imageSrc="data:image/png;base64,cGhvdG8="
        onGenerate={onGenerate}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />
    );
    const { unmount } = render(renderDetails());

    // A new post: nothing is carried in.
    fireEvent.click(screen.getByRole("button", { name: /Anything to mention/i }));
    const line = await screen.findByLabelText(/Anything to mention/i);
    expect(line).toHaveValue("");
    expect(within(signatureRow()).queryByText("Signed")).toBeNull();

    // Sign, type the line, Create post.
    const captured = signedRelease();
    mocks.nextRelease = captured;
    fireEvent.click(screen.getByRole("button", { name: /Get customer's signature/i }));
    fireEvent.click(screen.getByRole("button", { name: "Sign release" }));
    expectSignedBy("Alex Johnson");
    fireEvent.change(line, { target: { value: PERSONAL_LINE } });
    fireEvent.click(screen.getByRole("button", { name: /Create post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().generationParams).toMatchObject({
      capturedRelease: captured,
      personalLine: PERSONAL_LINE,
    });

    // Creating: Details unmounts.
    unmount();
    expect(screen.queryByLabelText(/Anything to mention/i)).not.toBeInTheDocument();

    // Cancel returns to Details and remounts from postDraft + pendingRelease.
    act(() => useAppStore.getState().setStep(AppStep.DETAILS));
    render(renderDetails());
    expect(await screen.findByLabelText(/Anything to mention/i)).toHaveValue(
      PERSONAL_LINE,
    );
    expectSignedBy("Alex Johnson");

    // The retry runs on the same signature: no second pad, no new release.
    mocks.nextRelease = null;
    fireEvent.click(screen.getByRole("button", { name: /Create post/i }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Sign release" }),
    ).not.toBeInTheDocument();
    const retryMeta = onGenerate.mock.calls[1][5] as {
      capturedRelease?: CapturedRelease;
      personalLine?: string;
    };
    expect(retryMeta.capturedRelease).toBe(captured);
    expect(retryMeta.personalLine).toBe(PERSONAL_LINE);
    expect(onGenerate.mock.calls[1][4]).toContain(`"${PERSONAL_LINE}"`);

    // Neither in-memory field ever reached storage on the way round. (The
    // line's text rides in the creative brief, which is stored as before.)
    const stored = JSON.parse(storedSession()) as { generationParams?: object };
    expect(stored.generationParams).toMatchObject({ customerName: "Alex" });
    expect(stored.generationParams).not.toHaveProperty("capturedRelease");
    expect(stored.generationParams).not.toHaveProperty("personalLine");
    expect(storedSession()).not.toContain(SIGNATURE);
  });

  it("gives a restored session no signature and no personal line, so Details asks for a fresh signature", async () => {
    const carried = signedRelease();
    // In this session: the draft is on the store and was saved (stripped).
    act(() => {
      useAppStore.getState().setPostDraft({
        categoryId: "deliveries",
        scenarioId: "customer_delivery",
        personalLine: PERSONAL_LINE,
      });
      useAppStore.getState().setGenerationParams({
        style: StyleOption.Modern,
        tone: ToneOption.Excited,
        customerName: "Alex",
        scenarioId: "customer_delivery",
        capturedRelease: carried,
        personalLine: PERSONAL_LINE,
      });
    });
    expect(storedSession()).not.toContain(SIGNATURE);
    expect(storedSession()).not.toContain(PERSONAL_LINE);
    // Even a copy an older build left in storage must not come back.
    const legacy = JSON.parse(storedSession()) as {
      generationParams: Record<string, unknown>;
    };
    legacy.generationParams.capturedRelease = carried;
    legacy.generationParams.personalLine = PERSONAL_LINE;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    // Reload: a fresh store is rebuilt from storage and the session cookie.
    useAppStore.setState({
      currentDealer: null,
      selectedImage: null,
      generatedPost: null,
      generationParams: null,
      postDraft: null,
      pendingRelease: null,
      step: AppStep.LOGIN,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ role: "salesperson", dealer: CREATIVE_DEALER }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await act(async () => {
      await useAppStore.getState().restoreSession();
    });
    const restored = useAppStore.getState();
    expect(restored.generationParams).toMatchObject({ customerName: "Alex" });
    expect(restored.generationParams).not.toHaveProperty("capturedRelease");
    expect(restored.generationParams).not.toHaveProperty("personalLine");
    expect(restored.pendingRelease).toBeNull();
    expect(restored.postDraft).toMatchObject({ scenarioId: "customer_delivery" });
    expect(restored.postDraft).not.toHaveProperty("personalLine");
    expect(storedSession()).not.toContain(SIGNATURE);
    expect(storedSession()).not.toContain(PERSONAL_LINE);

    // Details on the restored draft shows no signature and asks for one.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    render(
      <PostDetails
        imageSrc="data:image/png;base64,cGhvdG8="
        onGenerate={vi.fn()}
        onBack={vi.fn()}
        onChangePhoto={vi.fn()}
      />,
    );
    expect(within(signatureRow()).queryByText("Signed")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Get customer's signature/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Create post/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Anything to mention/i }));
    expect(await screen.findByLabelText(/Anything to mention/i)).toHaveValue("");
  });
});
