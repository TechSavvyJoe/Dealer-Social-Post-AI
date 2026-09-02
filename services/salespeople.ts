/**
 * Session-gated people client. Access codes are credential responses, never
 * properties on ordinary session or roster DTOs.
 */

import { readApiError } from "./apiErrors";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import type { BrandCategoryId } from "../types";

export type PersonRole = "manager" | "salesperson";

export interface PersonSummary {
  id: string;
  dealer: string;
  name: string;
  role: PersonRole;
  active: boolean;
  // ---- Brand-consistent creative system (phase 1; optional, ships dark) ----
  /** Sales-manager permission subset (approve, curate, enable). Set by dealer_admin/super_admin only. */
  managerScope?: boolean;
  /** Personal line (<= 140 chars) appended after the caption footer. */
  signatureLine?: string;
  /** Pre-selected post category (a BrandCategoryId or custom scenario category, <= 40 chars). */
  defaultCategory?: string;
  /** Pre-selects the Playful second image when the dealership allows it. */
  playfulDefault?: boolean;
}

export interface RosterPerson extends PersonSummary {
  hasPin: boolean;
  pinNeedsDistribution: boolean;
  hasManagerLogin: boolean;
  managerUsername?: string;
  dealerName?: string;
  createdAt?: string;
}

/** Backward-compatible names while components migrate to the safer DTO. */
export type Salesperson = RosterPerson;
export type Person = RosterPerson;

export interface CredentialResult {
  person: RosterPerson;
  /** One-time credential. Never persist in query or application state. */
  pin: string;
}

export interface PeoplePage {
  items: RosterPerson[];
  nextCursor?: string;
  total?: number;
}

export const API_CONTRACT_VERSION = "2026-07-31.v4";

const optionalText = (...candidates: unknown[]): string | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
};

const optionalFlag = (...candidates: unknown[]): boolean | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
};

/** Six Customer Hub categories a salesperson may pre-select (spec §4.4). */
export const BRAND_CATEGORY_OPTIONS: ReadonlyArray<{
  id: BrandCategoryId;
  label: string;
}> = [
  { id: "deliveries", label: "Deliveries" },
  { id: "inventory", label: "Inventory" },
  { id: "service", label: "Service" },
  { id: "promotions", label: "Promotions" },
  { id: "community", label: "Community" },
  { id: "team", label: "Team" },
];

/** Server limit for signature_line (pb_hooks PERSON_TEXT_FIELD_LIMITS). */
export const SIGNATURE_LINE_MAX_LENGTH = 140;
/** Server limit for default_category (pb_hooks PERSON_TEXT_FIELD_LIMITS). */
export const DEFAULT_CATEGORY_MAX_LENGTH = 40;

const normalizePerson = (person: Record<string, unknown>): RosterPerson => ({
  id: String(person.id || ""),
  dealer: String(person.dealer || ""),
  name: String(person.name || ""),
  role: person.role === "manager" ? "manager" : "salesperson",
  active: person.active !== false,
  // Brand-consistent creative system (phase 1): the server serializes these
  // in camelCase; the snake_case fallbacks cover a raw record shape.
  managerScope: optionalFlag(person.managerScope, person.manager_scope),
  signatureLine: optionalText(person.signatureLine, person.signature_line),
  defaultCategory: optionalText(person.defaultCategory, person.default_category),
  playfulDefault: optionalFlag(person.playfulDefault, person.playful_default),
  hasPin: Boolean(person.hasPin ?? person.has_pin),
  pinNeedsDistribution: Boolean(
    person.pinNeedsDistribution ?? person.pin_needs_distribution,
  ),
  hasManagerLogin: Boolean(person.hasManagerLogin ?? person.has_manager_login),
  managerUsername:
    typeof person.managerUsername === "string"
      ? person.managerUsername
      : typeof person.manager_username === "string"
        ? person.manager_username
        : undefined,
  dealerName:
    typeof person.dealerName === "string"
      ? person.dealerName
      : typeof person.dealer_name === "string"
        ? person.dealer_name
        : undefined,
  createdAt:
    typeof person.createdAt === "string"
      ? person.createdAt
      : typeof person.created_at === "string"
        ? person.created_at
        : undefined,
});

const json = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Dealer-Client-Contract": API_CONTRACT_VERSION,
      ...(init.headers || {}),
    },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) throw await readApiError(res, { requestAuthEpoch });
  const body = (await res.json()) as T;
  assertAuthEpoch(requestAuthEpoch);
  return body;
};

export interface ListPeopleOptions {
  includeInactive?: boolean;
  role?: PersonRole;
  /** Empty/omitted means all stores for super admins only. */
  dealerId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  codesToShare?: boolean;
}

export const listPeoplePage = async (
  options: ListPeopleOptions = {},
): Promise<PeoplePage> => {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set("include_inactive", "true");
  if (options.role) params.set("role", options.role);
  if (options.dealerId) params.set("dealer", options.dealerId);
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.codesToShare) params.set("pin_needs_distribution", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const body = await json<{
    items?: Array<Record<string, unknown>>;
    nextCursor?: string;
    next_cursor?: string;
    total?: number;
  }>(`/api/app/salespeople${qs}`);
  return {
    items: (body.items || []).map(normalizePerson),
    nextCursor: body.nextCursor || body.next_cursor,
    total: body.total,
  };
};

export const listAllPeople = async (
  options: Omit<ListPeopleOptions, "cursor" | "limit"> = {},
): Promise<RosterPerson[]> => {
  const operationAuthEpoch = captureAuthEpoch();
  const items: RosterPerson[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  // The backend's four-digit credential namespace caps the complete roster at
  // 10,000 records (50 pages of 200). Fail explicitly if that invariant ever
  // changes instead of showing a silently truncated team.
  for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
    assertAuthEpoch(operationAuthEpoch);
    const page = await listPeoplePage({ ...options, limit: 200, cursor });
    assertAuthEpoch(operationAuthEpoch);
    items.push(...page.items);
    if (!page.nextCursor) return items;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("The people roster returned a repeated continuation cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error("The people roster exceeds the supported 10,000-person limit.");
};

export const listSalespeople = async (
  includeInactive = false,
): Promise<RosterPerson[]> => listAllPeople({ includeInactive, role: "salesperson" });

export const listPeople = async (
  options: ListPeopleOptions = {},
): Promise<RosterPerson[]> => (await listPeoplePage(options)).items;

const normalizeCredential = (body: {
  person: Record<string, unknown>;
  pin: string;
}): CredentialResult => ({
  person: normalizePerson(body.person),
  pin: String(body.pin || ""),
});

export const addPerson = async (input: {
  name: string;
  role?: PersonRole;
  dealer?: string;
}): Promise<CredentialResult> => {
  const body = await json<{
    person: Record<string, unknown>;
    pin: string;
  }>("/api/app/salespeople", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizeCredential(body);
};

export const addSalesperson = addPerson;

export type PersonUpdateFields = Partial<
  Pick<
    RosterPerson,
    | "name"
    | "active"
    | "role"
    | "managerScope"
    | "signatureLine"
    | "defaultCategory"
    | "playfulDefault"
  >
>;

/** Wire keys accepted by PATCH /api/app/salespeople/:id for the profile fields. */
const PERSON_PROFILE_WIRE_KEYS = {
  managerScope: "manager_scope",
  signatureLine: "signature_line",
  defaultCategory: "default_category",
  playfulDefault: "playful_default",
} as const;

export const updatePerson = async (
  id: string,
  fields: PersonUpdateFields,
): Promise<RosterPerson> => {
  const { managerScope, signatureLine, defaultCategory, playfulDefault, ...rest } =
    fields;
  const payload: Record<string, unknown> = { ...rest };
  const profile = { managerScope, signatureLine, defaultCategory, playfulDefault };
  for (const [key, wireKey] of Object.entries(PERSON_PROFILE_WIRE_KEYS)) {
    const value = profile[key as keyof typeof profile];
    if (value !== undefined) payload[wireKey] = value;
  }
  const body = await json<Record<string, unknown>>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  return normalizePerson(body);
};

export const updateSalesperson = updatePerson;

export const rotatePersonPin = async (id: string): Promise<CredentialResult> => {
  const body = await json<{
    person: Record<string, unknown>;
    pin: string;
  }>(`/api/app/salespeople/${encodeURIComponent(id)}/rotate-pin`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return normalizeCredential(body);
};

export const acknowledgePinDistribution = async (id: string): Promise<RosterPerson> => {
  const body = await json<Record<string, unknown>>(
    `/api/app/salespeople/${encodeURIComponent(id)}/acknowledge-pin`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return normalizePerson(body);
};

export const configureManagerLogin = async (
  id: string,
  input: { username: string; password: string },
): Promise<RosterPerson> => {
  const body = await json<
    Record<string, unknown> & { person?: Record<string, unknown> }
  >(`/api/app/salespeople/${encodeURIComponent(id)}/manager-login`, {
    method: "PUT",
    body: JSON.stringify({
      username: input.username,
      // Passwords are exact. Do not trim or normalize this value.
      password: input.password,
    }),
  });
  return normalizePerson(body.person || body);
};

export const disableManagerLogin = async (id: string): Promise<RosterPerson> => {
  const body = await json<Record<string, unknown>>(
    `/api/app/salespeople/${encodeURIComponent(id)}/manager-login`,
    { method: "DELETE" },
  );
  return normalizePerson(body);
};

export const deactivatePerson = async (id: string): Promise<{ success: true }> =>
  json<{ success: true }>(`/api/app/salespeople/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const deactivateSalesperson = deactivatePerson;

export interface SessionPayload {
  role: string;
  dealer: { id: string; name: string; [key: string]: unknown };
  person?: PersonSummary;
  is_impersonation?: boolean;
}

export const impersonatePerson = async (personId: string): Promise<SessionPayload> =>
  json<SessionPayload>("/api/app/session/impersonate", {
    method: "POST",
    body: JSON.stringify({ personId }),
  });

export const exitImpersonation = async (): Promise<SessionPayload> =>
  json<SessionPayload>("/api/app/session/exit-impersonate", {
    method: "POST",
    body: JSON.stringify({}),
  });
