/**
 * This hook file creates a generic proxy for the Google Gemini API and Vertex AI.
 * It allows the frontend to send requests to paths like:
 * - `/api/proxy/v1beta/models/gemini-pro:generateContent` (Gemini API)
 * - `/api/proxy/vertex/v1beta1/projects/{PROJECT_ID}/locations/{LOCATION}/...` (Vertex AI)
 * and the hook will forward the request to the appropriate Google API with the secret API key.
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

  // Helper function moved inside handler for PocketBase JSVM compatibility
  const isAllowedProxyPathLocal = (path) => {
    const geminiPatterns = [
      /^v1beta\/models\/[^/]+:generateContent$/,
      /^v1beta\/models\/[^/]+:generateImages$/,
      /^v1beta\/models\/[^/]+:generateVideos$/,
      /^v1beta\/models\/[^/]+:predictLongRunning$/,
      /^v1beta\/operations\/.+$/,
      /^v1beta\/models\/[^/]+\/operations\/.+$/, // New format for operation polling
      /^v1beta\/files\/.+$/, // For downloading generated video files
    ];
    const vertexPatterns = [
      /^vertex\/v1beta1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/[^/]+:(generateContent|predict|generateVideos|generateImages|predictLongRunning)$/,
      /^vertex\/v1beta1\/operations\/.+$/,
      /^vertex\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/[^/]+:predict$/,
    ];
    return [...geminiPatterns, ...vertexPatterns].some((re) => re.test(path));
  };

  // Helper for SSRF protection
  const isPrivateHostLocal = (host) => {
    if (host === "localhost") return true;
    return (
      /^(\d{1,3}\.){3}\d{1,3}$/.test(host) &&
      /^(10\.|127\.|0\.0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
        host
      )
    );
  };

  let path = null;

  // Multiple methods to extract path for PocketBase JSVM compatibility
  try {
    // Method 1: Direct pathParams
    if (c.pathParams && c.pathParams.path) {
      path = c.pathParams.path;
    }
  } catch (e) {
    // pathParams may not be available
  }

  // Method 2: Get from URL path directly
  if (!path) {
    try {
      const fullPath = c.request.url.path || c.request.url.pathname;
      if (fullPath && fullPath.startsWith("/api/proxy/")) {
        path = fullPath.substring("/api/proxy/".length);
      }
    } catch (e) {
      // URL parsing may fail
    }
  }

  // Method 3: Get from raw URL string
  if (!path) {
    try {
      const urlStr = c.request.url.string();
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
      rateLimitKey = "token:" + incomingToken.substring(0, 16);
    }

    // Per-dealer (or per-token-prefix) sliding window. 60 req/min absorbs a
    // legitimate burst of poll requests for long-running video generation
    // while still capping a runaway script.
    const limit = helpers.checkProxyRateLimit(
      rateLimitKey,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS
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
        Math.ceil((limit.retryAfterMs || 60000) / 1000)
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
      return c.json(400, {
        error: "Missing API path.",
        debug: "Path extraction failed from all methods",
      });
    }

    if (!isAllowedProxyPathLocal(path)) {
      return c.json(403, {
        error: "Proxy path not allowed",
      });
    }

    // Detect if this is a Vertex AI request or Gemini API request
    const isVertexAI = path.startsWith("vertex/");
    let baseUrl;
    let authHeader = {};
    let queryParamsToAdd = [];

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
                "Failed to parse VERTEX_SERVICE_ACCOUNT_JSON: " + e.toString()
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
                "[Vertex] Constructed service account from individual env vars"
              );
            } else {
              // Fall back to file
              const keyPath = `${__hooks}/vertex_key.json`;
              // Read key file
              if (!$os.getFile(keyPath).exists()) {
                throw new Error(
                  "Vertex credentials not found. Set VERTEX_SERVICE_ACCOUNT_JSON env var, individual service account fields, or create vertex_key.json"
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
          const reqId =
            typeof $security !== "undefined" &&
            $security.randomStringWithAlphabet
              ? $security.randomStringWithAlphabet(12, "0123456789abcdef")
              : `${now}_${Math.floor(Math.random() * 1e9).toString(16)}`;
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
              `${opensslBin} dgst -sha256 -sign "${tempKey}" -out "${tempSig}" "${tempToken}" 2>&1`
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
              `${opensslBin} base64 -in "${tempSig}"`
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
                tokenResp.statusCode
              );
              // Do not log raw body if it contains sensitive info, but usually error body is safe.
              // However, to be safe, we'll just log the status and throw.
              throw new Error(
                `Token exchange failed with status ${tokenResp.statusCode}`
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
          error: "Authentication failed for Vertex AI",
          details: e.toString(),
        });
      }

      // Extract location from path (e.g., vertex/v1beta1/projects/PROJECT/locations/us-central1/...)
      const pathParts = path.split("/");
      let location = "us-central1"; // default
      const locationIndex = pathParts.indexOf("locations");
      if (locationIndex !== -1 && pathParts.length > locationIndex + 1) {
        location = pathParts[locationIndex + 1];
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
      queryParamsToAdd.push(`key=${geminiApiKey}`);
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
            `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`
          )
        );
      } else if (value !== undefined && value !== null) {
        queryParts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        );
      }
    });

    // Add our auth params (API Key for Gemini)
    queryParamsToAdd.forEach((p) => queryParts.push(p));

    if (queryParts.length > 0) {
      const separator = targetUrl.includes("?") ? "&" : "?";
      targetUrl += separator + queryParts.join("&");
    }

    const apiType = isVertexAI ? "Vertex AI" : "Gemini API";
    console.log(
      `[Proxy ${apiType}] ${requestInfo.method} ${targetUrl.replace(
        /key=[^&]+/,
        "key=HIDDEN"
      )}`
    );

    const res = $http.send({
      url: targetUrl,
      method: requestInfo.method,
      body:
        requestInfo.method === "POST" && requestInfo.body
          ? JSON.stringify(requestInfo.body)
          : "",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      timeout: 300000, // 5 minutes
    });

    console.log(`[Proxy] Upstream status: ${res.statusCode}`);

    // Forward headers for downstream consumers (e.g., content-type).
    if (res.headers) {
      Object.entries(res.headers).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          c.response().header(key, String(value));
        }
      });
    }

    const body =
      res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");

    try {
      const jsonBody = JSON.parse(body);
      return c.json(res.statusCode, jsonBody);
    } catch (e) {
      return c.string(res.statusCode, body);
    }
  } catch (err) {
    const apiType =
      path && path.startsWith("vertex/") ? "Vertex AI" : "Gemini API";
    console.error(`[Proxy ${apiType}] Error:`, err);
    return c.json(500, {
      error: `Failed to proxy request to ${apiType}.`,
      details: err.toString(),
      path: path,
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
  const openaiKey = ($os.getenv("OPENAI_API_KEY") || "").trim();
  if (!openaiKey) {
    return c.json(503, { error: "OpenAI API key is not configured" });
  }
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
  const limit = helpers.checkProxyRateLimit(
    "openai:" + dealer.id,
    30,
    60 * 1000
  );
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  try {
    const res = $http.send({
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body:
        requestInfo.method === "POST" && requestInfo.data
          ? JSON.stringify(requestInfo.data)
          : "",
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
      details: err.toString(),
    });
  }
});

routerAdd("POST", "/api/proxy/anthropic/v1/messages", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const anthropicKey = ($os.getenv("ANTHROPIC_API_KEY") || "").trim();
  if (!anthropicKey) {
    return c.json(503, { error: "Anthropic API key is not configured" });
  }
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    helpers.logAuthEvent("proxy_unauthorized", {
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "anthropic proxy",
    });
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  const limit = helpers.checkProxyRateLimit(
    "anthropic:" + dealer.id,
    60,
    60 * 1000
  );
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  try {
    const res = $http.send({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body:
        requestInfo.method === "POST" && requestInfo.data
          ? JSON.stringify(requestInfo.data)
          : "",
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
      details: err.toString(),
    });
  }
});

// Register the catch-all Gemini/Vertex proxy AFTER the more specific routes.
routerAdd("GET", "/api/proxy/:path(*)", proxyHandler);
routerAdd("POST", "/api/proxy/:path(*)", proxyHandler);

routerAdd("GET", "/api/proxy-image", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const url = c.queryParam("url");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  const limit = helpers.checkProxyRateLimit(
    "img:" + dealer.id,
    120,
    60 * 1000
  );
  if (!limit.ok) {
    c.response().header("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }

  if (!url) {
    return c.json(400, { error: "Missing url parameter" });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return c.json(400, { error: "Only https URLs are allowed" });
    }

    // Helper for SSRF protection (duplicated here for scope safety)
    const isPrivateHostLocal = (host) => {
      if (host === "localhost") return true;
      return (
        /^(\d{1,3}\.){3}\d{1,3}$/.test(host) &&
        /^(10\.|127\.|0\.0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
          host
        )
      );
    };

    if (isPrivateHostLocal(parsed.hostname)) {
      return c.json(400, { error: "Private/loopback hosts are not allowed" });
    }
  } catch (e) {
    return c.json(400, { error: "Invalid url parameter" });
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

    const contentType =
      res.headers["Content-Type"] || "application/octet-stream";

    // Return the raw image data
    // Note: res.raw is the byte slice of the body
    return c.blob(res.statusCode, contentType, res.raw);
  } catch (err) {
    return c.json(500, { error: "Proxy failed: " + err.toString() });
  }
});

// (Anthropic Claude fallback proxy moved above the wildcard /api/proxy/:path
// registration so route precedence works correctly.)

// ----------------------------------------------------------------------------
// Health + diagnostics endpoint. Public (no session required) so uptime
// monitors can hit it. Returns connectivity + config presence WITHOUT leaking
// any actual secret values.
// ----------------------------------------------------------------------------
routerAdd("GET", "/api/app/health", (c) => {
  const result = {
    ok: true,
    ts: new Date().toISOString(),
    checks: {
      pocketbase: false,
      gemini_key_set: false,
      proxy_token_set: false,
      vertex_credentials_set: false,
      anthropic_key_set: false,
      openai_key_set: false,
      admin_dealer_code_set: false,
    },
    counts: {
      dealers: 0,
      posts_24h: 0,
      photo_releases_24h: 0,
    },
    version: "1.0",
  };

  try {
    // Smoke a trivial PB query
    const dealers = $app.dao().findCollectionByNameOrId("dealers");
    result.checks.pocketbase = !!dealers;
    if (dealers) {
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
    result.checks.pocketbase = false;
  }

  // Posts in the last 24h (across all dealers)
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
        { s: since }
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
        { s: since }
      );
    result.counts.photo_releases_24h = releases.length;
  } catch (_e) {
    /* photo_releases may not exist yet */
  }

  // Env presence (booleans only — never echo the values)
  result.checks.gemini_key_set = !!($os.getenv("GEMINI_API_KEY") || "").trim();
  result.checks.proxy_token_set = !!($os.getenv("PROXY_ACCESS_TOKEN") || "").trim();
  result.checks.vertex_credentials_set =
    !!($os.getenv("VERTEX_SERVICE_ACCOUNT_JSON") || $os.getenv("private_key") || "").trim();
  result.checks.anthropic_key_set = !!($os.getenv("ANTHROPIC_API_KEY") || "").trim();
  result.checks.openai_key_set = !!($os.getenv("OPENAI_API_KEY") || "").trim();
  result.checks.admin_dealer_code_set =
    !!($os.getenv("ADMIN_DEALER_CODE") || "").trim();

  // Top-level ok = critical checks must pass
  if (!result.checks.pocketbase || !result.checks.gemini_key_set || !result.checks.proxy_token_set) {
    result.ok = false;
  }

  return c.json(result.ok ? 200 : 503, result);
});

routerAdd("POST", "/api/telemetry", (c) => {
  try {
    const rawBody = c.requestInfo().body || {};
    // Log to server console
    console.log("[Telemetry]", JSON.stringify(rawBody));
    return c.json(200, { success: true });
  } catch (err) {
    console.error("Telemetry error:", err);
    // Return 200 even on error to prevent client noise, but log the error
    return c.json(200, { success: false, error: err.toString() });
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
    
    console.log("Inside /api/app/session");
    const helpers = require(__hooks + "/helpers.js");
    const ip = helpers.clientIP(c);
    const ua = helpers.userAgent(c);

    const recentFails = helpers.countRecentEvents(
      "login_fail",
      ip,
      LOGIN_FAIL_WINDOW_SECONDS
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
      codeAttempted: dealerCode,
      ip: ip,
      userAgent: ua,
      detail: "malformed code",
    });
    return c.json(400, { error: "Dealer code is required" });
  }

  let record = null;
  let role = "salesperson";

  try {
    record = $app.dao().findFirstRecordByData("dealers", "code", dealerCode);
  } catch (_e) {
    /* not found by code */
  }


  if (!record) {
    try {
      record = $app
        .dao()
        .findFirstRecordByData("dealers", "admin_code", dealerCode);
      if (record) role = "dealer_admin";
    } catch (_e) {
      /* not found by admin_code either */
    }
  }

  if (!record) {
    helpers.logAuthEvent("login_fail", {
      codeAttempted: dealerCode,
      ip: ip,
      userAgent: ua,
    });
    return c.json(401, { error: "Invalid dealer code" });
  }

  const adminEnv = ($os.getenv("ADMIN_DEALER_CODE") || "").trim();
  if (
    adminEnv &&
    record.getString("code") === adminEnv &&
    role === "salesperson"
  ) {
    role = "super_admin";
  }

  // Mint the opaque session token + persist row. Cookie carries ONLY the token.
  let token, expiresAt;
  try {
    const session = helpers.createSession(record.id, role, ip, ua);
    token = session.token;
    expiresAt = session.expiresAt;
  } catch (err) {
    console.error("[session POST] createSession failed", err);
    return c.json(500, { error: "Failed to start session" });
  }

  c.response()
    .header()
    .add("Set-Cookie", helpers.buildSessionCookie(token));

  helpers.logAuthEvent("login_success", {
    dealerId: record.id,
    codeAttempted: dealerCode,
    ip: ip,
    userAgent: ua,
    detail: `role=${role}`,
  });

  let logoUrl = record.getString("logo");
  if (logoUrl && !logoUrl.startsWith("http")) {
    logoUrl = `/api/files/dealers/${record.id}/${logoUrl}`;
  }

  return c.json(200, {
    role: role,
    dealer: {
      id: record.id,
      name: record.getString("name"),
      code: record.getString("code"),
      logo: logoUrl,
      brand_voice: record.getString("brand_voice"),
      banned_phrases: record.getString("banned_phrases"),
      oem_affiliation: record.getString("oem_affiliation"),
      requires_approval: record.getBool
        ? record.getBool("requires_approval")
        : !!record.get("requires_approval"),
      brand_color: record.getString("brand_color"),
      website: record.getString("website"),
      phone: record.getString("phone"),
      address: record.getString("address"),
      hours: record.getString("hours"),
      tagline: record.getString("tagline"),
      facebook_url: record.getString("facebook_url"),
      instagram_handle: record.getString("instagram_handle"),
      tiktok_handle: record.getString("tiktok_handle"),
      x_handle: record.getString("x_handle"),
      gbp_url: record.getString("gbp_url"),
      default_hashtags: record.getString("default_hashtags"),
      default_footer: record.getString("default_footer"),
      enabled_styles: record.getString("enabled_styles"),
      default_style: record.getString("default_style"),
      enabled_fun_styles: record.getString("enabled_fun_styles"),
      custom_scenarios: record.getString("custom_scenarios"),
    },
  });
  } catch (e) {
    console.error("SESSION ERROR:", e);
    return c.json(500, { error: e.toString() });
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

  // Sliding refresh — touch last_used_at on every authenticated request so
  // an active dealer never silently expires mid-day. Best effort.
  try {
    session.set("last_used_at", new Date().toISOString());
    $app.dao().saveRecord(session);
    c.response().header().add("Set-Cookie", helpers.buildSessionCookie(token));
  } catch (_e) {
    /* ignore */
  }

  let logoUrl = record.getString("logo");
  if (logoUrl && !logoUrl.startsWith("http")) {
    logoUrl = `/api/files/dealers/${record.id}/${logoUrl}`;
  }

  return c.json(200, {
    role: role,
    dealer: {
      id: record.id,
      name: record.getString("name"),
      code: record.getString("code"),
      logo: logoUrl,
      brand_voice: record.getString("brand_voice"),
      banned_phrases: record.getString("banned_phrases"),
      oem_affiliation: record.getString("oem_affiliation"),
      requires_approval: record.getBool
        ? record.getBool("requires_approval")
        : !!record.get("requires_approval"),
      brand_color: record.getString("brand_color"),
    },
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

// isAdminDealer moved to top

// ---- Photo releases -----------------------------------------------------
routerAdd("POST", "/api/app/photo_releases", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    // multipart form expected — same shape the old direct-pb path used.
    const releases = $app.dao().findCollectionByNameOrId("photo_releases");
    if (!releases) return c.json(500, { error: "photo_releases collection missing" });

    const form = new RecordUpsertForm($app, new Record(releases));
    form.loadRequest($apis.requestInfo(c), "");
    // Force dealer field to the session's dealer; ignore any client-supplied value.
    form.data["dealer"] = dealer.id;

    form.submit();

    return c.json(200, {
      id: form.record.id,
      customer_name: form.record.getString("customer_name"),
      signed_at: form.record.getString("signed_at"),
      vin: form.record.getString("vin"),
    });
  } catch (err) {
    console.error("[/api/app/photo_releases] error", err);
    return c.json(400, { error: "Failed to save release: " + err.toString() });
  }
});

// ---- Posts (log + leaderboard + approval) ------------------------------
routerAdd("POST", "/api/app/posts", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  try {
    const body = $apis.requestInfo(c).data || {};
    const posts = $app.dao().findCollectionByNameOrId("posts");
    if (!posts) return c.json(500, { error: "posts collection missing" });

    // Validate optional salesperson_id is one of this dealership's records.
    let salespersonId = "";
    if (body.salesperson_id) {
      try {
        const sp = $app.dao().findRecordById("salespeople", body.salesperson_id.toString());
        if (sp && sp.getString("dealer") === dealer.id) {
          salespersonId = sp.id;
        }
      } catch (_e) {
        /* ignore — fall back to unattributed */
      }
    }

    const record = new Record(posts, {
      dealer: dealer.id, // force dealer from session
      salesperson_name: helpers.assertString(body.salesperson_name || "", 120),
      salesperson_id: salespersonId,
      generated_at: new Date().toISOString(),
      style: helpers.assertString(body.style || "", 60),
      tone: helpers.assertString(body.tone || "", 60),
      customer_name: helpers.assertString(body.customer_name || "", 120),
      vin: helpers.assertString(body.vin || "", 17),
      has_release: !!body.has_release,
      has_video: !!body.has_video,
      approval_status: helpers.assertEnum(body.approval_status === "pending" ? "pending" : "n_a", ["n_a", "pending"]),
    });
    $app.dao().saveRecord(record);

    return c.json(200, {
      id: record.id,
      dealer: dealer.id,
      generated_at: record.getString("generated_at"),
      approval_status: record.getString("approval_status"),
    });
  } catch (err) {
    console.error("[/api/app/posts] create error", err);
    return c.json(400, { error: "Failed to log post: " + err.toString() });
  }
});

routerAdd("GET", "/api/app/posts", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

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
        params
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
      has_release: r.getBool ? r.getBool("has_release") : !!r.get("has_release"),
      has_video: r.getBool ? r.getBool("has_video") : !!r.get("has_video"),
      approval_status: r.getString("approval_status"),
      approved_by: r.getString("approved_by"),
      approved_at: r.getString("approved_at"),
    }));

    return c.json(200, { items });
  } catch (err) {
    console.error("[/api/app/posts] list error", err);
    return c.json(500, { error: "Failed to list posts: " + err.toString() });
  }
});

routerAdd("PATCH", "/api/app/posts/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  const role = helpers.sessionRoleFromCookie(c);
  const isSuperAdmin = helpers.isAdminDealer(dealer);
  // Approval is a manager action. Allow super_admin OR dealer_admin (the latter
  // only for posts attached to their OWN dealership — enforced below).
  if (!isSuperAdmin && role !== "dealer_admin") {
    return c.json(403, {
      error: "Manager role required to set approval status",
    });
  }

  try {
    const id = c.pathParam("id");
    const body = $apis.requestInfo(c).data || {};
    const record = $app.dao().findRecordById("posts", id);

    // Tenant isolation — a dealer_admin can only act on posts that belong to
    // their own dealership. Super-admin bypasses for cross-tenant support.
    if (!isSuperAdmin && record.getString("dealer") !== dealer.id) {
      return c.json(403, {
        error: "Cross-dealer approval is not allowed",
      });
    }

    if (body.approval_status) {
      const allowed = ["n_a", "pending", "approved", "rejected"];
      helpers.assertEnum(body.approval_status, allowed);
      record.set("approval_status", body.approval_status);
    }
    if (body.approved_by !== undefined) {
      record.set("approved_by", helpers.assertString(body.approved_by || "", 120));
    }
    if (
      body.approval_status === "approved" ||
      body.approval_status === "rejected"
    ) {
      record.set("approved_at", new Date().toISOString());
    }

    $app.dao().saveRecord(record);
    return c.json(200, { id: record.id, approval_status: record.getString("approval_status") });
  } catch (err) {
    console.error("[/api/app/posts/:id] patch error", err);
    return c.json(400, { error: "Failed to update post: " + err.toString() });
  }
});

// ---- Salespeople CRUD (dealer-admin or super-admin) --------------------
// sessionRoleFromCookie moved to top

routerAdd("GET", "/api/app/salespeople", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  try {
    const query = $apis.requestInfo(c).query || {};
    const includeInactive =
      (query.include_inactive || "").toString() === "true";
    const filter = includeInactive
      ? "dealer = {:d}"
      : "dealer = {:d} && active = true";
    const records = $app
      .dao()
      .findRecordsByFilter("salespeople", filter, "name", 500, 0, {
        d: dealer.id,
      });
    return c.json(200, {
      items: records.map((r) => ({
        id: r.id,
        dealer: r.getString("dealer"),
        name: r.getString("name"),
        pin: r.getString("pin"),
        active: r.getBool ? r.getBool("active") : !!r.get("active"),
        created_at: r.getString("created_at"),
      })),
    });
  } catch (err) {
    console.error("[/api/app/salespeople] list error", err);
    return c.json(500, { error: "Failed to list salespeople" });
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

    const salespeople = $app.dao().findCollectionByNameOrId("salespeople");
    const record = new Record(salespeople, {
      dealer: dealer.id, // force from session
      name: helpers.assertString(name, 120),
      pin: helpers.assertString((body.pin || "").toString(), 12),
      active: body.active === false ? false : true,
      created_at: new Date().toISOString(),
    });
    $app.dao().saveRecord(record);
    return c.json(200, {
      id: record.id,
      name: record.getString("name"),
      pin: record.getString("pin"),
      active: true,
    });
  } catch (err) {
    console.error("[/api/app/salespeople] create error", err);
    return c.json(400, { error: "Failed to create: " + err.toString() });
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
    // Tenant isolation — can only edit your own dealership's salespeople
    if (record.getString("dealer") !== dealer.id && role !== "super_admin") {
      return c.json(403, { error: "Cross-dealer edit blocked" });
    }
    const body = $apis.requestInfo(c).data || {};
    if (typeof body.name === "string")
      record.set("name", helpers.assertString(body.name.toString(), 120));
    if (typeof body.pin === "string")
      record.set("pin", helpers.assertString(body.pin.toString(), 12));
    if (typeof body.active === "boolean") record.set("active", body.active);
    $app.dao().saveRecord(record);
    return c.json(200, { id: record.id });
  } catch (err) {
    return c.json(400, { error: "Failed to update: " + err.toString() });
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
    record.set("active", false);
    $app.dao().saveRecord(record);
    return c.json(200, { success: true });
  } catch (err) {
    return c.json(400, { error: "Failed to deactivate: " + err.toString() });
  }
});

// ---- Dealers CRUD (admin only) -----------------------------------------
routerAdd("POST", "/api/app/dealers", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (!helpers.isAdminDealer(dealer)) return c.json(403, { error: "Admin only" });

  try {
    const dealers = $app.dao().findCollectionByNameOrId("dealers");
    const form = new RecordUpsertForm($app, new Record(dealers));
    form.loadRequest($apis.requestInfo(c), "");
    form.submit();
    return c.json(200, { id: form.record.id });
  } catch (err) {
    console.error("[/api/app/dealers] create error", err);
    return c.json(400, { error: "Failed to create dealer: " + err.toString() });
  }
});

routerAdd("PATCH", "/api/app/dealers/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });

  const id = c.pathParam("id");
  const role = helpers.sessionRoleFromCookie(c);
  const isSuperAdmin = helpers.isAdminDealer(dealer);
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
    const form = new RecordUpsertForm($app, target);
    form.loadRequest($apis.requestInfo(c), "");
    // Code is immutable after creation (it's the login credential).
    form.data["code"] = target.getString("code");
    // Dealer-admin can't change admin_code on themselves (that's a super-admin
    // ladder rung — prevents a manager from rotating their own credential
    // without your knowledge).
    if (!isSuperAdmin) {
      form.data["admin_code"] = target.getString("admin_code");
    }
    form.submit();
    return c.json(200, { id: target.id });
  } catch (err) {
    console.error("[/api/app/dealers/:id] patch error", err);
    return c.json(400, { error: "Failed to update dealer: " + err.toString() });
  }
});

routerAdd("DELETE", "/api/app/dealers/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (!helpers.isAdminDealer(dealer)) return c.json(403, { error: "Admin only" });

  try {
    const id = c.pathParam("id");
    if (id === dealer.id) {
      return c.json(400, { error: "Refusing to delete your own dealer record" });
    }
    const target = $app.dao().findRecordById("dealers", id);
    $app.dao().deleteRecord(target);
    return c.json(200, { success: true });
  } catch (err) {
    console.error("[/api/app/dealers/:id] delete error", err);
    return c.json(400, { error: "Failed to delete dealer: " + err.toString() });
  }
});

// ---- Dealers list (admin only) -----------------------------------------
routerAdd("GET", "/api/app/dealers", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) return c.json(401, { error: "No active session" });
  if (!helpers.isAdminDealer(dealer)) {
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
