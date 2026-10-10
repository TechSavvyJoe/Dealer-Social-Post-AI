import React, { useMemo, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainContent, type MainContentProps } from "../components/MainContent";
import { useAppStore } from "../stores/appStore";
import { usePreparedDelivery } from "../hooks/usePreparedDelivery";
import { AppStep, type GeneratedPost } from "../types";

const media = vi.hoisted(() => ({ format: vi.fn() }));
vi.mock("../utils/multiFormatExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/multiFormatExport")>()),
  renderFormatIfNeeded: media.format,
}));
vi.mock("../utils/mediaSave", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/mediaSave")>()),
  prepareMediaForSave: async ({ basename }: { basename: string }) => ({
    kind: "image",
    filename: `${basename}.jpg`,
    file: new File(["formatted"], `${basename}.jpg`, { type: "image/jpeg" }),
  }),
}));

vi.mock("../components/ui/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../components/PostScreen", () => ({
  PostScreen: ({ post }: { post: GeneratedPost }) => {
    const [caption, setCaption] = useState("local caption edit");
    const video = useMemo(
      () => ({
        videoJobs: [],
        videoUrl: null,
        adoptVideoUrl: vi.fn(),
        manualVideoSelected: false,
        setManualVideoSelected: vi.fn(),
        currentVideoCreativeKey: "creative",
        videoJobForDelivery: () => undefined,
      }),
      [],
    );
    const delivery = usePreparedDelivery({
      post,
      resultIdentity: post.postId || "attempt-1",
      websiteEnabled: false,
      video,
    });
    return (
      <>
        <img alt="Formatted result" src={delivery.formattedPreviewUrl || post.image} />
        <input
          aria-label="Caption draft"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
        <output aria-label="Current saved post">
          {post.postId || "unsaved"}:{post.postRevision || "no-revision"}
        </output>
      </>
    );
  },
}));

const post: GeneratedPost = {
  image: "same-generated-image",
  text: "generated caption",
  saveOperationId: "operation-1",
  platformIds: ["instagram_feed"],
};
const propsFor = (generatedPost: GeneratedPost, dealerId = "dealer-1") =>
  ({
    displayedStep: AppStep.POST,
    step: AppStep.POST,
    currentDealer: { id: dealerId, name: "Test Dealer" },
    generatedPost,
  }) as unknown as MainContentProps;

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useAppStore.setState({ authEpoch: 1, role: "salesperson" });
  media.format.mockReset().mockImplementation(async (source: string) => source);
  let url = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:integration-${++url}`),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ walkaround: false }) }),
  );
});

describe("MainContent recovered post identity", () => {
  it("keeps local preview state when a save adopts its ID, while receiving fresh saved props", async () => {
    const { rerender } = render(<MainContent {...propsFor(post)} />);
    const draft = await screen.findByRole("textbox", { name: "Caption draft" });
    fireEvent.change(draft, { target: { value: "Unsaved local correction" } });
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Formatted result" })).toHaveAttribute(
        "src",
        "blob:integration-1",
      ),
    );
    let finish!: (source: string) => void;
    media.format.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    rerender(
      <MainContent
        {...propsFor({ ...post, postId: "saved-1", postRevision: "revision-2" })}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Caption draft" })).toHaveValue(
      "Unsaved local correction",
    );
    expect(screen.getByRole("img", { name: "Formatted result" })).toHaveAttribute(
      "src",
      "blob:integration-1",
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:integration-1");
    await act(async () => finish("same-formatted-source"));
    expect(screen.getByLabelText("Current saved post")).toHaveTextContent(
      "saved-1:revision-2",
    );
  });

  it.each(["operation", "dealer", "auth"])(
    "resets local post state across a different %s",
    async (boundary) => {
      const { rerender } = render(<MainContent {...propsFor(post)} />);
      fireEvent.change(await screen.findByRole("textbox", { name: "Caption draft" }), {
        target: { value: "Private local correction" },
      });
      if (boundary === "auth") act(() => useAppStore.setState({ authEpoch: 2 }));
      rerender(
        <MainContent
          {...propsFor(
            boundary === "operation"
              ? { ...post, saveOperationId: "operation-2" }
              : post,
            boundary === "dealer" ? "dealer-2" : "dealer-1",
          )}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "Caption draft" })).toHaveValue(
          "local caption edit",
        ),
      );
    },
  );
});
