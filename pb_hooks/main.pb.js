/**
 * This hook file creates a generic proxy for the Google Gemini API.
 * It allows the frontend to send requests to a path like `/api/proxy/v1beta/models/gemini-pro:generateContent`,
 * and the hook will forward the request to the Google API with the secret API key.
 */
routerAdd("GET,POST", "/api/proxy/:path(*)", (c) => {
  const GOOGLE_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const apiKey = $os.getenv("GEMINI_API_KEY");

  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not set.");
    return c.json(500, { error: "API key is not configured on the server." });
  }

  const path = c.pathParams.path;
  if (!path) {
    return c.json(400, { error: "Missing Gemini API path." });
  }

  const requestInfo = $apis.requestInfo(c);
  const targetUrl = `${GOOGLE_API_URL_BASE}${path}?key=${apiKey}`;

  try {
    const res = $http.send({
      url: targetUrl,
      method: requestInfo.method,
      body:
        requestInfo.method === "POST" ? JSON.stringify(requestInfo.data) : "",
      headers: { "Content-Type": "application/json" },
      timeout: 300, // 5 minutes for complex/long-running operations
    });

    Object.entries(res.headers).forEach(([key, value]) => {
      if (
        ["content-encoding", "transfer-encoding", "content-length"].includes(
          key.toLowerCase()
        )
      )
        return;
      c.res.header().set(key, value);
    });
    c.res.setStatusCode(res.statusCode);
    return c.res.send(res.raw);
  } catch (err) {
    console.error(
      `Error proxying ${requestInfo.method} request to Gemini:`,
      err
    );
    return c.json(500, {
      error: `Failed to proxy ${requestInfo.method} request to Gemini API.`,
      details: err.toString(),
    });
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

routerAdd("GET", "/api/debug/models", (c) => {
  try {
    const apiKey = $os.getenv("GEMINI_API_KEY");
    if (!apiKey) return c.json(500, { error: "No API key" });

    const versions = ["v1beta", "v1alpha"];
    const results = {};

    for (const v of versions) {
      try {
        const res = $http.send({
          url: `https://generativelanguage.googleapis.com/${v}/models?key=${apiKey}`,
          method: "GET",
          timeout: 10,
        });
        // Try to parse JSON, fallback to raw string
        try {
          results[v] = res.json;
        } catch (e) {
          results[v] = { raw: res.raw, parseError: e.toString() };
        }
      } catch (e) {
        results[v] = { requestError: e.toString() };
      }
    }

    return c.json(200, results);
  } catch (err) {
    return c.json(500, { error: "Handler failed", details: err.toString() });
  }
});

routerAdd("GET", "/api/debug/generate", (c) => {
  try {
    const apiKey = $os.getenv("GEMINI_API_KEY");
    const model = c.queryParam("model") || "gemini-1.5-pro";
    const version = c.queryParam("version") || "v1beta";

    const res = $http.send({
      url: `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hello" }] }],
      }),
      headers: { "Content-Type": "application/json" },
      timeout: 10,
    });

    // Handle response body safely
    let body = res.raw;
    try {
      body = res.json;
    } catch (e) {}

    return c.json(res.statusCode, {
      statusCode: res.statusCode,
      body: body,
      headers: res.headers,
    });
  } catch (err) {
    return c.json(500, { error: err.toString() });
  }
});
