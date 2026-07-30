import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MainContent } from "../components/MainContent";
import {
  AppStep,
  StyleOption,
  ToneOption,
  type Dealer,
  type GeneratedPost,
  type GenerationParams,
} from "../types";

const mocks = vi.hoisted(() => ({
  state: {
    generationParams: null as GenerationParams | null,
  },
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) =>
    selector(mocks.state),
}));

vi.mock("../components/PostCustomizer", () => ({
  PostCustomizer: (props: {
    initialGenerationParams?: GenerationParams | null;
    onGenerate: (...args: unknown[]) => Promise<void>;
  }) => (
    <div>
      <output data-testid="customizer-seed">
        {JSON.stringify(props.initialGenerationParams ?? null)}
      </output>
      <button
        type="button"
        onClick={() =>
          void props.onGenerate(
            StyleOption.Sporty,
            ToneOption.Professional,
            "Alex",
            "Alex found the perfect SUV.",
            "Retry-safe creative brief.",
            { scenarioId: "preowned_spotlight" },
            ["gbp"],
            {
              primaryFormatId: "gbp",
              imageAspectRatio: "4:3",
              label: "Google Business · 4:3",
            },
            "both",
          )
        }
      >
        Generate from editor
      </button>
    </div>
  ),
}));

vi.mock("../components/PostResult", () => ({
  PostResult: ({ onRemix }: { onRemix: () => void }) => (
    <button type="button" onClick={onRemix}>
      Remix result
    </button>
  ),
}));

vi.mock("../components/CameraCapture", () => ({
  ImageInput: () => <div>Camera step</div>,
}));

const dealer = {
  id: "dealer-1",
  name: "Example Motors",
} as Dealer;

const persistedParams: GenerationParams = {
  style: StyleOption.Modern,
  tone: ToneOption.Excited,
  customerName: "Alex",
  platformIds: ["facebook_feed", "gbp"],
  mediaOutputMode: "both",
  primaryFormatId: "marketplace",
  imageAspectRatio: "16:9",
};

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  displayedStep: AppStep.CUSTOMIZE,
  step: AppStep.CUSTOMIZE,
  currentDealer: dealer,
  selectedImage: "data:image/png;base64,cGhvdG8=",
  generatedPost: null as GeneratedPost | null,
  error: null,
  preferredStyle: StyleOption.Modern,
  preferredTone: ToneOption.Excited,
  isDesktopLayout: false,
  generationProgress: 0,
  progressMessage: "",
  onLogin: vi.fn(),
  onImageSelected: vi.fn(),
  onReset: vi.fn(),
  onRemix: vi.fn(),
  onDismissError: vi.fn(),
  onGenerate: vi.fn().mockResolvedValue(undefined),
  onBackToCapture: vi.fn(),
  onStyleToneChange: vi.fn(),
  onRegenerateImage: vi.fn().mockResolvedValue(undefined),
  onEditImage: vi.fn().mockResolvedValue(undefined),
  onRegenerateText: vi.fn().mockResolvedValue(undefined),
  onEditText: vi.fn().mockResolvedValue(""),
  onFunMode: vi.fn().mockResolvedValue(undefined),
  onGenerateVideo: vi.fn().mockResolvedValue(""),
  ...overrides,
});

describe("MainContent customizer delivery-plan persistence", () => {
  beforeEach(() => {
    mocks.state.generationParams = null;
  });

  it("hydrates persisted choices when a CUSTOMIZE session is restored", async () => {
    mocks.state.generationParams = persistedParams;
    render(<MainContent {...makeProps()} />);

    expect(await screen.findByTestId("customizer-seed")).toHaveTextContent(
      JSON.stringify(persistedParams),
    );
  });

  it("does not leak stale persisted choices from Capture into a new post", async () => {
    mocks.state.generationParams = persistedParams;
    const { rerender } = render(
      <MainContent
        {...makeProps({
          displayedStep: AppStep.CAPTURE,
          step: AppStep.CAPTURE,
          selectedImage: null,
        })}
      />,
    );

    expect(await screen.findByText("Camera step")).toBeInTheDocument();
    rerender(<MainContent {...makeProps()} />);

    expect(await screen.findByTestId("customizer-seed")).toHaveTextContent("null");
  });

  it("uses the result's exact delivery profile when remixing the same photo", async () => {
    mocks.state.generationParams = persistedParams;
    const generatedPost: GeneratedPost = {
      image: "data:image/png;base64,b3V0cHV0",
      text: "Caption",
      platformIds: ["gbp"],
      mediaOutputMode: "video",
      primaryFormatId: "gbp",
      imageAspectRatio: "4:3",
    };
    const props = makeProps({
      displayedStep: AppStep.RESULT,
      step: AppStep.RESULT,
      generatedPost,
    });
    const { rerender } = render(<MainContent {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remix result" }));
    expect(props.onRemix).toHaveBeenCalledOnce();

    rerender(<MainContent {...makeProps()} />);
    const restored = JSON.parse(
      (await screen.findByTestId("customizer-seed")).textContent || "null",
    ) as GenerationParams;
    expect(restored).toMatchObject({
      platformIds: ["gbp"],
      mediaOutputMode: "video",
      primaryFormatId: "gbp",
      imageAspectRatio: "4:3",
    });
  });

  it("captures exact editor choices before generation unmounts the editor", async () => {
    const props = makeProps();
    render(<MainContent {...props} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate from editor" }),
    );

    expect(props.onGenerate).toHaveBeenCalledWith(
      StyleOption.Sporty,
      ToneOption.Professional,
      "Alex",
      "Alex found the perfect SUV.",
      "Retry-safe creative brief.",
      { scenarioId: "preowned_spotlight" },
      ["gbp"],
      expect.objectContaining({
        primaryFormatId: "gbp",
        imageAspectRatio: "4:3",
      }),
      "both",
    );
  });

  it("round-trips the safe editor seed through a failed generation remount", async () => {
    const props = makeProps();
    const { rerender } = render(<MainContent {...props} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate from editor" }),
    );
    rerender(
      <MainContent
        {...props}
        displayedStep={AppStep.GENERATING}
        step={AppStep.GENERATING}
      />,
    );
    rerender(<MainContent {...props} />);

    const restored = JSON.parse(
      (await screen.findByTestId("customizer-seed")).textContent || "null",
    ) as GenerationParams;
    expect(restored).toMatchObject({
      style: StyleOption.Sporty,
      tone: ToneOption.Professional,
      customerName: "Alex",
      customText: "Alex found the perfect SUV.",
      creativeBrief: "Retry-safe creative brief.",
      scenarioId: "preowned_spotlight",
      platformIds: ["gbp"],
      mediaOutputMode: "both",
      primaryFormatId: "gbp",
      imageAspectRatio: "4:3",
    });
  });
});
