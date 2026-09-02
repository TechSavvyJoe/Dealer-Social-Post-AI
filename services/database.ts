import PocketBase from "pocketbase";
import type {
  ApprovalPolicy,
  CategoryDestinations,
  Dealer,
  FeaturePermissions,
  ImageQualityTier,
  LogoPlacement,
  MotionSignature,
  SignatureLook,
} from "../types";
import { retryWithBackoff, isRetryableError } from "../utils/retry";
import { getErrorMessage } from "../utils/errorMessages";
import { DealerRecordSchema } from "../utils/schemas";
import { readApiError } from "./apiErrors";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";

// Initialize PocketBase
// In production (served by PB), this is relative. In dev, it might need to be localhost:8090
const PB_URL = import.meta.env.PROD ? "/" : import.meta.env.VITE_POCKETBASE_URL || "/";
export const pb = new PocketBase(PB_URL);

export const COLLECTION_NAME = "dealers";

// --- Health Check ---

/**
 * Check if PocketBase connection is healthy
 */
export const checkHealth = async (): Promise<boolean> => {
  try {
    await pb.health.check();
    return true;
  } catch {
    console.error("[Database] Health check failed");
    return false;
  }
};

// ============================================================================
// Brand-consistent creative system (spec 2026-09-02 §6; phase 1 ships dark).
// The session payload (pb_hooks serializeDealer) emits every field below in
// snake_case with structured fields already decoded. These helpers keep the
// client picking them explicitly in both directions so a refresh, the admin
// list, and the dealer PATCH body never silently drop a brand setting.
// ============================================================================

const SIGNATURE_LOOKS: readonly SignatureLook[] = ["showroom", "hometown", "turbo"];
const IMAGE_QUALITY_TIERS: readonly ImageQualityTier[] = ["standard", "studio"];

/** Every dealer field added by the phase-1 migration, in payload order. */
export const DEALER_BRAND_FIELDS = [
  "signature_look",
  "alternate_look",
  "default_tone",
  "playful_style",
  "motion_signature",
  "logo_placement",
  "brand_voice_do",
  "brand_voice_dont",
  "required_hashtags_locked",
  "category_destinations",
  "approval_policy",
  "feature_permissions",
  "image_quality_tier",
] as const;
export type DealerBrandField = (typeof DEALER_BRAND_FIELDS)[number];
export type DealerBrandFields = Pick<Dealer, DealerBrandField>;

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

const asSignatureLook = (value: unknown): SignatureLook | "" =>
  typeof value === "string" && (SIGNATURE_LOOKS as readonly string[]).includes(value)
    ? (value as SignatureLook)
    : "";

const asImageQualityTier = (value: unknown): ImageQualityTier | "" =>
  typeof value === "string" &&
  (IMAGE_QUALITY_TIERS as readonly string[]).includes(value)
    ? (value as ImageQualityTier)
    : "";

/**
 * Structured fields arrive decoded from the session but a raw PocketBase
 * record (or a stale client) may still hand us JSON text; accept both and
 * treat anything that is not a plain object as unset.
 */
const decodeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw || raw === "null") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const asObject = <T extends object>(value: unknown): T | null => {
  const decoded = decodeJson(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? (decoded as T)
    : null;
};

const asStringList = (value: unknown): string[] => {
  const decoded = decodeJson(value);
  return Array.isArray(decoded)
    ? decoded.filter((item): item is string => typeof item === "string")
    : [];
};

/**
 * Pick the brand-consistent creative fields out of any dealer-shaped payload
 * (session dealer, admin list row, or raw record) into their typed form.
 */
export const pickDealerBrandFields = (
  source: Record<string, unknown>,
): DealerBrandFields => ({
  signature_look: asSignatureLook(source.signature_look),
  alternate_look: asSignatureLook(source.alternate_look),
  default_tone: asText(source.default_tone),
  playful_style: asText(source.playful_style),
  motion_signature: asObject<MotionSignature>(source.motion_signature),
  logo_placement: asObject<LogoPlacement>(source.logo_placement),
  brand_voice_do: asStringList(source.brand_voice_do),
  brand_voice_dont: asStringList(source.brand_voice_dont),
  required_hashtags_locked:
    source.required_hashtags_locked === true ||
    source.required_hashtags_locked === "true",
  category_destinations: asObject<CategoryDestinations>(source.category_destinations),
  approval_policy: asObject<ApprovalPolicy>(source.approval_policy),
  feature_permissions: asObject<FeaturePermissions>(source.feature_permissions),
  image_quality_tier: asImageQualityTier(source.image_quality_tier),
});

/**
 * Encode brand fields for the multipart dealer PATCH body. pb_hooks parses
 * structured fields from JSON text and booleans from "true"/"false"; an
 * explicit null clears a structured field. Only keys present on `fields` are
 * emitted, so callers that omit approval_policy / category_destinations /
 * feature_permissions leave those values untouched on the server.
 */
export const encodeDealerBrandFields = (
  fields: Partial<DealerBrandFields>,
): Record<string, string | boolean> => {
  const encoded: Record<string, string | boolean> = {};
  for (const field of DEALER_BRAND_FIELDS) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === undefined) continue;
    if (typeof value === "boolean") {
      encoded[field] = value;
    } else if (value === null) {
      encoded[field] = "";
    } else if (typeof value === "string") {
      encoded[field] = value;
    } else {
      encoded[field] = JSON.stringify(value);
    }
  }
  return encoded;
};

// --- Data Access Functions ---

/**
 * Gets a list of all dealers via the admin-gated `/api/app/dealers` endpoint.
 * Returns [] if the caller isn't an admin or the session is missing.
 */
export const getAllDealers = async (): Promise<Dealer[]> => {
  const requestAuthEpoch = captureAuthEpoch();
  try {
    assertAuthEpoch(requestAuthEpoch);
    const res = await fetch("/api/app/dealers", { credentials: "include" });
    if (!res.ok) {
      if (res.status === 403) return [];
      throw await readApiError(res, { requestAuthEpoch });
    }
    const body = (await res.json()) as { items?: Dealer[] };
    assertAuthEpoch(requestAuthEpoch);
    return (body.items || []).map((d) => ({
      ...d,
      logo: d.logo || undefined,
      brand_voice: d.brand_voice || undefined,
      banned_phrases: d.banned_phrases || undefined,
      oem_affiliation: d.oem_affiliation || undefined,
      brand_color: d.brand_color || undefined,
      ...pickDealerBrandFields(d as unknown as Record<string, unknown>),
    }));
  } catch (error) {
    const { title, description } = getErrorMessage(error);
    console.error(`[Database] ${title}:`, description, error);
    throw error;
  }
};

/**
 * Finds a dealer by their 4-digit code (e.g., "0000", "1111").
 * @param dealerCode The 4-digit code of the dealer.
 * @returns A promise resolving to the Dealer object or undefined if not found.
 */
export const findDealer = async (dealerCode: string): Promise<Dealer | undefined> => {
  try {
    // Search for dealer by code field instead of ID. Use pb.filter() for safe
    // {:name} placeholder substitution — passing a {filter:{...}} object as the
    // options arg does NOT substitute the placeholder (the literal "{:code}"
    // string gets sent and the query never matches).
    const rawRecord = await pb
      .collection(COLLECTION_NAME)
      .getFirstListItem(pb.filter("code = {:code}", { code: dealerCode }));

    const record = DealerRecordSchema.parse(rawRecord);

    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(rawRecord, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl || undefined,
      code: record.code || "",
      brand_voice: record.brand_voice || undefined,
      banned_phrases: record.banned_phrases || undefined,
      oem_affiliation: record.oem_affiliation || undefined,
      ...pickDealerBrandFields(record),
    };
  } catch (error) {
    // PocketBase throws 404 if not found
    return undefined;
  }
};

/**
 * Finds a dealer by their PocketBase record ID.
 * @param dealerId The PocketBase record ID of the dealer.
 * @returns A promise resolving to the Dealer object or undefined if not found.
 */
export const findDealerById = async (dealerId: string): Promise<Dealer | undefined> => {
  try {
    const rawRecord = await pb.collection(COLLECTION_NAME).getOne(dealerId);
    const record = DealerRecordSchema.parse(rawRecord);

    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(rawRecord, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl || undefined,
      code: record.code || "",
      brand_voice: record.brand_voice || undefined,
      banned_phrases: record.banned_phrases || undefined,
      oem_affiliation: record.oem_affiliation || undefined,
      ...pickDealerBrandFields(record),
    };
  } catch (error) {
    // PocketBase throws 404 if not found
    return undefined;
  }
};

/**
 * Gets a list of dealers for display (e.g., in the admin panel).
 * Excludes the Admin user if it exists as a special record (or handle logic here).
 * @returns A promise resolving to an array of Dealer objects.
 */
export const getDealers = async (): Promise<Dealer[]> => {
  const dealers = await getAllDealers();
  // Filter out any specific admin record if necessary.
  // Assuming standard dealers for now.
  return dealers.sort((a, b) => a.name.localeCompare(b.name));
};

// --- Data Mutation Functions ---

// ============================================================================
// Dealer mutations — all route through admin-gated /api/app/dealers endpoints
// in pb_hooks/main.pb.js. Direct REST writes on `dealers` are blocked since
// migration 1748000400_lock_collection_rules.
// ============================================================================

const mutateDealer = async (
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  formData?: FormData,
): Promise<Dealer> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(url, {
    method,
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const dealer = (await res.json()) as Dealer;
  assertAuthEpoch(requestAuthEpoch);
  return dealer;
};

export const addDealer = async (dealer: Omit<Dealer, "id">): Promise<Dealer> => {
  const fd = new FormData();
  fd.append("name", dealer.name);
  if (dealer.code) fd.append("code", dealer.code);
  if (dealer.logo) fd.append("logo", dealer.logo);
  return mutateDealer("/api/app/dealers", "POST", fd);
};

export const updateDealer = async (dealer: Dealer): Promise<Dealer> => {
  const fd = new FormData();
  fd.append("name", dealer.name);
  if (dealer.logo) fd.append("logo", dealer.logo);
  // Brand fields ride along only when the caller set them, so a partial
  // Dealer never clears a structured setting it did not carry.
  Object.entries(encodeDealerBrandFields(dealer)).forEach(([key, value]) =>
    fd.append(key, typeof value === "boolean" ? (value ? "true" : "false") : value),
  );
  return mutateDealer(`/api/app/dealers/${encodeURIComponent(dealer.id)}`, "PATCH", fd);
};

export const updateDealerWithFile = async (
  dealerId: string,
  formData: FormData,
): Promise<Dealer> => {
  return mutateDealer(
    `/api/app/dealers/${encodeURIComponent(dealerId)}`,
    "PATCH",
    formData,
  );
};

export const addDealerWithFile = async (formData: FormData): Promise<Dealer> => {
  return mutateDealer("/api/app/dealers", "POST", formData);
};

export const deleteDealer = async (dealerId: string): Promise<void> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(`/api/app/dealers/${encodeURIComponent(dealerId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  assertAuthEpoch(requestAuthEpoch);
};
