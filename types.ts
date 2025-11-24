export enum AppStep {
  LOGIN,
  CAPTURE,
  CUSTOMIZE,
  GENERATING,
  RESULT,
  ADMIN,
}

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
  code?: string; // 4-digit login code (optional, for admin display)
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
