import { readApiError } from "./apiErrors";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";

export type ConnectionServiceId =
  "gemini" | "anthropic" | "openai" | "website" | "walkaround";
export type ConnectionScope = "global" | "dealer";
export type ConnectionState =
  "off" | "needs_setup" | "needs_test" | "testing" | "ready" | "attention";

export interface ConnectionCapability {
  id: string;
  label: string;
  state: "verified" | "not_tested" | string;
}

export interface ManagedConnection {
  service: ConnectionServiceId;
  scope: ConnectionScope;
  dealerId?: string;
  configured: boolean;
  enabled: boolean;
  revision: number;
  state: ConnectionState;
  capabilities: ConnectionCapability[];
  lastVerifiedAt?: string;
  errorCode?: string;
  nextAction: string;
  settings: Record<string, string | boolean | undefined>;
  credentialConfigured: Record<string, boolean>;
}

export interface ConnectionDealer {
  id: string;
  name: string;
}

export interface ConnectionsResponse {
  scope: "guided_setup";
  services: ManagedConnection[];
  secureStorageAvailable?: boolean;
  dealers: ConnectionDealer[];
  apiContractVersion?: string;
  modelPolicyVersion?: string;
  capabilities?: Record<string, boolean>;
}

export interface ConnectionProofOption {
  id: string;
  label: string;
  state: "verified" | "not_tested" | string;
}

export const getConnectionProofs = async (
  service: "website" | "walkaround",
  dealerId?: string,
  signal?: AbortSignal,
): Promise<ConnectionProofOption[]> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const params = new URLSearchParams({ service });
  if (dealerId) params.set("dealerId", dealerId);
  const response = await fetch(`/api/app/connections/proofs?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return responseError(response, requestAuthEpoch);
  const payload = (await response.json()) as { items?: ConnectionProofOption[] };
  assertAuthEpoch(requestAuthEpoch);
  return Array.isArray(payload.items) ? payload.items : [];
};

export interface SaveConnectionInput {
  dealerId?: string;
  expectedRevision: number;
  enabled: boolean;
  settings: Record<string, string | boolean>;
  credentials: Record<string, string>;
}

export interface TestConnectionInput {
  dealerId?: string;
  expectedRevision: number;
  idempotencyKey: string;
  proofId?: string;
}

const responseError = async (
  response: Response,
  requestAuthEpoch: number,
): Promise<never> => {
  assertAuthEpoch(requestAuthEpoch);
  throw await readApiError(response, { requestAuthEpoch });
};

export const getConnections = async (
  signal?: AbortSignal,
): Promise<ConnectionsResponse> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const response = await fetch("/api/app/connections", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return responseError(response, requestAuthEpoch);
  const result = (await response.json()) as ConnectionsResponse;
  assertAuthEpoch(requestAuthEpoch);
  if (
    result?.scope !== "guided_setup" ||
    !Array.isArray(result.services) ||
    !Array.isArray(result.dealers)
  ) {
    throw new Error(
      "Connections setup is waiting for the server update. Refresh status after the release finishes.",
    );
  }
  return result;
};

export const saveConnection = async (
  service: ConnectionServiceId,
  input: SaveConnectionInput,
): Promise<ManagedConnection> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const response = await fetch(`/api/app/connections/${encodeURIComponent(service)}`, {
    method: "PATCH",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, confirmApply: true }),
  });
  if (!response.ok) return responseError(response, requestAuthEpoch);
  const result = (await response.json()) as ManagedConnection;
  assertAuthEpoch(requestAuthEpoch);
  return result;
};

export const testConnection = async (
  service: ConnectionServiceId,
  input: TestConnectionInput,
): Promise<ManagedConnection> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const response = await fetch(
    `/api/app/connections/${encodeURIComponent(service)}/test`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return responseError(response, requestAuthEpoch);
  const result = (await response.json()) as ManagedConnection;
  assertAuthEpoch(requestAuthEpoch);
  return result;
};
