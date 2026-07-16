const MUTATION_CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_DATA";

export function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required; no default is used.`);
  }
  return value;
}

function normalizePocketBaseUrl(rawUrl, envName) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${envName} must be an absolute http(s) URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${envName} must use http or https.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      `${envName} must not contain credentials, query, or fragment data.`,
    );
  }
  if (parsed.pathname !== "/") {
    throw new Error(`${envName} must be a PocketBase origin without a path.`);
  }

  return parsed.origin;
}

/**
 * Loads one explicit PocketBase admin target. With the default PB prefix the
 * required names are PB_URL, PB_ADMIN_EMAIL, and PB_ADMIN_PASSWORD. A prefix
 * such as PB_PROD maps to PB_PROD_URL, PB_PROD_ADMIN_EMAIL, and
 * PB_PROD_ADMIN_PASSWORD.
 */
export function loadAdminConfig(prefix = "PB") {
  const urlName = `${prefix}_URL`;
  return {
    url: normalizePocketBaseUrl(requireEnv(urlName), urlName),
    email: requireEnv(`${prefix}_ADMIN_EMAIL`),
    password: requireEnv(`${prefix}_ADMIN_PASSWORD`),
  };
}

/**
 * Mutating maintenance scripts require both a fixed confirmation phrase and
 * the exact target origin. This prevents an old shell history entry from
 * silently operating on a different environment.
 */
export function requireMutationApproval(
  targetUrl,
  {
    targetEnv = "PB_MUTATION_TARGET",
    confirmationEnv = "PB_MUTATION_CONFIRMATION",
  } = {},
) {
  const expectedTarget = new URL(targetUrl).origin;
  const confirmedTarget = requireEnv(targetEnv);
  const confirmation = requireEnv(confirmationEnv);

  if (confirmedTarget !== expectedTarget) {
    throw new Error(`${targetEnv} must exactly equal ${expectedTarget}.`);
  }
  if (confirmation !== MUTATION_CONFIRMATION) {
    throw new Error(`${confirmationEnv} must equal ${MUTATION_CONFIRMATION}.`);
  }
}

export async function authenticateAdmin(pb, config) {
  const response = await fetch(`${config.url}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: config.email,
      password: config.password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `PocketBase admin authentication failed (${response.status}).`,
    );
  }

  const auth = await response.json();
  if (!auth || !auth.token) {
    throw new Error("PocketBase admin authentication returned no token.");
  }
  pb.authStore.save(auth.token, auth.admin);
}
