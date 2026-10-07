import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";

const mocks = vi.hoisted(() => ({
  state: {} as { generatedPost: GeneratedPost | null; setGeneratedPost: unknown },
  setGeneratedPost: vi.fn(),
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: { getState: () => mocks.state },
}));

import { adoptPostRevision } from "./postRevision";

const livePost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Caption",
  postId: "post-1",
  postRevision: "rev-1",
};

describe("adoptPostRevision", () => {
  beforeEach(() => {
    mocks.setGeneratedPost.mockReset();
    mocks.setGeneratedPost.mockImplementation((post: GeneratedPost | null) => {
      mocks.state.generatedPost = post;
    });
    mocks.state.generatedPost = { ...livePost };
    mocks.state.setGeneratedPost = mocks.setGeneratedPost;
  });

  it("adopts a changed revision for the live post without archiving its image", () => {
    adoptPostRevision("post-1", "rev-2");

    expect(mocks.setGeneratedPost).toHaveBeenCalledTimes(1);
    expect(mocks.setGeneratedPost).toHaveBeenCalledWith(
      { ...livePost, postRevision: "rev-2" },
      { archive: false },
    );
    expect(mocks.state.generatedPost?.postRevision).toBe("rev-2");
  });

  it("adopts a revision for a live post that had none yet", () => {
    mocks.state.generatedPost = { ...livePost, postRevision: undefined };
    adoptPostRevision("post-1", "rev-2");
    expect(mocks.state.generatedPost?.postRevision).toBe("rev-2");
  });

  it("ignores a revision for another post", () => {
    adoptPostRevision("post-2", "rev-2");
    expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
    expect(mocks.state.generatedPost?.postRevision).toBe("rev-1");
  });

  it("ignores a missing post id or no live post", () => {
    adoptPostRevision(undefined, "rev-2");
    mocks.state.generatedPost = null;
    adoptPostRevision("post-1", "rev-2");
    expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined (an older backend)", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["unchanged", "rev-1"],
  ])("ignores a %s revision", (_label, revision) => {
    adoptPostRevision("post-1", revision);
    expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
    expect(mocks.state.generatedPost?.postRevision).toBe("rev-1");
  });
});
