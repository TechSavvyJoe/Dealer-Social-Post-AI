/**
 * Per-salesperson roster client. All routes are session-gated and scoped to
 * the active dealer; the server forces the dealer field on writes.
 */

export interface Salesperson {
  id: string;
  dealer: string;
  name: string;
  pin?: string;
  active: boolean;
  created_at?: string;
}

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
      throw new Error("You don’t have permission to view this roster.");
    }
    if (res.status >= 500) {
      throw new Error("The team roster is temporarily unavailable. Try again.");
    }
    throw new Error("We couldn’t load the team roster. Try again.");
  }
  return (await res.json()) as T;
};

export const listSalespeople = async (
  includeInactive = false,
): Promise<Salesperson[]> => {
  const qs = includeInactive ? "?include_inactive=true" : "";
  const body = await json<{ items: Salesperson[] }>(
    `/api/app/salespeople${qs}`,
  );
  return body.items || [];
};

export const addSalesperson = async (input: {
  name: string;
  pin?: string;
}): Promise<Salesperson> => {
  return json<Salesperson>("/api/app/salespeople", {
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const updateSalesperson = async (
  id: string,
  fields: Partial<Pick<Salesperson, "name" | "pin" | "active">>,
): Promise<{ id: string }> => {
  return json<{ id: string }>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(fields),
    },
  );
};

export const deactivateSalesperson = async (
  id: string,
): Promise<{ success: true }> => {
  return json<{ success: true }>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
};
