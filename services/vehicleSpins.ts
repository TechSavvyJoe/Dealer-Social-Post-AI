import { withRequestDeadline } from "../utils/requestDeadline";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import type { SpinBackground, SpinVehicle } from "../utils/vehicleSpin";
import { readApiError } from "./apiErrors";

export interface SpinCapacity {
  personalUsed: number;
  personalLimit: number;
  dealershipUsed: number;
  dealershipLimit: number;
  canCreate: boolean;
  /** Physical space for a complete spin plus backup working room. */
  storageAvailable?: boolean;
  reason: string;
}

export interface VehicleSpin {
  id: string;
  vehicle: SpinVehicle;
  frameCount: number;
  background: SpinBackground;
  dealerName: string;
  state: "uploading" | "pending" | "approved" | "n_a" | "rejected";
  canDeliver: boolean;
  created?: string;
  reviewNote?: string;
  linkToken?: string;
  uploadedAngles?: number[];
}
const request = async <T>(
  path: string,
  init: RequestInit = {},
  epoch = captureAuthEpoch(),
): Promise<T> => {
  assertAuthEpoch(epoch);
  return withRequestDeadline(init.signal, async (signal) => {
    const response = await fetch("/api/app/vehicle-spins" + path, {
      ...init,
      signal,
      credentials: "include",
      cache: "no-store",
    });
    assertAuthEpoch(epoch);
    if (!response.ok) throw await readApiError(response, { requestAuthEpoch: epoch });
    const value = (await response.json()) as T;
    assertAuthEpoch(epoch);
    return value;
  });
};
export const listVehicleSpins = (signal?: AbortSignal) =>
  request<{ items: VehicleSpin[]; canReview: boolean; capacity?: SpinCapacity }>("", {
    signal,
  });
export const getVehicleSpin = (id: string, signal?: AbortSignal) =>
  request<VehicleSpin>("/" + encodeURIComponent(id), { signal });
export const spinAction = (
  id: string,
  action: "finish" | "share" | "export" | "revoke" | "review",
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
) =>
  request<VehicleSpin>("/" + encodeURIComponent(id) + "/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
export const deleteVehicleSpin = (id: string, signal?: AbortSignal) =>
  request<{ deleted: boolean }>("/" + encodeURIComponent(id), {
    method: "DELETE",
    signal,
  });

export const saveVehicleSpin = async (
  input: {
    vehicle: SpinVehicle;
    background: SpinBackground;
    frames: Blob[];
    existing?: VehicleSpin | null;
  },
  options: {
    signal: AbortSignal;
    onCreated: (spin: VehicleSpin) => void;
    onProgress: (fraction: number) => void;
  },
): Promise<VehicleSpin> => {
  const epoch = captureAuthEpoch();
  const spin = input.existing
    ? await getVehicleSpin(input.existing.id, options.signal)
    : await request<VehicleSpin>(
        "",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: options.signal,
          body: JSON.stringify({
            vehicle: input.vehicle,
            frameCount: input.frames.length,
            background: input.background,
            reviewedAllAngles: true,
            vehicleOnly: true,
          }),
        },
        epoch,
      );
  assertAuthEpoch(epoch);
  options.onCreated(spin);
  if (spin.state !== "uploading") return spin;
  if (spin.frameCount !== input.frames.length)
    throw new Error(
      "This saved spin has a different number of angles. Start a new spin.",
    );
  const uploaded = new Set(spin.uploadedAngles || []);
  for (let index = 0; index < input.frames.length; index++) {
    assertAuthEpoch(epoch);
    if (!uploaded.has(index)) {
      const form = new FormData();
      form.append("image", input.frames[index], "angle-" + index + ".jpg");
      await request(
        "/" + spin.id + "/frames/" + index,
        { method: "POST", body: form, signal: options.signal },
        epoch,
      );
    }
    options.onProgress((index + 1) / input.frames.length);
  }
  assertAuthEpoch(epoch);
  return request<VehicleSpin>(
    "/" + spin.id + "/finish",
    { method: "POST", signal: options.signal },
    epoch,
  );
};

export const loadSpinFrames = async (
  spin: VehicleSpin,
  options: {
    signal: AbortSignal;
    publicToken?: string;
    onProgress?: (fraction: number) => void;
  },
): Promise<Blob[]> => {
  const epoch = captureAuthEpoch();
  if (
    !Number.isInteger(spin.frameCount) ||
    spin.frameCount < 24 ||
    spin.frameCount > 72
  )
    throw new Error("This vehicle view has an invalid number of angles.");
  const group = new AbortController();
  const cancel = () => group.abort(options.signal.reason);
  if (options.signal.aborted) cancel();
  else options.signal.addEventListener("abort", cancel, { once: true });
  const result: Blob[] = new Array(spin.frameCount);
  let next = 0,
    completed = 0;
  const worker = async () => {
    while (next < spin.frameCount) {
      const angle = next++;
      if (!options.publicToken) assertAuthEpoch(epoch);
      const path = options.publicToken
        ? "/api/public/vehicle-spin/frames/" + angle
        : "/api/app/vehicle-spins/" + spin.id + "/frames/" + angle;
      const blob = await withRequestDeadline(group.signal, async (signal) => {
        const response = await fetch(path, {
          credentials: options.publicToken ? "omit" : "include",
          cache: "no-store",
          signal,
          headers: options.publicToken
            ? { "X-Vehicle-Spin": options.publicToken }
            : undefined,
        });
        if (!options.publicToken) assertAuthEpoch(epoch);
        if (!response.ok)
          throw await readApiError(response, {
            notifyAuth: !options.publicToken,
            requestAuthEpoch: epoch,
          });
        const blob = await response.blob();
        if (!options.publicToken) assertAuthEpoch(epoch);
        if (!blob.type.startsWith("image/jpeg") || blob.size > 500000)
          throw new Error("This vehicle angle is unavailable.");
        return blob;
      });
      result[angle] = blob;
      options.onProgress?.(++completed / spin.frameCount);
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
    return result;
  } finally {
    group.abort();
    options.signal.removeEventListener("abort", cancel);
  }
};
export const getPublicVehicleSpin = async (
  token: string,
  signal: AbortSignal,
): Promise<VehicleSpin> => {
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new Error("This vehicle view is unavailable.");
  return withRequestDeadline(signal, async (boundedSignal) => {
    const response = await fetch("/api/public/vehicle-spin", {
      headers: { "X-Vehicle-Spin": token },
      credentials: "omit",
      cache: "no-store",
      signal: boundedSignal,
    });
    if (!response.ok) throw await readApiError(response, { notifyAuth: false });
    return (await response.json()) as VehicleSpin;
  });
};
export const vehicleSpinLink = (token: string) => location.origin + "/#/spin/" + token;
