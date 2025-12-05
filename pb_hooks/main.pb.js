/**
 * This hook file creates a generic proxy for the Google Gemini API and Vertex AI.
 * It allows the frontend to send requests to paths like:
 * - `/api/proxy/v1beta/models/gemini-pro:generateContent` (Gemini API)
 * - `/api/proxy/vertex/v1beta1/projects/{PROJECT_ID}/locations/{LOCATION}/...` (Vertex AI)
 * and the hook will forward the request to the appropriate Google API with the secret API key.
 */
// Global token cache
let cachedAccessToken = null;
let tokenExpiry = 0;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per window
var rateLimitStore = new Map(); // token -> { count, windowStart }

// Helper functions are defined inside proxyHandler for PocketBase JSVM compatibility

const proxyHandler = (c) => {
  const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const VERTEX_AI_URL_BASE = "https://{LOCATION}-aiplatform.googleapis.com/";

  const geminiApiKey = $os.getenv("GEMINI_API_KEY");
  // Vertex API Key no longer used, we use Service Account

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

  let path = c.pathParams.path;

  try {
    const requestInfo = $apis.requestInfo(c);
    const headers = requestInfo.headers || {};

    // Require shared token for all proxy calls to avoid unauthenticated use
    // PocketBase normalizes headers to lowercase with underscores, also try c.request().header.get()
    const incomingToken = (
      headers["x_proxy_token"] ||
      headers["x-proxy-token"] ||
      c.request().header.get("X-Proxy-Token") ||
      c.request().header.get("x-proxy-token") ||
      ""
    )
      .toString()
      .trim();

    if (!proxyAccessToken || incomingToken !== proxyAccessToken) {
      return c.json(401, {
        error: "Unauthorized proxy request",
      });
    }

    // Rate limiting check
    const now = Date.now();
    const rateLimitKey = incomingToken.substring(0, 16); // Use partial token as key
    let rateData = rateLimitStore.get(rateLimitKey);

    if (!rateData || now - rateData.windowStart > RATE_LIMIT_WINDOW_MS) {
      // Start new window
      rateData = { count: 1, windowStart: now };
      rateLimitStore.set(rateLimitKey, rateData);
    } else {
      rateData.count++;
      if (rateData.count > RATE_LIMIT_MAX_REQUESTS) {
        console.log(`[Proxy] Rate limit exceeded for token ${rateLimitKey}...`);
        return c.json(429, {
          error: "Rate limit exceeded. Please slow down your requests.",
          retryAfter: Math.ceil(
            (rateData.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000
          ),
        });
      }
    }

    // Fallback: manual extraction if wildcard param fails
    if (!path) {
      const fullPath = c.request().url.path;
      if (fullPath.startsWith("/api/proxy/")) {
        path = fullPath.substring("/api/proxy/".length);
      }
    }

    if (!path) {
      return c.json(400, {
        error: "Missing API path.",
        debug: "Path extraction failed",
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
      // Vertex AI endpoint -> Use Service Account Auth
      try {
        // Helper function to get token (defined inside to ensure scope availability)
        // Note: Caching is disabled for now to avoid scope issues. Token is fetched per request.
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

          // Sign JWT
          const tempDir = `${__hooks}/../temp`;
          const tempKey = `${tempDir}/temp_key_${now}.pem`;
          const tempToken = `${tempDir}/temp_token_${now}.txt`;
          const tempSig = `${tempDir}/temp_sig_${now}.bin`;

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
        requestInfo.method === "POST" && requestInfo.data
          ? JSON.stringify(requestInfo.data)
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

// Register routes separately
routerAdd("GET", "/api/proxy/:path(*)", proxyHandler);
routerAdd("POST", "/api/proxy/:path(*)", proxyHandler);

routerAdd("GET", "/api/proxy-image", (c) => {
  const url = c.queryParam("url");
  const requestInfo = $apis.requestInfo(c);
  const proxyAccessToken = $os.getenv("PROXY_ACCESS_TOKEN") || "";
  const incomingToken =
    (requestInfo.headers && requestInfo.headers["x-proxy-token"]) ||
    (requestInfo.headers && requestInfo.headers["X-Proxy-Token"]);

  if (!proxyAccessToken || incomingToken !== proxyAccessToken) {
    return c.json(401, { error: "Unauthorized proxy request" });
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

routerAdd("POST", "/api/telemetry", (c) => {
  try {
    // Read body as text first to avoid JSON parsing errors on empty body
    const rawBody = $apis.requestInfo(c).data;
    // Log to server console
    console.log("[Telemetry]", JSON.stringify(rawBody));
    return c.json(200, { success: true });
  } catch (err) {
    console.error("Telemetry error:", err);
    // Return 200 even on error to prevent client noise, but log the error
    return c.json(200, { success: false, error: err.toString() });
  }
});
