/**
 * This hook file creates an allowlisted proxy for the Google Gemini API.
 * It allows the frontend to send requests to paths like:
 * - `/api/proxy/v1beta/models/gemini-3.5-flash:generateContent` (Gemini API)
 * and forwards only configured model/method pairs with the server-side key.
 * Legacy Vertex code below is unreachable because requestPolicies intentionally
 * denies every `vertex/*` path; do not re-enable it without an S2S-only route.
 */
// ---------------------------------------------------------------------------
// Vertex AI access-token cache (module scope so it actually persists across
// requests). Previous version referenced undeclared cachedAccessToken /
// tokenExpiry inside the closure — JSVM hoisted them as globals on first
// write but reading them before write threw ReferenceError, which is why
// the in-handler comment said "Caching is disabled for now". Fixed by
// declaring at module scope.
// ---------------------------------------------------------------------------
var cachedAccessToken = null;
var tokenExpiry = 0;

// Rate limiting - using simple object instead of Map for PocketBase JSVM compatibility
var _rateLimitData = {};

const proxyHandler = (c) => {
  // Rate limit configuration - defined inside handler for scope safety
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
  const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per dealer per minute

  const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const VERTEX_AI_URL_BASE = "https://{LOCATION}-aiplatform.googleapis.com/";

  const geminiApiKey = $os.getenv("GEMINI_API_KEY");
  // Vertex API Key no longer used, we use Service Account

  // Session-cookie auth is the primary gate. The shared PROXY_ACCESS_TOKEN
  // remains as a fallback for server-to-server callers (cron jobs, monitoring)
  // ONLY — the frontend no longer sends it. If the token env var is unset, we
  // simply skip the fallback check.
  const proxyAccessToken = ($os.getenv("PROXY_ACCESS_TOKEN") || "").trim();

  let path = null;

  // Multiple methods to extract path for PocketBase JSVM compatibility
  try {
    // Method 1: PocketBase 0.22 router context API. Wildcard parameters are
    // exposed through pathParam(), not a public pathParams object.
    path = c.pathParam("path");
  } catch (e) {
    // pathParam may not be available in other compatible runtimes
  }

  if (!path) {
    try {
      // Method 2: Direct pathParams fallback for older/custom runtimes
      if (c.pathParams && c.pathParams.path) {
        path = c.pathParams.path;
      }
    } catch (e) {
      // pathParams may not be available
    }
  }

  // Method 3: Get from URL path directly
  if (!path) {
    try {
      const request = c.request();
      const fullPath = request.url.path || request.url.pathname;
      if (fullPath && fullPath.startsWith("/api/proxy/")) {
        path = fullPath.substring("/api/proxy/".length);
      }
    } catch (e) {
      // URL parsing may fail
    }
  }

  // Method 4: Get from raw URL string
  if (!path) {
    try {
      const urlStr = c.request().url.string();
      const match = urlStr.match(/\/api\/proxy\/(.+)/);
      if (match) {
        path = match[1];
      }
    } catch (e) {
      // URL string() may not be available
    }
  }

  try {
    const helpers = require(__hooks + "/helpers.js");
    const policies = require(__hooks + "/requestPolicies.js");
    const requestInfo = $apis.requestInfo(c);
    const headers = requestInfo.headers || {};

    // PRIMARY auth: session cookie. The frontend always carries it.
    const dealer = helpers.dealerFromSession(c);
    let rateLimitKey = null;

    if (dealer) {
      rateLimitKey = "dealer:" + dealer.id;
    } else {
      // FALLBACK auth: shared PROXY_ACCESS_TOKEN. Server-to-server only —
      // the frontend does not send this. Kept so monitors / cron jobs can
      // probe the proxy without holding a dealer session.
      const incomingToken = (
        headers["x_proxy_token"] ||
        headers["x-proxy-token"] ||
        c.request().header.get("X-Proxy-Token") ||
        c.request().header.get("x-proxy-token") ||
        ""
      )
        .toString()
        .trim();

      if (
        !proxyAccessToken ||
        !incomingToken ||
        incomingToken !== proxyAccessToken
      ) {
        helpers.logAuthEvent("proxy_unauthorized", {
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail: "no session, no valid token",
        });
        return c.json(401, { error: "Unauthorized proxy request" });
      }
      // There is a single configured S2S token, so a constant bucket avoids
      // retaining or logging any part of that credential.
      rateLimitKey = "s2s-token";
    }

    // Per-dealer (or per-token-prefix) sliding window. 60 req/min absorbs a
    // legitimate burst of poll requests for long-running video generation
    // while still capping a runaway script.
    const limit = helpers.checkProxyRateLimit(
      rateLimitKey,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS,
    );
    if (!limit.ok) {
      helpers.logAuthEvent("proxy_rate_limited", {
        dealerId: dealer ? dealer.id : "",
        ip: helpers.clientIP(c),
        userAgent: helpers.userAgent(c),
        detail: "key=" + rateLimitKey + " count=" + limit.count,
      });
      const retryAfter = Math.max(
        1,
        Math.ceil((limit.retryAfterMs || 60000) / 1000),
      );
      c.response().header("Retry-After", String(retryAfter));
      return c.json(429, {
        error: "Rate limit exceeded",
        retry_after_seconds: retryAfter,
      });
    }

    if (!path) {
      console.log("[Proxy] Path extraction failed. Request details:", {
        pathParams: c.pathParams,
      });
      return c.json(400, { error: "Missing API path" });
    }

    if (!policies.isAllowedProxyRequest(path, requestInfo.method)) {
      return c.json(403, {
        error: "Proxy method or path not allowed",
      });
    }

    const authorizedProxyPath = path;
    const operationStartProvider = policies.providerOperationStartProvider(
      authorizedProxyPath,
      requestInfo.method,
    );
    const requestedProviderResource = policies.providerResourceRequest(
      authorizedProxyPath,
      requestInfo.method,
    );

    // Shared S2S credentials have no tenant identity and therefore cannot
    // create, poll, or download dealer-owned provider resources. Stateful
    // provider routes require a browser session resolved to one dealer.
    if ((operationStartProvider || requestedProviderResource) && !dealer) {
      return c.json(403, {
        error: "Dealer session required for provider resource access",
      });
    }
    if (
      requestedProviderResource &&
      !helpers.dealerOwnsProviderResource(dealer.id, requestedProviderResource)
    ) {
      // Use the same response for missing, expired, and other-dealer IDs so
      // the ownership ledger cannot be used as a resource-existence oracle.
      return c.json(403, { error: "Provider resource access denied" });
    }

    // Generation bodies are an authorization boundary too: a permitted model
    // must not become an arbitrary pass-through for tools, oversized prompts,
    // unsupported resolutions, or other cost-amplifying provider options.
    // Polling and file-download GETs intentionally keep an empty body.
    let sanitizedProxyBody = "";
    if ((requestInfo.method || "").toString().toUpperCase() === "POST") {
      const upstreamRequest = policies.buildGeminiProxyRequest(
        path,
        requestInfo.data,
      );
      if (!upstreamRequest) {
        return c.json(400, {
          error: "Invalid or unsupported generation request",
        });
      }
      sanitizedProxyBody = JSON.stringify(upstreamRequest);
    }

    const costPolicy = policies.proxyCostPolicy(path);
    if (costPolicy) {
      const costLimit = helpers.checkProxyRateLimit(
        rateLimitKey + ":" + costPolicy.bucket,
        costPolicy.maxRequests,
        costPolicy.windowMs,
      );
      if (!costLimit.ok) {
        helpers.logAuthEvent("proxy_rate_limited", {
          dealerId: dealer ? dealer.id : "",
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail:
            "generation_bucket=" +
            costPolicy.bucket +
            " count=" +
            costLimit.count,
        });
        const retryAfter = Math.max(
          1,
          Math.ceil((costLimit.retryAfterMs || costPolicy.windowMs) / 1000),
        );
        c.response().header("Retry-After", String(retryAfter));
        return c.json(429, {
          error: "Generation rate limit exceeded",
          retry_after_seconds: retryAfter,
        });
      }
    }

    // Detect if this is a Vertex AI request or Gemini API request
    const isVertexAI = path.startsWith("vertex/");
    let baseUrl;
    let authHeader = {};

    if (isVertexAI) {
      // Vertex AI endpoint -> Use Service Account Auth.
      // Token is cached at module scope (declared at top of file). Vertex
      // tokens last 60 minutes; we refresh when <60s remaining.
      try {
        const getVertexAccessToken = () => {
          const now = Math.floor(Date.now() / 1000);

          // Reuse cached token when still valid
          if (cachedAccessToken && tokenExpiry - 60 > now) {
            return cachedAccessToken;
          }

          let serviceAccount;
          const envKey = $os.getenv("VERTEX_SERVICE_ACCOUNT_JSON");

          if (envKey) {
            try {
              serviceAccount = JSON.parse(envKey);
            } catch (e) {
              throw new Error(
                "Failed to parse VERTEX_SERVICE_ACCOUNT_JSON: " + e.toString(),
              );
            }
          } else {
            // Try to construct from individual env vars (Fly.io secrets)
            const privateKey = $os.getenv("private_key");
            const clientEmail = $os.getenv("client_email");
            const privateKeyId = $os.getenv("private_key_id");
            const projectId = $os.getenv("project_id");

            if (privateKey && clientEmail && privateKeyId) {
              serviceAccount = {
                type: $os.getenv("type") || "service_account",
                project_id: projectId,
                private_key_id: privateKeyId,
                private_key: privateKey,
                client_email: clientEmail,
                client_id: $os.getenv("client_id") || "",
                auth_uri:
                  $os.getenv("auth_uri") ||
                  "https://accounts.google.com/o/oauth2/auth",
                token_uri:
                  $os.getenv("token_uri") ||
                  "https://oauth2.googleapis.com/token",
                auth_provider_x509_cert_url:
                  $os.getenv("auth_provider_x509_cert_url") ||
                  "https://www.googleapis.com/oauth2/v1/certs",
                client_x509_cert_url: $os.getenv("client_x509_cert_url") || "",
                universe_domain:
                  $os.getenv("universe_domain") || "googleapis.com",
              };
              console.log(
                "[Vertex] Constructed service account from individual env vars",
              );
            } else {
              // Fall back to file
              const keyPath = `${__hooks}/vertex_key.json`;
              // Read key file
              if (!$os.getFile(keyPath).exists()) {
                throw new Error(
                  "Vertex credentials not found. Set VERTEX_SERVICE_ACCOUNT_JSON env var, individual service account fields, or create vertex_key.json",
                );
              }
              const rawKey = $os.readFile(keyPath);
              const keyStr = String.fromCharCode.apply(null, rawKey);
              serviceAccount = JSON.parse(keyStr);
            }
          }

          // Create JWT
          const header = {
            alg: "RS256",
            typ: "JWT",
            kid: serviceAccount.private_key_id,
          };

          const claims = {
            iss: serviceAccount.client_email,
            sub: serviceAccount.client_email,
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
            scope: "https://www.googleapis.com/auth/cloud-platform",
          };

          // Pure JS Base64 URL Encode
          const base64UrlEncode = (str) => {
            const chars =
              "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            let output = "";
            let i = 0;

            // Convert string to byte array (assuming UTF-8/ASCII)
            // For simple JSON, charCodeAt is fine.
            // If we had multi-byte chars, we'd need TextEncoder, but Goja might not have it.
            // Since header/claims are ASCII JSON, this is safe.

            while (i < str.length) {
              let chr1 = str.charCodeAt(i++);
              let chr2 = str.charCodeAt(i++);
              let chr3 = str.charCodeAt(i++);

              let enc1 = chr1 >> 2;
              let enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
              let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
              let enc4 = chr3 & 63;

              if (isNaN(chr2)) {
                enc3 = enc4 = 64;
              } else if (isNaN(chr3)) {
                enc4 = 64;
              }

              output =
                output +
                chars.charAt(enc1) +
                chars.charAt(enc2) +
                chars.charAt(enc3) +
                chars.charAt(enc4);
            }

            return output
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");
          };

          // Sign JWT. Temp filenames carry a per-request random suffix so
          // two concurrent Vertex requests in the same second can't clobber
          // each other's key files. (Date.now()/1000 was seconds-precision.)
          const reqId = helpers.secureRandomString(24, "0123456789abcdef");
          const tempDir = `${__hooks}/../temp`;
          const tempKey = `${tempDir}/temp_key_${reqId}.pem`;
          const tempToken = `${tempDir}/temp_token_${reqId}.txt`;
          const tempSig = `${tempDir}/temp_sig_${reqId}.bin`;

          // Helper to safely remove files (ignore errors if file doesn't exist)
          const safeRemove = (path) => {
            try {
              $os.remove(path);
            } catch (e) {
              /* ignore */
            }
          };

          try {
            // Ensure temp directory exists using full path with restrictive perms
            try {
              $os.cmd("/bin/mkdir", "-p", tempDir).output();
              $os.cmd("/bin/chmod", "700", tempDir).output();
            } catch (e) {
              // Directory may already exist, ignore
            }

            const encodedHeader = base64UrlEncode(JSON.stringify(header));
            const encodedClaims = base64UrlEncode(JSON.stringify(claims));
            const unsignedToken = `${encodedHeader}.${encodedClaims}`;

            let keyContent = serviceAccount.private_key;
            if (!keyContent.endsWith("\n")) keyContent += "\n";
            $os.writeFile(tempKey, keyContent);
            $os.writeFile(tempToken, unsignedToken);

            // Ensure permissions are readable
            try {
              $os.cmd("/bin/chmod", "600", tempKey).output();
              $os.cmd("/bin/chmod", "600", tempToken).output();
            } catch (e) {
              // Ignore chmod errors
            }

            // Use /usr/bin/openssl on Linux/Docker, fallback to other paths
            let opensslBin = "/usr/bin/openssl";
            try {
              // Test if openssl exists at the expected path
              $os.cmd("/bin/sh", "-c", `test -x ${opensslBin}`).output();
            } catch (e) {
              // Try alternate paths
              opensslBin = "openssl"; // fallback to PATH
            }

            // Step 1: Sign using sh with full path
            const signCmd = $os.cmd(
              "/bin/sh",
              "-c",
              `${opensslBin} dgst -sha256 -sign "${tempKey}" -out "${tempSig}" "${tempToken}" 2>&1`,
            );
            const signOut = signCmd.output();

            // Check if output contains error messages
            if (signOut && signOut.length > 0) {
              const outStr = String.fromCharCode.apply(null, signOut);
              if (
                outStr.includes("error") ||
                outStr.includes("Error") ||
                outStr.includes("Usage") ||
                outStr.includes("Permission denied")
              ) {
                throw new Error(`OpenSSL Error: ${outStr}`);
              }
            }

            // Step 2: Base64 encode signature
            const b64Cmd = $os.cmd(
              "/bin/sh",
              "-c",
              `${opensslBin} base64 -in "${tempSig}"`,
            );
            const b64 = b64Cmd.output();

            let base64Sig = String.fromCharCode.apply(null, b64);
            base64Sig = base64Sig.replace(/\s/g, "");
            const encodedSig = base64Sig
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");

            const jwt = `${unsignedToken}.${encodedSig}`;
            // console.log("[Auth] Generated JWT:", jwt); // REMOVED FOR SECURITY

            // Exchange for Access Token
            const tokenResp = $http.send({
              url: "https://oauth2.googleapis.com/token",
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
            });

            if (tokenResp.statusCode !== 200) {
              console.log(
                "[Auth] Token Exchange Failed. Status:",
                tokenResp.statusCode,
              );
              // Do not log raw body if it contains sensitive info, but usually error body is safe.
              // However, to be safe, we'll just log the status and throw.
              throw new Error(
                `Token exchange failed with status ${tokenResp.statusCode}`,
              );
            }

            const tokenData = tokenResp.json;
            console.log("[Auth] Successfully acquired Vertex AI Access Token");
            cachedAccessToken = tokenData.access_token;
            tokenExpiry = now + (tokenData.expires_in || 3600);
            return cachedAccessToken;
          } catch (err) {
            console.log("[Auth] Signing failed:", err);
            // Try to read stderr from the command if possible?
            // Unfortunately err object might not have it directly if it's a Go error.
            // But we can try to log more context.
            throw err;
          } finally {
            // Safely clean up temp files (ignore errors if files don't exist)
            safeRemove(tempKey);
            safeRemove(tempToken);
            safeRemove(tempSig);
          }
        };

        const accessToken = getVertexAccessToken();
        authHeader = { Authorization: `Bearer ${accessToken}` };
      } catch (e) {
        console.error("Failed to get Vertex Access Token:", e);
        return c.json(500, {
          error: "Vertex AI authentication is temporarily unavailable",
        });
      }

      // Extract location from path (e.g., vertex/v1beta1/projects/PROJECT/locations/us-central1/...)
      const pathParts = path.split("/");
      let location = "us-central1"; // default
      const locationIndex = pathParts.indexOf("locations");
      if (locationIndex !== -1 && pathParts.length > locationIndex + 1) {
        location = pathParts[locationIndex + 1];
      }

      // SSRF guard: `location` is interpolated directly into the upstream host
      // (`{LOCATION}-aiplatform.googleapis.com`) AND this request carries a live
      // GCP OAuth bearer token. A crafted value (e.g. "evil.example#" or one
      // containing "@") could redirect the authenticated request off-Google and
      // exfiltrate the token. Pin to the GCP region grammar before use.
      if (!/^[a-z]+-[a-z]+[0-9]+$/.test(location)) {
        return c.json(400, { error: "Invalid Vertex AI location" });
      }

      baseUrl = VERTEX_AI_URL_BASE.replace("{LOCATION}", location);
      // Remove "vertex/" prefix from path
      path = path.substring(7); // Remove "vertex/"
    } else {
      // Gemini API endpoint -> Use API Key
      if (!geminiApiKey) {
        console.error("GEMINI_API_KEY environment variable is not set.");
        return c.json(500, {
          error: "Gemini API key is not configured on the server.",
        });
      }
      baseUrl = GEMINI_API_URL_BASE;
      // Keep provider credentials out of URLs, access logs, and intermediary
      // query-string telemetry. Google's Gemini API supports this header on
      // every route used here.
      authHeader = { "x-goog-api-key": geminiApiKey };
    }

    // Build target URL, preserve incoming query params
    const finalBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const cleanPath = path.startsWith("/") ? path.substring(1) : path;
    let targetUrl = finalBaseUrl + cleanPath;

    const queryParts = [];
    const query = requestInfo.query || {};
    Object.entries(query).forEach(([key, value]) => {
      // Skip 'key' param if passed from client (shouldn't be, but just in case)
      if (key === "key") return;

      if (Array.isArray(value)) {
        value.forEach((v) =>
          queryParts.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`,
          ),
        );
      } else if (value !== undefined && value !== null) {
        queryParts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        );
      }
    });

    if (queryParts.length > 0) {
      const separator = targetUrl.includes("?") ? "&" : "?";
      targetUrl += separator + queryParts.join("&");
    }

    const apiType = isVertexAI ? "Vertex AI" : "Gemini API";
    const safeLogUrl = targetUrl
      .replace(/key=[^&]+/, "key=HIDDEN")
      .replace(/(\/operations\/)[^?]+/, "$1[redacted]")
      .replace(/(\/files\/)[^?]+/, "$1[redacted]");
    console.log(`[Proxy ${apiType}] ${requestInfo.method} ${safeLogUrl}`);

    const res = $http.send({
      url: targetUrl,
      method: requestInfo.method,
      body: sanitizedProxyBody,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      timeout: 300000, // 5 minutes
    });

    console.log(`[Proxy] Upstream status: ${res.statusCode}`);

    // Forward ONLY Content-Type. Blindly re-emitting every upstream header
    // (Content-Length / Content-Encoding / Transfer-Encoding / Connection)
    // corrupts the body we re-encode below, and forwarding upstream
    // Set-Cookie / Cache-Control can poison the SW/browser cache or leak
    // upstream cookies onto this authenticated origin.
    let upstreamContentType = "";
    if (res.headers) {
      Object.entries(res.headers).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          String(key).toLowerCase() === "content-type"
        ) {
          upstreamContentType = String(value).split(";", 1)[0].trim();
          c.response().header("Content-Type", String(value));
        }
      });
    }

    const isVideoDownload =
      cleanPath.startsWith("v1beta/files/") &&
      (upstreamContentType.indexOf("video/") === 0 ||
        upstreamContentType === "application/octet-stream");
    if (isVideoDownload) {
      const binaryBody = res.raw || res.body;
      const maxVideoBytes = 100 * 1024 * 1024;
      if (!binaryBody || binaryBody.length === 0) {
        return c.json(502, { error: "Video download returned no data" });
      }
      if (binaryBody.length > maxVideoBytes) {
        return c.json(413, { error: "Generated video exceeds 100 MB" });
      }
      c.response().header("Cache-Control", "private, no-store");
      c.response().header("X-Content-Type-Options", "nosniff");
      return c.blob(res.statusCode, upstreamContentType, binaryBody);
    }

    const body =
      res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");

    let jsonBody = null;
    try {
      jsonBody =
        res.json && typeof res.json === "object" ? res.json : JSON.parse(body);
    } catch (_e) {
      return c.string(res.statusCode, body);
    }

    if (
      dealer &&
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      (operationStartProvider ||
        (requestedProviderResource &&
          requestedProviderResource.resource_type === "operation"))
    ) {
      const discoveredResources = policies.providerResourcesFromResponse(
        authorizedProxyPath,
        jsonBody,
      );
      const securedOperation = discoveredResources.some(
        (resource) => resource.resource_type === "operation",
      );

      // If an async start returned a name, never hand the identifier to the
      // browser unless its durable ownership claim was understood and saved.
      if (
        operationStartProvider &&
        typeof jsonBody.name === "string" &&
        !securedOperation
      ) {
        return c.json(502, { error: "Invalid provider operation response" });
      }

      try {
        if (discoveredResources.length) {
          helpers.claimProviderResources(dealer.id, discoveredResources);
        }
      } catch (_e) {
        console.error("[Proxy] Provider resource ownership save failed");
        return c.json(502, { error: "Could not secure provider resource" });
      }
    }

    return c.json(res.statusCode, jsonBody);
  } catch (err) {
    const apiType =
      path && path.startsWith("vertex/") ? "Vertex AI" : "Gemini API";
    console.error(`[Proxy ${apiType}] Error:`, err);
    return c.json(500, {
      error: `${apiType} request failed`,
    });
  }
};

// IMPORTANT: register the more specific cross-vendor proxy routes BEFORE
// the wildcard so the dedicated handlers win. PocketBase's router is
// first-match-wins, so registration order matters.

// ----------------------------------------------------------------------------
// OpenAI image-generation fallback proxy. Used by services/openaiAdapter.ts
// when ALL Gemini image models in the fallback chain exhaust. Requires
// OPENAI_API_KEY in env. Same PROXY_ACCESS_TOKEN gating as the other proxies.
// ----------------------------------------------------------------------------
routerAdd("POST", "/api/proxy/openai/v1/images/generations", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const openaiKey = ($os.getenv("OPENAI_API_KEY") || "").trim();
  const enabled =
    ($os.getenv("ENABLE_OPENAI_FALLBACK") || "").trim().toLowerCase() ===
    "true";
  // Session cookie required (same model as primary Gemini proxy).
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    helpers.logAuthEvent("proxy_unauthorized", {
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "openai proxy",
    });
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  if (!enabled || !openaiKey) {
    return c.json(503, { error: "OpenAI image fallback is not enabled" });
  }
  const limit = helpers.checkProxyRateLimit(
    "openai:" + dealer.id,
    5,
    60 * 1000,
  );
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  const upstreamRequest = policies.buildOpenAIImageRequest(requestInfo.data);
  if (!upstreamRequest) {
    return c.json(400, { error: "Invalid OpenAI image request" });
  }
  try {
    const res = $http.send({
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(upstreamRequest),
      timeout: 120000,
    });
    const body =
      res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");
    try {
      return c.json(res.statusCode, JSON.parse(body));
    } catch (_e) {
      return c.string(res.statusCode, body);
    }
  } catch (err) {
    console.error("[Proxy OpenAI] error", err);
    return c.json(500, {
      error: "Failed to proxy request to OpenAI",
    });
  }
});

routerAdd("POST", "/api/proxy/anthropic/v1/messages", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const anthropicKey = ($os.getenv("ANTHROPIC_API_KEY") || "").trim();
  const enabled =
    ($os.getenv("ENABLE_CLAUDE_FALLBACK") || "").trim().toLowerCase() ===
    "true";
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    helpers.logAuthEvent("proxy_unauthorized", {
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "anthropic proxy",
    });
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  if (!enabled || !anthropicKey) {
    return c.json(503, { error: "Anthropic fallback is not enabled" });
  }
  const limit = helpers.checkProxyRateLimit(
    "anthropic:" + dealer.id,
    15,
    60 * 1000,
  );
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  const upstreamRequest = policies.buildAnthropicMessageRequest(
    requestInfo.data,
  );
  if (!upstreamRequest) {
    return c.json(400, { error: "Invalid Anthropic message request" });
  }
  try {
    const res = $http.send({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstreamRequest),
      timeout: 120000,
    });
    const body =
      res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");
    try {
      return c.json(res.statusCode, JSON.parse(body));
    } catch (_e) {
      return c.string(res.statusCode, body);
    }
  } catch (err) {
    console.error("[Proxy Anthropic] error", err);
    return c.json(500, {
      error: "Failed to proxy request to Anthropic",
    });
  }
});

// Register the catch-all Gemini/Vertex proxy AFTER the more specific routes.
routerAdd("GET", "/api/proxy/:path(*)", proxyHandler);
routerAdd("POST", "/api/proxy/:path(*)", proxyHandler);

routerAdd("GET", "/api/proxy-image", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const url = c.queryParam("url");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  const limit = helpers.checkProxyRateLimit("img:" + dealer.id, 120, 60 * 1000);
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }

  if (!url) {
    return c.json(400, { error: "Missing url parameter" });
  }

  const configuredHosts = $os.getenv("IMAGE_PROXY_ALLOWED_HOSTS") || "";
  if (!policies.isAllowedImageProxyUrl(url, configuredHosts)) {
    return c.json(400, { error: "Image URL host is not allowed" });
  }

  try {
    const res = $http.send({
      url: url,
      method: "GET",
      timeout: 30, // 30 seconds timeout for image fetch
    });

    if (res.statusCode >= 400) {
      return c.json(res.statusCode, { error: "Failed to fetch image" });
    }

    const headerValue = (name) => {
      const wanted = name.toLowerCase();
      const headers = res.headers || {};
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== wanted) continue;
        const value = headers[key];
        return Array.isArray(value) ? value[0] || "" : value || "";
      }
      return "";
    };

    const contentType = headerValue("content-type")
      .toString()
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ];
    if (allowedTypes.indexOf(contentType) === -1) {
      return c.json(415, {
        error: "Upstream response is not a supported image",
      });
    }

    const maxBytes = 10 * 1024 * 1024;
    const declaredLength = parseInt(headerValue("content-length"), 10);
    const actualLength = res.raw ? res.raw.length : 0;
    if (
      (Number.isFinite(declaredLength) && declaredLength > maxBytes) ||
      actualLength > maxBytes
    ) {
      return c.json(413, { error: "Upstream image exceeds 10 MB" });
    }

    c.response().header("Cache-Control", "private, no-store");
    c.response().header("X-Content-Type-Options", "nosniff");

    return c.blob(res.statusCode, contentType, res.raw);
  } catch (err) {
    console.error("[proxy-image] fetch failed", err);
    return c.json(500, { error: "Image proxy request failed" });
  }
});

// (Anthropic Claude fallback proxy moved above the wildcard /api/proxy/:path
// registration so route precedence works correctly.)

// ----------------------------------------------------------------------------
// Health + diagnostics endpoint. Public (no session required) so uptime
// monitors can hit it. Public callers get only aggregate readiness; detailed
// configuration presence and tenant counts require a super-admin session.
// ----------------------------------------------------------------------------
routerAdd("GET", "/api/app/health", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const isAuthedAdmin = helpers.sessionRoleFromCookie(c) === "super_admin";

  const checks = {
    pocketbase: false,
    gemini_key_set: false,
    // Optional S2S token — not required for browser session auth.
    proxy_token_set: false,
    anthropic_key_set: false,
    openai_key_set: false,
    admin_dealer_code_set: false,
  };
  const result = {
    ok: true,
    ts: new Date().toISOString(),
    version: "1.0",
  };

  // Aggregate tenant counts only for authenticated super-admins.
  if (isAuthedAdmin) {
    result.checks = checks;
    result.counts = {
      dealers: 0,
      posts_24h: 0,
      photo_releases_24h: 0,
    };
  }

  try {
    // Smoke a trivial PB query
    const dealers = $app.dao().findCollectionByNameOrId("dealers");
    checks.pocketbase = !!dealers;
    if (dealers && isAuthedAdmin) {
      try {
        const all = $app
          .dao()
          .findRecordsByFilter("dealers", "1=1", "name", 1000, 0);
        result.counts.dealers = all.length;
      } catch (_e) {
        /* ignore */
      }
    }
  } catch (e) {
    result.ok = false;
    checks.pocketbase = false;
  }

  if (isAuthedAdmin) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const posts = $app
        .dao()
        .findRecordsByFilter(
          "posts",
          "generated_at >= {:s}",
          "-generated_at",
          1000,
          0,
          { s: since },
        );
      result.counts.posts_24h = posts.length;
    } catch (_e) {
      /* posts collection may not exist yet */
    }
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const releases = $app
        .dao()
        .findRecordsByFilter(
          "photo_releases",
          "signed_at >= {:s}",
          "-signed_at",
          1000,
          0,
          { s: since },
        );
      result.counts.photo_releases_24h = releases.length;
    } catch (_e) {
      /* photo_releases may not exist yet */
    }
  }

  // Env presence (booleans only — never echo the values)
  checks.gemini_key_set = !!($os.getenv("GEMINI_API_KEY") || "").trim();
  checks.proxy_token_set = !!($os.getenv("PROXY_ACCESS_TOKEN") || "").trim();
  checks.anthropic_key_set = !!($os.getenv("ANTHROPIC_API_KEY") || "").trim();
  checks.openai_key_set = !!($os.getenv("OPENAI_API_KEY") || "").trim();
  checks.claude_fallback_enabled =
    checks.anthropic_key_set &&
    ($os.getenv("ENABLE_CLAUDE_FALLBACK") || "").trim().toLowerCase() ===
      "true";
  checks.openai_fallback_enabled =
    checks.openai_key_set &&
    ($os.getenv("ENABLE_OPENAI_FALLBACK") || "").trim().toLowerCase() ===
      "true";
  checks.admin_dealer_code_set = policies.isValidAdminDealerCode(
    $os.getenv("ADMIN_DEALER_CODE") || "",
  );

  // Top-level ok = critical checks must pass (uptime monitors hit this).
  if (
    !checks.pocketbase ||
    !checks.gemini_key_set ||
    !checks.admin_dealer_code_set
  ) {
    result.ok = false;
  }

  return c.json(result.ok ? 200 : 503, result);
});

function redactTelemetryVinStrings(value) {
  return String(value).replace(
    /(^|[^A-HJ-NPR-Z0-9])([A-HJ-NPR-Z0-9]{17})(?=$|[^A-HJ-NPR-Z0-9])/gi,
    function (match, prefix, candidate) {
      if (!/\d/.test(candidate)) return match;
      return prefix + "[REDACTED_VIN]";
    },
  );
}

function isSensitiveTelemetryKey(key) {
  const normalized = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (
    normalized === "vin" ||
    normalized.endsWith("vehiclevin") ||
    normalized.endsWith("attachedvin")
  ) {
    return true;
  }

  if (
    normalized === "code" ||
    normalized.endsWith("dealercode") ||
    normalized.endsWith("admincode") ||
    normalized.endsWith("accesscode") ||
    normalized.endsWith("invitecode")
  ) {
    return true;
  }

  return (
    normalized.indexOf("authorization") !== -1 ||
    normalized.indexOf("cookie") !== -1 ||
    normalized.indexOf("token") !== -1 ||
    normalized.indexOf("signature") !== -1 ||
    normalized.indexOf("password") !== -1 ||
    normalized.indexOf("secret") !== -1 ||
    normalized.indexOf("credential") !== -1 ||
    normalized.endsWith("apikey")
  );
}

function redactTelemetryValue(value, key, depth) {
  if (key && isSensitiveTelemetryKey(key)) return "[REDACTED]";
  if (typeof value === "string") return redactTelemetryVinStrings(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (depth >= 10) return "[TRUNCATED]";

  if (Array.isArray(value)) {
    return value.map(function (entry) {
      return redactTelemetryValue(entry, "", depth + 1);
    });
  }

  if (value && typeof value === "object") {
    const redacted = {};
    Object.keys(value).forEach(function (property) {
      const safeProperty = redactTelemetryVinStrings(property);
      redacted[safeProperty] = redactTelemetryValue(
        value[property],
        property,
        depth + 1,
      );
    });
    return redacted;
  }

  return "[UNSUPPORTED]";
}

routerAdd("POST", "/api/telemetry", (c) => {
  try {
    const helpers = require(__hooks + "/helpers.js");
    // This endpoint is intentionally unauthenticated (it captures pre-login
    // client errors), so rate-limit per IP to stop log-injection / disk-fill
    // abuse: 30 events per IP per minute.
    const rl = helpers.checkProxyRateLimit(
      "telemetry:" + helpers.clientIP(c),
      30,
      60 * 1000,
    );
    if (!rl.ok) return c.json(429, { success: false });

    const rawBody = $apis.requestInfo(c).data || {};
    // Redact before truncating so secrets cannot survive beyond the slice
    // boundary, then apply a serialized-string VIN pass as defense in depth.
    const redactedBody = redactTelemetryValue(rawBody, "", 0);
    const serialized = redactTelemetryVinStrings(
      JSON.stringify(redactedBody),
    ).slice(0, 2000);
    console.log("[Telemetry]", serialized);
    return c.json(200, { success: true });
  } catch (_err) {
    console.error("Telemetry redaction error");
    // Return 200 even on error to prevent client noise; do not echo details.
    return c.json(200, { success: false });
  }
});

// ============================================================================
// Session Endpoints — DB-backed opaque tokens (2026-05-28 rewrite)
//
// POST /api/app/session   { dealerCode }  → sets HttpOnly cookie, returns dealer
// GET  /api/app/session                   → resolves cookie → returns dealer
// DELETE /api/app/session                 → revokes session + clears cookie
//
// Login rate limit: 10 failed attempts per IP per 15 minutes triggers a soft
// lockout. After 30 minutes the counter resets. Successes don't count.
// ============================================================================

routerAdd("POST", "/api/app/session", (c) => {
  try {
    const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60; // 15 min
    const LOGIN_FAIL_THRESHOLD = 10;

    const helpers = require(__hooks + "/helpers.js");
    const policies = require(__hooks + "/requestPolicies.js");
    const ip = helpers.clientIP(c);
    const ua = helpers.userAgent(c);

    const recentFails = helpers.countRecentEvents(
      "login_fail",
      ip,
      LOGIN_FAIL_WINDOW_SECONDS,
    );
    if (recentFails >= LOGIN_FAIL_THRESHOLD) {
      helpers.logAuthEvent("login_locked", {
        ip: ip,
        userAgent: ua,
        detail: `${recentFails} fails in window`,
      });
      c.response().header("Retry-After", String(LOGIN_FAIL_WINDOW_SECONDS));
      return c.json(429, {
        error: "Too many login attempts. Try again in a few minutes.",
        retry_after_seconds: LOGIN_FAIL_WINDOW_SECONDS,
      });
    }

    const body = $apis.requestInfo(c).data || {};
    const dealerCode = (body.dealerCode || "").toString().trim();

    if (!dealerCode || dealerCode.length < 4 || dealerCode.length > 12) {
      helpers.logAuthEvent("login_fail", {
        credentialPresent: dealerCode.length > 0,
        ip: ip,
        userAgent: ua,
        detail: "malformed code",
      });
      return c.json(400, { error: "Access code is required" });
    }

    let role = "salesperson";
    let record;
    let personRecord = null;
    // SECURITY: never fall back to a hardcoded admin code. If ADMIN_DEALER_CODE
    // is unset, super-admin login is simply unavailable.
    const configuredAdminCode = ($os.getenv("ADMIN_DEALER_CODE") || "").trim();
    const adminEnv = policies.isValidAdminDealerCode(configuredAdminCode)
      ? configuredAdminCode
      : "";

    if (adminEnv && dealerCode.toLowerCase() === adminEnv.toLowerCase()) {
      role = "super_admin";
      try {
        record = $app.dao().findFirstRecordByData("dealers", "code", adminEnv);
      } catch (_e) {}

      if (!record) {
        // Auto-provision only when ADMIN_DEALER_CODE is explicitly configured.
        // Uses raw SQL so a still-migrating schema can't block bootstrap.
        try {
          const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
          const id = helpers.secureRandomString(15, chars);
          const now =
            new Date().toISOString().replace("T", " ").substring(0, 19) + "Z";

          $app
            .dao()
            .db()
            .newQuery(
              "INSERT INTO dealers (id, code, name, created, updated) VALUES ({:id}, {:code}, 'SYSTEM ADMIN', {:now}, {:now})",
            )
            .bind({ id: id, code: adminEnv, now: now })
            .execute();

          record = $app.dao().findRecordById("dealers", id);
        } catch (insertErr) {
          console.log(
            "[session] admin insert failed (likely duplicate), re-querying:",
            insertErr,
          );
          try {
            record = $app
              .dao()
              .findFirstRecordByData("dealers", "code", adminEnv);
          } catch (_e2) {
            console.error("[session] admin re-query also failed:", _e2);
          }
        }
      }
    } else {
      // Personal 4-digit codes on the people roster (managers + salespeople).
      // Shared dealer/admin codes are no longer accepted for store login.
      personRecord = helpers.findActivePersonByPin(dealerCode);
      if (personRecord) {
        role = helpers.personRoleToSessionRole(personRecord.getString("role"));
        try {
          record = $app
            .dao()
            .findRecordById("dealers", personRecord.getString("dealer"));
        } catch (_e) {
          record = null;
        }
      }
    }

    if (role === "super_admin" && !record) {
      helpers.logAuthEvent("login_fail", {
        credentialPresent: true,
        ip: ip,
        userAgent: ua,
        detail: "admin account unavailable",
      });
      return c.json(503, {
        error: "Administrative login is temporarily unavailable",
      });
    }

    if (!record) {
      helpers.logAuthEvent("login_fail", {
        credentialPresent: true,
        ip: ip,
        userAgent: ua,
      });
      return c.json(401, { error: "Invalid access code" });
    }

    // Mint the opaque session token + persist row. Cookie carries ONLY the token.
    let token, expiresAt;
    try {
      const sessionOpts = {};
      if (personRecord) sessionOpts.personId = personRecord.id;
      const session = helpers.createSession(
        record.id,
        role,
        ip,
        ua,
        sessionOpts,
      );
      token = session.token;
      expiresAt = session.expiresAt;
    } catch (err) {
      console.error("[session POST] createSession failed", err);
      return c.json(500, { error: "Failed to start session" });
    }

    c.response().header().add("Set-Cookie", helpers.buildSessionCookie(token));

    helpers.logAuthEvent("login_success", {
      dealerId: record.id,
      credentialPresent: true,
      ip: ip,
      userAgent: ua,
      detail:
        "role=" +
        role +
        (personRecord ? " person=" + personRecord.id : ""),
    });

    const payload = {
      role: role,
      dealer: helpers.serializeDealer(record),
      is_impersonation: false,
    };
    if (personRecord) {
      payload.person = helpers.serializePerson(personRecord);
    }
    return c.json(200, payload);
  } catch (e) {
    console.error("SESSION ERROR:", e);
    return c.json(500, { error: "Session request failed" });
  }
});

routerAdd("GET", "/api/app/session", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const token = helpers.readSessionToken(c);
  if (!token) return c.json(401, { error: "No active session" });

  const session = helpers.findSessionByToken(token);
  if (!session) return c.json(401, { error: "Invalid session" });

  const role = session.getString("role") || "salesperson";
  let record;
  try {
    record = $app.dao().findRecordById("dealers", session.getString("dealer"));
  } catch (_e) {
    return c.json(401, { error: "Invalid session" });
  }

  // Sliding refresh — extend the authoritative database expiry and the cookie
  // together so an active dealer does not expire at the original login time.
  try {
    helpers.refreshSession(session);
    c.response().header().add("Set-Cookie", helpers.buildSessionCookie(token));
  } catch (_e) {
    /* ignore */
  }

  const payload = {
    role: role,
    dealer: helpers.serializeDealer(record),
    is_impersonation: !!(session.getBool
      ? session.getBool("is_impersonation")
      : session.get("is_impersonation")),
  };
  const personId = session.getString("person");
  if (personId) {
    try {
      const person = $app.dao().findRecordById("salespeople", personId);
      payload.person = helpers.serializePerson(person);
    } catch (_e) {
      /* person removed */
    }
  }
  return c.json(200, payload);
});

// Super-admin opens a store as a manager or salesperson without their pin.
routerAdd("POST", "/api/app/session/impersonate", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const token = helpers.readSessionToken(c);
  if (!token) return c.json(401, { error: "No active session" });
  const session = helpers.findSessionByToken(token);
  if (!session) return c.json(401, { error: "Invalid session" });
  if (session.getString("role") !== "super_admin") {
    return c.json(403, { error: "Super admin only" });
  }
  if (
    session.getBool
      ? session.getBool("is_impersonation")
      : session.get("is_impersonation")
  ) {
    return c.json(400, { error: "Already impersonating — exit first" });
  }

  const body = $apis.requestInfo(c).data || {};
  const personId = (body.personId || "").toString().trim();
  if (!personId) return c.json(400, { error: "personId is required" });

  let person;
  try {
    person = $app.dao().findRecordById("salespeople", personId);
  } catch (_e) {
    return c.json(404, { error: "Person not found" });
  }
  const active = person.getBool
    ? person.getBool("active")
    : !!person.get("active");
  if (!active) return c.json(400, { error: "Person is inactive" });

  let dealer;
  try {
    dealer = $app.dao().findRecordById("dealers", person.getString("dealer"));
  } catch (_e) {
    return c.json(400, { error: "Dealer not found for person" });
  }

  const role = helpers.personRoleToSessionRole(person.getString("role"));
  const ip = helpers.clientIP(c);
  const ua = helpers.userAgent(c);

  let minted;
  try {
    minted = helpers.createSession(dealer.id, role, ip, ua, {
      personId: person.id,
      isImpersonation: true,
      impersonatorSessionId: session.id,
    });
  } catch (err) {
    console.error("[impersonate] createSession failed", err);
    return c.json(500, { error: "Failed to start impersonation" });
  }

  c.response()
    .header()
    .add("Set-Cookie", helpers.buildSessionCookie(minted.token));

  helpers.logAuthEvent("impersonate_start", {
    dealerId: dealer.id,
    credentialPresent: true,
    ip: ip,
    userAgent: ua,
    detail: "person=" + person.id + " role=" + role,
  });

  return c.json(200, {
    role: role,
    dealer: helpers.serializeDealer(dealer),
    person: helpers.serializePerson(person),
    is_impersonation: true,
  });
});

routerAdd("POST", "/api/app/session/exit-impersonate", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const token = helpers.readSessionToken(c);
  if (!token) return c.json(401, { error: "No active session" });
  const session = helpers.findSessionByToken(token);
  if (!session) return c.json(401, { error: "Invalid session" });

  const isImpersonation = session.getBool
    ? session.getBool("is_impersonation")
    : !!session.get("is_impersonation");
  if (!isImpersonation) {
    return c.json(400, { error: "Not impersonating" });
  }

  const impersonatorId = session.getString("impersonator_session");
  if (!impersonatorId) {
    return c.json(400, { error: "Impersonation source missing" });
  }

  let adminSession;
  try {
    adminSession = $app.dao().findRecordById("sessions", impersonatorId);
  } catch (_e) {
    adminSession = null;
  }
  if (!adminSession || adminSession.getString("role") !== "super_admin") {
    helpers.revokeSession(c);
    c.response().header().add("Set-Cookie", helpers.buildClearCookie());
    return c.json(401, {
      error: "Super admin session expired — sign in again",
    });
  }

  // Revoke the impersonation session; re-mint a fresh super-admin cookie so we
  // never re-issue a stored plaintext token (only hashes are kept).
  try {
    $app.dao().deleteRecord(session);
  } catch (_e) {
    /* ignore */
  }

  let adminDealer;
  try {
    adminDealer = $app
      .dao()
      .findRecordById("dealers", adminSession.getString("dealer"));
  } catch (_e) {
    return c.json(401, { error: "Admin dealer unavailable" });
  }

  const ip = helpers.clientIP(c);
  const ua = helpers.userAgent(c);
  let minted;
  try {
    minted = helpers.createSession(
      adminDealer.id,
      "super_admin",
      ip,
      ua,
      {},
    );
  } catch (err) {
    console.error("[exit-impersonate] createSession failed", err);
    return c.json(500, { error: "Failed to restore admin session" });
  }

  // Drop the old super-admin session row that was parked during impersonation.
  try {
    $app.dao().deleteRecord(adminSession);
  } catch (_e) {
    /* ignore */
  }

  c.response()
    .header()
    .add("Set-Cookie", helpers.buildSessionCookie(minted.token));

  helpers.logAuthEvent("impersonate_exit", {
    dealerId: adminDealer.id,
    credentialPresent: true,
    ip: ip,
    userAgent: ua,
    detail: "restored super_admin",
  });

  return c.json(200, {
    role: "super_admin",
    dealer: helpers.serializeDealer(adminDealer),
    is_impersonation: false,
  });
});

routerAdd("DELETE", "/api/app/session", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  // Best-effort: delete the row so the token is permanently dead even if
  // the cookie sticks around somewhere.
  try {
    helpers.revokeSession(c);
    helpers.logAuthEvent("session_revoked", {
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
    });
  } catch (_e) {
    /* ignore */
  }
  c.response().header().add("Set-Cookie", helpers.buildClearCookie());
  return c.json(200, { success: true });
});

// ============================================================================
// Session-gated app endpoints. The frontend hits these instead of pb.collection
// directly so collection rules can stay locked to null.
//
// Auth model: every request must carry the dealer_session cookie set by the
// /api/app/session login route. We resolve the cookie to a dealer record and
// pass that record into the handler.
// ============================================================================

// dealerFromSession moved to top

// ---- Photo releases -----------------------------------------------------
routerAdd("POST", "/api/app/photo_releases", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    const releases = $app.dao().findCollectionByNameOrId("photo_releases");
    if (!releases)
      return c.json(500, { error: "photo_releases collection missing" });

    const body = $apis.requestInfo(c).data || {};
    const customerName = helpers.assertString(
      (body.customer_name || "").toString().trim(),
      120,
    );
    if (!customerName) {
      return c.json(400, { error: "Customer name is required" });
    }

    let signatureFile = null;
    try {
      const header = c.formFile("signature_png");
      if (header) signatureFile = $filesystem.fileFromMultipart(header);
    } catch (_e) {}
    if (!signatureFile) {
      return c.json(400, { error: "Signature image is required" });
    }

    // Only allowlist the customer-controlled release fields. Dealer,
    // timestamp, IP hash, and user agent always come from the active request.
    // A newly captured release is deliberately unlinked: it must be durable
    // before any provider call, and is linked only after the post exists.
    const record = new Record(releases);
    const form = new RecordUpsertForm($app, record);
    form.setFullManageAccess(true);
    const data = {
      dealer: dealer.id,
      customer_name: customerName,
      signed_at: new Date().toISOString(),
      vin: helpers.assertString((body.vin || "").toString().trim(), 17),
      notes: helpers.assertString((body.notes || "").toString(), 1000),
      post_id: "",
      ip_hash: "",
      user_agent: "",
    };
    try {
      const ip = helpers.clientIP(c) || "";
      // Store a hash, not the raw IP (field is named ip_hash).
      data.ip_hash = ip ? $security.sha256(ip) : "";
    } catch (_e) {}
    try {
      data.user_agent = (helpers.userAgent(c) || "").toString().slice(0, 300);
    } catch (_e) {}

    form.loadData(data);
    form.addFiles("signature_png", signatureFile);
    form.submit();

    return c.json(200, {
      id: record.id,
      customer_name: record.getString("customer_name"),
      signed_at: record.getString("signed_at"),
      vin: record.getString("vin"),
    });
  } catch (err) {
    console.error("[/api/app/photo_releases] error", err);
    return c.json(400, { error: helpers.safePhotoReleaseError(err) });
  }
});

// Link a protected signature that already exists to the post created after AI
// generation. This is a one-way, idempotent transition: the signature file is
// never accepted or re-saved here, and an existing link cannot be redirected.
routerAdd("POST", "/api/app/photo_releases/:id/link-post", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  let release = null;
  try {
    release = $app.dao().findRecordById("photo_releases", c.pathParam("id"));
  } catch (_e) {
    return c.json(404, { error: "Photo release not found" });
  }
  if (release.getString("dealer") !== dealer.id) {
    return c.json(403, { error: "Cross-dealer release link blocked" });
  }
  if (!release.getString("signature_png")) {
    return c.json(409, { error: "Photo release has no stored signature" });
  }

  const body = $apis.requestInfo(c).data || {};
  const postId = helpers.assertString(
    (body.post_id || "").toString().trim(),
    64,
  );
  if (!postId) return c.json(400, { error: "post_id is required" });

  let post = null;
  try {
    post = $app.dao().findRecordById("posts", postId);
  } catch (_e) {
    return c.json(404, { error: "Post not found" });
  }
  if (post.getString("dealer") !== dealer.id) {
    return c.json(403, { error: "Cross-dealer release link blocked" });
  }

  // A salesperson may only link consent to a post created by this exact
  // browser session, not another salesperson's post in the same dealership.
  const token = helpers.readSessionToken(c);
  const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
  if (
    !currentOwnerHash ||
    currentOwnerHash !== post.getString("owner_session_hash")
  ) {
    return c.json(403, { error: "Post belongs to another session" });
  }

  try {
    const existingPostId = release.getString("post_id");
    if (existingPostId && existingPostId !== post.id) {
      return c.json(409, {
        error: "Photo release is already linked to another post",
      });
    }

    if (!existingPostId) {
      // This conditional write is the one-way concurrency boundary. Two
      // simultaneous requests cannot redirect one release to different posts.
      const linkedAt = new Date().toISOString();
      const result = $app
        .dao()
        .db()
        .newQuery(
          "UPDATE photo_releases " +
            "SET post_id = {:postId}, updated = {:updated} " +
            "WHERE id = {:releaseId} AND dealer = {:dealer} " +
            "AND (post_id = '' OR post_id IS NULL)",
        )
        .bind({
          postId: post.id,
          updated: linkedAt,
          releaseId: release.id,
          dealer: dealer.id,
        })
        .execute();

      if (!result || result.rowsAffected() !== 1) {
        const current = $app
          .dao()
          .findRecordById("photo_releases", release.id);
        if (current.getString("post_id") !== post.id) {
          return c.json(409, {
            error: "Photo release is already linked to another post",
          });
        }
      }
    }

    // Only a successfully stored same-dealer link is allowed to assert
    // consent on the post. A failed post update leaves the conservative false
    // value in place; retrying this idempotent endpoint repairs it safely.
    const hasRelease = post.getBool
      ? post.getBool("has_release")
      : !!post.get("has_release");
    if (!hasRelease) {
      post.set("has_release", true);
      $app.dao().saveRecord(post);
    }

    return c.json(200, {
      id: release.id,
      post_id: post.id,
      has_release: true,
    });
  } catch (err) {
    console.error("[/api/app/photo_releases/:id/link-post] error", err);
    return c.json(400, { error: "Failed to link photo release" });
  }
});

// ---- Posts (log + leaderboard + approval) ------------------------------
routerAdd("POST", "/api/app/posts", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    const posts = $app.dao().findCollectionByNameOrId("posts");
    if (!posts) return c.json(500, { error: "posts collection missing" });

    const record = new Record(posts);
    const form = new RecordUpsertForm($app, record);
    form.setFullManageAccess(true);
    const body = $apis.requestInfo(c).data || {};

    // Validate optional salesperson_id is one of this dealership's records.
    let salespersonId = "";
    if (body.salesperson_id) {
      try {
        const sp = $app
          .dao()
          .findRecordById("salespeople", body.salesperson_id.toString());
        if (sp && sp.getString("dealer") === dealer.id) {
          salespersonId = sp.id;
        }
      } catch (_e) {
        /* ignore — fall back to unattributed */
      }
    }

    const approvalStatus = policies.initialApprovalStatus(dealer);
    const caption = helpers.assertString(
      (body.caption || "").toString().trim(),
      12000,
    );
    const disclosures = helpers.assertString(
      (body.disclosures || "").toString().trim(),
      12000,
    );
    if (approvalStatus === "pending" && !caption) {
      return c.json(400, { error: "Review caption is required" });
    }
    if (approvalStatus === "pending") {
      const compliance = policies.validatePostCompliance(
        caption,
        disclosures,
        dealer.getString("banned_phrases"),
      );
      if (!compliance.ok) {
        return c.json(400, { error: compliance.error });
      }
    }

    let creativeFile = null;
    if (approvalStatus === "pending") {
      try {
        const header = c.formFile("creative_image");
        if (header) creativeFile = $filesystem.fileFromMultipart(header);
      } catch (_e) {}
      if (!creativeFile) {
        return c.json(400, { error: "Review image is required" });
      }
    }

    // Load only the server-approved text fields, then attach the parsed upload
    // explicitly. This avoids trusting multipart filename strings as record
    // values and keeps all tenant/policy/audit fields server-controlled.
    const token = helpers.readSessionToken(c);
    form.loadData({
      dealer: dealer.id,
      salesperson_name: helpers.assertString(
        (body.salesperson_name || "").toString(),
        120,
      ),
      salesperson_id: salespersonId,
      generated_at: new Date().toISOString(),
      style: helpers.assertString((body.style || "").toString(), 60),
      tone: helpers.assertString((body.tone || "").toString(), 60),
      customer_name: helpers.assertString(
        (body.customer_name || "").toString(),
        120,
      ),
      vin: helpers.assertString((body.vin || "").toString(), 17),
      // Release status is derived from a durably stored, same-dealer signature
      // by the photo-releases endpoint. Never trust a client assertion here.
      has_release: false,
      // Video metrics are recorded only by the owner-scoped completion route
      // after rendering succeeds; a client cannot pre-claim success here.
      has_video: false,
      approval_status: approvalStatus,
      approved_by: "",
      approved_at: "",
      caption: approvalStatus === "pending" ? caption : "",
      disclosures: approvalStatus === "pending" ? disclosures : "",
      // Every derived artifact (approval polling, protected creative, video
      // completion) is bound to the opaque browser session that logged it.
      owner_session_hash: token ? helpers.hashSessionToken(token) : "",
    });
    if (creativeFile) form.addFiles("creative_image", creativeFile);
    form.submit();

    if (approvalStatus === "pending" && !record.getString("creative_image")) {
      // Never create a queue item a manager cannot actually inspect.
      try {
        $app.dao().deleteRecord(record);
      } catch (_e) {}
      return c.json(400, { error: "Review image is required" });
    }

    return c.json(200, {
      id: record.id,
      dealer: dealer.id,
      generated_at: record.getString("generated_at"),
      approval_status: record.getString("approval_status"),
    });
  } catch (err) {
    console.error("[/api/app/posts] create error", err);
    return c.json(400, { error: "Failed to log post" });
  }
});

// Record successful video rendering only from the browser session that logged
// the source post. The transition is intentionally idempotent so client retry
// after a lost response cannot inflate or corrupt metrics.
routerAdd("POST", "/api/app/posts/:id/video-generated", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  let record = null;
  try {
    record = $app.dao().findRecordById("posts", c.pathParam("id"));
  } catch (_e) {
    return c.json(404, { error: "Post not found" });
  }

  if (record.getString("dealer") !== dealer.id) {
    return c.json(403, { error: "Cross-dealer video update blocked" });
  }

  const token = helpers.readSessionToken(c);
  const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
  if (
    !currentOwnerHash ||
    currentOwnerHash !== record.getString("owner_session_hash")
  ) {
    return c.json(403, { error: "Post belongs to another session" });
  }

  try {
    const alreadyGenerated = record.getBool
      ? record.getBool("has_video")
      : !!record.get("has_video");
    if (!alreadyGenerated) {
      record.set("has_video", true);
      $app.dao().saveRecord(record);
    }
    return c.json(200, { id: record.id, has_video: true });
  } catch (err) {
    console.error("[/api/app/posts/:id/video-generated] error", err);
    return c.json(500, { error: "Failed to record generated video" });
  }
});

// The submitting browser can poll only its own post. A post id is not a bearer
// credential: ownership is checked against a SHA-256 verifier of the current
// opaque session token, and the dealer relationship is checked independently.
routerAdd("GET", "/api/app/posts/:id/status", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    const record = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, { error: "Cross-dealer status read blocked" });
    }

    const role = helpers.sessionRoleFromCookie(c);
    const isManager = role === "dealer_admin" || role === "super_admin";
    const token = helpers.readSessionToken(c);
    const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner =
      !!currentOwnerHash &&
      currentOwnerHash === record.getString("owner_session_hash");
    if (!isOwner && !isManager) {
      return c.json(403, { error: "Post status belongs to another session" });
    }

    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, {
      id: record.id,
      approval_status: record.getString("approval_status"),
      approved_by: record.getString("approved_by"),
      approved_at: record.getString("approved_at"),
    });
  } catch (err) {
    return c.json(404, { error: "Post not found" });
  }
});

// Protected creative images are never exposed through PocketBase's public file
// route. This endpoint authorizes the manager (or submitting browser session)
// first and then streams the stored file from the configured local/S3 backend.
routerAdd("GET", "/api/app/posts/:id/creative-image", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    const record = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, { error: "Cross-dealer creative read blocked" });
    }

    const role = helpers.sessionRoleFromCookie(c);
    const isManager = role === "dealer_admin" || role === "super_admin";
    const token = helpers.readSessionToken(c);
    const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner =
      !!currentOwnerHash &&
      currentOwnerHash === record.getString("owner_session_hash");
    if (!isOwner && !isManager) {
      return c.json(403, { error: "Creative belongs to another session" });
    }

    const filename = record.getString("creative_image");
    if (!filename) return c.json(404, { error: "Creative image not found" });

    const fileSystem = $app.newFilesystem();
    try {
      const fileKey = record.baseFilesPath() + "/" + filename;
      if (!fileSystem.exists(fileKey)) {
        return c.json(404, { error: "Creative image not found" });
      }
      c.response().header().set("Cache-Control", "private, no-store");
      c.response().header().set("X-Content-Type-Options", "nosniff");
      fileSystem.serve(c.response(), c.request(), fileKey, filename);
      return;
    } finally {
      fileSystem.close();
    }
  } catch (err) {
    return c.json(404, { error: "Creative image not found" });
  }
});

routerAdd("GET", "/api/app/posts", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const query = $apis.requestInfo(c).query || {};
    const since = (query.since || "").toString();
    const until = (query.until || "").toString();
    const status = (query.approval_status || "").toString();
    const limitRaw = parseInt((query.limit || "200").toString(), 10);
    const limit = Math.min(Math.max(limitRaw || 200, 1), 1000);

    const filterParts = [`dealer = {:dealer}`];
    const params = { dealer: dealer.id };
    if (since) {
      filterParts.push(`generated_at >= {:since}`);
      params.since = since;
    }
    if (until) {
      filterParts.push(`generated_at <= {:until}`);
      params.until = until;
    }
    if (status) {
      filterParts.push(`approval_status = {:status}`);
      params.status = status;
    }

    const records = $app
      .dao()
      .findRecordsByFilter(
        "posts",
        filterParts.join(" && "),
        "-generated_at",
        limit,
        0,
        params,
      );

    const items = records.map((r) => ({
      id: r.id,
      dealer: r.getString("dealer"),
      salesperson_name: r.getString("salesperson_name"),
      salesperson_id: r.getString("salesperson_id"),
      generated_at: r.getString("generated_at"),
      style: r.getString("style"),
      tone: r.getString("tone"),
      customer_name: r.getString("customer_name"),
      vin: r.getString("vin"),
      has_release: r.getBool
        ? r.getBool("has_release")
        : !!r.get("has_release"),
      has_video: r.getBool ? r.getBool("has_video") : !!r.get("has_video"),
      approval_status: r.getString("approval_status"),
      approved_by: r.getString("approved_by"),
      approved_at: r.getString("approved_at"),
      caption: r.getString("caption"),
      disclosures: r.getString("disclosures"),
      creative_image_url: r.getString("creative_image")
        ? `/api/app/posts/${r.id}/creative-image`
        : "",
    }));

    return c.json(200, { items });
  } catch (err) {
    console.error("[/api/app/posts] list error", err);
    return c.json(500, { error: "Failed to list posts" });
  }
});

routerAdd("PATCH", "/api/app/posts/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, {
      error: "Manager role required to set approval status",
    });
  }

  try {
    const id = c.pathParam("id");
    const body = $apis.requestInfo(c).data || {};
    const record = $app.dao().findRecordById("posts", id);

    // Approval authority matches the manager's list/view scope. There is no
    // audited tenant-selection mechanism, so even a global super-admin session
    // cannot blindly mutate another dealership's queue by guessing a post id.
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, {
        error: "Cross-dealer approval is not allowed",
      });
    }

    const decision = helpers.assertEnum(body.approval_status, [
      "approved",
      "rejected",
    ]);
    if (record.getString("approval_status") !== "pending") {
      return c.json(409, { error: "This approval has already been decided" });
    }
    const approver = helpers.assertString(
      (body.approved_by || "").toString().trim(),
      120,
    );
    if (!approver) {
      return c.json(400, { error: "Approver name is required" });
    }

    if (
      decision === "approved" &&
      (!record.getString("caption") || !record.getString("creative_image"))
    ) {
      return c.json(409, {
        error: "Cannot approve a post without reviewable creative",
      });
    }
    if (decision === "approved") {
      // Re-evaluate the stored, immutable review copy against the current
      // dealer policy. This protects legacy queue entries and catches phrases
      // blocked after submission; rejection remains available to clear them.
      const compliance = policies.validatePostCompliance(
        record.getString("caption"),
        record.getString("disclosures"),
        dealer.getString("banned_phrases"),
      );
      if (!compliance.ok) {
        return c.json(409, { error: compliance.error });
      }
    }

    // The pending check above gives a fast response for ordinary retries, but
    // only this conditional UPDATE is the concurrency boundary. SQLite will
    // serialize the competing writers; exactly one can change `pending`, and
    // the loser observes rowsAffected=0 instead of overwriting the decision.
    const approvedAt = new Date().toISOString();
    const result = $app
      .dao()
      .db()
      .newQuery(
        "UPDATE posts " +
          "SET approval_status = {:decision}, approved_by = {:approver}, " +
          "approved_at = {:approvedAt}, updated = {:updated} " +
          "WHERE id = {:id} AND dealer = {:dealer} " +
          "AND approval_status = 'pending'",
      )
      .bind({
        decision: decision,
        approver: approver,
        approvedAt: approvedAt,
        updated: approvedAt,
        id: record.id,
        dealer: dealer.id,
      })
      .execute();
    if (!result || result.rowsAffected() !== 1) {
      return c.json(409, { error: "This approval has already been decided" });
    }

    return c.json(200, {
      id: record.id,
      approval_status: decision,
    });
  } catch (err) {
    console.error("[/api/app/posts/:id] patch error", err);
    return c.json(400, { error: "Failed to update post" });
  }
});

// ---- People roster (salespeople collection: managers + salespeople) ----

routerAdd("GET", "/api/app/salespeople", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  try {
    const query = $apis.requestInfo(c).query || {};
    const includeInactive =
      (query.include_inactive || "").toString() === "true";
    const roleFilter = (query.role || "").toString().trim();
    const dealerFilter = (query.dealer || "").toString().trim();

    let scopeDealerId = dealer.id;
    if (role === "super_admin" && dealerFilter) {
      scopeDealerId = dealerFilter;
    } else if (role === "super_admin" && !dealerFilter) {
      // Super admin may list across all dealers when no filter is set.
      scopeDealerId = "";
    }

    let filterParts = [];
    const params = {};
    if (scopeDealerId) {
      filterParts.push("dealer = {:d}");
      params.d = scopeDealerId;
    } else {
      filterParts.push("1 = 1");
    }
    if (!includeInactive) filterParts.push("active = true");
    if (role === "super_admin") {
      if (roleFilter === "manager" || roleFilter === "salesperson") {
        filterParts.push("role = {:role}");
        params.role = roleFilter;
      }
    } else {
      // Store managers and floor staff only list the salesperson roster
      // (showroom picker + Team tab). Managers are system-admin only.
      filterParts.push("role = {:role}");
      params.role = "salesperson";
    }

    const records = $app
      .dao()
      .findRecordsByFilter(
        "salespeople",
        filterParts.join(" && "),
        "name",
        1000,
        0,
        params,
      );

    // Salespeople never see pins of others; managers/super-admin need pins for ops.
    const includePin = role === "super_admin" || role === "dealer_admin";
    return c.json(200, {
      items: records.map((r) => {
        const item = {
          id: r.id,
          dealer: r.getString("dealer"),
          name: r.getString("name"),
          role: r.getString("role") || "salesperson",
          active: r.getBool ? r.getBool("active") : !!r.get("active"),
          created_at: r.getString("created_at"),
        };
        if (includePin) item.pin = r.getString("pin");
        return item;
      }),
    });
  } catch (err) {
    console.error("[/api/app/salespeople] list error", err);
    return c.json(500, { error: "Failed to list people" });
  }
});

routerAdd("POST", "/api/app/salespeople", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }
  try {
    const body = $apis.requestInfo(c).data || {};
    const name = (body.name || "").toString().trim();
    if (!name) return c.json(400, { error: "name is required" });

    let personRole = (body.role || "salesperson").toString().trim();
    if (personRole !== "manager" && personRole !== "salesperson") {
      return c.json(400, { error: "role must be manager or salesperson" });
    }
    // Only super-admin may create managers.
    if (personRole === "manager" && role !== "super_admin") {
      return c.json(403, { error: "Only system admin can create managers" });
    }
    // Dealer admin can only create salespeople for their own store.
    if (role === "dealer_admin") personRole = "salesperson";

    let targetDealerId = dealer.id;
    if (role === "super_admin" && body.dealer) {
      targetDealerId = body.dealer.toString().trim();
      try {
        $app.dao().findRecordById("dealers", targetDealerId);
      } catch (_e) {
        return c.json(400, { error: "Invalid dealer" });
      }
    }

    let pin = (body.pin || "").toString().trim();
    if (!pin) {
      pin = helpers.generateUniquePersonPin();
    } else {
      pin = helpers.assertPersonPinAvailable(pin, "");
    }

    const salespeople = $app.dao().findCollectionByNameOrId("salespeople");
    const record = new Record(salespeople, {
      dealer: targetDealerId,
      name: helpers.assertString(name, 120),
      pin: pin,
      role: personRole,
      active: body.active === false ? false : true,
      created_at: new Date().toISOString(),
    });
    $app.dao().saveRecord(record);
    return c.json(200, helpers.serializePerson(record));
  } catch (err) {
    console.error("[/api/app/salespeople] create error", err);
    const msg = helpers.safeDealerMutationError(err);
    return c.json(400, {
      error:
        msg === "Failed to save dealer" ? "Failed to create person" : msg,
    });
  }
});

routerAdd("PATCH", "/api/app/salespeople/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }
  try {
    const id = c.pathParam("id");
    const record = $app.dao().findRecordById("salespeople", id);
    if (record.getString("dealer") !== dealer.id && role !== "super_admin") {
      return c.json(403, { error: "Cross-dealer edit blocked" });
    }
    const existingRole = record.getString("role") || "salesperson";
    if (existingRole === "manager" && role !== "super_admin") {
      return c.json(403, { error: "Only system admin can edit managers" });
    }

    const body = $apis.requestInfo(c).data || {};
    if (typeof body.name === "string")
      record.set("name", helpers.assertString(body.name.toString(), 120));
    if (typeof body.pin === "string") {
      const pin = helpers.assertPersonPinAvailable(body.pin.toString(), id);
      record.set("pin", pin);
    }
    if (typeof body.active === "boolean") record.set("active", body.active);
    if (typeof body.role === "string" && role === "super_admin") {
      const nextRole = body.role.toString().trim();
      if (nextRole !== "manager" && nextRole !== "salesperson") {
        return c.json(400, { error: "role must be manager or salesperson" });
      }
      record.set("role", nextRole);
    }
    $app.dao().saveRecord(record);
    return c.json(200, helpers.serializePerson(record));
  } catch (err) {
    console.error("[/api/app/salespeople/:id] update error", err);
    const msg = helpers.safeDealerMutationError(err);
    return c.json(400, {
      error:
        msg === "Failed to save dealer" ? "Failed to update person" : msg,
    });
  }
});

routerAdd("DELETE", "/api/app/salespeople/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  // Soft-delete: flip active=false. Hard delete would orphan posts.
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }
  try {
    const id = c.pathParam("id");
    const record = $app.dao().findRecordById("salespeople", id);
    if (record.getString("dealer") !== dealer.id && role !== "super_admin") {
      return c.json(403, { error: "Cross-dealer delete blocked" });
    }
    if (
      (record.getString("role") || "salesperson") === "manager" &&
      role !== "super_admin"
    ) {
      return c.json(403, { error: "Only system admin can deactivate managers" });
    }
    record.set("active", false);
    $app.dao().saveRecord(record);
    return c.json(200, { success: true });
  } catch (err) {
    console.error("[/api/app/salespeople/:id] deactivate error", err);
    return c.json(400, { error: "Failed to deactivate person" });
  }
});

// ---- Dealers CRUD (admin only) -----------------------------------------
routerAdd("POST", "/api/app/dealers", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (helpers.sessionRoleFromCookie(c) !== "super_admin") {
    return c.json(403, { error: "Admin only" });
  }

  try {
    const dealers = $app.dao().findCollectionByNameOrId("dealers");
    helpers.restrictDealerLogoSchema(dealers);
    const body = $apis.requestInfo(c).data || {};
    // Super-admin creates stores by name/brand only. Personal access codes live
    // on the people roster (managers / users), not on the dealer record.
    const data = helpers.dealerMutationData(body, true, true);
    if (!data.name) return c.json(400, { error: "Dealer name is required" });
    if (data.code) {
      helpers.assertDealerCredentialAvailable(data.code, "");
    }
    if (data.admin_code) {
      helpers.assertDealerCredentialAvailable(data.admin_code, "");
    }
    if (data.admin_code && data.code && data.admin_code === data.code) {
      return c.json(400, {
        error: "Dealer and manager codes must be different",
      });
    }

    const record = new Record(dealers);
    const form = new RecordUpsertForm($app, record);
    form.setFullManageAccess(true);
    form.loadData(data);
    const logo = helpers.dealerLogoFile(c);
    if (logo) form.addFiles("logo", logo);
    form.submit();
    return c.json(200, { id: record.id });
  } catch (err) {
    console.error("[/api/app/dealers] create error", err);
    return c.json(400, { error: helpers.safeDealerMutationError(err) });
  }
});

routerAdd("PATCH", "/api/app/dealers/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  const id = c.pathParam("id");
  const role = helpers.sessionRoleFromCookie(c);
  const isSuperAdmin = role === "super_admin";
  const isSelfDealerAdmin = role === "dealer_admin" && id === dealer.id;

  // Super admin can patch any dealer; dealer_admin can only patch their own
  // dealership. Salesperson role is blocked.
  if (!isSuperAdmin && !isSelfDealerAdmin) {
    return c.json(403, {
      error: "Need super-admin or dealer-admin (self) role to patch a dealer",
    });
  }

  try {
    const target = $app.dao().findRecordById("dealers", id);
    helpers.restrictDealerLogoSchema(target.collection());
    const body = $apis.requestInfo(c).data || {};
    const data = helpers.dealerMutationData(body, isSuperAdmin, isSuperAdmin);
    if (data.name !== undefined && !data.name) {
      return c.json(400, { error: "Dealer name is required" });
    }
    if (
      isSuperAdmin &&
      target.id === dealer.id &&
      data.code !== undefined &&
      data.code !== target.getString("code")
    ) {
      return c.json(400, {
        error:
          "The system-admin dealer code must be rotated through the deployment secret runbook",
      });
    }
    const finalCode =
      data.code !== undefined ? data.code : target.getString("code");
    const finalAdminCode =
      data.admin_code !== undefined
        ? data.admin_code
        : target.getString("admin_code");
    if (finalAdminCode && finalAdminCode === finalCode) {
      return c.json(400, {
        error: "Dealer and manager codes must be different",
      });
    }
    if (data.code !== undefined) {
      helpers.assertDealerCredentialAvailable(data.code, target.id);
    }
    if (data.admin_code) {
      helpers.assertDealerCredentialAvailable(data.admin_code, target.id);
    }
    const codeRotated =
      isSuperAdmin && !!data.code && data.code !== target.getString("code");
    const adminCodeRotated =
      isSuperAdmin &&
      data.admin_code !== undefined &&
      data.admin_code !== target.getString("admin_code");

    const form = new RecordUpsertForm($app, target);
    form.setFullManageAccess(true);
    form.loadData(data);
    const logo = helpers.dealerLogoFile(c);
    if (logo) form.addFiles("logo", logo);
    form.submit();

    if (codeRotated || adminCodeRotated) {
      const preserveToken =
        isSuperAdmin && target.id === dealer.id
          ? helpers.readSessionToken(c)
          : "";
      const revokedSessions = helpers.revokeDealerSessions(
        target.id,
        preserveToken,
      );
      helpers.logAuthEvent("dealer_credentials_rotated", {
        dealerId: target.id,
        ip: helpers.clientIP(c),
        userAgent: helpers.userAgent(c),
        detail:
          "rotated_by=super_admin code=" +
          (codeRotated ? "yes" : "no") +
          " manager_code=" +
          (adminCodeRotated ? "yes" : "no") +
          " sessions_revoked=" +
          revokedSessions,
      });
    }
    return c.json(200, { id: target.id });
  } catch (err) {
    console.error("[/api/app/dealers/:id] patch error", err);
    return c.json(400, { error: helpers.safeDealerMutationError(err) });
  }
});

routerAdd("DELETE", "/api/app/dealers/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (helpers.sessionRoleFromCookie(c) !== "super_admin") {
    return c.json(403, { error: "Admin only" });
  }

  try {
    const id = c.pathParam("id");
    if (id === dealer.id) {
      return c.json(400, {
        error: "Refusing to delete your own dealer record",
      });
    }
    const target = $app.dao().findRecordById("dealers", id);
    $app.dao().deleteRecord(target);
    return c.json(200, { success: true });
  } catch (err) {
    console.error("[/api/app/dealers/:id] delete error", err);
    return c.json(400, { error: "Failed to delete dealer" });
  }
});

// ---- Dealers list (admin only) -----------------------------------------
routerAdd("GET", "/api/app/dealers", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (helpers.sessionRoleFromCookie(c) !== "super_admin") {
    return c.json(403, { error: "Admin only" });
  }
  try {
    const records = $app
      .dao()
      .findRecordsByFilter("dealers", "1=1", "name", 1000, 0);
    const items = records.map((r) => ({
      id: r.id,
      name: r.getString("name"),
      code: r.getString("code"),
      logo: r.getString("logo")
        ? `/api/files/dealers/${r.id}/${r.getString("logo")}`
        : "",
      brand_voice: r.getString("brand_voice"),
      banned_phrases: r.getString("banned_phrases"),
      oem_affiliation: r.getString("oem_affiliation"),
      requires_approval: r.getBool
        ? r.getBool("requires_approval")
        : !!r.get("requires_approval"),
      brand_color: r.getString("brand_color"),
      admin_code: r.getString("admin_code"),
      website: r.getString("website"),
      phone: r.getString("phone"),
      address: r.getString("address"),
      hours: r.getString("hours"),
      tagline: r.getString("tagline"),
      facebook_url: r.getString("facebook_url"),
      instagram_handle: r.getString("instagram_handle"),
      tiktok_handle: r.getString("tiktok_handle"),
      x_handle: r.getString("x_handle"),
      gbp_url: r.getString("gbp_url"),
      default_hashtags: r.getString("default_hashtags"),
      default_footer: r.getString("default_footer"),
      enabled_styles: r.getString("enabled_styles"),
      default_style: r.getString("default_style"),
      enabled_fun_styles: r.getString("enabled_fun_styles"),
      custom_scenarios: r.getString("custom_scenarios"),
    }));
    return c.json(200, { items });
  } catch (err) {
    console.error("[/api/app/dealers] list error", err);
    return c.json(500, { error: "Failed to list dealers" });
  }
});
