/**
 * Optional proxy request fields the signed-in backend accepts, as advertised
 * on the session payload (`capabilities`) and on /api/app/health. Mirrors
 * PROXY_CAPABILITIES in pb_hooks/helpers.js.
 *
 * The app sends an optional field only when the server that issued its
 * session said so. A backend that predates the field (a rollback, or the
 * older half of a mixed-version deploy) omits `capabilities` entirely, so
 * every flag reads false and the request stays byte-identical to what that
 * server already validates. Same-tab module state, like utils/authBoundary:
 * services must not import the app store.
 */
export interface ProxyCapabilities {
  /** buildVeoRequest forwards a bounded `parameters.negativePrompt`. */
  veoNegativePrompt?: boolean;
}

let advertised: ProxyCapabilities = {};

/**
 * Replace (never merge) on every session payload. Only known flags with the
 * literal value `true` are kept, so an unexpected payload shape cannot switch
 * on a field the server never claimed.
 */
export const setProxyCapabilities = (capabilities: unknown): void => {
  advertised = {};
  if (typeof capabilities !== "object" || capabilities === null) return;
  const source = capabilities as Record<string, unknown>;
  if (source.veoNegativePrompt === true) advertised.veoNegativePrompt = true;
};

export const proxyCapabilities = (): Readonly<ProxyCapabilities> => advertised;
