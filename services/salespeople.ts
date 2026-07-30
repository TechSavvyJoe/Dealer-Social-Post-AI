/**
 * Session-gated people client. Access codes are credential responses, never
 * properties on ordinary session or roster DTOs.
 */

import { readApiError } from "./apiErrors";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";

export type PersonRole = "manager" | "salesperson";

export interface PersonSummary {
  id: string;
  dealer: string;
  name: string;
  role: PersonRole;
  active: boolean;
}

export interface RosterPerson extends PersonSummary {
  hasPin: boolean;
  pinNeedsDistribution: boolean;
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

export const API_CONTRACT_VERSION = "2026-07-29.v3";

const normalizePerson = (person: Record<string, unknown>): RosterPerson => ({
  id: String(person.id || ""),
  dealer: String(person.dealer || ""),
  name: String(person.name || ""),
  role: person.role === "manager" ? "manager" : "salesperson",
  active: person.active !== false,
  hasPin: Boolean(person.hasPin ?? person.has_pin),
  pinNeedsDistribution: Boolean(
    person.pinNeedsDistribution ?? person.pin_needs_distribution,
  ),
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

export const updatePerson = async (
  id: string,
  fields: Partial<Pick<RosterPerson, "name" | "active" | "role">>,
): Promise<RosterPerson> => {
  const body = await json<Record<string, unknown>>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(fields) },
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

export const revealPersonPin = async (id: string): Promise<CredentialResult> => {
  const body = await json<{
    person: Record<string, unknown>;
    pin: string;
  }>(`/api/app/salespeople/${encodeURIComponent(id)}/reveal-pin`, {
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
