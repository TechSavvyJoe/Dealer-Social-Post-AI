import type { PostRecord, PostWorkspaceRequest } from "../services/posts";

/** Build the dual-revision token required by archive/restore actions. */
export const workspaceRequestForPost = (
  post: Pick<PostRecord, "id" | "updated" | "workspace_revision">,
): PostWorkspaceRequest | undefined => {
  const id = typeof post.id === "string" ? post.id.trim() : "";
  const expectedPostRevision =
    typeof post.updated === "string" ? post.updated.trim() : "";
  const expectedWorkspaceRevision = post.workspace_revision;

  if (
    !id ||
    !expectedPostRevision ||
    typeof expectedWorkspaceRevision !== "number" ||
    !Number.isSafeInteger(expectedWorkspaceRevision) ||
    expectedWorkspaceRevision < 0
  ) {
    return undefined;
  }

  return { id, expectedPostRevision, expectedWorkspaceRevision };
};
