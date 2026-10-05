import { useAppStore } from "../stores/appStore";

/**
 * Adopt a revision the server returned for a write that changed only
 * server-owned fields — the consent link, the video flag, a manager decision,
 * the website hand-off — so the editor's next draft save or share receipt uses
 * the current compare-and-set token.
 *
 * Never call this with a revision from a write that may carry another editor's
 * content: adopting it would turn a real conflict into a silent overwrite.
 */
export const adoptPostRevision = (
  postId: string | undefined,
  revision: string | undefined,
): void => {
  if (!postId || typeof revision !== "string" || !revision.trim()) return;
  const store = useAppStore.getState();
  const current = store.generatedPost;
  if (!current || current.postId !== postId || current.postRevision === revision) {
    return;
  }
  store.setGeneratedPost({ ...current, postRevision: revision }, { archive: false });
};
