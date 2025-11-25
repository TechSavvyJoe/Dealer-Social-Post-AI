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

  // Fallback: manual extraction if wildcard param fails
  if (!path) {
    const fullPath = c.request().url.path;
    if (fullPath.startsWith("/api/proxy/")) {
      path = fullPath.substring("/api/proxy/".length);
    }
  }

  console.log(
    `[Proxy] Request: ${c.request().method} ${
      c.request().url.path
    }, Path param: ${c.pathParams.path}, Extracted: ${path}`
  );

  if (!path) {
    return c.json(400, { error: "Missing Gemini API path." });
  }

  const requestInfo = $apis.requestInfo(c);
  const targetUrl = `${GOOGLE_API_URL_BASE}${path}?key=${apiKey}`;
  console.log(`[Proxy] Forwarding to: ${targetUrl.replace(apiKey, "HIDDEN")}`);

  try {
    const res = $http.send({
      url: targetUrl,
      method: requestInfo.method,
      body:
        requestInfo.method === "POST" ? JSON.stringify(requestInfo.data) : "",
      headers: { "Content-Type": "application/json" },
      timeout: 300, // 5 minutes
    });

    console.log(`[Proxy] Upstream status: ${res.statusCode}`);

    // Skip header forwarding for now to avoid API issues
    return c.json(res.statusCode, res.json || { raw: res.raw });
  } catch (err) {
    console.error(`[Proxy] Error:`, err);
    return c.json(500, {
      error: `Failed to proxy ${requestInfo.method} request to Gemini API.`,
      details: err.toString(),
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
