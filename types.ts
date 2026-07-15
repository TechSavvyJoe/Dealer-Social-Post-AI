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

export interface GeneratedPost {
  image: string; // base64 data URL
  text: string;
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
  code?: string; // 6-digit login code (optional, for admin display)
  /** Per-dealership manager code. When set, logging in with this code routes to the DealerAdminDashboard instead of the salesperson capture flow. */
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
  aspectPreference: "auto" | "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p";
  pacing: "cinematic" | "snappy";
}

export interface GenerationParams {
  style: StyleOption;
  tone: ToneOption;
  customerName: string;
  customText?: string;
  creativeBrief?: string;
}
