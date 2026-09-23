import type { PlatformDestinationId } from "./services/platformOutputs";
import type { WebsiteDraft, WebsitePublication } from "./services/websitePublishing";
import type { DecodedVehicle } from "./services/vinDecoder";

export enum AppStep {
  LOGIN,
  CAPTURE,
  CUSTOMIZE,
  GENERATING,
  RESULT,
  /** Super-admin (Joe): manages dealerships across all tenants. */
  ADMIN,
  /** Per-dealership admin (GSM/GM): manages their own dealership only. */
  DEALER_ADMIN,
}

export type UserRole = "salesperson" | "dealer_admin" | "super_admin";
export type ImageQualityTier = "standard" | "studio";
/**
 * Media the salesperson intends to deliver for each selected destination.
 * A photo master is still created for video-only plans because Veo animates
 * that protected, approval-ready frame.
 */
export type MediaOutputMode = "photo" | "video" | "both";
/** Gemini image ratios that map to the app's supported social canvases. */
export type ImageAspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "4:3";
/** Exact export canvas selected as the primary generation target. */
export type PrimaryImageFormatId =
  "feed_portrait" | "feed_square" | "story_vertical" | "marketplace" | "gbp";

// ---- Brand-consistent creative system (spec 2026-09-02) -------------------
// Shared contract for the dealer/person fields added in phase 1. The backend
// (pb_hooks/helpers.js) validates every shape below before storing it.

/** Dealership Signature Look: bundles image style, caption tone, layout, motion. */
export type SignatureLook = "showroom" | "hometown" | "turbo";
/** The six Customer Hub categories the per-category destination table keys off. */
export type BrandCategoryId =
  "deliveries" | "inventory" | "service" | "promotions" | "community" | "team";
/** Any EXPORT_FORMATS id, including the landscape export that is never primary. */
export type CategoryFormatId = PrimaryImageFormatId | "social_landscape";
export type LogoCorner = "top_left" | "top_right" | "bottom_left" | "bottom_right";
export interface LogoPlacement {
  corner: LogoCorner;
  /** Logo width as a fraction of the canvas width (0.04-0.5). */
  scale: number;
}
export type MotionAspect = "9:16" | "16:9";
export type MotionAudio = "none" | "celebration" | "cinematic" | "anthemic" | "funk";
/** Fixed motion format for a Look; the manager may enable a 16:9 variant. */
export interface MotionSignature {
  /** VideoStyle display value bound to the Look (e.g. "Golden Radiance"). */
  style: string;
  aspects: MotionAspect[];
  audio: MotionAudio;
}
export interface CategoryDestination {
  /** publishTargets ids (backend allowlist: allowedPostPlatformIds). */
  platformIds: string[];
  formatIds: CategoryFormatId[];
  video: boolean;
}
export type CategoryDestinations = Partial<
  Record<BrandCategoryId, CategoryDestination>
>;
export type ApprovalPolicyMode = "none" | "first_n" | "always" | "per_category";
export interface ApprovalPolicy {
  mode: ApprovalPolicyMode;
  /** Only for mode "first_n": posts 1..firstN of each person need sign-off. */
  firstN?: number;
  /** Only for mode "per_category". */
  categories?: BrandCategoryId[];
}
export type FeaturePermissionKey = "playful" | "video" | "freeTextEdit";
export interface FeaturePermission {
  /** Team-wide default. */
  team: boolean;
  /** Per-person overrides keyed by salespeople record id. */
  people: Record<string, boolean>;
}
export type FeaturePermissions = Partial<
  Record<FeaturePermissionKey, FeaturePermission>
>;

export enum StyleOption {
  Luxury = "Luxury & Elegance",
  Modern = "Modern & Bold",
  Friendly = "Fun & Friendly",
  Sporty = "Sporty & Dynamic",
  DepthPop = "3D Depth Pop",
}

export enum ToneOption {
  Excited = "Excited",
  Professional = "Professional",
  Family = "Family-Friendly",
  Humorous = "Humorous",
  Inspirational = "Inspirational",
  Promotional = "Promotional",
}

// FIX: Added the VideoStyle enum to resolve the export error.
export enum VideoStyle {
  EpicReveal = "Epic Reveal",
  PartyTime = "Party Time",
  VintageFilm = "Vintage Film",
  NeonPulse = "Neon Pulse",
  CometStrike = "Comet Strike",
  HappyDance = "Happy Dance",
  JumpingForJoy = "Jumping for Joy",
  SpeedLines = "Speed Lines",
  CarSketch = "Car Sketch",
  GoldenRadiance = "Golden Radiance",
  GlitchPop = "Glitch Pop",
  SmokeReveal = "Smoke Reveal",
  Spotlight = "Spotlight",
  FireEmbers = "Fire & Embers",
  LiquidChrome = "Liquid Chrome",
  StickerSlap = "Sticker Slap",
  GraffitiReveal = "Graffiti Reveal",
  HolographicScan = "Holographic Scan",
  RoadTrip = "Road Trip",
  Blueprint = "Blueprint",
}

/**
 * The AI works from a normalized, mobile-safe image while the untouched File
 * remains available for recovery and an explicit Save to Photos action.
 */
export interface ImageSelection {
  workingImage: string;
  originalSource: string | Blob;
  originalFilename?: string;
}

/**
 * How a completed share left the device: the OS share sheet resolved, the
 * file was downloaded, or the caption was copied. Mirrors the `via` select on
 * the `post_share_events` collection.
 */
export type PostShareVia = "share_sheet" | "download" | "copy";

/** One recorded share. The server writes the timestamp. */
export interface PostShareRecord {
  /** Destination id from services/platformOutputs.ts, e.g. `facebook_feed`. */
  channel: PlatformDestinationId;
  via: PostShareVia;
  /** Server-written time the share was recorded. */
  at: string;
}

export interface GeneratedPost {
  image: string; // base64 data URL
  text: string;
  /** Public-safe first name/family label; never the protected full release name. */
  customerDisplayName?: string;
  /** True only when the selected post type requires a release-bound customer identity. */
  customerIdentityRequired?: boolean;
  /**
   * The post type this creative was generated for. Travels with the post
   * (and is persisted as `scenario_id`) so a creative reopened from History —
   * which deliberately has no live generationParams — still knows whether
   * delivery language belongs in its caption filler and which Look applies.
   */
  scenarioId?: string;
  /** Server record used for owner-scoped approval status polling. */
  postId?: string;
  /** `submission_failed` is client-only and keeps delivery locked safely. */
  approvalStatus?: "n_a" | "pending" | "approved" | "rejected" | "submission_failed";
  /** What the manager asked to be changed. Set only when rejected. */
  rejectionReason?: string;
  /**
   * A captured signature is not considered usable until the protected release
   * record has been saved. Failed persistence locks all delivery actions so a
   * post can never claim consent that the backend does not hold.
   */
  releaseStatus?: "not_required" | "saved" | "save_failed";
  /**
   * The two release writes fail independently: the signature is stored before
   * the paid provider call, the post-to-release association after it. This is
   * set only when consent IS durably stored and just the association failed —
   * a recoverable state the result screen can retry. Its absence on a locked
   * post means the lock is a genuine missing-consent lock, which keeps the
   * strict copy.
   */
  releaseLinkStatus?: "link_failed";
  /** Server id of the stored consent record, so the link can be retried. */
  releaseId?: string;
  /** Manager/super-admin History view of another salesperson's immutable work. */
  historyReadOnly?: boolean;
  /** Server policy quarantine for legacy/unreviewed creative pixels. */
  imageReviewRequired?: boolean;
  /**
   * Required compliance disclosure footer, stored separately from `text` so
   * a salesperson can't silently delete it while editing the caption.
   * Empty string when no disclosure rules matched.
   */
  disclosures?: string;
  /**
   * Categories of disclosures detected, surfaced as compliance pills.
   */
  disclosureCategories?: string[];
  /**
   * Platforms selected on the generate screen ("Share to"). Used to prioritize
   * multi-format export and to label the caption pack.
   */
  platformIds?: string[];
  /** Whether the selected destinations should receive photos, videos, or both. */
  mediaOutputMode?: MediaOutputMode;
  /** Native canvas targeted during AI image generation. */
  primaryFormatId?: PrimaryImageFormatId;
  /** Provider-validated aspect ratio used for the primary generated image. */
  imageAspectRatio?: ImageAspectRatio;
  /**
   * Per-platform caption variants keyed by publish target id
   * (e.g. `instagram_feed`, `tiktok`). Absent when only the primary caption
   * was generated (0–1 platforms or pack step failed).
   */
  platformCaptions?: Record<string, string>;
  /** AI-prepared copy for a private Customer Hub draft; never public by itself. */
  websiteDraft?: WebsiteDraft;
  /** Durable server-to-server delivery state for the private website draft. */
  websitePublication?: WebsitePublication;
  /**
   * Shares the server recorded for this post (POST /api/app/posts/:id/shared),
   * oldest first. Present only after a completed share; never claims which
   * app received it, only how it left the device.
   */
  sharedTo?: PostShareRecord[];
  /** User-visible provenance for the primary caption. */
  captionSource?: "ai" | "basic_fallback" | "custom";
  /** True when a safe local template was used instead of a provider result. */
  isBasicFallback?: boolean;
  /** Redacted generation diagnostics; never contains prompts or credentials. */
  aiMeta?: {
    captionSource: "ai" | "basic_fallback" | "custom";
    selectedTier: "standard" | "studio";
    model?: string;
    fallbackCount: number;
    lastSuccessfulGenerationAt?: string;
    caption: {
      task: string;
      tier: "fast" | "quality" | "standard" | "studio";
      provider: string;
      model: string | null;
      attemptId?: string;
      fallbackCount: number;
      lastSuccessAt: string | null;
    };
    image: {
      task: string;
      tier: "fast" | "quality" | "standard" | "studio";
      provider: string;
      model: string | null;
      attemptId?: string;
      fallbackCount: number;
      lastSuccessAt: string | null;
    };
    modelPolicyVersion: string;
  };
}

export interface DealershipSettings {
  dealershipName: string;
  dealershipLogo?: string; // base64 data URL
}

export interface TemplateOption {
  id: string;
  name: string;
  content: string;
}

// New types for the database and user authentication
export interface Dealer {
  id: string; // unique identifier
  name: string;
  logo?: string; // base64 data URL
  /** Legacy store code field (no longer used for personal login). */
  code?: string;
  /** Legacy manager code field (managers now use personal 4-digit codes). */
  admin_code?: string;
  /** Free-form voice guide injected into every prompt. */
  brand_voice?: string;
  /** Newline- or comma-separated list of phrases the model must avoid. */
  banned_phrases?: string;
  /** Primary franchise OEM ("Ford", "GM", "Stellantis", "Independent", etc.) */
  oem_affiliation?: string;
  /** When true, every new post starts in 'pending' state and needs manager sign-off before it counts as published. */
  requires_approval?: boolean;
  /** Optional hex color (e.g. "#1d4ed8") for white-label theme. */
  brand_color?: string;

  // ---- Contact + identity ----
  website?: string;
  phone?: string;
  address?: string;
  hours?: string;
  tagline?: string;

  // ---- Social handles ----
  facebook_url?: string;
  /** Exact Facebook Page mention used in salesperson-originated posts. */
  facebook_page_tag?: string;
  instagram_handle?: string;
  tiktok_handle?: string;
  x_handle?: string;
  /** Exact LinkedIn company mention; composer may require selecting its suggestion. */
  linkedin_company_tag?: string;
  gbp_url?: string;

  // ---- Generation defaults ----
  /** Newline- or comma-separated hashtags appended to every post. */
  default_hashtags?: string;
  /** Boilerplate text appended after the caption (CTA, address, hours, etc.). */
  default_footer?: string;

  // ---- Image-overlay preferences ----
  /** Comma-separated list of enabled StyleOption ids. Empty = all enabled. */
  enabled_styles?: string;
  /** Default StyleOption id preselected in the picker. Empty = first enabled. */
  default_style?: string;
  /** Comma-separated funStyle ids the GSM has enabled. Empty = all enabled. */
  enabled_fun_styles?: string;

  /** JSON-serialized array of GSM-defined post scenarios. Augments the built-in catalog. */
  custom_scenarios?: string;

  // ---- Brand-consistent creative system (phase 1; all optional, ships dark) ----
  /** House Look; empty until the dealer admin picks one. */
  signature_look?: SignatureLook | "";
  /** Optional second Look a manager may enable. */
  alternate_look?: SignatureLook | "";
  /** Tone derived from the Look; stored so overrides can be audited. */
  default_tone?: string;
  /** Exactly one Fun Mode style id; supersedes free-form enabled_fun_styles. */
  playful_style?: string;
  motion_signature?: MotionSignature | null;
  logo_placement?: LogoPlacement | null;
  /** Up to 3 "do" phrases (<= 60 chars) alongside brand_voice. */
  brand_voice_do?: string[];
  /** Up to 3 "don't" phrases (<= 60 chars). */
  brand_voice_dont?: string[];
  /** When true, default_hashtags survive the per-platform tag cap. */
  required_hashtags_locked?: boolean;
  category_destinations?: CategoryDestinations | null;
  approval_policy?: ApprovalPolicy | null;
  feature_permissions?: FeaturePermissions | null;
  /** Server-owned replacement for the client localStorage tier. */
  image_quality_tier?: ImageQualityTier | "";
  /**
   * Phase 2 resolver flag (spec §9). While false or unset,
   * services/creativeSystem.ts reproduces today's style/tone precedence and
   * prescribes no destinations, so only a piloted dealership changes behavior.
   */
  creative_system_v2?: boolean;
  /**
   * Optional override of the FTC 16 CFR 255 team-member disclosure wording.
   * Empty or unset uses DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE.
   */
  employee_disclosure_text?: string;
  /**
   * Opt-OUT of the team-member disclosure, not an opt-in: unset/false means
   * the disclosure is applied. PocketBase reports an unset bool as false, so
   * this polarity keeps every pre-existing dealership on the compliant side.
   */
  employee_disclosure_disabled?: boolean;
}

// FIX: Added User interface to resolve import error in UserModal.tsx.
export interface User {
  id: string; // unique identifier, phone number
  name: string;
  dealerId: string;
}

export interface VideoRequestOptions {
  durationSeconds: number;
  soundtrack: "none" | "celebration" | "cinematic" | "anthemic" | "funk";
  /** Veo-supported output ratios only; never label a landscape file as square. */
  aspectPreference: "auto" | "16:9" | "9:16";
  resolution: "720p" | "1080p";
  pacing: "cinematic" | "snappy";
}

export interface GenerationParams {
  style: StyleOption;
  tone: ToneOption;
  customerName: string;
  customText?: string;
  creativeBrief?: string;
  /** Platforms selected in PostCustomizer ("Share to") for caption packs + export priority. */
  platformIds?: string[];
  /** Post scenario restored after a failed generation attempt or same-photo remix. */
  scenarioId?: string;
  /** Trusted scenario decision used to fail closed only for customer-required copy. */
  customerIdentityRequired?: boolean;
  /** Requested destination deliverables; defaults to photo for legacy sessions. */
  mediaOutputMode?: MediaOutputMode;
  /** Exact export canvas selected from the destination mix. */
  primaryFormatId?: PrimaryImageFormatId;
  /** Native Gemini image ratio corresponding to `primaryFormatId`. */
  imageAspectRatio?: ImageAspectRatio;
  /** Separate from manual social targets: prepare a private website draft. */
  websiteEnabled?: boolean;
  /** Grounded year/make/model/trim label from VIN decode; never the VIN. */
  websiteVehicleDescription?: string;
  /**
   * Full decoded VIN record, restored verbatim after a failed generation
   * attempt sends the customizer back through a remount (every AppStep
   * transition is a keyed remount — see PageTransition). Without this, a
   * successfully scanned VIN silently vanished on retry even though every
   * other field on screen correctly restored, leaving the next attempt
   * ungrounded exactly when the hallucination risk the VIN feature exists
   * to prevent is highest.
   */
  decodedVehicle?: DecodedVehicle;
}
