/**
 * This hook file creates a generic proxy for the Google Gemini API and Vertex AI.
 * It allows the frontend to send requests to paths like:
 * - `/api/proxy/v1beta/models/gemini-pro:generateContent` (Gemini API)
 * - `/api/proxy/vertex/v1beta1/projects/{PROJECT_ID}/locations/{LOCATION}/...` (Vertex AI)
 * and the hook will forward the request to the appropriate Google API with the secret API key.
 */
const proxyHandler = (c) => {
  const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const VERTEX_AI_URL_BASE = "https://{LOCATION}-aiplatform.googleapis.com/";

  const geminiApiKey = $os.getenv("GEMINI_API_KEY");
  const vertexApiKey = $os.getenv("VERTEX_API_KEY");

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
    let apiKey, baseUrl;

    if (isVertexAI) {
      // Vertex AI endpoint
      if (!vertexApiKey) {
        console.error("VERTEX_API_KEY environment variable is not set.");
        return c.json(500, {
          error: "Vertex AI API key is not configured on the server.",
        });
      }
      apiKey = vertexApiKey;

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
      // Gemini API endpoint
      if (!geminiApiKey) {
        console.error("GEMINI_API_KEY environment variable is not set.");
        return c.json(500, {
          error: "Gemini API key is not configured on the server.",
        });
      }
      apiKey = geminiApiKey;
      baseUrl = GEMINI_API_URL_BASE;
    }

    // Build target URL, preserve incoming query params, and append API key.
    // Note: PocketBase JS environment might not have URL class, so we use string manipulation.
    const finalBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const cleanPath = path.startsWith("/") ? path.substring(1) : path;
    let targetUrl = finalBaseUrl + cleanPath;

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

    const apiType = isVertexAI ? "Vertex AI" : "Gemini API";
    console.log(
      `[Proxy ${apiType}] ${requestInfo.method} ${targetUrl.replace(
        apiKey,
        "HIDDEN"
      )}`
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
    const apiType = path && path.startsWith("vertex/") ? "Vertex AI" : "Gemini API";
    console.error(`[Proxy ${apiType}] Error:`, err);
    return c.json(500, {
      error: `Failed to proxy request to ${apiType}.`,
      details: err.toString(),
      path: path,
      geminiApiKeyConfigured: !!geminiApiKey,
      vertexApiKeyConfigured: !!vertexApiKey,
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
