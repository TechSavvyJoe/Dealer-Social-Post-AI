/**
 * This hook file creates a generic proxy for the Google Gemini API.
 * It allows the frontend to send requests to a path like `/api/proxy/v1beta/models/gemini-pro:generateContent`,
 * and the hook will forward the request to the Google API with the secret API key.
 */
routerAdd("GET,POST", "/api/proxy/:path(*)", (c) => {
    const GOOGLE_API_URL_BASE = "https://generativelanguage.googleapis.com/";
    const apiKey = os.getenv("GEMINI_API_KEY");

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
            body: requestInfo.method === "POST" ? JSON.stringify(requestInfo.data) : "",
            headers: { "Content-Type": "application/json" },
            timeout: 300, // 5 minutes for complex/long-running operations
        });

        Object.entries(res.headers).forEach(([key, value]) => {
            if (['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) return;
            c.res.header().set(key, value);
        });
        c.res.setStatusCode(res.statusCode);
        return c.res.send(res.raw);

    } catch (err) {
        console.error(`Error proxying ${requestInfo.method} request to Gemini:`, err);
        return c.json(500, { error: `Failed to proxy ${requestInfo.method} request to Gemini API.`, details: err.toString() });
    }
});
