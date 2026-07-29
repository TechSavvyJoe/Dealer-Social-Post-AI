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
/** Gemini image ratios that map to the app's supported social canvases. */
export type ImageAspectRatio = "1:1" | "9:16" | "16:9" | "4:3";
/** Exact export canvas selected as the primary generation target. */
export type PrimaryImageFormatId =
  "feed_square" | "story_vertical" | "marketplace" | "gbp";

export enum StyleOption {
  Luxury = "Luxury & Elegance",
  Modern = "Modern & Bold",
  Friendly = "Fun & Friendly",
  Sporty = "Sporty & Dynamic",
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

export interface GeneratedPost {
  image: string; // base64 data URL
  text: string;
  /** Server record used for owner-scoped approval status polling. */
  postId?: string;
  /** `submission_failed` is client-only and keeps delivery locked safely. */
  approvalStatus?: "n_a" | "pending" | "approved" | "rejected" | "submission_failed";
  /**
   * A captured signature is not considered usable until the protected release
   * record has been saved. Failed persistence locks all delivery actions so a
   * post can never claim consent that the backend does not hold.
   */
  releaseStatus?: "not_required" | "saved" | "save_failed";
  /** Manager/super-admin History view of another salesperson's immutable work. */
  historyReadOnly?: boolean;
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
  instagram_handle?: string;
  tiktok_handle?: string;
  x_handle?: string;
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
  /** Exact export canvas selected from the destination mix. */
  primaryFormatId?: PrimaryImageFormatId;
  /** Native Gemini image ratio corresponding to `primaryFormatId`. */
  imageAspectRatio?: ImageAspectRatio;
}
