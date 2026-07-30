import PocketBase from "pocketbase";
import { Dealer } from "../types";
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
