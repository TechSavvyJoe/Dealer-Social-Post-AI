/**
 * Post-log client. After the 1748000400 rule lockdown, the `posts` PocketBase
 * collection is locked from direct REST access. The frontend goes through
 * session-gated `/api/app/posts*` endpoints. The server forces the `dealer`
 * field from the dealer_session cookie, so the client never has to (and never
 * gets to) pick which dealership a post is logged against.
 *
 * Filters on the read endpoints use PocketBase's `filterParams` (the
 * `{:name}` form) server-side — no string interpolation, no injection.
 */

import { dataUrlToBlob } from "../utils/imageUtils";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import type {
  ImageAspectRatio,
  MediaOutputMode,
  PostShareVia,
  PrimaryImageFormatId,
} from "../types";
import type { PlatformDestinationId } from "./platformOutputs";
import { readApiError } from "./apiErrors";
import {
  replaceFullCustomerName,
  type WebsiteDraft,
  type WebsitePublication,
} from "./websitePublishing";
import {
  normalizeCustomerIdentity,
  releaseAuthorizesPublicLabel,
  toPublicCustomerLabel,
} from "../utils/customerIdentity";
import {
  captionUsesOnlyExpectedCustomer,
  describeUnauthorizedNames,
  unauthorizedCustomerNames,
} from "../utils/captionQuality";
import { stripCanonicalDisclosures } from "../utils/complianceDisclosures";

export type ApprovalStatus = "n_a" | "pending" | "approved" | "rejected";

export interface LogPostInput {
  /** Kept for backwards compat; ignored — the server uses the session dealer. */
  dealerId?: string;
  salespersonName?: string;
  /** Optional FK to the salespeople collection (preferred over free-text name). */
  salespersonId?: string;
  style?: string;
  tone?: string;
  customerName?: string;
  customerIdentityRequired?: boolean;
  scenarioId?: string;
  vin?: string;
  hasRelease?: boolean;
  hasVideo?: boolean;
  /** When the dealer requires manager approval, log post as 'pending'. */
  requiresApproval?: boolean;
  /** The exact review copy submitted to the manager. */
  caption?: string;
  disclosures?: string;
  /** The exact generated image submitted for review. */
  imageDataUrl?: string;
  /** Prompt-free generation provenance used only for aggregate diagnostics. */
  captionSource?: "ai" | "custom" | "basic_fallback";
  generationTier?: "standard" | "studio";
  generationModel?: string;
  generationFallbackCount?: number;
  generationLastSuccessAt?: string;
  modelPolicyVersion?: string;
  /** Opaque server-event correlations; not credentials and never user-visible. */
  captionAttemptId?: string;
  imageAttemptId?: string;
  /** Selected destinations and authoritative output canvas for History reopen. */
  platformIds?: string[];
  mediaOutputMode?: MediaOutputMode;
  platformCaptions?: Record<string, string>;
  primaryFormatId?: PrimaryImageFormatId;
  imageAspectRatio?: ImageAspectRatio;
  /** ISO timestamp for when this post should be published */
  scheduledFor?: string;
  /** Private Customer Hub draft metadata; server controls any delivery. */
  websiteDraft?: WebsiteDraft;
  /** Dealer name / OEM so the copy check never mistakes them for a customer. */
  grounding?: DealerIdentityGrounding;
}

export interface PostRecord {
  id: string;
  /** Opaque PocketBase update revision used for compare-and-set writes. */
  updated?: string;
  dealer: string;
  salesperson_name?: string;
  /** Optional FK to the salespeople collection — preferred over the free-text name when present. */
  salesperson_id?: string;
  /** True only for server-derived ownership; legacy display attribution is untrusted. */
  attribution_authoritative?: boolean;
  generated_at: string;
  style?: string;
  tone?: string;
  customer_name?: string;
  scenario_id?: string;
  vin?: string;
  has_release?: boolean;
  release_required?: boolean;
  release_status?: "not_required" | "pending" | "saved";
  has_video?: boolean;
  approval_status?: ApprovalStatus;
  approved_by?: string;
  rejection_reason?: string;
  approved_at?: string;
  caption?: string;
  caption_source?: "ai" | "custom" | "basic_fallback" | null;
  disclosures?: string;
  /** Validated destination/output profile captured when this creative was made. */
  platform_ids?: string[];
  media_output_mode?: MediaOutputMode;
  platform_captions?: Record<string, string>;
  primary_format_id?: PrimaryImageFormatId;
  image_aspect_ratio?: ImageAspectRatio;
  /** Session-authorized route; never a public PocketBase file URL. */
  creative_image_url?: string;
  scheduled_for?: string;
  website_draft?: WebsiteDraft;
  website_publication?: WebsitePublication;
  /** Client projection quarantined copy that may name an unauthorized customer. */
  identity_review_required?: boolean;
  /** Server-derived quarantine for creative pixels archived under an older policy. */
  image_review_required?: boolean;
  /**
   * Derived from the `post_share_events` collection by GET /api/app/posts:
   * null when the post was never shared, absent from an older backend.
   */
  share_summary?: PostShareSummary | null;
}

/**
 * What the History list knows about a post's recorded shares. Share events
 * are their own collection (never a field on the post), so recording one does
 * not bump the post's revision.
 */
export interface PostShareSummary {
  /** Recorded shares; the server keeps the newest 20 per post. */
  count: number;
  /** Server-written time of the latest share. */
  last_shared_at: string;
  /** Destination of the latest share, e.g. `facebook_feed`. */
  last_channel: string;
  last_via: PostShareVia;
  /** Distinct destinations, most recent first. */
  channels: string[];
}

const POST_SHARE_VIAS: readonly PostShareVia[] = ["share_sheet", "download", "copy"];

/**
 * Client projection of the server's share summary. A missing field (older
 * backend) stays absent; anything malformed or empty reads as never shared.
 */
export const projectShareSummary = (
  raw: unknown,
): PostShareSummary | null | undefined => {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const count =
    typeof value.count === "number" && Number.isFinite(value.count)
      ? Math.floor(value.count)
      : 0;
  const lastChannel = typeof value.last_channel === "string" ? value.last_channel : "";
  const lastVia = POST_SHARE_VIAS.find((via) => via === value.last_via);
  if (count <= 0 || !lastChannel || !lastVia) return null;
  const channels = Array.isArray(value.channels)
    ? value.channels.filter(
        (channel, index, all): channel is string =>
          typeof channel === "string" &&
          Boolean(channel) &&
          all.indexOf(channel) === index,
      )
    : [];
  return {
    count,
    last_shared_at:
      typeof value.last_shared_at === "string" ? value.last_shared_at : "",
    last_channel: lastChannel,
    last_via: lastVia,
    channels: channels.length > 0 ? channels : [lastChannel],
  };
};

export interface PostApprovalStatus {
  id: string;
  approval_status: ApprovalStatus;
  approved_by?: string;
  rejection_reason?: string;
  approved_at?: string;
  image_review_required?: boolean;
}

export interface PostVideoStatus {
  id: string;
  has_video: true;
}

/**
 * Public-label lookups for the posts the UI is currently working with. They
 * back the identity guard in `updatePostDraft`, so this must never become a
 * long-lived store: an entry recorded for one signed-in workspace must not be
 * readable from another.
 *
 * Two properties keep that true:
 *   1. Every entry is scoped to the auth epoch it was recorded under. Logout,
 *      login, impersonation, exiting impersonation, and session restore all
 *      bump `authEpoch` (see stores/appStore.ts), so a dealer switch drops the
 *      whole cache instead of leaking a previous tenant's label.
 *   2. Within one epoch the cache is a small LRU, so scrolling a long History
 *      list cannot grow it without bound for the life of the tab.
 *
 * A miss is safe: `updatePostDraft` then guards with no known label, and the
 * server revalidates ownership and compliance on every write regardless.
 */
const POST_IDENTITY_CACHE_LIMIT = 200;

interface PostIdentityEntry {
  /** Approved public label (first name), or undefined when none is approved. */
  publicCustomer?: string;
  customerIdentityRequired: boolean;
}

const postIdentityByPostId = new Map<string, PostIdentityEntry>();
let postIdentityAuthEpoch = captureAuthEpoch();

/** The cache for the current auth epoch, emptied when the workspace changes. */
const postIdentityCache = (): Map<string, PostIdentityEntry> => {
  const epoch = captureAuthEpoch();
  if (epoch !== postIdentityAuthEpoch) {
    postIdentityAuthEpoch = epoch;
    postIdentityByPostId.clear();
  }
  return postIdentityByPostId;
};

const rememberPostIdentity = (postId: string, entry: PostIdentityEntry): void => {
  const cache = postIdentityCache();
  // Re-insert so Map iteration order stays least-recently-used first.
  cache.delete(postId);
  cache.set(postId, entry);
  while (cache.size > POST_IDENTITY_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};

const recallPostIdentity = (postId: string): PostIdentityEntry | undefined => {
  const cache = postIdentityCache();
  const entry = cache.get(postId);
  if (!entry) return undefined;
  // A read is a use: keep the post the salesperson is editing off the evict end.
  cache.delete(postId);
  cache.set(postId, entry);
  return entry;
};

/**
 * Grounded, non-customer proper nouns the identity guard must never mistake
 * for a person: the dealership's configured name and the OEM it sells. Every
 * copy check below needs these — without them "Ford is proud...", "Congrats,
 * Ford family!" and "Bob Maxey Ford's team" read as unauthorized customers
 * and a perfectly good post is refused at save time (or, on reopen, has its
 * caption replaced with a review placeholder) even though the generation
 * guard already accepted the very same text.
 */
export interface DealerIdentityGrounding {
  dealerName?: string;
  oemAffiliation?: string;
  /**
   * The VIN-decoded vehicle as it was grounded at generation. Saved posts
   * only carry it inside a website draft, so without this a caption that
   * generated fine with a scanned VIN ("Bronco is ready…") refused to save
   * whenever the website toggle was off.
   */
  vehicleDescription?: string;
  /** Named in prose freely, never accepted as the celebrated customer. */
  salespersonName?: string;
}

const groundedPhrases = (
  grounding: DealerIdentityGrounding | undefined,
  vehicleDescription?: string,
): Array<string | undefined> => [
  grounding?.dealerName,
  grounding?.oemAffiliation,
  grounding?.vehicleDescription,
  vehicleDescription,
];

/**
 * The signed-in salesperson AND whoever the record credits — History and the
 * approval queue show other people's posts, and their salesperson is just as
 * legitimate in their prose.
 */
const maskedPhrases = (
  grounding: DealerIdentityGrounding | undefined,
  recordSalesperson?: string,
): Array<string | undefined> => [
  grounding?.salespersonName,
  toPublicCustomerLabel(grounding?.salespersonName),
  recordSalesperson,
  toPublicCustomerLabel(recordSalesperson),
];

const assertCustomerCopyIsSafe = (input: {
  customerName?: string;
  caption?: string;
  disclosures?: string;
  platformCaptions?: Record<string, string>;
  websiteDraft?: WebsiteDraft;
  customerIdentityRequired?: boolean;
  grounding?: DealerIdentityGrounding;
}): void => {
  const publicCustomer = toPublicCustomerLabel(input.customerName);
  const customerIdentityRequired = Boolean(
    input.customerIdentityRequired || input.websiteDraft?.kind === "customer_story",
  );
  const copy = [
    input.caption,
    input.disclosures,
    ...Object.values(input.platformCaptions || {}),
  ].filter((value): value is string => Boolean(value?.trim()));
  // Canonical disclosure material never reaches the guard (the same rule the
  // server's save route applies): it is fixed legal copy, not a name.
  const offending = copy.flatMap((caption) =>
    unauthorizedCustomerNames(stripCanonicalDisclosures(caption), publicCustomer, {
      allowedPhrases: groundedPhrases(
        input.grounding,
        input.websiteDraft?.vehicleDescription,
      ),
      maskedPhrases: maskedPhrases(input.grounding),
      rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
    }),
  );
  if (offending.length > 0) {
    throw new Error(
      `The saved caption contains a customer name that is not authorized for this post (${describeUnauthorizedNames(
        offending,
      )}).`,
    );
  }
  if (input.websiteDraft?.kind === "customer_story") {
    if (
      publicCustomer
        ? !releaseAuthorizesPublicLabel(
            publicCustomer,
            input.websiteDraft.customerDisplayName,
          )
        : Boolean(input.websiteDraft.customerDisplayName?.trim())
    ) {
      throw new Error(
        "The website draft customer label does not match this post's authorized first name.",
      );
    }
    const websiteCopy = [
      input.websiteDraft.title,
      input.websiteDraft.body,
      input.websiteDraft.altText,
    ];
    if (
      websiteCopy.some(
        (caption) =>
          !captionUsesOnlyExpectedCustomer(
            stripCanonicalDisclosures(caption),
            publicCustomer,
            {
              allowedPhrases: groundedPhrases(
                input.grounding,
                input.websiteDraft?.vehicleDescription,
              ),
              maskedPhrases: maskedPhrases(input.grounding),
              rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
            },
          ),
      )
    ) {
      throw new Error(
        "The website draft contains a customer name that is not authorized for this post.",
      );
    }
  }
};

/**
 * The server retains the exact release signer for consent linkage. List and
 * approval screens receive a public projection so legal names cannot leak
 * through History cards, search, CSV, approval copy, or reopened drafts.
 */
export const projectPostRecordForUi = (
  record: PostRecord,
  grounding?: DealerIdentityGrounding,
): PostRecord => {
  const protectedName = record.customer_name || "";
  const publicCustomer = toPublicCustomerLabel(protectedName);
  if (record.id) {
    rememberPostIdentity(record.id, {
      publicCustomer: publicCustomer || undefined,
      customerIdentityRequired: Boolean(
        record.release_required || record.website_draft?.kind === "customer_story",
      ),
    });
  }
  const customerIdentityRequired = Boolean(
    record.release_required || record.website_draft?.kind === "customer_story",
  );
  const sanitize = (value?: string): string | undefined =>
    value === undefined
      ? undefined
      : replaceFullCustomerName(value, protectedName, publicCustomer || undefined);
  const caption = sanitize(record.caption);
  const disclosures = sanitize(record.disclosures);
  // Canonical disclosure material is stripped before every check below, as the
  // server's History projection does: it is fixed legal copy, never a name.
  const captionIdentitySafe =
    !caption ||
    captionUsesOnlyExpectedCustomer(
      stripCanonicalDisclosures(caption),
      publicCustomer,
      {
        allowedPhrases: groundedPhrases(
          grounding,
          record.website_draft?.vehicleDescription,
        ),
        maskedPhrases: maskedPhrases(grounding, record.salesperson_name),
        rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
      },
    );
  const disclosureIdentitySafe =
    !disclosures ||
    captionUsesOnlyExpectedCustomer(
      stripCanonicalDisclosures(disclosures),
      publicCustomer,
      {
        allowedPhrases: groundedPhrases(
          grounding,
          record.website_draft?.vehicleDescription,
        ),
        maskedPhrases: maskedPhrases(grounding, record.salesperson_name),
        rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
      },
    );
  let identityReviewRequired = Boolean(record.identity_review_required);
  if (!captionIdentitySafe) identityReviewRequired = true;
  if (!disclosureIdentitySafe) identityReviewRequired = true;

  const platformCaptions = record.platform_captions
    ? Object.fromEntries(
        Object.entries(record.platform_captions).flatMap(([platform, rawCaption]) => {
          const projectedCaption = sanitize(rawCaption) || "";
          const safe = captionUsesOnlyExpectedCustomer(
            stripCanonicalDisclosures(projectedCaption),
            publicCustomer,
            {
              allowedPhrases: groundedPhrases(
                grounding,
                record.website_draft?.vehicleDescription,
              ),
              maskedPhrases: maskedPhrases(grounding, record.salesperson_name),
              rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
            },
          );
          if (!safe) {
            identityReviewRequired = true;
            return [];
          }
          return [[platform, projectedCaption]];
        }),
      )
    : undefined;

  let websiteDraft: WebsiteDraft | undefined;
  if (record.website_draft) {
    const projectedDraft = {
      ...record.website_draft,
      title: sanitize(record.website_draft.title) || record.website_draft.title,
      body: sanitize(record.website_draft.body) || record.website_draft.body,
      altText: sanitize(record.website_draft.altText) || record.website_draft.altText,
      ...(publicCustomer ? { customerDisplayName: publicCustomer } : {}),
    };
    const websiteLabelSafe =
      record.website_draft.kind !== "customer_story" ||
      (publicCustomer
        ? releaseAuthorizesPublicLabel(
            publicCustomer,
            record.website_draft.customerDisplayName,
          ) ||
          normalizeCustomerIdentity(record.website_draft.customerDisplayName) ===
            normalizeCustomerIdentity(protectedName)
        : !record.website_draft.customerDisplayName?.trim());
    const websiteIdentitySafe =
      websiteLabelSafe &&
      [projectedDraft.title, projectedDraft.body, projectedDraft.altText].every(
        (copy) =>
          captionUsesOnlyExpectedCustomer(
            stripCanonicalDisclosures(copy),
            publicCustomer,
            {
              allowedPhrases: groundedPhrases(
                grounding,
                projectedDraft.vehicleDescription,
              ),
              maskedPhrases: maskedPhrases(grounding, record.salesperson_name),
              rejectAnyCustomerIdentity: customerIdentityRequired && !publicCustomer,
            },
          ),
      );
    if (websiteIdentitySafe) websiteDraft = projectedDraft;
    else identityReviewRequired = true;
  }

  return {
    ...record,
    customer_name: publicCustomer || undefined,
    caption: captionIdentitySafe ? caption : "Caption held for customer-name review.",
    disclosures: disclosureIdentitySafe
      ? disclosures
      : "Disclosure held for customer-name review.",
    platform_captions: platformCaptions,
    website_draft: websiteDraft,
    identity_review_required: identityReviewRequired || undefined,
    ...(record.share_summary !== undefined
      ? { share_summary: projectShareSummary(record.share_summary) }
      : {}),
  };
};

export interface UpdatePostDraftInput {
  caption: string;
  /** Last server revision observed by this editor. */
  expectedPostRevision: string;
  disclosures?: string;
  imageDataUrl?: string;
  platformCaptions?: Record<string, string>;
  grounding?: DealerIdentityGrounding;
}

const jsonRequest = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const body = (await res.json()) as T;
  assertAuthEpoch(requestAuthEpoch);
  return body;
};

export const logPost = async (
  input: LogPostInput,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<PostRecord | null> => {
  assertCustomerCopyIsSafe({
    customerName: input.customerName,
    customerIdentityRequired: input.customerIdentityRequired,
    caption: input.caption,
    disclosures: input.disclosures,
    platformCaptions: input.platformCaptions,
    websiteDraft: input.websiteDraft,
    grounding: input.grounding,
  });
  assertAuthEpoch(requestAuthEpoch);
  try {
    const form = new FormData();
    form.append("salesperson_name", input.salespersonName || "");
    form.append("salesperson_id", input.salespersonId || "");
    form.append("style", input.style || "");
    form.append("tone", input.tone || "");
    form.append("customer_name", input.customerName || "");
    form.append("scenario_id", input.scenarioId || "");
    form.append("vin", input.vin || "");
    form.append("has_release", input.hasRelease ? "true" : "false");
    form.append("has_video", input.hasVideo ? "true" : "false");
    if (input.captionSource) {
      form.append("caption_source", input.captionSource);
    }
    if (input.generationTier) {
      form.append("generation_tier", input.generationTier);
    }
    if (input.generationModel) {
      form.append("generation_model", input.generationModel);
    }
    if (typeof input.generationFallbackCount === "number") {
      form.append("generation_fallback_count", String(input.generationFallbackCount));
    }
    if (input.generationLastSuccessAt) {
      form.append("generation_last_success_at", input.generationLastSuccessAt);
    }
    if (input.modelPolicyVersion) {
      form.append("model_policy_version", input.modelPolicyVersion);
    }
    if (input.captionAttemptId) {
      form.append("caption_attempt_id", input.captionAttemptId);
    }
    if (input.imageAttemptId) {
      form.append("image_attempt_id", input.imageAttemptId);
    }
    if (Array.isArray(input.platformIds)) {
      form.append("platform_ids", JSON.stringify(input.platformIds));
    }
    if (input.mediaOutputMode) {
      form.append("media_output_mode", input.mediaOutputMode);
    }
    if (input.platformCaptions && Object.keys(input.platformCaptions).length > 0) {
      form.append("platform_captions", JSON.stringify(input.platformCaptions));
    }
    if (input.primaryFormatId) {
      form.append("primary_format_id", input.primaryFormatId);
    }
    if (input.imageAspectRatio) {
      form.append("image_aspect_ratio", input.imageAspectRatio);
    }
    if (input.scheduledFor) {
      form.append("scheduled_for", input.scheduledFor);
    }
    if (input.websiteDraft?.enabled) {
      form.append("website_draft", JSON.stringify(input.websiteDraft));
    }

    // Persist caption + creative whenever available so History can reopen
    // for re-share/export without regenerating. Approval-gated posts still
    // require both fields (server enforces).
    if (input.caption?.trim()) {
      form.append("caption", input.caption.trim());
    }
    if (input.disclosures?.trim()) {
      form.append("disclosures", input.disclosures.trim());
    }
    if (input.imageDataUrl) {
      const image = await dataUrlToBlob(input.imageDataUrl);
      const extension =
        image.type === "image/png"
          ? "png"
          : image.type === "image/webp"
            ? "webp"
            : "jpg";
      form.append("creative_image", image, `post-creative.${extension}`);
    } else if (input.requiresApproval) {
      throw new Error("Approval submission is missing its creative");
    }
    if (input.requiresApproval && !input.caption?.trim()) {
      throw new Error("Approval submission is missing its creative");
    }

    assertAuthEpoch(requestAuthEpoch);
    const res = await fetch("/api/app/posts", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      throw await readApiError(res, { requestAuthEpoch });
    }
    const post = (await res.json()) as PostRecord;
    assertAuthEpoch(requestAuthEpoch);
    return projectPostRecordForUi(post, input.grounding);
  } catch (err) {
    // For approval-gated posts, a failed persist means the manager has nothing
    // to review — the caller MUST know so it can lock share/save and alert.
    if (input.requiresApproval) throw err;
    // Non-approval posts: preserve the user's flow but log clearly.
    console.warn("[posts.logPost] non-fatal persist failure", err);
    return null;
  }
};

/**
 * Read the approval state for a post submitted by this browser session. The
 * server binds the post to a hash of the opaque session token, so knowing a
 * post id alone is insufficient.
 */
export const getPostApprovalStatus = async (
  postId: string,
  signal?: AbortSignal,
): Promise<PostApprovalStatus> =>
  jsonRequest<PostApprovalStatus>(
    `/api/app/posts/${encodeURIComponent(postId)}/status`,
    { signal },
  );

/** Mark a completed render on the owner-scoped post record (idempotent). */
export const markPostVideoGenerated = async (
  postId: string,
): Promise<PostVideoStatus> =>
  jsonRequest<PostVideoStatus>(
    `/api/app/posts/${encodeURIComponent(postId)}/video-generated`,
    { method: "POST" },
  );

/**
 * Persist the latest non-approval draft so My Work reopens what the
 * salesperson actually edited, saved, and shared instead of the first model
 * response. The server revalidates ownership and compliance.
 */
export const updatePostDraft = async (
  postId: string,
  input: UpdatePostDraftInput,
): Promise<{ id: string; updated: true; post_revision: string }> => {
  const knownIdentity = recallPostIdentity(postId);
  assertCustomerCopyIsSafe({
    customerName: knownIdentity?.publicCustomer,
    customerIdentityRequired: knownIdentity?.customerIdentityRequired,
    caption: input.caption,
    disclosures: input.disclosures,
    platformCaptions: input.platformCaptions,
    grounding: input.grounding,
  });
  const requestAuthEpoch = captureAuthEpoch();
  const form = new FormData();
  form.append("expected_post_revision", input.expectedPostRevision);
  form.append("caption", input.caption.trim());
  form.append("disclosures", input.disclosures?.trim() || "");
  form.append("platform_captions", JSON.stringify(input.platformCaptions || {}));
  if (input.imageDataUrl) {
    const image = await dataUrlToBlob(input.imageDataUrl);
    const extension =
      image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    form.append("creative_image", image, `post-creative.${extension}`);
  }
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(`/api/app/posts/${encodeURIComponent(postId)}/draft`, {
    method: "PATCH",
    credentials: "include",
    cache: "no-store",
    body: form,
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const updated = (await res.json()) as {
    id: string;
    updated: true;
    post_revision: string;
  };
  if (!updated.post_revision) {
    throw new Error("Saved draft response did not include its server revision");
  }
  assertAuthEpoch(requestAuthEpoch);
  return updated;
};

export interface RecordPostSharedInput {
  channel: PlatformDestinationId;
  via: PostShareVia;
  /** Revision of the exact saved copy that was exported. */
  expectedPostRevision: string;
}

export interface RecordedPostShare {
  id: string;
  channel: PlatformDestinationId;
  via: PostShareVia;
  /** Server-written time; the client never supplies one. */
  shared_at: string;
  /** True when the same channel and method were already recorded within 60 s. */
  deduplicated: boolean;
  /** Revision of the saved copy whose delivery locks were checked. */
  post_revision: string;
}

/**
 * Record a completed share on the owner-scoped post. Call it only once the
 * share happened (navigator.share resolved, the download started, the
 * caption was copied). The revision binds the receipt to the exact saved copy;
 * the server writes the time and refuses stale or locked posts.
 */
export const recordPostShared = async (
  postId: string,
  input: RecordPostSharedInput,
): Promise<RecordedPostShare> =>
  jsonRequest<RecordedPostShare>(
    `/api/app/posts/${encodeURIComponent(postId)}/shared`,
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        channel: input.channel,
        via: input.via,
        expected_post_revision: input.expectedPostRevision,
      }),
    },
  );

/** Set a scheduled publication timestamp on the owner-scoped post record. */
export const schedulePost = async (
  postId: string,
  scheduledFor: string,
): Promise<{ id: string; scheduled_for: string }> =>
  jsonRequest<{ id: string; scheduled_for: string }>(
    `/api/app/posts/${encodeURIComponent(postId)}/schedule`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_for: scheduledFor }),
    },
  );

/**
 * Load a stored creative image as a data URL (session-authenticated).
 * Used by History → reopen for share/export without regenerating.
 */
export const fetchPostCreativeDataUrl = async (
  creativeImageUrl: string,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(creativeImageUrl, { credentials: "include" });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const blob = await res.blob();
  assertAuthEpoch(requestAuthEpoch);
  if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error("Creative is not an image");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertAuthEpoch(requestAuthEpoch);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  assertAuthEpoch(requestAuthEpoch);
  return `data:${mime};base64,${btoa(binary)}`;
};

export const setApprovalStatus = async (
  postId: string,
  status: "approved" | "rejected",
  approvedBy?: string,
  /**
   * Required by the backend when status is "rejected": the salesperson's
   * result screen tells them to make "the requested changes", so there has to
   * be something to request. Ignored on approval.
   */
  rejectionReason?: string,
): Promise<void> => {
  await jsonRequest(`/api/app/posts/${encodeURIComponent(postId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      approval_status: status,
      approved_by: approvedBy || "",
      rejection_reason: rejectionReason || "",
    }),
  });
};

export const listPendingPosts = async (
  _dealerId: string,
  limit = 50,
  grounding?: DealerIdentityGrounding,
): Promise<PostRecord[]> => {
  const qs = new URLSearchParams({
    approval_status: "pending",
    limit: String(limit),
  });
  const res = await jsonRequest<{ items: PostRecord[] }>(
    `/api/app/posts?${qs.toString()}`,
  );
  return (res.items || []).map((item) => projectPostRecordForUi(item, grounding));
};

export interface PostListPage {
  items: PostRecord[];
  nextCursor?: string;
}

export const listPostsPage = async (
  options: {
    limit?: number;
    approvalStatus?: ApprovalStatus | "all";
    cursor?: string;
    grounding?: DealerIdentityGrounding;
  } = {},
): Promise<PostListPage> => {
  const qs = new URLSearchParams({
    limit: String(options.limit ?? 200),
  });
  if (options.approvalStatus && options.approvalStatus !== "all") {
    qs.set("approval_status", options.approvalStatus);
  }
  if (options.cursor) {
    qs.set("cursor", options.cursor);
  }
  const res = await jsonRequest<PostListPage>(`/api/app/posts?${qs.toString()}`);
  return {
    items: (res.items || []).map((item) =>
      projectPostRecordForUi(item, options.grounding),
    ),
    nextCursor: res.nextCursor || undefined,
  };
};

export const listPosts = async (
  options: {
    limit?: number;
    approvalStatus?: ApprovalStatus | "all";
    grounding?: DealerIdentityGrounding;
  } = {},
): Promise<PostRecord[]> => (await listPostsPage(options)).items;

export interface LeaderboardEntry {
  salesperson: string;
  salespersonId?: string;
  count: number;
  videoCount: number;
  releaseCount: number;
  lastPostedAt: string;
}

/**
 * Aggregates posts by salesperson_name within the given UTC date range.
 * "Unattributed" bucket captures posts where salesperson_name is empty.
 * The `dealerId` param is kept for backwards compat; the server scopes to
 * the session's dealer.
 */
export const getLeaderboard = async (
  _dealerId: string,
  since: Date,
  until: Date = new Date(),
): Promise<LeaderboardEntry[]> => {
  const qs = new URLSearchParams({
    since: since.toISOString(),
    until: until.toISOString(),
    aggregate: "leaderboard",
  });
  const res = await jsonRequest<{ items: LeaderboardEntry[] }>(
    `/api/app/posts?${qs.toString()}`,
  );
  return (res.items || []).map((entry) => ({
    salesperson: entry.salesperson || "Unattributed",
    salespersonId: entry.salespersonId || undefined,
    count: Number(entry.count) || 0,
    videoCount: Number(entry.videoCount) || 0,
    releaseCount: Number(entry.releaseCount) || 0,
    lastPostedAt: entry.lastPostedAt || "",
  }));
};
