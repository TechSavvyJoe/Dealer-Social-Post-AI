import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApprovalStatus,
  PostRecord,
  fetchPostCreativeDataUrl,
  listPostsPage,
} from "../services/posts";
import {
  getWebsitePublication,
  listWebsiteDestinations,
  retryWebsitePublication,
  websitePublicationIsSettled,
  websitePublicationPollDelay,
} from "../services/websitePublishing";
import { useAppStore } from "../stores/appStore";
import { AppStep } from "../types";
import { toUiMessage } from "../utils/errorMessages";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import {
  savedPostIdentityIsSafe,
  toGeneratedPostFromRecord,
} from "../utils/historyPost";
import { useToast } from "../components/ui/Toast";

const HISTORY_PAGE_SIZE = 50;

export interface UsePostHistoryListOptions {
  onOpenCreative?: () => void;
}

/**
 * Loading, paging, search and reopen for the History list. Extracted
 * verbatim from components/PostHistory.tsx — every ref, timer and telemetry
 * call keeps its original semantics, see utils/historyPost.ts for the pure
 * pieces this hook calls.
 */
export const usePostHistoryList = ({
  onOpenCreative,
}: UsePostHistoryListOptions = {}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const role = useAppStore((s) => s.role);
  const currentPersonId = useAppStore((s) => s.currentPerson?.id || "");
  const setGeneratedPost = useAppStore((s) => s.setGeneratedPost);
  const setSelectedImage = useAppStore((s) => s.setSelectedImage);
  const setGenerationParams = useAppStore((s) => s.setGenerationParams);
  const setStep = useAppStore((s) => s.setStep);
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [websiteRetryingId, setWebsiteRetryingId] = useState<string | null>(null);
  const [, setWebsiteOriginsReady] = useState(false);

  const reqIdRef = useRef(0);
  const websitePollTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const identityGrounding = useMemo(
    () => ({ dealerName: dealer?.name, oemAffiliation: dealer?.oem_affiliation }),
    [dealer?.name, dealer?.oem_affiliation],
  );
  const load = useCallback(
    async (cursor?: string) => {
      if (!dealer) return;
      const append = Boolean(cursor);
      const myId = ++reqIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setItems([]);
        setNextCursor(null);
      }
      setError(null);
      try {
        const page = await listPostsPage({
          limit: HISTORY_PAGE_SIZE,
          approvalStatus: statusFilter,
          cursor,
          grounding: identityGrounding,
        });
        if (reqIdRef.current === myId) {
          setItems((current) => {
            if (!append) return page.items;
            const seen = new Set(current.map((post) => post.id));
            return [...current, ...page.items.filter((post) => !seen.has(post.id))];
          });
          setNextCursor(page.nextCursor || null);
        }
      } catch (err) {
        if (reqIdRef.current === myId)
          setError(toUiMessage(err, "Could not load your posts."));
      } finally {
        if (reqIdRef.current === myId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [dealer, identityGrounding, statusFilter],
  );

  useEffect(() => {
    void load(undefined);
  }, [load]);

  useEffect(
    () => () => {
      websitePollTimersRef.current.forEach((timer) => clearTimeout(timer));
      websitePollTimersRef.current.clear();
    },
    [],
  );

  const pollWebsitePublication = useCallback(
    (postId: string, remaining = 36, delayMs = 5_000) => {
      if (remaining < 1) return;
      const timer = setTimeout(() => {
        websitePollTimersRef.current.delete(timer);
        void getWebsitePublication(postId)
          .then((publication) => {
            setItems((current) =>
              current.map((item) =>
                item.id === postId
                  ? { ...item, website_publication: publication }
                  : item,
              ),
            );
            if (
              !websitePublicationIsSettled(publication.status) ||
              publication.status === "draft_ready"
            ) {
              pollWebsitePublication(
                postId,
                remaining - 1,
                websitePublicationPollDelay(publication.status),
              );
            }
          })
          .catch(() => {
            pollWebsitePublication(postId, remaining - 1, 10_000);
          });
      }, delayMs);
      websitePollTimersRef.current.add(timer);
    },
    [],
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => {
      const haystack = [
        p.salesperson_name,
        toPublicCustomerLabel(p.customer_name),
        p.vin,
        p.style,
        p.tone,
        p.approved_by,
        savedPostIdentityIsSafe(p, identityGrounding) ? p.caption : undefined,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [identityGrounding, items, query]);

  const openCreative = useCallback(
    async (post: PostRecord) => {
      if (!post.creative_image_url) {
        toastError("No stored image for this post — only caption logs exist.");
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
      try {
        const image = await fetchPostCreativeDataUrl(post.creative_image_url);
        const generated = toGeneratedPostFromRecord(post, {
          role,
          currentPersonId,
          image,
        });
        // A stored creative may come from another device/session, so it does
        // not have the original capture needed for a true same-photo remix.
        // Clear any stale capture and expose only safe share/export actions.
        setSelectedImage(null);
        setGenerationParams(null);
        setGeneratedPost(generated);
        setStep(AppStep.RESULT);
        onOpenCreative?.();
        toastSuccess("Creative reopened — share or export without regenerating.");
      } catch (err) {
        toastError(toUiMessage(err, "Could not open this creative."));
      } finally {
        setOpeningId(null);
      }
    },
    [
      onOpenCreative,
      currentPersonId,
      identityGrounding,
      role,
      setGeneratedPost,
      setGenerationParams,
      setSelectedImage,
      setStep,
      toastError,
      toastSuccess,
    ],
  );

  const retryWebsite = useCallback(
    async (post: PostRecord) => {
      if (websiteRetryingId) return;
      setWebsiteRetryingId(post.id);
      try {
        const publication = await retryWebsitePublication(post.id);
        setItems((current) =>
          current.map((item) =>
            item.id === post.id ? { ...item, website_publication: publication } : item,
          ),
        );
        if (
          !websitePublicationIsSettled(publication.status) ||
          publication.status === "draft_ready"
        ) {
          pollWebsitePublication(
            post.id,
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
        toastError(toUiMessage(err, "Website draft could not be retried."));
      } finally {
        setWebsiteRetryingId(null);
      }
    },
    [pollWebsitePublication, toastError, toastSuccess, websiteRetryingId],
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
    setQuery,
    statusFilter,
    setStatusFilter,
    openingId,
    websiteRetryingId,
    load,
    openCreative,
    retryWebsite,
  };
};
