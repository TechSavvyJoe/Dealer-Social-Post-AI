import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftAutosave } from "../hooks/useDraftAutosave";
import { updatePostDraft } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import {
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
} from "../utils/complianceDisclosures";

vi.mock("../services/posts", () => ({ updatePostDraft: vi.fn() }));

const post = {
  postId: "post12345678901",
  postRevision: "2026-10-07 12:00:00.000Z",
  image: "data:image/jpeg;base64,saved",
  text: "Take a look at our latest arrival!",
};
const draft = (imageDataUrl: string) => ({
  caption: post.text,
  disclosures: "",
  imageDataUrl,
});
const options = {
  post,
  editable: true,
  primaryCaption: post.text,
  captionAnalysis: analyzeCaptionForDelivery(post.text),
  captionSetAnalysis: analyzeCaptionSetForDelivery([post.text]),
  identityLocked: false,
  grounding: { dealerName: "Example Ford" },
};
const renderAutosave = () => renderHook(() => useDraftAutosave(options));

describe("exact-creative draft image saves", () => {
  beforeEach(() => {
    vi.mocked(updatePostDraft).mockReset();
    vi.mocked(updatePostDraft).mockResolvedValue({
      id: post.postId,
      updated: true,
      post_revision: "2026-10-07 12:00:01.000Z",
    });
    useAppStore.setState({ generatedPost: { ...post } });
  });

  afterEach(cleanup);

  it("omits the already-saved image at a website handoff save boundary", async () => {
    const { result } = renderAutosave();
    await act(async () => {
      result.current.stage(draft(post.image));
      expect(await result.current.flush()).toBe(true);
    });
    expect(updatePostDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(updatePostDraft).mock.lastCall?.[1].imageDataUrl).toBeUndefined();
  });

  it("still uploads an image that differs from the saved creative", async () => {
    const { result } = renderAutosave();
    const changedImage = "data:image/jpeg;base64,changed";
    await act(async () => {
      result.current.stage(draft(changedImage));
      expect(await result.current.flush()).toBe(true);
    });
    expect(vi.mocked(updatePostDraft).mock.lastCall?.[1].imageDataUrl).toBe(
      changedImage,
    );
  });

  it("compares against the image saved by an earlier queued write", async () => {
    const { result } = renderAutosave();
    const changedImage = "data:image/jpeg;base64,changed";
    await act(async () => {
      result.current.stage(draft(changedImage));
      const first = result.current.flush();
      result.current.stage(draft(changedImage));
      const handoff = result.current.flush();
      expect(await first).toBe(true);
      expect(await handoff).toBe(true);
    });
    expect(updatePostDraft).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updatePostDraft).mock.calls[0][1].imageDataUrl).toBe(changedImage);
    expect(vi.mocked(updatePostDraft).mock.calls[1][1].imageDataUrl).toBeUndefined();
  });
});
