import { describe, expect, it } from "vitest";
import { workspaceRequestForPost } from "./postWorkspace";

describe("workspaceRequestForPost", () => {
  it("returns the exact dual-CAS request and preserves workspace revision zero", () => {
    expect(
      workspaceRequestForPost({
        id: "post-1",
        updated: "2026-10-12 12:00:00.000Z",
        workspace_revision: 0,
      }),
    ).toEqual({
      id: "post-1",
      expectedPostRevision: "2026-10-12 12:00:00.000Z",
      expectedWorkspaceRevision: 0,
    });
  });

  it.each([
    { id: "", updated: "revision", workspace_revision: 0 },
    { id: "post-1", updated: " ", workspace_revision: 0 },
    { id: "post-1", updated: "revision", workspace_revision: undefined },
    { id: "post-1", updated: "revision", workspace_revision: -1 },
    { id: "post-1", updated: "revision", workspace_revision: 1.5 },
    {
      id: "post-1",
      updated: "revision",
      workspace_revision: Number.MAX_SAFE_INTEGER + 1,
    },
  ])("fails closed for invalid revision data %#", (post) => {
    expect(workspaceRequestForPost(post)).toBeUndefined();
  });
});
