/**
 * This hook file creates a generic proxy for the Google Gemini API.
 * It allows the frontend to send requests to a path like `/api/proxy/v1beta/models/gemini-pro:generateContent`,
 * and the hook will forward the request to the Google API with the secret API key.
 */
const proxyHandler = (c) => {
  const GOOGLE_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const apiKey = $os.getenv("GEMINI_API_KEY");

  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not set.");
    return c.json(500, { error: "API key is not configured on the server." });
  }

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
        error: "Missing Gemini API path.",
        debug: "Path extraction failed",
      });
    }

    // Build target URL, preserve incoming query params, and append API key.
    // Build target URL, preserve incoming query params, and append API key.
    // Note: PocketBase JS environment might not have URL class, so we use string manipulation.
    const baseUrl = GOOGLE_API_URL_BASE.endsWith("/")
      ? GOOGLE_API_URL_BASE
      : GOOGLE_API_URL_BASE + "/";
    const cleanPath = path.startsWith("/") ? path.substring(1) : path;
    let targetUrl = baseUrl + cleanPath;

    const queryParts = [];
    const query = requestInfo.query || {};
    Object.entries(query).forEach(([key, value]) => {
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
    queryParts.push(`key=${apiKey}`);

    const separator = targetUrl.includes("?") ? "&" : "?";
    targetUrl += separator + queryParts.join("&");

    console.log(
      `[Proxy] ${requestInfo.method} ${targetUrl.replace(apiKey, "HIDDEN")}`
    );

    const res = $http.send({
      url: targetUrl,
      method: requestInfo.method,
      body:
        requestInfo.method === "POST" && requestInfo.data
          ? JSON.stringify(requestInfo.data)
          : "",
      headers: { "Content-Type": "application/json" },
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
    console.error(`[Proxy] Error:`, err);
    return c.json(500, {
      error: `Failed to proxy request to Gemini API.`,
      details: err.toString(),
      path: path,
      apiKeyConfigured: !!apiKey,
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
