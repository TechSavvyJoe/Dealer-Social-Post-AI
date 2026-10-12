import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { fetchPostCreativeDataUrl, listPostsPage } from "../services/posts";
import type {
  ApprovalStatus,
  PostArchiveFilter,
  PostListPage,
  PostListOptions,
  PostMediaFilter,
  PostRecord,
  PostListSort,
} from "../services/posts";
import {
  getWebsitePublication,
  listWebsiteDestinations,
  retryWebsitePublication,
  websitePublicationIsSettled,
  websitePublicationPollDelay,
} from "../services/websitePublishing";
import { useAppStore } from "../stores/appStore";
import type { GeneratedPost } from "../types";
import { toUiMessage } from "../utils/errorMessages";
import {
  savedPostIdentityIsSafe,
  toGeneratedPostFromRecord,
} from "../utils/historyPost";
import { useToast } from "../components/ui/Toast";
import type {
  WebsitePublication,
  WebsitePublicationState,
} from "../services/websitePublishing";

const HISTORY_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

export type PostHistoryArchiveFilter = PostArchiveFilter;
export type PostHistoryMediaFilter = PostMediaFilter;
export type PostHistorySort = PostListSort;

export interface UsePostHistoryListOptions {
  onOpenCreative?: () => void;
  onPostReady?: (post: GeneratedPost) => void;
  onWebsitePublication?: (postId: string, publication: WebsitePublication) => void;
}

/**
 * Loading, paging, search and reopen for the History list. Extracted
 * verbatim from components/PostHistory.tsx — every ref, timer and telemetry
 * call keeps its original semantics, see utils/historyPost.ts for the pure
 * pieces this hook calls.
 */
export const usePostHistoryList = ({
  onOpenCreative,
  onPostReady,
  onWebsitePublication,
}: UsePostHistoryListOptions = {}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const role = useAppStore((s) => s.role);
  const currentPersonId = useAppStore((s) => s.currentPerson?.id || "");
  const authEpoch = useAppStore((s) => s.authEpoch);
  const openSavedPost = useAppStore((s) => s.openSavedPost);
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [queryGeneration, setQueryGeneration] = useState(0);
  const queryDirtyRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [since, setSince] = useState<string | undefined>();
  const [until, setUntil] = useState<string | undefined>();
  const [ownerPersonId, setOwnerPersonId] = useState("");
  const [archived, setArchived] = useState<PostHistoryArchiveFilter>("active");
  const [mediaFilter, setMediaFilter] = useState<PostHistoryMediaFilter>("any");
  const [websiteStatus, setWebsiteStatus] = useState<WebsitePublicationState | "all">(
    "all",
  );
  const [sort, setSort] = useState<PostHistorySort>("newest_created");
  const [total, setTotal] = useState<number | undefined>();
  const [counts, setCounts] = useState<PostListPage["counts"]>();
  const [loadedScope, setLoadedScope] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [websiteRetryingId, setWebsiteRetryingId] = useState<string | null>(null);
  const [, setWebsiteOriginsReady] = useState(false);

  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);
  const openRequestRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRequestRef.current += 1;
    };
  }, []);
  const websitePollTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const websiteSessionIsCurrent = useCallback(
    (session: {
      authEpoch: number;
      dealerId: string;
      personId: string;
      role: string;
    }) => {
      const current = useAppStore.getState();
      return (
        mountedRef.current &&
        current.authEpoch === session.authEpoch &&
        current.currentDealer?.id === session.dealerId &&
        current.currentPerson?.id === session.personId &&
        current.role === session.role
      );
    },
    [],
  );
  const identityGrounding = useMemo(
    () => ({ dealerName: dealer?.name, oemAffiliation: dealer?.oem_affiliation }),
    [dealer?.name, dealer?.oem_affiliation],
  );
  const scopeKey = useMemo(
    () =>
      JSON.stringify({
        dealerId: dealer?.id || "",
        personId: currentPersonId,
        role,
        authEpoch,
        query: debouncedQuery.trim(),
        queryGeneration,
        statusFilter,
        since,
        until,
        ownerPersonId,
        archived,
        mediaFilter,
        websiteStatus,
        sort,
      }),
    [
      archived,
      authEpoch,
      currentPersonId,
      dealer?.id,
      debouncedQuery,
      mediaFilter,
      ownerPersonId,
      queryGeneration,
      role,
      since,
      sort,
      statusFilter,
      until,
      websiteStatus,
    ],
  );
  const activeScopeRef = useRef(scopeKey);
  const invalidateList = useCallback(() => {
    reqIdRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setTotal(undefined);
    setCounts(undefined);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
  }, []);
  useLayoutEffect(() => {
    activeScopeRef.current = scopeKey;
    invalidateList();
  }, [invalidateList, scopeKey]);
  const load = useCallback(
    async (cursor?: string) => {
      if (!dealer) {
        reqIdRef.current += 1;
        setItems([]);
        setNextCursor(null);
        setTotal(undefined);
        setCounts(undefined);
        setLoading(false);
        setLoadingMore(false);
        setError(null);
        setLoadedScope("");
        return;
      }
      const append = Boolean(cursor);
      const myId = ++reqIdRef.current;
      const requestAuthEpoch = useAppStore.getState().authEpoch;
      setLoadedScope(scopeKey);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setItems([]);
        setNextCursor(null);
        setTotal(undefined);
        setCounts(undefined);
      }
      setError(null);
      try {
        const options: PostListOptions = {
          limit: HISTORY_PAGE_SIZE,
          approvalStatus: statusFilter,
          cursor,
          q: debouncedQuery.trim() || undefined,
          since,
          until,
          ownerPersonId: ownerPersonId || undefined,
          archived,
          media: mediaFilter,
          websiteStatus: websiteStatus === "all" ? undefined : websiteStatus,
          sort,
          grounding: identityGrounding,
        };
        const page = await listPostsPage(options);
        if (
          reqIdRef.current === myId &&
          scopeKey === activeScopeRef.current &&
          requestAuthEpoch === useAppStore.getState().authEpoch
        ) {
          setItems((current) => {
            if (!append) return page.items;
            const seen = new Set(current.map((post) => post.id));
            return [...current, ...page.items.filter((post) => !seen.has(post.id))];
          });
          setNextCursor(page.nextCursor || null);
          setTotal(page.total);
          setCounts(page.counts);
        }
      } catch (err) {
        if (
          reqIdRef.current === myId &&
          scopeKey === activeScopeRef.current &&
          requestAuthEpoch === useAppStore.getState().authEpoch
        )
          setError(toUiMessage(err, "Could not load your posts."));
      } finally {
        if (
          reqIdRef.current === myId &&
          scopeKey === activeScopeRef.current &&
          requestAuthEpoch === useAppStore.getState().authEpoch
        ) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [
      archived,
      debouncedQuery,
      dealer,
      identityGrounding,
      mediaFilter,
      ownerPersonId,
      scopeKey,
      since,
      sort,
      statusFilter,
      until,
      websiteStatus,
    ],
  );

  useEffect(() => {
    void load(undefined);
    return () => {
      reqIdRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!queryDirtyRef.current) return;
      queryDirtyRef.current = false;
      setDebouncedQuery(query);
      setQueryGeneration((value) => value + 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(
    () => () => {
      websitePollTimersRef.current.forEach((timer) => clearTimeout(timer));
      websitePollTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    setWebsiteRetryingId(null);
    websitePollTimersRef.current.forEach((timer) => clearTimeout(timer));
    websitePollTimersRef.current.clear();
  }, [authEpoch, currentPersonId, dealer?.id, role]);

  const pollWebsitePublication = useCallback(
    (
      postId: string,
      session: { authEpoch: number; dealerId: string; personId: string; role: string },
      remaining = 36,
      delayMs = 5_000,
    ) => {
      if (remaining < 1 || !websiteSessionIsCurrent(session)) return;
      const timer = setTimeout(() => {
        websitePollTimersRef.current.delete(timer);
        if (!websiteSessionIsCurrent(session)) return;
        void getWebsitePublication(postId)
          .then((publication) => {
            if (!websiteSessionIsCurrent(session)) return;
            setItems((current) =>
              current.map((item) =>
                item.id === postId
                  ? { ...item, website_publication: publication }
                  : item,
              ),
            );
            onWebsitePublication?.(postId, publication);
            if (
              !websitePublicationIsSettled(publication.status) ||
              publication.status === "draft_ready"
            ) {
              pollWebsitePublication(
                postId,
                session,
                remaining - 1,
                websitePublicationPollDelay(publication.status),
              );
            }
          })
          .catch(() => {
            if (websiteSessionIsCurrent(session))
              pollWebsitePublication(postId, session, remaining - 1, 10_000);
          });
      }, delayMs);
      websitePollTimersRef.current.add(timer);
    },
    [onWebsitePublication, websiteSessionIsCurrent],
  );

  useEffect(() => {
    const controller = new AbortController();
    setWebsiteOriginsReady(false);
    void listWebsiteDestinations(controller.signal)
      .then(() => setWebsiteOriginsReady(true))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setWebsiteOriginsReady(false);
      });
    return () => controller.abort();
  }, [dealer?.id]);

  const filtered = useMemo(
    () => (loadedScope === scopeKey ? items : []),
    [items, loadedScope, scopeKey],
  );
  const changeFilter = useCallback(
    <T>(setter: Dispatch<SetStateAction<T>>, currentValue: T) =>
      (value: T) => {
        if (Object.is(value, currentValue)) return;
        invalidateList();
        setter(value);
      },
    [invalidateList],
  );
  const updateQuery = useCallback(
    (value: string) => {
      if (value === query) return;
      queryDirtyRef.current = true;
      invalidateList();
      setQuery(value);
    },
    [invalidateList, query],
  );
  const updateStatusFilter = useMemo(
    () => changeFilter(setStatusFilter, statusFilter),
    [changeFilter, statusFilter],
  );
  const updateSince = useMemo(
    () => changeFilter(setSince, since),
    [changeFilter, since],
  );
  const updateUntil = useMemo(
    () => changeFilter(setUntil, until),
    [changeFilter, until],
  );
  const updateOwner = useMemo(
    () => changeFilter(setOwnerPersonId, ownerPersonId),
    [changeFilter, ownerPersonId],
  );
  const updateArchived = useMemo(
    () => changeFilter(setArchived, archived),
    [changeFilter, archived],
  );
  const updateMedia = useMemo(
    () => changeFilter(setMediaFilter, mediaFilter),
    [changeFilter, mediaFilter],
  );
  const updateWebsiteStatus = useMemo(
    () => changeFilter(setWebsiteStatus, websiteStatus),
    [changeFilter, websiteStatus],
  );
  const updateSort = useMemo(() => changeFilter(setSort, sort), [changeFilter, sort]);

  const openCreative = useCallback(
    async (post: PostRecord) => {
      if (!post.creative_image_url) {
        toastError("This post has no saved image to open, only its caption.");
        return;
      }
      if (post.image_review_required) {
        toastError(
          "This saved image is quarantined because it predates the current on-pixel safety review. Create a new post from the original photo before sharing it.",
        );
        return;
      }
      if (!savedPostIdentityIsSafe(post, identityGrounding)) {
        toastError(
          "This saved post is quarantined because its copy may name a different customer. Create a corrected caption before sharing it.",
        );
        return;
      }
      setOpeningId(post.id);
      const requestId = ++openRequestRef.current;
      const authEpoch = useAppStore.getState().authEpoch;
      try {
        const image = await fetchPostCreativeDataUrl(post.creative_image_url);
        if (
          !mountedRef.current ||
          requestId !== openRequestRef.current ||
          authEpoch !== useAppStore.getState().authEpoch
        )
          return;
        const generated = toGeneratedPostFromRecord(post, {
          role,
          currentPersonId,
          image,
        });
        // A stored creative may come from another device/session, so it does
        // not have the original capture needed for a true same-photo remix.
        // Clear any stale capture and expose only safe share/export actions.
        // Without a handler (the manager dashboard's history list) the store
        // opens it exactly as the app's own handler does, so Back returns to
        // the dashboard and no draft or signature survives under it.
        if (onPostReady) onPostReady(generated);
        else openSavedPost(generated);
        onOpenCreative?.();
        toastSuccess("Post reopened. Share it without making a new one.");
      } catch (err) {
        if (
          mountedRef.current &&
          requestId === openRequestRef.current &&
          authEpoch === useAppStore.getState().authEpoch
        )
          toastError(toUiMessage(err, "Could not open this post."));
      } finally {
        if (mountedRef.current && requestId === openRequestRef.current)
          setOpeningId(null);
      }
    },
    [
      onOpenCreative,
      onPostReady,
      currentPersonId,
      identityGrounding,
      role,
      openSavedPost,
      toastError,
      toastSuccess,
    ],
  );

  const retryWebsite = useCallback(
    async (post: PostRecord) => {
      if (websiteRetryingId) return;
      const state = useAppStore.getState();
      const session = {
        authEpoch: state.authEpoch,
        dealerId: state.currentDealer?.id || "",
        personId: state.currentPerson?.id || "",
        role: state.role,
      };
      if (!session.dealerId || !session.personId || post.dealer !== session.dealerId)
        return;
      setWebsiteRetryingId(post.id);
      try {
        const publication = await retryWebsitePublication(post.id);
        if (!websiteSessionIsCurrent(session)) return;
        setItems((current) =>
          current.map((item) =>
            item.id === post.id ? { ...item, website_publication: publication } : item,
          ),
        );
        onWebsitePublication?.(post.id, publication);
        if (
          !websitePublicationIsSettled(publication.status) ||
          publication.status === "draft_ready"
        ) {
          pollWebsitePublication(
            post.id,
            session,
            36,
            websitePublicationPollDelay(publication.status),
          );
        }
        toastSuccess(
          post.website_publication?.status === "draft_ready"
            ? "Website status check queued."
            : "Private website draft queued again.",
        );
      } catch (err) {
        if (websiteSessionIsCurrent(session))
          toastError(toUiMessage(err, "Website draft could not be retried."));
      } finally {
        if (websiteSessionIsCurrent(session)) setWebsiteRetryingId(null);
      }
    },
    [
      onWebsitePublication,
      pollWebsitePublication,
      toastError,
      toastSuccess,
      websiteRetryingId,
      websiteSessionIsCurrent,
    ],
  );

  return {
    dealer,
    role,
    identityGrounding,
    items,
    filtered,
    loading,
    loadingMore,
    error,
    nextCursor,
    query,
    setQuery: updateQuery,
    statusFilter,
    setStatusFilter: updateStatusFilter,
    since,
    setSince: updateSince,
    until,
    setUntil: updateUntil,
    ownerPersonId,
    setOwnerPersonId: updateOwner,
    archived,
    setArchived: updateArchived,
    mediaFilter,
    setMediaFilter: updateMedia,
    websiteStatus,
    setWebsiteStatus: updateWebsiteStatus,
    sort,
    setSort: updateSort,
    total,
    counts,
    openingId,
    websiteRetryingId,
    load,
    openCreative,
    retryWebsite,
  };
};
