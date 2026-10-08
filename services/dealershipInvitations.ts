import { z } from "zod";
import { withRequestDeadline } from "../utils/requestDeadline";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import { readApiError } from "./apiErrors";
const statusSchema = z.object({
  required: z.boolean(),
  hasInvitation: z.boolean(),
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
const dealerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
});
export type InvitationStatus = z.infer<typeof statusSchema>;
export type InvitedDealer = z.infer<typeof dealerSchema>;
export async function currentInvitedDealer(
  signal?: AbortSignal,
): Promise<InvitedDealer | null> {
  return withRequestDeadline(signal, async (bounded) => {
    const response = await fetch("/api/app/dealership-invitation", {
      credentials: "include",
      cache: "no-store",
      signal: bounded,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await readApiError(response, { notifyAuth: false });
    return dealerSchema.parse(await response.json());
  });
}
export async function acceptDealershipInvitation(
  token: string,
  callerSignal?: AbortSignal,
): Promise<InvitedDealer> {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Ask your manager for a current private invitation.");
  return withRequestDeadline(callerSignal, async (signal) => {
    const response = await fetch("/api/app/dealership-invitation", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw await readApiError(response, { notifyAuth: false });
    return dealerSchema.parse(await response.json());
  });
}
export async function dealershipInvitation(
  dealerId: string,
  action?: "issue" | "require",
  signal?: AbortSignal,
): Promise<InvitationStatus> {
  const epoch = captureAuthEpoch();
  return withRequestDeadline(signal, async (bounded) => {
    assertAuthEpoch(epoch);
    const response = await fetch(
      "/api/app/dealers/" + encodeURIComponent(dealerId) + "/invitation",
      {
        method: action ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        signal: bounded,
        ...(action
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            }
          : {}),
      },
    );
    assertAuthEpoch(epoch);
    if (!response.ok) throw await readApiError(response, { requestAuthEpoch: epoch });
    const result = await response.json();
    assertAuthEpoch(epoch);
    return statusSchema.parse(result);
  });
}
export const dealershipInvitationLink = (token: string) =>
  location.origin + "/join#" + token;
