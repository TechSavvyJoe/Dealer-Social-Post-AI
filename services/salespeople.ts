/**
 * People roster client (managers + salespeople). Session-gated; server scopes
 * by role. Super-admin may pass dealer + role filters and impersonate.
 */

export type PersonRole = "manager" | "salesperson";

export interface Salesperson {
  id: string;
  dealer: string;
  name: string;
  pin?: string;
  role?: PersonRole;
  active: boolean;
  created_at?: string;
}

export type Person = Salesperson;

const json = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error || detail;
    } catch {
      /* not json */
    }
    console.error("[salespeople] request failed", {
      url,
      status: res.status,
      detail,
    });

    if (res.status === 401) {
      throw new Error("Your session expired. Log in again to load the roster.");
    }
    if (res.status === 403) {
      throw new Error("You don’t have permission for this action.");
    }
    if (res.status >= 500) {
      throw new Error("The team roster is temporarily unavailable. Try again.");
    }
    throw new Error(detail || "We couldn’t complete that request. Try again.");
  }
  return (await res.json()) as T;
};

export interface ListPeopleOptions {
  includeInactive?: boolean;
  role?: PersonRole;
  dealerId?: string;
}

export const listSalespeople = async (
  includeInactive = false,
): Promise<Salesperson[]> => {
  return listPeople({ includeInactive });
};

export const listPeople = async (
  options: ListPeopleOptions = {},
): Promise<Person[]> => {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set("include_inactive", "true");
  if (options.role) params.set("role", options.role);
  if (options.dealerId) params.set("dealer", options.dealerId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const body = await json<{ items: Person[] }>(`/api/app/salespeople${qs}`);
  return body.items || [];
};

export const addSalesperson = async (input: {
  name: string;
  pin?: string;
  role?: PersonRole;
  dealer?: string;
}): Promise<Salesperson> => {
  return json<Salesperson>("/api/app/salespeople", {
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const addPerson = addSalesperson;

export const updateSalesperson = async (
  id: string,
  fields: Partial<Pick<Salesperson, "name" | "pin" | "active" | "role">>,
): Promise<Salesperson> => {
  return json<Salesperson>(`/api/app/salespeople/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
};

export const updatePerson = updateSalesperson;

export const deactivateSalesperson = async (
  id: string,
): Promise<{ success: true }> => {
  return json<{ success: true }>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
};

export const deactivatePerson = deactivateSalesperson;

export interface SessionPayload {
  role: string;
  dealer: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  person?: Person;
  is_impersonation?: boolean;
}

export const impersonatePerson = async (
  personId: string,
): Promise<SessionPayload> => {
  return json<SessionPayload>("/api/app/session/impersonate", {
    method: "POST",
    body: JSON.stringify({ personId }),
  });
};

export const exitImpersonation = async (): Promise<SessionPayload> => {
  return json<SessionPayload>("/api/app/session/exit-impersonate", {
    method: "POST",
    body: JSON.stringify({}),
  });
};
