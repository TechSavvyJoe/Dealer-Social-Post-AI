/**
 * Same-tab signal for an authoritative 401 response. Cross-tab identity
 * changes are coordinated by the app store's BroadcastChannel; this event
 * covers API calls made by the current tab after a role/PIN/session revocation.
 */
export const AUTH_SESSION_REJECTED_EVENT = "dealer-social:session-rejected";

let activeAuthEpoch = 0;

export const setActiveAuthEpoch = (epoch: number): void => {
  activeAuthEpoch = epoch;
};

/** Capture immediately before an authenticated request begins. */
export const captureAuthEpoch = (): number => activeAuthEpoch;

export const assertAuthEpoch = (requestAuthEpoch: number): void => {
  if (requestAuthEpoch !== activeAuthEpoch) {
    throw new DOMException(
      "The signed-in workspace changed before this request could be sent.",
      "AbortError",
    );
  }
};

export const notifySessionRejected = (requestAuthEpoch: number): void => {
  if (typeof window === "undefined") return;
  // A delayed 401 from a prior session must never clear a newer login.
  if (requestAuthEpoch !== activeAuthEpoch) return;
  window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_REJECTED_EVENT, {
      detail: { authEpoch: requestAuthEpoch },
    }),
  );
};
