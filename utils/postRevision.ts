import { useAppStore } from "../stores/appStore";

/**
 * Adopt a revision the server returned for a write that changed only
 * server-owned fields — the consent link, a manager decision, the website
 * hand-off — so the editor's next draft save or share receipt uses the current
 * compare-and-set token. (Marking a finished video does not advance the
 * revision, so it has nothing to adopt.)
 *
 * Never call this with a revision from a write that may carry another editor's
 * content: adopting it would turn a real conflict into a silent overwrite.
 */
export const adoptPostRevision = (
  postId: string | undefined,
  revision: string | undefined,
  observed?: { revision: string | undefined; authEpoch: number },
): void => {
  if (!postId || typeof revision !== "string" || !revision.trim()) return;
  const store = useAppStore.getState();
  const current = store.generatedPost;
  if (
    observed &&
    (store.authEpoch !== observed.authEpoch ||
      current?.postRevision !== observed.revision)
  )
    return;
  if (!current || current.postId !== postId || current.postRevision === revision) {
    return;
  }
  store.setGeneratedPost({ ...current, postRevision: revision }, { archive: false });
};
