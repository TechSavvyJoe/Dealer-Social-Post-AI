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
    throw new Error(`${url}: ${detail}`);
  }
  return (await res.json()) as T;
};

export const listSalespeople = async (
  includeInactive = false
): Promise<Salesperson[]> => {
  const qs = includeInactive ? "?include_inactive=true" : "";
  const body = await json<{ items: Salesperson[] }>(
    `/api/app/salespeople${qs}`
  );
  return body.items || [];
};

export const addSalesperson = async (
  input: { name: string; pin?: string }
): Promise<Salesperson> => {
  return json<Salesperson>("/api/app/salespeople", {
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const updateSalesperson = async (
  id: string,
  fields: Partial<Pick<Salesperson, "name" | "pin" | "active">>
): Promise<{ id: string }> => {
  return json<{ id: string }>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(fields),
    }
  );
};

export const deactivateSalesperson = async (
  id: string
): Promise<{ success: true }> => {
  return json<{ success: true }>(
    `/api/app/salespeople/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
};
