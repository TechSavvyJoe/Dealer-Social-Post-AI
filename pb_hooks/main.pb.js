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

// getVertexAccessToken moved inside proxyHandler for scope safety

const proxyHandler = (c) => {
  const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const VERTEX_AI_URL_BASE = "https://{LOCATION}-aiplatform.googleapis.com/";

  const geminiApiKey = $os.getenv("GEMINI_API_KEY");
  // Vertex API Key no longer used, we use Service Account

  let path = c.pathParams.path;

  try {
    const requestInfo = $apis.requestInfo(c);

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

          const keyPath = `${__hooks}/vertex_key.json`;
          // Read key file
          const rawKey = $os.readFile(keyPath);
          const keyStr = String.fromCharCode.apply(null, rawKey);
          const serviceAccount = JSON.parse(keyStr);

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

          try {
            const encodedHeader = base64UrlEncode(JSON.stringify(header));
            const encodedClaims = base64UrlEncode(JSON.stringify(claims));
            const unsignedToken = `${encodedHeader}.${encodedClaims}`;

            let keyContent = serviceAccount.private_key;
            if (!keyContent.endsWith("\n")) keyContent += "\n";
            $os.writeFile(tempKey, keyContent);
            $os.writeFile(tempToken, unsignedToken);

            // Debug: check file size
            const tokenStat = $os.cmd("ls", "-l", tempToken).output();
            // Ensure permissions are readable using /bin/chmod
            try {
              $os.cmd("/bin/chmod", "644", tempKey).output();
              $os.cmd("/bin/chmod", "644", tempToken).output();
            } catch (e) {
              // Ignore chmod errors
            }

            // Detect OpenSSL path (Docker/Linux vs macOS)
            const opensslBin = $os.cmd("which", "openssl").run()
              ? "openssl"
              : "/opt/homebrew/bin/openssl";

            // Step 1: Sign
            const signCmd = $os.cmd(
              "sh",
              "-c",
              `${opensslBin} dgst -sha256 -sign "${tempKey}" -out "${tempSig}" "${tempToken}" 2>&1 || true`
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
              "sh",
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
            return tokenData.access_token;
          } catch (err) {
            console.log("[Auth] Signing failed:", err);
            // Try to read stderr from the command if possible?
            // Unfortunately err object might not have it directly if it's a Go error.
            // But we can try to log more context.
            throw err;
          } finally {
            $os.remove(tempKey);
            $os.remove(tempToken);
            $os.remove(tempSig);
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
