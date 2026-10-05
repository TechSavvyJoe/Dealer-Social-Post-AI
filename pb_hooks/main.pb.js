/**
 * This hook file creates an allowlisted proxy for the Google Gemini API.
 * It allows the frontend to send requests to paths like:
 * - `/api/proxy/v1beta/models/gemini-3.6-flash:generateContent` (Gemini API)
 * and forwards only configured model/method pairs with the server-side key.
 */
// ---------------------------------------------------------------------------
// Administrator account bootstrap. The system admin signs in with a normal
// username/password held in the locked admin_accounts auth collection. The
// initial (and rotated) credential comes from deployment secrets:
// ADMIN_LOGIN_USERNAME + ADMIN_LOGIN_PASSWORD. Password changes rotate the
// account token key, which invalidates outstanding administrator sessions.
// ---------------------------------------------------------------------------
onAfterBootstrap(() => {
  try {
    const helpers = require(__hooks + "/helpers.js");
    helpers.ensureAdminAccountProvisioned({ syncPassword: true });
  } catch (err) {
    console.error("[bootstrap] Administrator account bootstrap failed:", err);
  }
  try {
    const helpers = require(__hooks + "/helpers.js");
    // Converts any plaintext access codes to peppered hashes and rewrites the
    // affected sessions' fingerprints in the same transaction, so the storage
    // change never logs anyone out. Idempotent; no-op once converted.
    const summary = helpers.backfillSalespersonPinHashes();
    if (summary.converted || summary.failed || summary.skipped) {
      console.log("[bootstrap] access-code hash backfill: " + JSON.stringify(summary));
    }
  } catch (err) {
    console.error("[bootstrap] Access-code hash backfill failed:", err);
  }
});

// Rate limiting - using simple object instead of Map for PocketBase JSVM compatibility
const proxyHandler = (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  // Rate limit configuration - defined inside handler for scope safety
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
  const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per dealer per minute

  let GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/";
  const providerTestBase = ($os.getenv("GEMINI_API_URL_BASE") || "").trim();
  const providerTestMode =
    ($os.getenv("ALLOW_TEST_PROVIDER_ORIGIN") || "").trim().toLowerCase() === "true";
  if (
    providerTestMode &&
    /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal):\d{2,5}\/$/.test(
      providerTestBase,
    )
  ) {
    // Deterministic CI-only upstream boundary; production cannot redirect
    // provider traffic without both the explicit test flag and loopback host.
    GEMINI_API_URL_BASE = providerTestBase;
  }
  const geminiApiKey = $os.getenv("GEMINI_API_KEY");

  let path = null;
  let generationAudit = null;
  let generationAuditRecorded = false;
  // Billable facts for the usage ledger. Image size and video seconds come
  // from the sanitized upstream body (never the raw client body); latency is
  // the timed provider call. Token counts and finishReason are read from the
  // provider response inside recordProxyGenerationEvent.
  const generationUsage = { latencyMs: 0, imageSize: "", videoSeconds: 0 };

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
    const requestInfo = $apis.requestInfo(c);

    // Every billable provider request requires the same continuously validated
    // browser session as the application routes. Public health has its own
    // non-billable endpoint; a long-lived shared proxy token would bypass role,
    // expiry, person, tenant, and credential-rotation checks.
    const dealer = helpers.dealerFromSession(c);
    if (!dealer) {
      helpers.logCoalescedAuthEvent(
        "proxy_unauthorized",
        {
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail: "no authoritative session",
        },
        15 * 60,
        30,
      );
      return c.json(401, { error: "Unauthorized proxy request" });
    }
    const rateLimitKey = "dealer:" + dealer.id;

    // Per-dealer sliding window. 60 req/min absorbs a
    // legitimate burst of poll requests for long-running video generation
    // while still capping a runaway script.
    const limit = helpers.checkProxyRateLimit(
      rateLimitKey,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS,
    );
    if (!limit.ok) {
      helpers.logCoalescedAuthEvent(
        "proxy_rate_limited",
        {
          dealerId: dealer ? dealer.id : "",
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail: "key=" + rateLimitKey + " count=" + limit.count,
        },
        5 * 60,
        60,
      );
      const retryAfter = Math.max(1, Math.ceil((limit.retryAfterMs || 60000) / 1000));
      c.response().header().set("Retry-After", String(retryAfter));
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
    if (dealer && (requestInfo.method || "").toString().toUpperCase() === "POST") {
      generationAudit = {
        dealer: dealer,
        requestInfo: requestInfo,
        path: authorizedProxyPath,
      };
    }
    const operationStartProvider = policies.providerOperationStartProvider(
      authorizedProxyPath,
      requestInfo.method,
    );
    const requestedProviderResource = policies.providerResourceRequest(
      authorizedProxyPath,
      requestInfo.method,
    );

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
      // A stale installed client announces the policy version it was built
      // against. Answer it before body validation with a distinct status so
      // the app can prompt for an update instead of blaming the inputs.
      // Requests without the header keep the legacy best-effort handling.
      const policyVersionCheck = helpers.proxyPolicyVersionMismatch(
        requestInfo,
        policies,
      );
      if (policyVersionCheck.mismatch) {
        return c.json(409, {
          error: "POLICY_VERSION_MISMATCH",
          code: "POLICY_VERSION_MISMATCH",
          currentVersion: policyVersionCheck.currentVersion,
        });
      }
      const proxyHeaders = requestInfo.headers || {};
      const requestedGenerationTask = String(
        proxyHeaders["x-generation-task"] ||
          proxyHeaders["x_generation_task"] ||
          proxyHeaders["X-Generation-Task"] ||
          "",
      ).trim();
      const upstreamRequest = policies.buildGeminiProxyRequest(
        path,
        requestInfo.data,
        requestedGenerationTask,
      );
      if (!upstreamRequest) {
        return c.json(400, {
          error: "Invalid or unsupported generation request",
        });
      }
      sanitizedProxyBody = JSON.stringify(upstreamRequest);
      try {
        const imageConfig =
          upstreamRequest.generationConfig &&
          upstreamRequest.generationConfig.imageConfig;
        if (imageConfig && imageConfig.imageSize) {
          generationUsage.imageSize = String(imageConfig.imageSize);
        }
        const videoParameters = upstreamRequest.parameters;
        if (videoParameters && videoParameters.durationSeconds) {
          generationUsage.videoSeconds = Number(videoParameters.durationSeconds) || 0;
        }
      } catch (_usageErr) {
        /* accounting never blocks a validated request */
      }
    }

    const costPolicy = policies.proxyCostPolicy(path);
    if (costPolicy) {
      const costLimit = helpers.checkProxyRateLimit(
        rateLimitKey + ":" + costPolicy.bucket,
        costPolicy.maxRequests,
        costPolicy.windowMs,
      );
      if (!costLimit.ok) {
        helpers.logCoalescedAuthEvent(
          "proxy_rate_limited",
          {
            dealerId: dealer ? dealer.id : "",
            ip: helpers.clientIP(c),
            userAgent: helpers.userAgent(c),
            detail:
              "generation_bucket=" + costPolicy.bucket + " count=" + costLimit.count,
          },
          5 * 60,
          60,
        );
        const retryAfter = Math.max(
          1,
          Math.ceil((costLimit.retryAfterMs || costPolicy.windowMs) / 1000),
        );
        c.response().header().set("Retry-After", String(retryAfter));
        return c.json(429, {
          error: "Generation rate limit exceeded",
          retry_after_seconds: retryAfter,
        });
      }
    }

    // requestPolicies allowlists only Gemini API paths (vertex/* is denied
    // before this handler), so the proxy speaks exactly one upstream dialect.
    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY environment variable is not set.");
      return c.json(500, {
        error: "Gemini API key is not configured on the server.",
      });
    }
    const baseUrl = GEMINI_API_URL_BASE;
    // Keep provider credentials out of URLs, access logs, and intermediary
    // query-string telemetry. Google's Gemini API supports this header on
    // every route used here.
    const authHeader = { "x-goog-api-key": geminiApiKey };

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

    const safeLogUrl = targetUrl
      .replace(/key=[^&]+/, "key=HIDDEN")
      .replace(/(\/operations\/)[^?]+/, "$1[redacted]")
      .replace(/(\/files\/)[^?]+/, "$1[redacted]");
    console.log(`[Proxy Gemini API] ${requestInfo.method} ${safeLogUrl}`);

    // Always pin binary file downloads to alt=media so Google returns bytes,
    // not a JSON metadata envelope that browsers cannot play.
    const isFileDownloadPath =
      cleanPath.indexOf("v1beta/files/") === 0 && cleanPath.indexOf(":download") !== -1;
    if (
      isFileDownloadPath &&
      (requestInfo.method || "").toString().toUpperCase() === "GET" &&
      targetUrl.indexOf("alt=") === -1
    ) {
      targetUrl += (targetUrl.indexOf("?") === -1 ? "?" : "&") + "alt=media";
    }

    // GET downloads must not send a JSON content-type or body — that can make
    // some upstreams return an error JSON body which then "plays" as a broken
    // video (infinite spinner on the play button).
    const isGet = (requestInfo.method || "").toString().toUpperCase() === "GET";
    const upstreamHeaders = isGet
      ? { ...authHeader }
      : { "Content-Type": "application/json", ...authHeader };

    const globalProviderSlot = helpers.acquireProxyConcurrency("provider:global", 12);
    if (!globalProviderSlot.ok) {
      c.response().header().set("Retry-After", "1");
      return c.json(503, { error: "Provider capacity is temporarily busy" });
    }
    const dealerProviderSlot = helpers.acquireProxyConcurrency(
      "provider:dealer:" + dealer.id,
      4,
    );
    if (!dealerProviderSlot.ok) {
      globalProviderSlot.release();
      c.response().header().set("Retry-After", "1");
      return c.json(429, { error: "Too many concurrent provider requests" });
    }

    const upstreamStartedAt = Date.now();
    const res = (function () {
      try {
        return $http.send({
          url: targetUrl,
          method: requestInfo.method,
          body: isGet ? "" : sanitizedProxyBody,
          headers: upstreamHeaders,
          timeout: 300, // PocketBase 0.22 uses seconds; allow 5 minutes for Veo.
        });
      } finally {
        generationUsage.latencyMs = Math.max(0, Date.now() - upstreamStartedAt);
        dealerProviderSlot.release();
        globalProviderSlot.release();
      }
    })();

    const declaredResponseBytes = helpers.upstreamContentLength(res);
    const maximumResponseBytes = isFileDownloadPath
      ? 100 * 1024 * 1024
      : 30 * 1024 * 1024;
    if (
      declaredResponseBytes !== null &&
      declaredResponseBytes > maximumResponseBytes
    ) {
      return c.json(413, { error: "Provider response is too large" });
    }

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
          c.response().header().set("Content-Type", String(value));
        }
      });
    }

    const normalizedUpstreamContentType = upstreamContentType.toLowerCase();
    const isSuccessfulFileDownload =
      isFileDownloadPath && res.statusCode >= 200 && res.statusCode < 300;
    if (
      isSuccessfulFileDownload &&
      (normalizedUpstreamContentType.indexOf("application/json") === 0 ||
        normalizedUpstreamContentType.indexOf("text/") === 0)
    ) {
      return c.json(502, {
        error: "Video provider returned metadata instead of playable media",
      });
    }
    // Google has returned video bytes as video/mp4, application/octet-stream,
    // and occasionally without Content-Type. The allowlisted :download route
    // plus a successful status is the authoritative binary boundary; requiring
    // one exact upstream header corrupts otherwise valid MP4s in the JSON path.
    const isVideoDownload = isSuccessfulFileDownload;
    if (isVideoDownload) {
      const binaryBody = res.raw || res.body;
      const maxVideoBytes = 100 * 1024 * 1024;
      if (!binaryBody || binaryBody.length === 0) {
        return c.json(502, { error: "Video download returned no data" });
      }
      if (binaryBody.length > maxVideoBytes) {
        return c.json(413, { error: "Generated video exceeds 100 MB" });
      }
      c.response().header().set("Cache-Control", "private, no-store");
      c.response().header().set("X-Content-Type-Options", "nosniff");
      return c.blob(res.statusCode, "video/mp4", binaryBody);
    }

    const body = res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");

    let jsonBody = null;
    try {
      jsonBody = res.json && typeof res.json === "object" ? res.json : JSON.parse(body);
    } catch (_e) {
      if (!isGet) {
        helpers.recordProxyGenerationEvent(
          c,
          dealer,
          requestInfo,
          authorizedProxyPath,
          res.statusCode,
          "gemini",
          "",
          null,
          generationUsage,
        );
        generationAuditRecorded = true;
      }
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
        helpers.recordProxyGenerationEvent(
          c,
          dealer,
          requestInfo,
          authorizedProxyPath,
          502,
          "gemini",
          "",
          jsonBody,
          generationUsage,
        );
        generationAuditRecorded = true;
        return c.json(502, { error: "Invalid provider operation response" });
      }

      try {
        if (discoveredResources.length) {
          helpers.claimProviderResources(dealer.id, discoveredResources);
        }
      } catch (_e) {
        console.error("[Proxy] Provider resource ownership save failed");
        helpers.recordProxyGenerationEvent(
          c,
          dealer,
          requestInfo,
          authorizedProxyPath,
          502,
          "gemini",
          "",
          jsonBody,
          generationUsage,
        );
        generationAuditRecorded = true;
        return c.json(502, { error: "Could not secure provider resource" });
      }
    }

    if (!isGet) {
      helpers.recordProxyGenerationEvent(
        c,
        dealer,
        requestInfo,
        authorizedProxyPath,
        res.statusCode,
        "gemini",
        "",
        jsonBody,
        generationUsage,
      );
      generationAuditRecorded = true;
    }

    return c.json(res.statusCode, jsonBody);
  } catch (err) {
    if (generationAudit && !generationAuditRecorded) {
      helpers.recordProxyGenerationEvent(
        c,
        generationAudit.dealer,
        generationAudit.requestInfo,
        generationAudit.path,
        0,
        "gemini",
        "",
        null,
        generationUsage,
      );
    }
    console.error(
      "[Proxy Gemini API] Error:",
      helpers.safeProviderTransportDiagnostic(err),
    );
    return c.json(500, {
      error: "Gemini API request failed",
    });
  }
};

// IMPORTANT: register the more specific cross-vendor proxy routes BEFORE
// the wildcard so the dedicated handlers win. PocketBase's router is
// first-match-wins, so registration order matters.

// ----------------------------------------------------------------------------
// OpenAI image-generation fallback proxy. Used by services/openaiAdapter.ts
// when ALL Gemini image models in the fallback chain exhaust. Requires
// OPENAI_API_KEY in env. The same authoritative browser session gate applies.
// ----------------------------------------------------------------------------
routerAdd("POST", "/api/proxy/openai/v1/images/generations", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const openaiKey = ($os.getenv("OPENAI_API_KEY") || "").trim();
  const enabled =
    ($os.getenv("ENABLE_OPENAI_FALLBACK") || "").trim().toLowerCase() === "true";
  // Session cookie required (same model as primary Gemini proxy).
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    helpers.logCoalescedAuthEvent(
      "proxy_unauthorized",
      {
        ip: helpers.clientIP(c),
        userAgent: helpers.userAgent(c),
        detail: "openai proxy",
      },
      15 * 60,
      30,
    );
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  if (!enabled || !openaiKey) {
    return c.json(503, { error: "OpenAI image fallback is not enabled" });
  }
  const limit = helpers.checkProxyRateLimit("openai:" + dealer.id, 5, 60 * 1000);
  if (!limit.ok) {
    c.response().header().set("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  const upstreamRequest = policies.buildOpenAIImageRequest(requestInfo.data);
  if (!upstreamRequest) {
    return c.json(400, { error: "Invalid OpenAI image request" });
  }
  const globalProviderSlot = helpers.acquireProxyConcurrency("openai:global", 8);
  if (!globalProviderSlot.ok) {
    c.response().header().set("Retry-After", "1");
    return c.json(503, { error: "Provider capacity is temporarily busy" });
  }
  const dealerProviderSlot = helpers.acquireProxyConcurrency(
    "openai:dealer:" + dealer.id,
    2,
  );
  if (!dealerProviderSlot.ok) {
    globalProviderSlot.release();
    c.response().header().set("Retry-After", "1");
    return c.json(429, { error: "Too many concurrent image requests" });
  }
  try {
    let res;
    try {
      res = $http.send({
        url: "https://api.openai.com/v1/images/generations",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify(upstreamRequest),
        timeout: 120,
      });
    } finally {
      dealerProviderSlot.release();
      globalProviderSlot.release();
    }
    const declaredResponseBytes = helpers.upstreamContentLength(res);
    if (declaredResponseBytes !== null && declaredResponseBytes > 30 * 1024 * 1024) {
      return c.json(413, { error: "Provider image response is too large" });
    }
    const body = res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");
    let parsedBody = null;
    try {
      parsedBody =
        res.json && typeof res.json === "object" ? res.json : JSON.parse(body);
    } catch (_e) {
      helpers.recordProxyGenerationEvent(
        c,
        dealer,
        requestInfo,
        "openai/v1/images/generations",
        res.statusCode,
        "openai",
        upstreamRequest.model,
        null,
      );
      return c.string(res.statusCode, body);
    }
    helpers.recordProxyGenerationEvent(
      c,
      dealer,
      requestInfo,
      "openai/v1/images/generations",
      res.statusCode,
      "openai",
      upstreamRequest.model,
      parsedBody,
    );
    return c.json(res.statusCode, parsedBody);
  } catch (err) {
    dealerProviderSlot.release();
    globalProviderSlot.release();
    helpers.recordProxyGenerationEvent(
      c,
      dealer,
      requestInfo,
      "openai/v1/images/generations",
      0,
      "openai",
      upstreamRequest.model,
      null,
    );
    console.error("[Proxy OpenAI] error", helpers.safeProviderTransportDiagnostic(err));
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
    ($os.getenv("ENABLE_CLAUDE_FALLBACK") || "").trim().toLowerCase() === "true";
  const dealer = helpers.dealerFromSession(c);
  if (!dealer) {
    helpers.logCoalescedAuthEvent(
      "proxy_unauthorized",
      {
        ip: helpers.clientIP(c),
        userAgent: helpers.userAgent(c),
        detail: "anthropic proxy",
      },
      15 * 60,
      30,
    );
    return c.json(401, { error: "Unauthorized proxy request" });
  }
  if (!enabled || !anthropicKey) {
    return c.json(503, { error: "Anthropic fallback is not enabled" });
  }
  const limit = helpers.checkProxyRateLimit("anthropic:" + dealer.id, 15, 60 * 1000);
  if (!limit.ok) {
    c.response().header().set("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }
  const requestInfo = $apis.requestInfo(c);
  const upstreamRequest = policies.buildAnthropicMessageRequest(requestInfo.data);
  if (!upstreamRequest) {
    return c.json(400, { error: "Invalid Anthropic message request" });
  }
  const globalProviderSlot = helpers.acquireProxyConcurrency("anthropic:global", 16);
  if (!globalProviderSlot.ok) {
    c.response().header().set("Retry-After", "1");
    return c.json(503, { error: "Provider capacity is temporarily busy" });
  }
  const dealerProviderSlot = helpers.acquireProxyConcurrency(
    "anthropic:dealer:" + dealer.id,
    4,
  );
  if (!dealerProviderSlot.ok) {
    globalProviderSlot.release();
    c.response().header().set("Retry-After", "1");
    return c.json(429, { error: "Too many concurrent caption requests" });
  }
  try {
    let res;
    try {
      res = $http.send({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(upstreamRequest),
        timeout: 120,
      });
    } finally {
      dealerProviderSlot.release();
      globalProviderSlot.release();
    }
    const declaredResponseBytes = helpers.upstreamContentLength(res);
    if (declaredResponseBytes !== null && declaredResponseBytes > 5 * 1024 * 1024) {
      return c.json(413, { error: "Provider caption response is too large" });
    }
    const body = res.body ?? res.raw ?? (res.json ? JSON.stringify(res.json) : "");
    let parsedBody = null;
    try {
      parsedBody =
        res.json && typeof res.json === "object" ? res.json : JSON.parse(body);
    } catch (_e) {
      helpers.recordProxyGenerationEvent(
        c,
        dealer,
        requestInfo,
        "anthropic/v1/messages",
        res.statusCode,
        "anthropic",
        upstreamRequest.model,
        null,
      );
      return c.string(res.statusCode, body);
    }
    helpers.recordProxyGenerationEvent(
      c,
      dealer,
      requestInfo,
      "anthropic/v1/messages",
      res.statusCode,
      "anthropic",
      upstreamRequest.model,
      parsedBody,
    );
    return c.json(res.statusCode, parsedBody);
  } catch (err) {
    dealerProviderSlot.release();
    globalProviderSlot.release();
    helpers.recordProxyGenerationEvent(
      c,
      dealer,
      requestInfo,
      "anthropic/v1/messages",
      0,
      "anthropic",
      upstreamRequest.model,
      null,
    );
    console.error(
      "[Proxy Anthropic] error",
      helpers.safeProviderTransportDiagnostic(err),
    );
    return c.json(500, {
      error: "Failed to proxy request to Anthropic",
    });
  }
});

// Register the catch-all Gemini proxy AFTER the more specific routes.
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
    c.response().header().set("Retry-After", "60");
    return c.json(429, { error: "Rate limit exceeded" });
  }

  if (!url) {
    return c.json(400, { error: "Missing url parameter" });
  }

  const configuredHosts = $os.getenv("IMAGE_PROXY_ALLOWED_HOSTS") || "";
  if (!policies.isAllowedImageProxyUrl(url, configuredHosts)) {
    return c.json(400, { error: "Image URL host is not allowed" });
  }

  const globalProviderSlot = helpers.acquireProxyConcurrency("image-proxy:global", 12);
  if (!globalProviderSlot.ok) {
    c.response().header().set("Retry-After", "1");
    return c.json(503, { error: "Image proxy capacity is temporarily busy" });
  }
  const dealerProviderSlot = helpers.acquireProxyConcurrency(
    "image-proxy:dealer:" + dealer.id,
    4,
  );
  if (!dealerProviderSlot.ok) {
    globalProviderSlot.release();
    c.response().header().set("Retry-After", "1");
    return c.json(429, { error: "Too many concurrent image requests" });
  }

  try {
    let res;
    try {
      res = $http.send({
        url: url,
        method: "GET",
        timeout: 30, // 30 seconds timeout for image fetch
      });
    } finally {
      dealerProviderSlot.release();
      globalProviderSlot.release();
    }

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
    const declaredLength = helpers.upstreamContentLength(res);
    const actualLength = res.raw ? res.raw.length : 0;
    if (
      (declaredLength !== null && declaredLength > maxBytes) ||
      actualLength > maxBytes
    ) {
      return c.json(413, { error: "Upstream image exceeds 10 MB" });
    }

    c.response().header().set("Cache-Control", "private, no-store");
    c.response().header().set("X-Content-Type-Options", "nosniff");

    return c.blob(res.statusCode, contentType, res.raw);
  } catch (err) {
    dealerProviderSlot.release();
    globalProviderSlot.release();
    console.error(
      "[proxy-image] fetch failed",
      helpers.safeProviderTransportDiagnostic(err),
    );
    return c.json(500, { error: "Image proxy request failed" });
  }
});

// (Anthropic Claude fallback proxy moved above the wildcard /api/proxy/:path
// registration so route precedence works correctly.)

// Public release probe used only to prove that the staged Vercel /api route
// injected the configured server-side credential. It reveals one boolean and
// never echoes the supplied or configured secret.
routerAdd("GET", "/api/app/proxy-readiness", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "no-store");
  const trusted = helpers.trustedVercelProxyRequest(c);
  return c.json(trusted ? 200 : 503, { ok: trusted });
});

// System-administrator configuration inventory for Settings. This endpoint reports
// only whether a connection is configured/enabled; it never echoes a secret
// and never claims a provider was tested. Live provider canaries remain an
// explicit release operation owned by the system administrator.
routerAdd("GET", "/api/app/connections", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "super_admin") {
    return c.json(403, { error: "System administrator role required" });
  }

  const configured = function (name) {
    const value = ($os.getenv(name) || "").toString().trim();
    return !!value && value !== "your-api-key-here";
  };
  const enabled = function (name) {
    return ($os.getenv(name) || "").toString().trim().toLowerCase() === "true";
  };
  const validSecret = function (name) {
    const value = ($os.getenv(name) || "").toString();
    return value.length >= 32 && value === value.trim();
  };
  const validHttpsUrl = function (name) {
    return /^https:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[^?#]*)?$/.test(
      ($os.getenv(name) || "").toString().trim().replace(/\/+$/, ""),
    );
  };
  const geminiConfigured = configured("GEMINI_API_KEY");
  const anthropicConfigured = configured("ANTHROPIC_API_KEY");
  const openaiConfigured = configured("OPENAI_API_KEY");
  const modelPolicy = policies.geminiModelPolicySnapshot();
  const configuredWebsiteDealer = ($os.getenv("CUSTOMER_HUB_DEALER_ID") || "")
    .toString()
    .trim();
  const websiteConfigured = require(
    __hooks + "/websitePublications.js",
  ).destinationConfiguration(configuredWebsiteDealer).enabled;
  const walkaroundEnabled = enabled("WALKAROUND_STUDIO_ENABLED");
  const walkaroundBucket = ($os.getenv("WALKAROUND_GCS_BUCKET") || "")
    .toString()
    .trim();
  const walkaroundConfigured =
    /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(walkaroundBucket) &&
    validHttpsUrl("WALKAROUND_UPLOAD_BROKER_URL") &&
    validSecret("WALKAROUND_UPLOAD_BROKER_TOKEN") &&
    validHttpsUrl("WALKAROUND_YOUTUBE_BROKER_URL") &&
    validSecret("WALKAROUND_YOUTUBE_BROKER_TOKEN") &&
    validSecret("WALKAROUND_WORKER_TOKEN") &&
    validSecret("WALKAROUND_WORKER_SIGNING_SECRET");

  c.response().header().set("Cache-Control", "private, no-store");
  c.response().header().set("Vary", "Cookie");
  return c.json(200, {
    scope: "configuration_only",
    providers: {
      gemini: {
        configured: geminiConfigured,
        enabled: geminiConfigured,
        verification: "not_tested",
      },
      anthropic: {
        configured: anthropicConfigured,
        enabled: anthropicConfigured && enabled("ENABLE_CLAUDE_FALLBACK"),
        verification: "not_tested",
      },
      openai: {
        configured: openaiConfigured,
        enabled: openaiConfigured && enabled("ENABLE_OPENAI_FALLBACK"),
        verification: "not_tested",
      },
    },
    automation: {
      customer_hub: {
        configured: websiteConfigured,
        enabled: websiteConfigured,
        verification: "not_tested",
      },
      walkaround: {
        configured: walkaroundConfigured,
        enabled: walkaroundEnabled && walkaroundConfigured,
        verification: "not_tested",
      },
    },
    apiContractVersion: helpers.API_CONTRACT_VERSION,
    capabilities: helpers.PROXY_CAPABILITIES,
    modelPolicyVersion: String(modelPolicy.version),
  });
});

// ----------------------------------------------------------------------------
// Health + diagnostics endpoint. Public (no session required) so uptime
// monitors can hit it. Public callers get only aggregate readiness; detailed
// configuration presence and tenant counts require a super-admin session.
// ----------------------------------------------------------------------------
routerAdd("GET", "/api/app/health", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  // The response shape depends on the validated cookie (public readiness vs.
  // privileged diagnostics), so intermediaries must never cache or merge it.
  c.response().header().set("Cache-Control", "private, no-store");
  c.response().header().set("Vary", "Cookie");
  const healthContext = helpers.sessionContext(c);
  const isAuthedAdmin = !!healthContext && healthContext.role === "super_admin";

  const checks = {
    pocketbase: false,
    gemini_key_set: false,
    // Optional S2S token — not required for browser session auth.
    proxy_token_set: false,
    anthropic_key_set: false,
    openai_key_set: false,
    admin_login_configured: false,
    turnstile_enforcement_enabled: false,
    turnstile_secret_set: false,
    turnstile_site_key_set: false,
    turnstile_hostnames_configured: false,
    trusted_proxy_configured: false,
    legacy_client_compatibility_enabled: false,
    off_box_backup_configured: false,
    off_box_restore_ready: false,
    website_integration_configured: false,
  };
  const modelPolicy = policies.geminiModelPolicySnapshot();
  const backupEnabled =
    ($os.getenv("POCKETBASE_R2_BACKUPS_ENABLED") || "").trim().toLowerCase() === "true";
  const backupVerifiedCandidate = (
    $os.getenv("POCKETBASE_BACKUP_LAST_VERIFIED_AT") || ""
  ).trim();
  const backupVerifiedMillis = Date.parse(backupVerifiedCandidate);
  const backupLastVerifiedAt = Number.isFinite(backupVerifiedMillis)
    ? new Date(backupVerifiedMillis).toISOString()
    : null;
  const releaseSha = (
    $os.getenv("RELEASE_SHA") ||
    $os.getenv("FLY_IMAGE_REF") ||
    "unknown"
  )
    .trim()
    .slice(0, 120);
  const backupVerifiedReleaseSha = (
    $os.getenv("POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA") || ""
  )
    .trim()
    .slice(0, 120);
  // A restore result is release evidence, not a permanent boolean. Seven days
  // leaves room for a stable production release while still forcing stale or
  // copied evidence out of readiness. Every deployment performs a fresh drill.
  const backupVerificationMaxAgeHours = 7 * 24;
  const backupVerificationAgeMillis = Number.isFinite(backupVerifiedMillis)
    ? Date.now() - backupVerifiedMillis
    : NaN;
  const backupTimestampIsRecent =
    Number.isFinite(backupVerificationAgeMillis) &&
    backupVerificationAgeMillis >= -5 * 60 * 1000 &&
    backupVerificationAgeMillis <= backupVerificationMaxAgeHours * 60 * 60 * 1000;
  const releaseShaIsKnown = !!releaseSha && releaseSha !== "unknown";
  const backupReleaseMatches =
    releaseShaIsKnown && backupVerifiedReleaseSha === releaseSha;
  let backupStatus = "verified";
  if (!backupEnabled) {
    backupStatus = "not_configured";
  } else if (!backupLastVerifiedAt || !backupVerifiedReleaseSha) {
    backupStatus = "verification_required";
  } else if (!releaseShaIsKnown) {
    backupStatus = "release_unknown";
  } else if (!backupReleaseMatches) {
    backupStatus = "release_mismatch";
  } else if (!backupTimestampIsRecent) {
    backupStatus = "stale";
  }
  const backupRestoreReady = backupStatus === "verified";
  const result = {
    ok: true,
    ts: new Date().toISOString(),
    version: "2.0",
    releaseSha: releaseSha,
    apiContractVersion: helpers.API_CONTRACT_VERSION,
    capabilities: helpers.PROXY_CAPABILITIES,
    modelPolicyVersion: String(modelPolicy.version),
    backup: {
      configured: backupEnabled,
      lastVerifiedAt: backupLastVerifiedAt,
      verifiedReleaseSha: backupVerifiedReleaseSha || null,
      maxAgeHours: backupVerificationMaxAgeHours,
      status: backupStatus,
    },
  };

  // Aggregate tenant counts only for authenticated super-admins.
  if (isAuthedAdmin) {
    result.checks = checks;
    result.counts = {
      dealers: 0,
      posts_24h: 0,
      photo_releases_24h: 0,
    };
    result.generation = {
      aiSuccesses24h: 0,
      basicFallbacks24h: 0,
      fallbackAttempts24h: 0,
      standardTier24h: 0,
      studioTier24h: 0,
      lastSuccessfulAt: null,
      providerAttempts24h: 0,
      providerFailures24h: 0,
      lastProviderAttemptAt: null,
    };
    result.recentErrors = {
      total24h: 0,
      topActions: [],
    };
    result.usage = {
      windowDays: 7,
      since: null,
      dealers: [],
      truncated: false,
    };
  }

  try {
    // Smoke a trivial PB query
    const dealers = $app.dao().findCollectionByNameOrId("dealers");
    checks.pocketbase = !!dealers;
    if (dealers && isAuthedAdmin) {
      try {
        const row = new DynamicModel({ total: 0 });
        $app
          .dao()
          .db()
          .newQuery(
            "SELECT COUNT(*) AS total FROM dealers WHERE COALESCE(is_system, 0) = 0",
          )
          .one(row);
        result.counts.dealers = Number(row.total) || 0;
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
      const since = helpers.databaseTimestamp(
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );
      const postSummary = new DynamicModel({
        total: 0,
        aiSuccesses: 0,
        basicFallbacks: 0,
        fallbackAttempts: 0,
        standardTier: 0,
        studioTier: 0,
        lastSuccessfulAt: "",
      });
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT COUNT(*) AS total, " +
            "COALESCE(SUM(CASE WHEN caption_source = 'ai' THEN 1 ELSE 0 END), 0) AS aiSuccesses, " +
            "COALESCE(SUM(CASE WHEN caption_source = 'basic_fallback' THEN 1 ELSE 0 END), 0) AS basicFallbacks, " +
            "COALESCE(SUM(CASE WHEN generation_fallback_count > 0 THEN generation_fallback_count ELSE 0 END), 0) AS fallbackAttempts, " +
            "COALESCE(SUM(CASE WHEN generation_tier = 'standard' THEN 1 ELSE 0 END), 0) AS standardTier, " +
            "COALESCE(SUM(CASE WHEN generation_tier = 'studio' THEN 1 ELSE 0 END), 0) AS studioTier, " +
            "COALESCE(MAX(generation_last_success_at), '') AS lastSuccessfulAt " +
            "FROM posts WHERE generated_at >= {:since}",
        )
        .bind({ since: since })
        .one(postSummary);
      result.counts.posts_24h = Number(postSummary.total) || 0;
      result.generation.aiSuccesses24h = Number(postSummary.aiSuccesses) || 0;
      result.generation.basicFallbacks24h = Number(postSummary.basicFallbacks) || 0;
      result.generation.fallbackAttempts24h = Number(postSummary.fallbackAttempts) || 0;
      result.generation.standardTier24h = Number(postSummary.standardTier) || 0;
      result.generation.studioTier24h = Number(postSummary.studioTier) || 0;
      result.generation.lastSuccessfulAt = postSummary.lastSuccessfulAt
        ? postSummary.lastSuccessfulAt.toString().replace(" ", "T")
        : null;
    } catch (_e) {
      /* posts collection may not exist yet */
    }
    try {
      const since = helpers.databaseTimestamp(
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );
      const releaseSummary = new DynamicModel({ total: 0 });
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT COUNT(*) AS total FROM photo_releases WHERE signed_at >= {:since}",
        )
        .bind({ since: since })
        .one(releaseSummary);
      result.counts.photo_releases_24h = Number(releaseSummary.total) || 0;
    } catch (_e) {
      /* photo_releases may not exist yet */
    }
    try {
      const cutoff = helpers.databaseTimestamp(
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );
      const attemptSummary = new DynamicModel({
        total: 0,
        failures: 0,
        lastAttemptAt: "",
      });
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT COUNT(*) AS total, " +
            "COALESCE(SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END), 0) AS failures, " +
            "COALESCE(MAX(occurred_at), '') AS lastAttemptAt " +
            "FROM generation_events WHERE occurred_at >= {:cutoff}",
        )
        .bind({ cutoff: cutoff })
        .one(attemptSummary);
      result.generation.providerAttempts24h = Number(attemptSummary.total) || 0;
      result.generation.providerFailures24h = Number(attemptSummary.failures) || 0;
      result.generation.lastProviderAttemptAt = attemptSummary.lastAttemptAt
        ? attemptSummary.lastAttemptAt.toString().replace(" ", "T")
        : null;
    } catch (_e) {
      /* generation_events may not exist until the forward migration */
    }
    try {
      const cutoff = helpers.databaseTimestamp(
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );
      const errorSummary = new DynamicModel({ total: 0 });
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT COUNT(*) AS total FROM client_error_events WHERE occurred_at >= {:cutoff}",
        )
        .bind({ cutoff: cutoff })
        .one(errorSummary);
      const topActions = arrayOf(new DynamicModel({ name: "", count: 0 }));
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT COALESCE(NULLIF(name, ''), 'unknown') AS name, COUNT(*) AS count " +
            "FROM client_error_events WHERE occurred_at >= {:cutoff} " +
            "GROUP BY COALESCE(NULLIF(name, ''), 'unknown') " +
            "ORDER BY count DESC, name ASC LIMIT 5",
        )
        .bind({ cutoff: cutoff })
        .all(topActions);
      result.recentErrors.total24h = Number(errorSummary.total) || 0;
      result.recentErrors.topActions = topActions.map(function (row) {
        return {
          name: (row.name || "unknown").toString(),
          count: Number(row.count) || 0,
        };
      });
    } catch (_e) {
      /* client_error_events may not exist until the forward migration */
    }
    try {
      // Per-dealer 7-day usage (events, tokens, image sizes, video seconds,
      // p50/p95 upstream latency). Bounded queries; accounting must never
      // turn a healthy deployment into a failed health probe.
      result.usage = helpers.generationUsageSummary(7);
    } catch (_e) {
      /* usage columns may not exist until the forward migration */
    }
  }

  // Env presence (booleans only — never echo the values)
  checks.gemini_key_set = !!($os.getenv("GEMINI_API_KEY") || "").trim();
  // Retained in the health contract for one compatibility release. Shared
  // proxy tokens are intentionally unsupported; every paid route requires a
  // continuously revalidated application session.
  checks.proxy_token_set = false;
  checks.anthropic_key_set = !!($os.getenv("ANTHROPIC_API_KEY") || "").trim();
  checks.openai_key_set = !!($os.getenv("OPENAI_API_KEY") || "").trim();
  checks.claude_fallback_enabled =
    checks.anthropic_key_set &&
    ($os.getenv("ENABLE_CLAUDE_FALLBACK") || "").trim().toLowerCase() === "true";
  checks.openai_fallback_enabled =
    checks.openai_key_set &&
    ($os.getenv("ENABLE_OPENAI_FALLBACK") || "").trim().toLowerCase() === "true";
  try {
    // Creation-only self-heal covers fresh databases where migrations landed
    // after the bootstrap hook already ran.
    helpers.ensureAdminAccountProvisioned({ syncPassword: false });
    const adminVerification = helpers.findAdminPasswordVerificationAccount();
    checks.admin_login_configured = adminVerification.status === "found";
  } catch (_e) {
    checks.admin_login_configured = false;
  }
  const flyRuntime = !!($os.getenv("FLY_APP_NAME") || "").trim();
  const turnstileSecret = ($os.getenv("TURNSTILE_SECRET") || "").toString();
  const turnstileSiteKey = ($os.getenv("TURNSTILE_SITE_KEY") || "").toString();
  checks.turnstile_enforcement_enabled =
    ($os.getenv("TURNSTILE_ENFORCEMENT_ENABLED") || "").trim().toLowerCase() === "true";
  checks.turnstile_secret_set =
    turnstileSecret.length >= 20 &&
    (!flyRuntime || !helpers.isTurnstileTestSecret(turnstileSecret));
  checks.turnstile_site_key_set =
    /^[A-Za-z0-9_-]{20,}$/.test(turnstileSiteKey) &&
    (!flyRuntime || !helpers.isTurnstileTestSiteKey(turnstileSiteKey));
  checks.turnstile_hostnames_configured =
    helpers.configuredTurnstileHostnames().length > 0;
  checks.trusted_proxy_configured =
    ($os.getenv("VERCEL_TO_FLY_PROXY_SECRET") || "").toString().length >= 32;
  // Access-code hashing is inert without its pepper: PIN logins fail closed and
  // the plaintext backfill cannot run. Deploys must not pass readiness without it.
  checks.pin_pepper_configured = helpers.salespersonPinPepper().length >= 32;
  checks.legacy_client_compatibility_enabled =
    ($os.getenv("LEGACY_CLIENT_COMPATIBILITY_ENABLED") || "")
      .toString()
      .trim()
      .toLowerCase() === "true";
  checks.off_box_backup_configured = backupEnabled;
  checks.off_box_restore_ready = backupRestoreReady;
  try {
    const websitePublications = require(__hooks + "/websitePublications.js");
    const configuredDealerId = ($os.getenv("CUSTOMER_HUB_DEALER_ID") || "").trim();
    checks.website_integration_configured =
      !!configuredDealerId &&
      websitePublications.destinationConfiguration(configuredDealerId).enabled;
  } catch (_e) {
    checks.website_integration_configured = false;
  }

  // Top-level ok = critical checks must pass (uptime monitors hit this).
  if (
    !checks.pocketbase ||
    !checks.gemini_key_set ||
    !checks.admin_login_configured ||
    (flyRuntime &&
      (!checks.trusted_proxy_configured ||
        !checks.pin_pepper_configured ||
        !checks.turnstile_secret_set ||
        !checks.turnstile_site_key_set ||
        !checks.turnstile_hostnames_configured)) ||
    (checks.turnstile_enforcement_enabled &&
      (!checks.turnstile_secret_set ||
        !checks.turnstile_site_key_set ||
        !checks.turnstile_hostnames_configured)) ||
    (flyRuntime &&
      (!checks.off_box_restore_ready || !checks.website_integration_configured))
  ) {
    result.ok = false;
  }

  return c.json(result.ok ? 200 : 503, result);
});

routerAdd("POST", "/api/telemetry", (c) => {
  let telemetryStage = "start";
  try {
    const helpers = require(__hooks + "/helpers.js");
    c.response().header().set("Cache-Control", "no-store");
    // This endpoint is intentionally unauthenticated (it captures pre-login
    // client errors), so rate-limit per IP to stop log-injection / disk-fill
    // abuse: 30 events per IP per minute.
    // ipKeyed: the key is a client IP, so its cardinality is whatever an
    // attacker chooses. It counts against the separate IP table, where a flood
    // can only evict other flood buckets — not a dealership's per-minute quota,
    // and not the "telemetry:ingress" ceiling on the next line.
    const rl = helpers.checkProxyRateLimit(
      "telemetry:" + helpers.clientIP(c),
      30,
      60 * 1000,
      { ipKeyed: true },
    );
    if (!rl.ok) return c.json(429, { success: false });
    const globalRl = helpers.checkProxyRateLimit("telemetry:ingress", 240, 60 * 1000);
    if (!globalRl.ok) return c.json(202, { success: true, stored: false });

    telemetryStage = "request_info";
    const rawBody = $apis.requestInfo(c).data || {};
    const rawSerialized = JSON.stringify(rawBody);
    if (!rawSerialized || rawSerialized.length > 8000) {
      return c.json(413, { success: false });
    }
    // PocketBase exposes request data through a Go map proxy. Round-trip it
    // into a plain JS object before recursively enumerating keys in Goja.
    const plainBody = JSON.parse(rawSerialized);
    telemetryStage = "parsed";
    // Only actionable error-level events leave the browser. Info/warn events
    // remain in the 14-day local ring buffer and cannot fill the server DB.
    if (!plainBody || plainBody.level !== "error") {
      return c.json(202, { success: true, stored: false });
    }

    // Persist an allowlisted diagnostic envelope, never arbitrary client text.
    // Messages, VINs, names, codes, prompts, and credentials are discarded even
    // if a malicious or outdated client bypasses the browser-side sanitizer.
    const safeEnvelope = helpers.buildSafeTelemetryEnvelope(plainBody);
    telemetryStage = "validated";

    telemetryStage = "record_ready";
    const persistence = helpers.persistBoundedTelemetryEvent(safeEnvelope, new Date());
    return c.json(persistence.stored ? 200 : 202, { success: true });
  } catch (_err) {
    console.error("Telemetry persistence error at stage", telemetryStage);
    // Return 200 even on error to prevent client noise; do not echo details.
    return c.json(200, { success: false });
  }
});

// Keep diagnostics and raw authentication metadata within explicit operational
// windows. Auth denials are also coalesced at write time; retention is the
// durable backstop against indefinite IP/user-agent accumulation.
cronAdd("prune-client-error-events", "17 7 * * *", function () {
  try {
    const helpers = require(__hooks + "/helpers.js");
    const cutoff = helpers.databaseTimestamp(
      new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    );
    $app
      .dao()
      .db()
      .newQuery("DELETE FROM client_error_events WHERE occurred_at < {:cutoff}")
      .bind({ cutoff: cutoff })
      .execute();
    $app
      .dao()
      .db()
      .newQuery("DELETE FROM generation_events WHERE occurred_at < {:cutoff}")
      .bind({ cutoff: cutoff })
      .execute();
    const authCutoff = helpers.databaseTimestamp(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    $app
      .dao()
      .db()
      .newQuery("DELETE FROM auth_events WHERE created < {:cutoff}")
      .bind({ cutoff: authCutoff })
      .execute();
  } catch (_err) {
    // The first boot before the migration may not have the collection yet.
  }
});

// ============================================================================
// Session Endpoints — DB-backed opaque tokens (2026-05-28 rewrite)
//
// POST /api/app/session   { dealerCode } OR { authType, username, password }
//                         → sets HttpOnly cookie, returns dealer
// GET  /api/app/session                   → resolves cookie → returns dealer
// DELETE /api/app/session                 → revokes session + clears cookie
//
// Login rate limit: 10 failed attempts per IP per 15 minutes triggers a soft
// lockout. After 30 minutes the counter resets. Successes don't count.
// ============================================================================

routerAdd("POST", "/api/app/session", (c) => {
  let helpers = null;
  let attemptReservationId = "";
  try {
    const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60; // 15 min
    const LOGIN_FAIL_THRESHOLD = 10;
    const TURNSTILE_AFTER_FAILURES = 3;

    helpers = require(__hooks + "/helpers.js");
    const ip = helpers.clientIP(c);
    const ua = helpers.userAgent(c);
    c.response().header().set("Cache-Control", "private, no-store");
    const unavailableResponse = function () {
      return c.json(503, {
        error: "UNAVAILABLE",
        code: "UNAVAILABLE",
        message: "The secure sign-in service is temporarily unavailable.",
      });
    };
    const lockedResponse = function (state) {
      helpers.logCoalescedAuthEvent(
        "login_locked",
        {
          ip: ip,
          userAgent: ua,
          detail: (state.count || LOGIN_FAIL_THRESHOLD) + " fails in window",
        },
        LOGIN_FAIL_WINDOW_SECONDS,
        60,
      );
      c.response().header().set("Retry-After", String(state.retryAfterSeconds));
      return c.json(429, {
        error: "LOCKED",
        code: "LOCKED",
        message: "Too many login attempts. Sign-in is temporarily locked.",
        retryAfterSeconds: state.retryAfterSeconds,
      });
    };
    const challengeRequiredResponse = function (message) {
      return c.json(403, {
        error: "CHALLENGE_REQUIRED",
        code: "CHALLENGE_REQUIRED",
        message: message || "Complete the security check to continue.",
        action: helpers.TURNSTILE_ACTION,
      });
    };
    const cancelReservedAttempt = function () {
      if (!attemptReservationId) return;
      helpers.cancelLoginAttempt(attemptReservationId);
      attemptReservationId = "";
    };

    const failureState = helpers.loginFailureState(
      ip,
      LOGIN_FAIL_THRESHOLD,
      LOGIN_FAIL_WINDOW_SECONDS,
    );
    const rejectInvalidCredential = function (detail, credentialPresent) {
      const failureStored = helpers.finalizeLoginAttempt(
        attemptReservationId,
        "login_fail",
        {
          credentialPresent: !!credentialPresent,
          detail: detail || "",
        },
      );
      attemptReservationId = "";
      if (!failureStored) return unavailableResponse();
      const updated = helpers.loginFailureState(
        ip,
        LOGIN_FAIL_THRESHOLD,
        LOGIN_FAIL_WINDOW_SECONDS,
      );
      if (updated.unavailable) return unavailableResponse();
      if (updated.locked) return lockedResponse(updated);
      const invalidCode = managerLoginRequested
        ? "INVALID_CREDENTIALS"
        : "INVALID_CODE";
      return c.json(401, {
        error: invalidCode,
        code: invalidCode,
        message: "Invalid sign-in credentials.",
      });
    };
    if (failureState.unavailable) return unavailableResponse();
    if (failureState.locked) return lockedResponse(failureState);

    const body = $apis.requestInfo(c).data || {};
    const dealerCode =
      body.dealerCode === undefined || body.dealerCode === null
        ? ""
        : body.dealerCode.toString();
    // Optional store hint remembered by the device after a prior login. It only
    // scopes the personal-code lookup — the PIN itself remains the credential.
    const rememberedDealerId = /^[a-z0-9]{15}$/.test(
      (body.dealerId || "").toString().trim(),
    )
      ? (body.dealerId || "").toString().trim()
      : "";
    const managerUsername = helpers.normalizeManagerUsername(body.username);
    // Passwords are exact credentials. Never trim, normalize, case-fold, log,
    // or persist the submitted value outside PocketBase's password verifier.
    const managerPassword =
      body.password === undefined || body.password === null
        ? ""
        : body.password.toString();
    const requestedAuthType = (body.authType || "").toString();
    const adminLoginRequested = requestedAuthType === "admin_password";
    const managerLoginRequested =
      !adminLoginRequested &&
      (requestedAuthType === "manager_password" ||
        body.username !== undefined ||
        body.password !== undefined);
    const passwordLoginRequested = adminLoginRequested || managerLoginRequested;
    const credentialPresent = passwordLoginRequested
      ? managerUsername.length > 0 || managerPassword.length > 0
      : dealerCode.length > 0;

    // Keep Fly backward-compatible while the exact staged Vercel artifact is
    // awaiting promotion. Enforcement is enabled only after the new client is
    // live; once enabled, three credential failures remain frictionless and
    // every later attempt requires a fresh managed Turnstile token.
    const turnstileEnforcementEnabled =
      ($os.getenv("TURNSTILE_ENFORCEMENT_ENABLED") || "")
        .toString()
        .trim()
        .toLowerCase() === "true";
    let challengeValidated = false;
    if (turnstileEnforcementEnabled && failureState.count >= TURNSTILE_AFTER_FAILURES) {
      const turnstileToken = (body.turnstileToken || "").toString();
      if (!turnstileToken) {
        return challengeRequiredResponse();
      }
      const challenge = helpers.verifyTurnstileToken(turnstileToken, ip);
      if (challenge.unavailable) {
        return c.json(503, {
          error: "UNAVAILABLE",
          code: "UNAVAILABLE",
          message: "The secure sign-in service is temporarily unavailable.",
        });
      }
      if (!challenge.ok) {
        helpers.logAuthEvent("turnstile_fail", {
          credentialPresent: credentialPresent,
          ip: ip,
          userAgent: ua,
          detail: "challenge rejected",
        });
        return challengeRequiredResponse(
          "The security check expired or was not accepted. Try again.",
        );
      }
      challengeValidated = true;
    }

    // Reserve the comparison before validating syntax or touching either
    // credential store. The transactional helper rechecks the bucket after its
    // write, closing the parallel-request gap between this preflight and the
    // actual comparison.
    const reservation = helpers.reserveLoginAttempt({
      ip: ip,
      userAgent: ua,
      credentialPresent: credentialPresent,
      threshold: LOGIN_FAIL_THRESHOLD,
      windowSeconds: LOGIN_FAIL_WINDOW_SECONDS,
      challengeAfter: turnstileEnforcementEnabled
        ? TURNSTILE_AFTER_FAILURES
        : LOGIN_FAIL_THRESHOLD,
      challengeValidated: challengeValidated,
    });
    if (!reservation || reservation.status === "unavailable") {
      return unavailableResponse();
    }
    if (reservation.status === "locked") {
      return lockedResponse(reservation);
    }
    if (reservation.status === "challenge_required") {
      return challengeRequiredResponse();
    }
    attemptReservationId = reservation.attemptId;

    if (
      (requestedAuthType &&
        requestedAuthType !== "manager_password" &&
        requestedAuthType !== "admin_password") ||
      (passwordLoginRequested && body.dealerCode !== undefined) ||
      (managerLoginRequested && requestedAuthType !== "manager_password")
    ) {
      return rejectInvalidCredential("ambiguous credential payload", credentialPresent);
    }
    if (
      passwordLoginRequested &&
      (!helpers.isValidManagerUsername(managerUsername) ||
        !helpers.isManagerLoginPasswordShape(managerPassword))
    ) {
      return rejectInvalidCredential(
        "malformed manager credentials",
        credentialPresent,
      );
    }
    if (!passwordLoginRequested && !/^[A-Za-z0-9]{4,12}$/.test(dealerCode)) {
      return rejectInvalidCredential("malformed code", dealerCode.length > 0);
    }

    let role = "salesperson";
    let record;
    let personRecord = null;
    let verifiedPersonPinFingerprint = "";
    let managerAccount = null;
    let verifiedManagerAuthFingerprint = "";
    let adminAccount = null;
    let verifiedAdminAuthFingerprint = "";

    if (adminLoginRequested) {
      try {
        helpers.ensureAdminAccountProvisioned({ syncPassword: false });
      } catch (_e) {}
      const adminLookup = helpers.findActiveAdminLogin(managerUsername);
      if (adminLookup.status === "unavailable") {
        cancelReservedAttempt();
        return unavailableResponse();
      }
      let passwordVerificationAccount = adminLookup.account;
      if (!passwordVerificationAccount) {
        const verificationLookup = helpers.findAdminPasswordVerificationAccount();
        if (verificationLookup.status === "unavailable") {
          cancelReservedAttempt();
          return unavailableResponse();
        }
        passwordVerificationAccount = verificationLookup.account;
      }
      if (passwordVerificationAccount) {
        let passwordAccepted = false;
        try {
          passwordAccepted =
            !!passwordVerificationAccount.validatePassword(managerPassword);
        } catch (_e) {
          cancelReservedAttempt();
          return unavailableResponse();
        }
        // A valid password for the dummy verification target never becomes an
        // identity match. Only the account resolved from this exact username
        // can mint the administrator session.
        if (adminLookup.status === "found" && passwordAccepted) {
          adminAccount = adminLookup.account;
          role = "super_admin";
          try {
            verifiedAdminAuthFingerprint = helpers.adminAuthFingerprint(adminAccount);
          } catch (_e) {
            cancelReservedAttempt();
            return unavailableResponse();
          }
          record = helpers.findSystemDealer();
          if (!record) {
            // A stable marker identifies the one system tenant; the unique
            // partial index in the integrity migration prevents multiple
            // canonical records.
            try {
              const dealers = $app.dao().findCollectionByNameOrId("dealers");
              const systemDealer = new Record(dealers, {
                name: "SYSTEM ADMIN",
                is_system: true,
              });
              $app.dao().saveRecord(systemDealer);
              record = systemDealer;
            } catch (insertErr) {
              console.log(
                "[session] system dealer insert raced, re-querying:",
                insertErr,
              );
              record = helpers.findSystemDealer();
            }
          }
        }
      }
    } else if (managerLoginRequested) {
      const managerLookup = helpers.findActiveManagerLogin(managerUsername);
      if (managerLookup.status === "unavailable") {
        cancelReservedAttempt();
        return unavailableResponse();
      }
      let passwordVerificationAccount = managerLookup.account;
      if (!passwordVerificationAccount) {
        const verificationLookup = helpers.findManagerPasswordVerificationAccount();
        if (verificationLookup.status === "unavailable") {
          cancelReservedAttempt();
          return unavailableResponse();
        }
        passwordVerificationAccount = verificationLookup.account;
      }
      if (passwordVerificationAccount) {
        let passwordAccepted = false;
        try {
          passwordAccepted =
            !!passwordVerificationAccount.validatePassword(managerPassword);
        } catch (_e) {
          cancelReservedAttempt();
          return unavailableResponse();
        }
        // A valid password for the dummy verification target never becomes an
        // identity match. Only the account resolved from this exact username
        // can mint the dealer-scoped app session.
        if (managerLookup.status === "found" && passwordAccepted) {
          personRecord = managerLookup.person;
          managerAccount = managerLookup.account;
          role = "dealer_admin";
          try {
            verifiedPersonPinFingerprint = helpers.personPinFingerprint(personRecord);
            verifiedManagerAuthFingerprint =
              helpers.managerAuthFingerprint(managerAccount);
            record = $app
              .dao()
              .findRecordById("dealers", personRecord.getString("dealer"));
          } catch (_e) {
            cancelReservedAttempt();
            return unavailableResponse();
          }
        }
      }
    } else {
      // Personal 4-digit codes on the people roster (managers + salespeople).
      // Shared dealer/admin codes are no longer accepted for store login.
      const pinLookup = helpers.isValidPersonPin(dealerCode)
        ? helpers.findActivePersonByPin(dealerCode, rememberedDealerId)
        : { status: "not_found", person: null };
      if (pinLookup.status === "unavailable") {
        cancelReservedAttempt();
        return unavailableResponse();
      }
      personRecord = pinLookup.status === "found" ? pinLookup.person : null;
      if (personRecord) {
        role = helpers.personRoleToSessionRole(personRecord.getString("role"));
        try {
          verifiedPersonPinFingerprint = helpers.personPinFingerprint(personRecord);
          record = $app
            .dao()
            .findRecordById("dealers", personRecord.getString("dealer"));
        } catch (_e) {
          cancelReservedAttempt();
          return unavailableResponse();
        }
      }
    }

    if (role === "super_admin" && !record) {
      cancelReservedAttempt();
      return c.json(503, {
        error: "UNAVAILABLE",
        code: "UNAVAILABLE",
        message: "Administrative login is temporarily unavailable.",
      });
    }

    if (!record) {
      return rejectInvalidCredential("credential not recognized", credentialPresent);
    }

    // Mint the opaque session token + persist row. Cookie carries ONLY the token.
    let token;
    let sessionId = "";
    try {
      const sessionOpts = {};
      if (personRecord) {
        sessionOpts.personId = personRecord.id;
        sessionOpts.expectedPersonPinFingerprint = verifiedPersonPinFingerprint;
      }
      if (managerAccount) {
        sessionOpts.managerAccountId = managerAccount.id;
        sessionOpts.expectedManagerAuthFingerprint = verifiedManagerAuthFingerprint;
      }
      if (adminAccount) {
        sessionOpts.adminAccountId = adminAccount.id;
        sessionOpts.expectedAdminAuthFingerprint = verifiedAdminAuthFingerprint;
      }
      const session = helpers.createSession(record.id, role, ip, ua, sessionOpts);
      token = session.token;
      sessionId = session.sessionId || "";
    } catch (err) {
      console.error("[session POST] createSession failed", err);
      cancelReservedAttempt();
      return unavailableResponse();
    }

    // The reserved failure becomes a success before the new bearer is exposed.
    // If the audit store cannot be finalized, the random orphan token is never
    // returned and therefore cannot be used.
    const successStored = helpers.finalizeLoginAttempt(
      attemptReservationId,
      "login_success",
      {
        dealerId: record.id,
        credentialPresent: true,
        detail:
          "auth=" +
          (adminAccount
            ? "admin_password"
            : managerAccount
              ? "manager_password"
              : "code") +
          " role=" +
          role +
          (personRecord ? " person=" + personRecord.id : "") +
          (sessionId ? " session=" + sessionId : ""),
      },
    );
    attemptReservationId = "";
    if (!successStored) return unavailableResponse();

    c.response().header().add("Set-Cookie", helpers.buildSessionCookie(token));

    const payload = {
      role: role,
      dealer: helpers.serializeDealer(record),
      is_impersonation: false,
      capabilities: helpers.PROXY_CAPABILITIES,
    };
    if (personRecord) {
      payload.person = helpers.serializePersonSummary(personRecord);
    }
    return c.json(200, payload);
  } catch (e) {
    if (helpers && attemptReservationId) {
      helpers.cancelLoginAttempt(attemptReservationId);
      attemptReservationId = "";
    }
    console.error("SESSION ERROR:", e);
    return c.json(503, {
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      message: "The secure sign-in service is temporarily unavailable.",
    });
  }
});

routerAdd("GET", "/api/app/session", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "Invalid session" });

  // Sliding refresh — extend the authoritative database expiry and the cookie
  // together so an active dealer does not expire at the original login time.
  try {
    helpers.refreshSession(context.session);
    c.response().header().add("Set-Cookie", helpers.buildSessionCookie(context.token));
  } catch (_e) {
    /* ignore */
  }

  const payload = {
    role: context.role,
    dealer: helpers.serializeDealer(context.dealer),
    is_impersonation: context.isImpersonating,
    capabilities: helpers.PROXY_CAPABILITIES,
  };
  if (context.person) {
    payload.person = helpers.serializePersonSummary(context.person);
  }
  return c.json(200, payload);
});

// Super-admin opens a store as a manager or salesperson without their pin.
routerAdd("POST", "/api/app/session/impersonate", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "Invalid session" });
  if (context.role !== "super_admin") {
    return c.json(403, { error: "Super admin only" });
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
  const active = person.getBool ? person.getBool("active") : !!person.get("active");
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
    minted = helpers.runAuditedTransaction(
      "impersonate_start",
      {
        dealerId: dealer.id,
        credentialPresent: true,
        ip: ip,
        userAgent: ua,
        detail: "person=" + person.id + " role=" + role,
      },
      function (txDao) {
        return helpers.createSessionWithDao(txDao, dealer.id, role, ip, ua, {
          personId: person.id,
          isImpersonation: true,
          impersonatorSessionId: context.session.id,
        });
      },
    );
  } catch (err) {
    console.error("[impersonate] audited session creation failed", err);
    return c.json(503, {
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      message: "Impersonation could not be started safely.",
    });
  }

  c.response().header().add("Set-Cookie", helpers.buildSessionCookie(minted.token));

  return c.json(200, {
    role: role,
    dealer: helpers.serializeDealer(dealer),
    person: helpers.serializePersonSummary(person),
    is_impersonation: true,
    capabilities: helpers.PROXY_CAPABILITIES,
  });
});

routerAdd("POST", "/api/app/session/exit-impersonate", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "Invalid session" });
  if (!context.isImpersonating) {
    return c.json(400, { error: "Not impersonating" });
  }
  const adminSession = context.impersonatorSession;
  const adminDealer = helpers.findSystemDealer();
  if (!adminSession || !adminDealer) {
    return c.json(401, { error: "Admin session unavailable" });
  }

  const ip = helpers.clientIP(c);
  const ua = helpers.userAgent(c);
  let minted;
  try {
    minted = helpers.replaceImpersonationSession(
      context.session.id,
      adminSession.id,
      ip,
      ua,
      {
        kind: "impersonate_exit",
        options: {
          dealerId: adminDealer.id,
          credentialPresent: true,
          ip: ip,
          userAgent: ua,
          detail: "restored super_admin",
        },
      },
    );
  } catch (err) {
    console.error("[exit-impersonate] transactional replacement failed", err);
    return c.json(503, {
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      message: "The admin session could not be restored safely.",
    });
  }

  c.response().header().add("Set-Cookie", helpers.buildSessionCookie(minted.token));

  return c.json(200, {
    role: "super_admin",
    dealer: helpers.serializeDealer(adminDealer),
    is_impersonation: false,
    capabilities: helpers.PROXY_CAPABILITIES,
  });
});

routerAdd("DELETE", "/api/app/session", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  try {
    helpers.revokeSession(c);
    helpers.logAuthEvent("session_revoked", {
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
    });
  } catch (err) {
    console.error("[session DELETE] authoritative revocation failed", err);
    // Preserve the cookie so the browser can retry. Claiming success and
    // clearing only the client copy would leave copied bearer tokens alive.
    return c.json(503, {
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      message: "Sign-out could not be completed safely. Please try again.",
    });
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
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;
  const token = helpers.readSessionToken(c);
  const ownerSessionHash = token ? helpers.hashSessionToken(token) : "";
  if (!ownerSessionHash) return c.json(401, { error: "No active session" });
  const releaseWriter = context.person ? context.person.id : context.session.id;
  // A higher attempt throttle protects validation work without letting a
  // malformed client consume the lower successful-save allowance below.
  const releaseAttemptHourly = helpers.checkProxyRateLimit(
    "app-attempt:photo-release:hour:" + dealer.id + ":" + releaseWriter,
    120,
    60 * 60 * 1000,
  );
  const releaseAttemptDaily = helpers.checkProxyRateLimit(
    "app-attempt:photo-release:day:" + dealer.id + ":" + releaseWriter,
    300,
    24 * 60 * 60 * 1000,
  );
  if (!releaseAttemptHourly.ok || !releaseAttemptDaily.ok) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        Math.max(
          releaseAttemptHourly.retryAfterMs || 0,
          releaseAttemptDaily.retryAfterMs || 0,
        ) / 1000,
      ),
    );
    c.response().header().set("Retry-After", String(retryAfter));
    return c.json(429, {
      error: "WRITE_RATE_LIMITED",
      code: "WRITE_RATE_LIMITED",
      message:
        "Too many photo-release save attempts. Check the app and try again later.",
      retry_after_seconds: retryAfter,
    });
  }

  try {
    const releases = $app.dao().findCollectionByNameOrId("photo_releases");
    if (!releases) return c.json(500, { error: "photo_releases collection missing" });

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

    // Count only a validated write against the normal salesperson allowance.
    const releaseHourly = helpers.checkProxyRateLimit(
      "app-write:photo-release:hour:" + dealer.id + ":" + releaseWriter,
      20,
      60 * 60 * 1000,
    );
    const releaseDaily = helpers.checkProxyRateLimit(
      "app-write:photo-release:day:" + dealer.id + ":" + releaseWriter,
      50,
      24 * 60 * 60 * 1000,
    );
    if (!releaseHourly.ok || !releaseDaily.ok) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          Math.max(releaseHourly.retryAfterMs || 0, releaseDaily.retryAfterMs || 0) /
            1000,
        ),
      );
      c.response().header().set("Retry-After", String(retryAfter));
      return c.json(429, {
        error: "WRITE_RATE_LIMITED",
        code: "WRITE_RATE_LIMITED",
        message: "The photo-release save limit was reached. Try again later.",
        retry_after_seconds: retryAfter,
      });
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
      vin: helpers.assertString(helpers.normalizeReleaseVin(body.vin), 17),
      notes: helpers.assertString((body.notes || "").toString(), 1000),
      post_id: "",
      owner_session_hash: ownerSessionHash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ip_hash: "",
      user_agent: "",
    };
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
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;

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
  const postId = helpers.assertString((body.post_id || "").toString().trim(), 64);
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
  if (!currentOwnerHash || currentOwnerHash !== post.getString("owner_session_hash")) {
    return c.json(403, { error: "Post belongs to another session" });
  }
  if (currentOwnerHash !== release.getString("owner_session_hash")) {
    return c.json(403, { error: "Photo release belongs to another session" });
  }
  const releaseExpiry = release.getString("expires_at");
  if (
    !release.getString("post_id") &&
    (!releaseExpiry ||
      releaseExpiry.replace("T", " ") <=
        helpers.databaseTimestamp(new Date().toISOString()))
  ) {
    return c.json(410, { error: "Photo release expired; capture it again" });
  }
  if (
    helpers.normalizeReleaseIdentity(release.getString("customer_name")) !==
    helpers.normalizeReleaseIdentity(post.getString("customer_name"))
  ) {
    return c.json(409, {
      error: "Photo release customer does not match this post",
    });
  }
  if (
    helpers.normalizeReleaseVin(release.getString("vin")) !==
    helpers.normalizeReleaseVin(post.getString("vin"))
  ) {
    return c.json(409, {
      error: "Photo release vehicle does not match this post",
    });
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
            "AND owner_session_hash = {:owner} " +
            "AND (post_id = '' OR post_id IS NULL)",
        )
        .bind({
          postId: post.id,
          updated: linkedAt,
          releaseId: release.id,
          dealer: dealer.id,
          owner: currentOwnerHash,
        })
        .execute();

      if (!result || result.rowsAffected() !== 1) {
        const current = $app.dao().findRecordById("photo_releases", release.id);
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
    if (
      !hasRelease ||
      !post.getBool("release_required") ||
      post.getString("release_status") !== "saved"
    ) {
      post.set("has_release", true);
      post.set("release_required", true);
      post.set("release_status", "saved");
      $app.dao().saveRecord(post);
    }

    // Consent and post creation are intentionally separate durable writes.
    // Wake a waiting website row now; the minute worker also reconciles this
    // state so a crash between these writes cannot strand the draft.
    try {
      require(__hooks + "/websitePublications.js").reconcilePublicationForPost(post.id);
    } catch (_e) {}

    // Saving the consent flags advances posts.updated. Return that exact
    // revision so the editor's next draft/share compare-and-set is not stale.
    const linkedPost = $app.dao().findRecordById("posts", post.id);
    return c.json(200, {
      id: release.id,
      post_id: post.id,
      has_release: true,
      post_revision: linkedPost.getString("updated"),
    });
  } catch (err) {
    console.error("[/api/app/photo_releases/:id/link-post] error", err);
    return c.json(400, { error: "Failed to link photo release" });
  }
});

// Abandoned signatures are sensitive temporary records, not legal audit
// artifacts. Delete them record-by-record so PocketBase also removes the
// protected file. Linked releases are never selected by this cleanup.
cronAdd("prune-unlinked-photo-releases", "13 * * * *", function () {
  try {
    const helpers = require(__hooks + "/helpers.js");
    const expired = $app
      .dao()
      .findRecordsByFilter(
        "photo_releases",
        "post_id = '' && expires_at != '' && expires_at <= {:now}",
        "expires_at",
        500,
        0,
        { now: helpers.databaseTimestamp(new Date().toISOString()) },
      );
    for (let i = 0; i < expired.length; i++) {
      try {
        $app.dao().deleteRecord(expired[i]);
      } catch (e) {
        console.warn("[photo-releases] expired-release prune failed: " + e);
      }
    }
  } catch (_e) {
    // Collection/fields may not exist before the forward migration.
  }
});

// ---- Website destination (server-only credentials, safe public status) --
routerAdd("GET", "/api/app/website-destinations", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const websitePublications = require(__hooks + "/websitePublications.js");
  c.response().header().set("Cache-Control", "private, no-store");
  return c.json(200, {
    items: [websitePublications.publicDestinationConfiguration(context.dealer.id)],
  });
});

// ---- Posts (log + leaderboard + approval) ------------------------------
routerAdd("POST", "/api/app/posts", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;
  const postWriter = context.person ? context.person.id : context.session.id;
  // Protect parsing/validation independently from the successful-save quota.
  const postAttemptHourly = helpers.checkProxyRateLimit(
    "app-attempt:post:hour:" + dealer.id + ":" + postWriter,
    120,
    60 * 60 * 1000,
  );
  const postAttemptDaily = helpers.checkProxyRateLimit(
    "app-attempt:post:day:" + dealer.id + ":" + postWriter,
    300,
    24 * 60 * 60 * 1000,
  );
  if (!postAttemptHourly.ok || !postAttemptDaily.ok) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        Math.max(
          postAttemptHourly.retryAfterMs || 0,
          postAttemptDaily.retryAfterMs || 0,
        ) / 1000,
      ),
    );
    c.response().header().set("Retry-After", String(retryAfter));
    return c.json(429, {
      error: "WRITE_RATE_LIMITED",
      code: "WRITE_RATE_LIMITED",
      message: "Too many post-save attempts. Check the app and try again later.",
      retry_after_seconds: retryAfter,
    });
  }
  let generationClaimToken = "";
  let generationClaimOwner = "";
  let generationClaimCount = 0;
  let createdPostRecord = null;

  try {
    const posts = $app.dao().findCollectionByNameOrId("posts");
    if (!posts) return c.json(500, { error: "posts collection missing" });

    const record = new Record(posts);
    const form = new RecordUpsertForm($app, record);
    form.setFullManageAccess(true);
    const body = $apis.requestInfo(c).data || {};
    const protectedCustomerName = helpers.assertString(
      (body.customer_name || "").toString().trim(),
      120,
    );
    const websitePublications = require(__hooks + "/websitePublications.js");
    const parsedWebsiteDraft = websitePublications.parseWebsiteDraft(
      body.website_draft,
    );
    if (!parsedWebsiteDraft.ok) {
      return c.json(400, { error: parsedWebsiteDraft.error });
    }
    let websiteDraft = parsedWebsiteDraft.value;
    let websiteDraftSerialized = parsedWebsiteDraft.serialized;
    if (websiteDraft && websiteDraft.enabled) {
      if (websiteDraft.customerDisplayName && !protectedCustomerName) {
        return c.json(400, {
          error: "A customer identity is required before using a public customer label",
        });
      }
    }
    const scenarioId = helpers.assertString(
      (body.scenario_id || "").toString().trim(),
      80,
    );
    const scenarioPolicy = helpers.resolvePostScenarioPolicy(
      scenarioId,
      dealer.getString("custom_scenarios"),
      protectedCustomerName ||
        (websiteDraft && websiteDraft.enabled
          ? websiteDraft.customerDisplayName || ""
          : ""),
    );
    if (!scenarioPolicy.ok) {
      return c.json(400, { error: "Invalid post scenario" });
    }
    if (
      websiteDraft &&
      websiteDraft.enabled &&
      !websitePublications.websiteDraftMatchesScenario(
        scenarioId,
        dealer.getString("custom_scenarios"),
        websiteDraft,
      )
    ) {
      return c.json(400, {
        error: "Website draft does not match the selected post type",
        code: "WEBSITE_MAPPING_CONFLICT",
      });
    }
    const releaseRequired = scenarioPolicy.releaseRequired;
    const allowedPlatformIds = helpers.allowedPostPlatformIds();
    const allowedPrimaryFormatIds = [
      "feed_portrait",
      "feed_square",
      "story_vertical",
      "marketplace",
      "gbp",
    ];
    const allowedImageAspectRatios = ["1:1", "4:5", "9:16", "16:9", "4:3"];
    const allowedMediaOutputModes = ["photo", "video", "both"];

    // Preserve the exact destination mix and generated master canvas so a
    // History reopen uses the same sizing workflow. Multipart values arrive
    // as strings; reject malformed/unknown values rather than storing
    // arbitrary client metadata alongside customer creatives.
    const rawPlatformIds = helpers.assertString(
      (body.platform_ids || "").toString(),
      400,
    );
    let parsedPlatformIds = [];
    if (rawPlatformIds) {
      try {
        parsedPlatformIds = JSON.parse(rawPlatformIds);
      } catch (_e) {
        return c.json(400, { error: "Invalid platform selection" });
      }
      if (!Array.isArray(parsedPlatformIds)) {
        return c.json(400, { error: "Invalid platform selection" });
      }
    }
    if (parsedPlatformIds.length > allowedPlatformIds.length) {
      return c.json(400, { error: "Too many platform selections" });
    }
    const platformIds = [];
    for (let i = 0; i < parsedPlatformIds.length; i++) {
      const platformId = parsedPlatformIds[i];
      if (
        typeof platformId !== "string" ||
        allowedPlatformIds.indexOf(platformId) === -1
      ) {
        return c.json(400, { error: "Invalid platform selection" });
      }
      if (platformIds.indexOf(platformId) === -1) {
        platformIds.push(platformId);
      }
    }
    const primaryFormatId = helpers.assertString(
      (body.primary_format_id || "").toString(),
      40,
    );
    if (primaryFormatId && allowedPrimaryFormatIds.indexOf(primaryFormatId) === -1) {
      return c.json(400, { error: "Invalid primary image format" });
    }
    const imageAspectRatio = helpers.assertString(
      (body.image_aspect_ratio || "").toString(),
      10,
    );
    if (imageAspectRatio && allowedImageAspectRatios.indexOf(imageAspectRatio) === -1) {
      return c.json(400, { error: "Invalid image aspect ratio" });
    }
    const expectedAspectByFormat = {
      feed_portrait: "4:5",
      feed_square: "1:1",
      story_vertical: "9:16",
      marketplace: "16:9",
      gbp: "4:3",
    };
    if (
      !!primaryFormatId !== !!imageAspectRatio ||
      (primaryFormatId && expectedAspectByFormat[primaryFormatId] !== imageAspectRatio)
    ) {
      return c.json(400, { error: "Output format and aspect ratio do not match" });
    }
    const mediaOutputMode =
      helpers.assertString((body.media_output_mode || "photo").toString(), 10) ||
      "photo";
    if (allowedMediaOutputModes.indexOf(mediaOutputMode) === -1) {
      return c.json(400, { error: "Invalid media output mode" });
    }
    const parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
      body.platform_captions,
      allowedPlatformIds,
      platformIds,
    );
    if (!parsedPlatformCaptions.ok) {
      return c.json(400, { error: parsedPlatformCaptions.error });
    }

    // Attribution comes exclusively from the centrally validated session.
    // Legacy client fields are ignored so a browser cannot credit another
    // salesperson or inject a free-text identity into history/leaderboards.
    const salespersonId = context.person ? context.person.id : "";
    const salespersonName = context.person
      ? context.person.getString("name")
      : "System Admin";

    // A store's approval policy is applied only from server-resolved facts:
    // the scenario's brand category, whether the post involves a customer, and
    // how many of the author's posts a manager has approved. Anything unknown
    // is reviewed (see policies.initialApprovalStatus).
    const approvalMapping = websitePublications.resolveWebsiteMapping(
      scenarioId,
      dealer.getString("custom_scenarios"),
    );
    const approvalStatus = policies.initialApprovalStatus(dealer, {
      category: approvalMapping ? approvalMapping.category : "",
      involvesCustomer:
        releaseRequired ||
        !approvalMapping ||
        approvalMapping.kind === "customer_story",
      countApprovedPosts: function () {
        if (!salespersonId) return NaN;
        const row = new DynamicModel({ total: 0 });
        $app
          .dao()
          .db()
          .newQuery(
            "SELECT COUNT(*) AS total FROM posts " +
              "WHERE dealer = {:dealer} AND salesperson_id = {:person} " +
              "AND approval_status = 'approved'",
          )
          .bind({ dealer: dealer.id, person: salespersonId })
          .one(row);
        return Number(row.total);
      },
    });
    let caption = helpers.assertString((body.caption || "").toString().trim(), 12000);
    let disclosures = helpers.assertString(
      (body.disclosures || "").toString().trim(),
      12000,
    );
    if (approvalStatus === "pending" && !caption) {
      return c.json(400, { error: "Review caption is required" });
    }
    const publicCustomerName =
      websitePublications.publicCustomerLabel(protectedCustomerName);
    if (
      websiteDraft &&
      websiteDraft.enabled &&
      websiteDraft.customerDisplayName &&
      !websitePublications.releaseAuthorizesPublicCustomerLabel(
        protectedCustomerName,
        websiteDraft.customerDisplayName,
      )
    ) {
      return c.json(400, {
        error:
          "The website customer label must be the exact approved public first name",
        code: "CUSTOMER_IDENTITY_CONFLICT",
      });
    }
    const platformCaptionIds = Object.keys(parsedPlatformCaptions.value);
    const identityValues = [caption, disclosures].concat(
      platformCaptionIds.map(function (platformId) {
        return parsedPlatformCaptions.value[platformId];
      }),
    );
    const websiteIdentityOffset = identityValues.length;
    if (websiteDraft && websiteDraft.enabled) {
      identityValues.push(
        websiteDraft.title || "",
        websiteDraft.body || "",
        websiteDraft.altText || "",
      );
    }
    // Canonical disclosure material is stripped before the customer-name guard
    // reads anything (policies.reviewCustomerIdentityExcludingDisclosures).
    const identityReview = policies.reviewCustomerIdentityExcludingDisclosures(
      websitePublications.reviewPostCustomerIdentity,
      protectedCustomerName,
      identityValues,
      [
        websitePublications.groundedIdentityPhrase(dealer.getString("name")),
        websitePublications.groundedIdentityPhrase(dealer.getString("oem_affiliation")),
        salespersonName,
        websitePublications.publicCustomerLabel(salespersonName),
        websitePublications.groundedIdentityPhrase(
          websiteDraft && websiteDraft.enabled
            ? websitePublications.groundedVehicleIdentityPhrase(
                websiteDraft.vehicleDescription || "",
              )
            : "",
        ),
      ],
      scenarioPolicy.releaseRequired && !publicCustomerName,
    );
    if (identityReview.unexpectedIdentity) {
      return c.json(400, {
        error:
          "Customer-name review required. Remove any unapproved customer name and try again.",
        code: "CUSTOMER_IDENTITY_CONFLICT",
      });
    }
    caption = identityReview.projectedValues[0] || "";
    disclosures = identityReview.projectedValues[1] || "";
    const projectedPlatformCaptions = {};
    for (let i = 0; i < platformCaptionIds.length; i++) {
      projectedPlatformCaptions[platformCaptionIds[i]] =
        identityReview.projectedValues[i + 2] || "";
    }
    parsedPlatformCaptions.value = projectedPlatformCaptions;
    parsedPlatformCaptions.serialized = JSON.stringify(projectedPlatformCaptions);
    if (websiteDraft && websiteDraft.enabled) {
      websiteDraft = Object.assign({}, websiteDraft, {
        title: identityReview.projectedValues[websiteIdentityOffset] || "",
        body: identityReview.projectedValues[websiteIdentityOffset + 1] || "",
        altText: identityReview.projectedValues[websiteIdentityOffset + 2] || "",
      });
      if (websiteDraft.kind === "customer_story" && publicCustomerName) {
        websiteDraft.customerDisplayName = publicCustomerName;
      }
      websiteDraftSerialized = JSON.stringify(websiteDraft);
    }
    {
      const compliance = policies.validatePostComplianceSet(
        [caption].concat(Object.values(parsedPlatformCaptions.value)),
        disclosures,
        dealer.getString("banned_phrases"),
      );
      if (!compliance.ok) {
        return c.json(400, { error: compliance.error });
      }
    }

    // Creative archive: accept image for any post so History can reopen for
    // re-share/export. Approval-pending still requires caption + image.
    let creativeFile = null;
    try {
      const header = c.formFile("creative_image");
      if (header) creativeFile = $filesystem.fileFromMultipart(header);
    } catch (_e) {}
    if (approvalStatus === "pending" && !creativeFile) {
      return c.json(400, { error: "Review image is required" });
    }
    if (websiteDraft && websiteDraft.enabled && !creativeFile) {
      return c.json(400, { error: "Website creative image is required" });
    }

    // Invalid requests above do not consume this normal storage allowance.
    const postHourly = helpers.checkProxyRateLimit(
      "app-write:post:hour:" + dealer.id + ":" + postWriter,
      20,
      60 * 60 * 1000,
    );
    const postDaily = helpers.checkProxyRateLimit(
      "app-write:post:day:" + dealer.id + ":" + postWriter,
      50,
      24 * 60 * 60 * 1000,
    );
    // Bound the dealership's aggregate private-media growth as well as each
    // person's usage. This intentionally does not delete History records.
    const postDealerDaily = helpers.checkProxyRateLimit(
      "app-write:post:dealer:day:" + dealer.id,
      100,
      24 * 60 * 60 * 1000,
    );
    if (!postHourly.ok || !postDaily.ok || !postDealerDaily.ok) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          Math.max(
            postHourly.retryAfterMs || 0,
            postDaily.retryAfterMs || 0,
            postDealerDaily.retryAfterMs || 0,
          ) / 1000,
        ),
      );
      c.response().header().set("Retry-After", String(retryAfter));
      return c.json(429, {
        error: "WRITE_RATE_LIMITED",
        code: "WRITE_RATE_LIMITED",
        message: postDealerDaily.ok
          ? "The post save limit was reached. Try again later."
          : "The dealership reached its daily archive limit. Ask a manager to check storage.",
        retry_after_seconds: retryAfter,
      });
    }

    // Load only the server-approved text fields, then attach the parsed upload
    // explicitly. This avoids trusting multipart filename strings as record
    // values and keeps all tenant/policy/audit fields server-controlled.
    const token = helpers.readSessionToken(c);
    // Store caption/disclosures whenever provided (library reopen); always
    // required for pending approval.
    const storeCaption = approvalStatus === "pending" || caption ? caption : "";
    const storeDisclosures =
      approvalStatus === "pending" || disclosures ? disclosures : "";
    const modelPolicy = policies.geminiModelPolicySnapshot();
    const ownerSessionHash = token ? helpers.hashSessionToken(token) : "";
    generationClaimOwner = ownerSessionHash;
    const captionSourceCandidate = helpers.assertString(
      (body.caption_source || "").toString(),
      30,
    );
    // Operational provenance is derived from prompt-free proxy events bound to
    // this exact session AND this exact logical model attempt. A broad recent
    // session window allowed an older AI success to relabel a later local safe
    // template, so attempt ids are now required for affirmative AI metadata.
    const normalizeAttemptId = function (value) {
      const candidate = (value || "").toString();
      return /^[A-Za-z0-9_-]{16,80}$/.test(candidate) ? candidate : "";
    };
    const captionAttemptId = normalizeAttemptId(body.caption_attempt_id);
    const imageAttemptId = normalizeAttemptId(body.image_attempt_id);
    const eventCutoff = helpers.databaseTimestamp(
      new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    );
    const loadAttemptEvents = function (attemptId) {
      if (!ownerSessionHash || !attemptId) return [];
      try {
        return $app
          .dao()
          .findRecordsByFilter(
            "generation_events",
            "owner_session_hash = {:owner} && dealer = {:dealer} && attempt_id = {:attempt} && occurred_at >= {:cutoff}",
            "-occurred_at",
            20,
            0,
            {
              owner: ownerSessionHash,
              dealer: dealer.id,
              attempt: attemptId,
              cutoff: eventCutoff,
            },
          )
          .filter(function (event) {
            return !event.getString("consumed_post");
          });
      } catch (_e) {
        return [];
      }
    };
    const captionGenerationEvents = loadAttemptEvents(captionAttemptId);
    const imageGenerationEvents =
      imageAttemptId && imageAttemptId !== captionAttemptId
        ? loadAttemptEvents(imageAttemptId)
        : [];
    const recentGenerationEvents =
      captionGenerationEvents.concat(imageGenerationEvents);
    if (recentGenerationEvents.length) {
      try {
        generationClaimToken = helpers.claimGenerationEvents(
          recentGenerationEvents.map(function (event) {
            return event.id;
          }),
          ownerSessionHash,
          dealer.id,
        );
        generationClaimCount = recentGenerationEvents.length;
      } catch (_e) {
        return c.json(409, {
          error: "GENERATION_ATTEMPT_ALREADY_USED",
          code: "GENERATION_ATTEMPT_ALREADY_USED",
          message: "This generation result was already saved to another post.",
        });
      }
    }
    // Which text tasks may be claimed as "an AI wrote this caption". This is
    // provenance, not a task inventory: `vision_review` is a text task on the
    // same models, but it is a QC read of a rendered image and must never
    // relabel a locally templated caption as AI-generated. Any new text task
    // has to be listed here explicitly, with its answer.
    const captionTasks = {
      caption: true,
      caption_regenerate: true,
      caption_edit: true,
      vision_review: false,
    };
    const imageTasks = { image_standard: true, image_studio: true };
    let latestCaptionSuccess = null;
    let latestImageSuccess = null;
    let latestAnySuccess = null;
    let serverFallbackCount = 0;
    captionGenerationEvents.forEach(function (event) {
      const task = event.getString("task");
      const succeeded = event.getBool
        ? event.getBool("succeeded")
        : !!event.get("succeeded");
      if (!succeeded) {
        serverFallbackCount += 1;
        return;
      }
      if (!latestAnySuccess) latestAnySuccess = event;
      if (!latestCaptionSuccess && captionTasks[task]) {
        latestCaptionSuccess = event;
      }
    });
    imageGenerationEvents.forEach(function (event) {
      const task = event.getString("task");
      const succeeded = event.getBool
        ? event.getBool("succeeded")
        : !!event.get("succeeded");
      if (!succeeded) {
        serverFallbackCount += 1;
        return;
      }
      if (!latestImageSuccess && imageTasks[task]) latestImageSuccess = event;
      if (
        !latestAnySuccess ||
        event.getString("occurred_at") > latestAnySuccess.getString("occurred_at")
      ) {
        latestAnySuccess = event;
      }
    });
    const captionSource =
      captionSourceCandidate === "custom"
        ? "custom"
        : captionSourceCandidate === "basic_fallback"
          ? "basic_fallback"
          : latestCaptionSuccess
            ? "ai"
            : "";
    const generationTier = latestImageSuccess
      ? latestImageSuccess.getString("tier")
      : "";
    const generationModel = latestAnySuccess ? latestAnySuccess.getString("model") : "";
    const generationFallbackCount = Math.min(20, serverFallbackCount);
    const generationLastSuccessAt = latestAnySuccess
      ? latestAnySuccess.getString("occurred_at")
      : "";
    const modelPolicyVersion = recentGenerationEvents.length
      ? String(modelPolicy.version)
      : "";
    form.loadData({
      dealer: dealer.id,
      salesperson_name: helpers.assertString(salespersonName, 120),
      salesperson_id: salespersonId,
      generated_at: new Date().toISOString(),
      style: helpers.assertString((body.style || "").toString(), 60),
      tone: helpers.assertString((body.tone || "").toString(), 60),
      customer_name: protectedCustomerName,
      scenario_id: scenarioId,
      vin: helpers.assertString((body.vin || "").toString(), 17),
      scheduled_for: helpers.assertString((body.scheduled_for || "").toString(), 40),
      // Release status is derived from a durably stored, same-dealer signature
      // by the photo-releases endpoint. Never trust a client assertion here.
      has_release: false,
      release_required: releaseRequired,
      release_status: releaseRequired ? "pending" : "not_required",
      // Video metrics are recorded only by the owner-scoped completion route
      // after rendering succeeds; a client cannot pre-claim success here.
      has_video: false,
      approval_status: approvalStatus,
      approved_by: "",
      approved_at: "",
      caption: storeCaption,
      disclosures: storeDisclosures,
      platform_ids: JSON.stringify(platformIds),
      media_output_mode: mediaOutputMode,
      platform_captions: parsedPlatformCaptions.serialized,
      primary_format_id: primaryFormatId,
      image_aspect_ratio: imageAspectRatio,
      caption_source: captionSource,
      generation_tier: generationTier,
      generation_model: generationModel,
      generation_fallback_count: generationFallbackCount,
      generation_last_success_at: generationLastSuccessAt,
      model_policy_version: modelPolicyVersion,
      website_draft: websiteDraftSerialized,
      // Every derived artifact (approval polling, protected creative, video
      // completion) is bound to the opaque browser session that logged it.
      owner_session_hash: ownerSessionHash,
      owner_person_id: salespersonId,
      attribution_authoritative: !!context.person,
    });
    if (creativeFile) form.addFiles("creative_image", creativeFile);
    form.submit();
    createdPostRecord = record;

    if (approvalStatus === "pending" && !record.getString("creative_image")) {
      // Never create a queue item a manager cannot actually inspect.
      let postRemoved = false;
      try {
        $app.dao().deleteRecord(record);
        postRemoved = true;
      } catch (_e) {
        console.error("[posts] failed to remove incomplete approval post");
      }
      createdPostRecord = null;
      if (generationClaimToken && postRemoved) {
        helpers.releaseGenerationEventClaims(
          generationClaimToken,
          generationClaimOwner,
          dealer.id,
        );
        generationClaimToken = "";
      }
      return c.json(400, { error: "Review image is required" });
    }

    if (generationClaimToken) {
      helpers.finalizeGenerationEventClaims(
        generationClaimToken,
        record.id,
        generationClaimOwner,
        dealer.id,
        generationClaimCount,
      );
      generationClaimToken = "";
    }

    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, {
      id: record.id,
      dealer: dealer.id,
      generated_at: record.getString("generated_at"),
      updated: record.getString("updated"),
      customer_name: publicCustomerName,
      approval_status: record.getString("approval_status"),
      release_required: record.getBool
        ? record.getBool("release_required")
        : !!record.get("release_required"),
      release_status: record.getString("release_status"),
      platform_ids: platformIds,
      media_output_mode: mediaOutputMode,
      platform_captions: parsedPlatformCaptions.value,
      primary_format_id: primaryFormatId,
      image_aspect_ratio: imageAspectRatio,
      image_review_required:
        policies.postImageReviewRequired(record, modelPolicy) || undefined,
      website_draft: websiteDraft && websiteDraft.enabled ? websiteDraft : null,
      website_publication: websitePublications.publicationSummaryForPost(record, null),
    });
  } catch (err) {
    if (generationClaimToken) {
      let postRemoved = !createdPostRecord;
      if (createdPostRecord) {
        try {
          $app.dao().deleteRecord(createdPostRecord);
          postRemoved = true;
        } catch (_cleanupError) {
          console.error("[posts] failed to roll back post after claim failure");
        }
      }
      if (postRemoved) {
        try {
          helpers.releaseGenerationEventClaims(
            generationClaimToken,
            generationClaimOwner,
            dealer.id,
          );
        } catch (_cleanupError) {
          console.error("[posts] failed to release generation claim");
        }
      }
    }
    console.error("[/api/app/posts] create error", err);
    return c.json(400, { error: "Failed to log post" });
  }
});

// Persist the latest editable draft for History recovery. Approval submissions
// remain immutable: the manager must always review the exact original copy.
routerAdd("PATCH", "/api/app/posts/:id/draft", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });

  try {
    const record = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (record.getString("dealer") !== context.dealer.id) {
      return c.json(403, { error: "Cross-dealer draft update blocked" });
    }
    const token = helpers.readSessionToken(c);
    const ownerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner = !!ownerHash && ownerHash === record.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
    if (!isOwner && !isSamePerson) {
      return c.json(403, { error: "Post belongs to another person" });
    }
    if (record.getString("approval_status") !== "n_a") {
      return c.json(409, {
        error: "Approval review copies are immutable; create another post to revise it",
      });
    }
    const websitePublications = require(__hooks + "/websitePublications.js");
    if (websitePublications.findPublicationForPost(record.id, "")) {
      return c.json(409, {
        error:
          "Website delivery copies are immutable; create another post to revise it",
      });
    }

    const body = $apis.requestInfo(c).data || {};
    // Phase A rollout compatibility: an older installed frontend omits this
    // field entirely. Bind that request to the revision loaded above, then
    // apply the same transaction recheck. Once the sender rollout is proven,
    // Phase C removes this absence-only fallback.
    const revisionWasSupplied = Object.prototype.hasOwnProperty.call(
      body,
      "expected_post_revision",
    );
    if (!revisionWasSupplied) {
      // Stage C's release gate: strict enforcement ships only after these
      // lines stop appearing in the production log for the rollout window.
      console.log("[revision-legacy-client] route=draft post=" + record.id);
    }
    const expectedPostRevision = revisionWasSupplied
      ? typeof body.expected_post_revision === "string"
        ? body.expected_post_revision.trim()
        : ""
      : record.getString("updated");
    if (
      (revisionWasSupplied && typeof body.expected_post_revision !== "string") ||
      !expectedPostRevision ||
      expectedPostRevision.length > 80
    ) {
      return c.json(409, {
        error: "Reload this saved post before editing it.",
        code: "POST_DRAFT_REVISION_REQUIRED",
      });
    }
    let caption = helpers.assertString((body.caption || "").toString().trim(), 12000);
    let disclosures = helpers.assertString(
      (body.disclosures || "").toString().trim(),
      12000,
    );
    if (!caption) return c.json(400, { error: "Draft caption is required" });
    const allowedPlatformIds = helpers.allowedPostPlatformIds();
    let selectedPlatformIds = [];
    try {
      const storedPlatformIds = JSON.parse(record.getString("platform_ids") || "[]");
      if (Array.isArray(storedPlatformIds)) {
        selectedPlatformIds = storedPlatformIds.filter(function (platformId, index) {
          return (
            typeof platformId === "string" &&
            allowedPlatformIds.indexOf(platformId) !== -1 &&
            storedPlatformIds.indexOf(platformId) === index
          );
        });
      }
    } catch (_e) {}
    let parsedPlatformCaptions = null;
    if (body.platform_captions !== undefined && body.platform_captions !== null) {
      parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
        body.platform_captions,
        allowedPlatformIds,
        selectedPlatformIds,
      );
      if (!parsedPlatformCaptions.ok) {
        return c.json(400, { error: parsedPlatformCaptions.error });
      }
    } else {
      parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
        record.getString("platform_captions"),
        allowedPlatformIds,
        selectedPlatformIds,
      );
      if (!parsedPlatformCaptions.ok) {
        return c.json(400, { error: parsedPlatformCaptions.error });
      }
    }
    const storedWebsiteDraft = websitePublications.parseWebsiteDraft(
      record.getString("website_draft"),
    );
    const websiteVehicleDescription =
      storedWebsiteDraft.ok &&
      storedWebsiteDraft.value &&
      storedWebsiteDraft.value.enabled
        ? websitePublications.groundedVehicleIdentityPhrase(
            storedWebsiteDraft.value.vehicleDescription || "",
          )
        : "";
    const platformCaptionIds = Object.keys(parsedPlatformCaptions.value);
    const identityReview = policies.reviewCustomerIdentityExcludingDisclosures(
      websitePublications.reviewPostCustomerIdentity,
      record.getString("customer_name"),
      [caption, disclosures].concat(
        platformCaptionIds.map(function (platformId) {
          return parsedPlatformCaptions.value[platformId];
        }),
      ),
      [
        websitePublications.groundedIdentityPhrase(context.dealer.getString("name")),
        websitePublications.groundedIdentityPhrase(
          context.dealer.getString("oem_affiliation"),
        ),
        context.person ? context.person.getString("name") : "System Admin",
        websitePublications.publicCustomerLabel(
          context.person ? context.person.getString("name") : "System Admin",
        ),
        websitePublications.groundedIdentityPhrase(websiteVehicleDescription),
      ],
      (record.getBool
        ? record.getBool("release_required")
        : !!record.get("release_required")) &&
        !websitePublications.publicCustomerLabel(record.getString("customer_name")),
    );
    if (identityReview.unexpectedIdentity) {
      return c.json(400, {
        error:
          "Customer-name review required. Remove any unapproved customer name and try again.",
        code: "CUSTOMER_IDENTITY_CONFLICT",
      });
    }
    caption = identityReview.projectedValues[0] || "";
    disclosures = identityReview.projectedValues[1] || "";
    const projectedPlatformCaptions = {};
    for (let i = 0; i < platformCaptionIds.length; i++) {
      projectedPlatformCaptions[platformCaptionIds[i]] =
        identityReview.projectedValues[i + 2] || "";
    }
    parsedPlatformCaptions.value = projectedPlatformCaptions;
    parsedPlatformCaptions.serialized = JSON.stringify(projectedPlatformCaptions);
    const compliance = policies.validatePostComplianceSet(
      [caption].concat(Object.values(parsedPlatformCaptions.value)),
      disclosures,
      context.dealer.getString("banned_phrases"),
    );
    if (!compliance.ok) return c.json(400, { error: compliance.error });

    let creativeFile = null;
    try {
      const header = c.formFile("creative_image");
      if (header) creativeFile = $filesystem.fileFromMultipart(header);
    } catch (_e) {}
    const draftData = {
      caption: caption,
      disclosures: disclosures,
    };
    if (parsedPlatformCaptions) {
      draftData.platform_captions = parsedPlatformCaptions.serialized;
    }
    let savedRecord = null;
    $app.dao().runInTransaction(function (txDao) {
      // This write fence is deliberately first. It serializes a draft save
      // against the final website handoff before either operation rechecks the
      // publication row, so media cannot change after the outbox wins.
      const fence = txDao
        .db()
        .newQuery("UPDATE posts SET updated = updated WHERE id = {:post}")
        .bind({ post: record.id })
        .execute();
      if (!fence || fence.rowsAffected() !== 1) {
        throw new Error("source_post_missing");
      }
      const current = txDao.findRecordById("posts", record.id);
      if (
        current.getString("dealer") !== context.dealer.id ||
        current.getString("owner_session_hash") !==
          record.getString("owner_session_hash") ||
        current.getString("owner_person_id") !== record.getString("owner_person_id")
      ) {
        throw new Error("post_draft_authority_changed");
      }
      if (current.getString("approval_status") !== "n_a") {
        throw new Error("post_draft_immutable");
      }
      if (current.getString("updated") !== expectedPostRevision) {
        throw new Error("post_draft_revision_conflict");
      }
      if (
        websitePublications.findPublicationForPostWithDaoStrict(txDao, current.id, "")
      ) {
        throw new Error("website_draft_already_sent");
      }
      const form = new RecordUpsertForm($app, current);
      form.setFullManageAccess(true);
      form.setDao(txDao);
      form.loadData(draftData);
      if (creativeFile) form.addFiles("creative_image", creativeFile);
      form.submit();
      savedRecord = txDao.findRecordById("posts", current.id);
    });

    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, {
      id: record.id,
      updated: true,
      post_revision: savedRecord ? savedRecord.getString("updated") : "",
    });
  } catch (err) {
    const code = (err && err.message ? err.message : "").toString();
    if (code === "website_draft_already_sent") {
      return c.json(409, {
        error:
          "Website delivery copies are immutable; create another post to revise it",
        code: "WEBSITE_DRAFT_ALREADY_SENT",
      });
    }
    if (code === "post_draft_revision_conflict") {
      return c.json(409, {
        error: "This draft changed in another window. Reload it before saving again.",
        code: "POST_DRAFT_REVISION_CONFLICT",
      });
    }
    if (code === "post_draft_immutable") {
      return c.json(409, {
        error: "Approval review copies are immutable; create another post to revise it",
      });
    }
    console.error("[/api/app/posts/:id/draft] update error", err);
    return c.json(400, { error: "Failed to update saved draft" });
  }
});

// Record successful video rendering only from the browser session that logged
// the source post. The transition is intentionally idempotent so client retry
// after a lost response cannot inflate or corrupt metrics.
routerAdd("POST", "/api/app/posts/:id/video-generated", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;

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
  const isOwner =
    !!currentOwnerHash && currentOwnerHash === record.getString("owner_session_hash");
  const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
  if (!isOwner && !isSamePerson) {
    return c.json(403, { error: "Post belongs to another session" });
  }

  try {
    const alreadyGenerated = record.getBool
      ? record.getBool("has_video")
      : !!record.get("has_video");
    if (!alreadyGenerated) {
      // Column-scoped on purpose. Saving the record loaded above would write
      // every column back (undoing a caption saved since it was read) and
      // advance posts.updated, the editor's compare-and-set revision, so an
      // autosave already in flight would be rejected as stale. The flag is
      // not post content: it changes neither the row's other columns nor the
      // revision, and this route returns no revision for an editor to adopt.
      $app
        .dao()
        .db()
        .newQuery(
          "UPDATE posts SET has_video = 1 " +
            "WHERE id = {:post} AND dealer = {:dealer} AND COALESCE(has_video, 0) = 0",
        )
        .bind({ post: record.id, dealer: dealer.id })
        .execute();
    }
    return c.json(200, { id: record.id, has_video: true });
  } catch (err) {
    console.error("[/api/app/posts/:id/video-generated] error", err);
    return c.json(500, { error: "Failed to record generated video" });
  }
});

routerAdd("POST", "/api/app/posts/:id/schedule", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;

  let record = null;
  try {
    record = $app.dao().findRecordById("posts", c.pathParam("id"));
  } catch (_e) {
    return c.json(404, { error: "Post not found" });
  }

  if (record.getString("dealer") !== dealer.id) {
    return c.json(403, { error: "Cross-dealer post update blocked" });
  }

  const token = helpers.readSessionToken(c);
  const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
  const isOwner =
    !!currentOwnerHash && currentOwnerHash === record.getString("owner_session_hash");
  const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
  if (!isOwner && !isSamePerson) {
    return c.json(403, { error: "Post belongs to another session" });
  }
  if (policies.postImageReviewRequired(record, policies.geminiModelPolicySnapshot())) {
    return c.json(409, {
      error: "IMAGE_REVIEW_REQUIRED",
      code: "IMAGE_REVIEW_REQUIRED",
      message:
        "This saved image predates the current on-pixel safety review. Create a new post before scheduling it.",
    });
  }

  try {
    const body = $apis.requestInfo(c).data || {};
    const scheduledFor = helpers.assertString(
      (body.scheduled_for || "").toString(),
      40,
    );
    record.set("scheduled_for", scheduledFor);
    $app.dao().saveRecord(record);
    return c.json(200, { id: record.id, scheduled_for: scheduledFor });
  } catch (err) {
    console.error("[/api/app/posts/:id/schedule] error", err);
    return c.json(500, { error: "Failed to schedule post" });
  }
});

// The submitting browser can poll only its own post. A post id is not a bearer
// credential: ownership is checked against a SHA-256 verifier of the current
// opaque session token, and the dealer relationship is checked independently.
routerAdd("GET", "/api/app/posts/:id/status", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;

  try {
    const record = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, { error: "Cross-dealer status read blocked" });
    }

    const role = context.role;
    const isManager = role === "dealer_admin" || role === "super_admin";
    const token = helpers.readSessionToken(c);
    const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner =
      !!currentOwnerHash && currentOwnerHash === record.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
    if (!isOwner && !isManager && !isSamePerson) {
      return c.json(403, { error: "Post status belongs to another session" });
    }

    c.response().header().set("Cache-Control", "private, no-store");
    const websitePublications = require(__hooks + "/websitePublications.js");
    const websitePublication = websitePublications.findPublicationForPost(
      record.id,
      "",
    );
    return c.json(200, {
      id: record.id,
      // A manager decision advances posts.updated. Once a post has left the
      // n_a state its content is immutable, so the author's editor can adopt
      // this revision for share receipts without risking a lost edit.
      post_revision: record.getString("updated"),
      approval_status: record.getString("approval_status"),
      approved_by: record.getString("approved_by"),
      approved_at: record.getString("approved_at"),
      rejection_reason: record.getString("rejection_reason"),
      image_review_required:
        policies.postImageReviewRequired(
          record,
          policies.geminiModelPolicySnapshot(),
        ) || undefined,
      website_publication: websitePublications.publicationSummaryForPost(
        record,
        websitePublication,
      ),
    });
  } catch (err) {
    return c.json(404, { error: "Post not found" });
  }
});

// Record that the post's author completed a share: the OS share sheet
// resolved, the file was downloaded, or the caption was copied. The client
// calls this only after the share happened, and the row says only that — the
// honest label is "sent to the share sheet", never which app received it.
//
// Events live in `post_share_events`, never on the post: saving the post
// would bump `posts.updated`, which is the website hand-off's post_revision.
// The route fails closed on every delivery lock, deduplicates a repeat of the
// same channel and method within 60 seconds, and keeps the newest 20 events
// per post. Additive: an older frontend never calls it.
routerAdd("POST", "/api/app/posts/:id/shared", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;
  const shareWriter = context.person ? context.person.id : context.session.id;
  const shareHourly = helpers.checkProxyRateLimit(
    "app-write:post-share:hour:" + dealer.id + ":" + shareWriter,
    120,
    60 * 60 * 1000,
  );
  if (!shareHourly.ok) {
    const retryAfter = Math.max(1, Math.ceil((shareHourly.retryAfterMs || 0) / 1000));
    c.response().header().set("Retry-After", String(retryAfter));
    return c.json(429, {
      error: "WRITE_RATE_LIMITED",
      code: "WRITE_RATE_LIMITED",
      message: "Too many shares recorded. Try again later.",
    });
  }

  let record = null;
  try {
    record = $app.dao().findRecordById("posts", c.pathParam("id"));
  } catch (_e) {
    return c.json(404, { error: "Post not found" });
  }

  if (record.getString("dealer") !== dealer.id) {
    return c.json(403, { error: "Cross-dealer share record blocked" });
  }

  // Only the post's author records a share. A manager reading a teammate's
  // post in History is not its author.
  const token = helpers.readSessionToken(c);
  const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
  const isOwner =
    !!currentOwnerHash && currentOwnerHash === record.getString("owner_session_hash");
  const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
  if (!isOwner && !isSamePerson) {
    return c.json(403, { error: "Post belongs to another session" });
  }

  let body = null;
  try {
    body = $apis.requestInfo(c).data || {};
  } catch (_e) {
    return c.json(400, {
      error: "INVALID_SHARE_REQUEST",
      code: "INVALID_SHARE_REQUEST",
      message: "The share record request is invalid.",
    });
  }
  const channel = typeof body.channel === "string" ? body.channel.trim() : "";
  const via = typeof body.via === "string" ? body.via.trim() : "";
  // Phase A rollout compatibility mirrors draft saves: only true absence gets
  // the record revision loaded for this request. A malformed supplied value
  // never downgrades to legacy behavior, and the transaction rechecks either
  // token after taking the post write fence.
  const revisionWasSupplied = Object.prototype.hasOwnProperty.call(
    body,
    "expected_post_revision",
  );
  const expectedPostRevision = revisionWasSupplied
    ? typeof body.expected_post_revision === "string"
      ? body.expected_post_revision.trim()
      : ""
    : record.getString("updated");
  if (helpers.allowedPostPlatformIds().indexOf(channel) === -1) {
    return c.json(400, {
      error: "INVALID_SHARE_CHANNEL",
      code: "INVALID_SHARE_CHANNEL",
      message: "Unknown share destination.",
    });
  }
  if (["share_sheet", "download", "copy"].indexOf(via) === -1) {
    return c.json(400, {
      error: "INVALID_SHARE_METHOD",
      code: "INVALID_SHARE_METHOD",
      message: "Unknown share method.",
    });
  }
  if (
    (revisionWasSupplied && typeof body.expected_post_revision !== "string") ||
    !expectedPostRevision ||
    expectedPostRevision.length > 80
  ) {
    return c.json(409, {
      error: "Save or reload this post before recording its share.",
      code: "POST_SHARE_REVISION_REQUIRED",
      message: "The share receipt needs the revision of the saved copy.",
    });
  }
  if (record.getString("updated") !== expectedPostRevision) {
    return c.json(409, {
      error: "POST_SHARE_REVISION_CONFLICT",
      code: "POST_SHARE_REVISION_CONFLICT",
      message: "This post changed before the share receipt was recorded.",
    });
  }

  // Delivery locks. Unknown or legacy-blank approval states fail closed, the
  // same reading the website hand-off applies.
  const approval = record.getString("approval_status");
  if (approval !== "n_a" && approval !== "approved") {
    return c.json(409, {
      error: "APPROVAL_REQUIRED",
      code: "APPROVAL_REQUIRED",
      message: "This post needs a manager's approval before it is shared.",
    });
  }
  const releaseRequired = record.getBool
    ? record.getBool("release_required")
    : !!record.get("release_required");
  const hasRelease = record.getBool
    ? record.getBool("has_release")
    : !!record.get("has_release");
  if (
    releaseRequired &&
    (!hasRelease || record.getString("release_status") !== "saved")
  ) {
    return c.json(409, {
      error: "RELEASE_NOT_SAVED",
      code: "RELEASE_NOT_SAVED",
      message: "The customer's photo release is not saved on this post.",
    });
  }
  if (policies.postImageReviewRequired(record, policies.geminiModelPolicySnapshot())) {
    return c.json(409, {
      error: "IMAGE_REVIEW_REQUIRED",
      code: "IMAGE_REVIEW_REQUIRED",
      message: "This saved image predates the current on-pixel safety review.",
    });
  }

  try {
    // Both copy locks below read the stored caption set: the caption and
    // every selected destination's caption.
    const websitePublications = require(__hooks + "/websitePublications.js");
    const allowedPlatformIds = helpers.allowedPostPlatformIds();
    let platformIds = [];
    try {
      const parsed = JSON.parse(record.getString("platform_ids") || "[]");
      if (Array.isArray(parsed)) {
        platformIds = parsed.filter(
          (id, index) =>
            typeof id === "string" &&
            allowedPlatformIds.indexOf(id) !== -1 &&
            parsed.indexOf(id) === index,
        );
      }
    } catch (_e) {}
    const parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
      record.getString("platform_captions"),
      allowedPlatformIds,
      platformIds,
    );
    const platformCaptions = parsedPlatformCaptions.ok
      ? parsedPlatformCaptions.value
      : {};

    // The claim lock the result screen enforces (utils/postLocks.ts), under
    // the current server policy: prohibited claims, this dealership's blocked
    // wording as configured now, and the canonical disclosures, over the same
    // stored caption set the draft save and the approval decision validate. A
    // phrase the dealership blocks after the post was saved locks it here too.
    const compliance = policies.validatePostComplianceSet(
      [record.getString("caption")].concat(Object.values(platformCaptions)),
      record.getString("disclosures"),
      dealer.getString("banned_phrases"),
    );
    if (!compliance.ok) {
      // The result screen's claim-lock wording (prohibitedClaimsMessage in
      // utils/complianceDisclosures.ts). The policy names the dealership's
      // blocked phrases but only flags a legal claim, so that one is described
      // rather than quoted. A disclosure mismatch keeps the policy's error.
      const blockedPhrases = compliance.dealer_blocked_phrases || [];
      const legalClaim = !!compliance.legal_prohibited;
      let claimMessage = compliance.error;
      if (legalClaim || blockedPhrases.length > 0) {
        const quoted = blockedPhrases
          .map((phrase) => "\u201c" + phrase.trim() + "\u201d")
          .join(", ");
        const reason =
          legalClaim && blockedPhrases.length > 0
            ? "These claims are prohibited or blocked by this dealership and cannot be published."
            : legalClaim
              ? "Claims such as guaranteed approval or no credit check cannot be published."
              : "This dealership has blocked this wording, so it cannot be published.";
        claimMessage = legalClaim
          ? "Remove prohibited advertising claims" +
            (quoted ? ", including " + quoted : "") +
            ". " +
            reason
          : "Remove prohibited advertising claim" +
            (blockedPhrases.length === 1 ? "" : "s") +
            ": " +
            quoted +
            ". " +
            reason;
      }
      return c.json(409, {
        error: "CLAIMS_BLOCKED",
        code: "CLAIMS_BLOCKED",
        message: claimMessage,
      });
    }

    // The same customer-identity review the History list projects as
    // identity_review_required: caption, disclosures, every destination
    // caption, and the website draft.
    const storedWebsiteDraft = websitePublications.parseWebsiteDraft(
      record.getString("website_draft"),
    );
    const rawWebsiteDraft =
      storedWebsiteDraft.ok &&
      storedWebsiteDraft.value &&
      storedWebsiteDraft.value.enabled
        ? storedWebsiteDraft.value
        : null;
    const protectedCustomerName = record.getString("customer_name");
    const copyReview = policies.reviewCustomerIdentityExcludingDisclosures(
      websitePublications.reviewPostCustomerIdentity,
      protectedCustomerName,
      [record.getString("caption"), record.getString("disclosures")].concat(
        Object.keys(platformCaptions).map((id) => platformCaptions[id]),
      ),
      [
        websitePublications.groundedIdentityPhrase(dealer.getString("name")),
        websitePublications.groundedIdentityPhrase(dealer.getString("oem_affiliation")),
        record.getString("salesperson_name"),
        websitePublications.publicCustomerLabel(record.getString("salesperson_name")),
        websitePublications.groundedIdentityPhrase(
          rawWebsiteDraft
            ? websitePublications.groundedVehicleIdentityPhrase(
                rawWebsiteDraft.vehicleDescription || "",
              )
            : "",
        ),
      ],
      releaseRequired &&
        !websitePublications.publicCustomerLabel(protectedCustomerName),
    );
    const websiteReview = websitePublications.publicWebsiteDraftForPost(
      record,
      dealer.getString("name"),
      dealer.getString("oem_affiliation"),
      policies.identityReviewExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
      ),
    );
    if (copyReview.reviewRequired || websiteReview.identityReviewRequired) {
      return c.json(409, {
        error: "IDENTITY_REVIEW_REQUIRED",
        code: "IDENTITY_REVIEW_REQUIRED",
        message: "This post's copy is held for customer-name review.",
      });
    }

    const maxShareEvents = 20;
    const dedupeSince = helpers.databaseTimestamp(
      new Date(Date.now() - 60 * 1000).toISOString(),
    );
    let shared = null;
    let deduplicated = false;
    $app.dao().runInTransaction(function (txDao) {
      // Serialize with draft updates and the website handoff, then recheck the
      // client revision. The policy checks above therefore describe the exact
      // saved copy associated with this receipt.
      const fence = txDao
        .db()
        .newQuery("UPDATE posts SET updated = updated WHERE id = {:post}")
        .bind({ post: record.id })
        .execute();
      if (!fence || fence.rowsAffected() !== 1) {
        throw new Error("source_post_missing");
      }
      const current = txDao.findRecordById("posts", record.id);
      if (current.getString("updated") !== expectedPostRevision) {
        throw new Error("post_share_revision_conflict");
      }
      const existing = txDao.findRecordsByFilter(
        "post_share_events",
        "post = {:post}",
        "-created,-id",
        100,
        0,
        { post: record.id },
      );
      for (let i = 0; i < existing.length; i++) {
        if (
          existing[i].getString("channel") === channel &&
          existing[i].getString("via") === via &&
          existing[i].getString("created") >= dedupeSince
        ) {
          shared = existing[i];
          deduplicated = true;
          return;
        }
      }
      const event = new Record(txDao.findCollectionByNameOrId("post_share_events"));
      event.set("post", record.id);
      event.set("dealer", dealer.id);
      event.set("channel", channel);
      event.set("via", via);
      txDao.saveRecord(event);
      shared = event;
      // Keep the newest events: the one just written plus maxShareEvents - 1.
      for (let i = maxShareEvents - 1; i < existing.length; i++) {
        txDao.deleteRecord(existing[i]);
      }
    });

    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, {
      id: record.id,
      channel: shared.getString("channel"),
      via: shared.getString("via"),
      shared_at: shared.getString("created"),
      deduplicated: deduplicated,
      post_revision: expectedPostRevision,
    });
  } catch (err) {
    if ((err && err.message ? err.message : "") === "post_share_revision_conflict") {
      return c.json(409, {
        error: "POST_SHARE_REVISION_CONFLICT",
        code: "POST_SHARE_REVISION_CONFLICT",
        message: "This post changed before the share receipt was recorded.",
      });
    }
    console.error("[/api/app/posts/:id/shared] error", err);
    return c.json(500, { error: "Failed to record share" });
  }
});

routerAdd("GET", "/api/app/posts/:id/website-publication", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  try {
    const post = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (post.getString("dealer") !== context.dealer.id) {
      return c.json(403, { error: "Cross-dealer website status read blocked" });
    }
    const isManager = context.role === "dealer_admin" || context.role === "super_admin";
    const token = helpers.readSessionToken(c);
    const ownerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner = !!ownerHash && ownerHash === post.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, post);
    if (!isManager && !isOwner && !isSamePerson) {
      return c.json(403, { error: "Website status belongs to another person" });
    }
    const websitePublications = require(__hooks + "/websitePublications.js");
    const publication = websitePublications.findPublicationForPost(post.id, "");
    c.response().header().set("Cache-Control", "private, no-store");
    const summary = websitePublications.publicationSummaryForPost(post, publication);
    const publicDraft = websitePublications.publicWebsiteDraftForPost(
      post,
      context.dealer.getString("name"),
      context.dealer.getString("oem_affiliation"),
      policies.identityReviewExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
      ),
    );
    if (publicDraft.websiteDraft) {
      summary.websiteDraft = publicDraft.websiteDraft;
    }
    summary.identity_review_required = publicDraft.identityReviewRequired;
    const imageReviewRequired = policies.postImageReviewRequired(
      post,
      policies.geminiModelPolicySnapshot(),
    );
    summary.image_review_required = imageReviewRequired || undefined;
    if (imageReviewRequired) {
      // Never hand a legacy creative's remote review link back to the app.
      // The private destination may already hold an older draft, but this UI
      // cannot become the path that publishes it.
      summary.reviewUrl = "";
      summary.lastError = "image_review_required";
    }
    return c.json(200, summary);
  } catch (_e) {
    return c.json(404, { error: "Post not found" });
  }
});

routerAdd("POST", "/api/app/posts/:id/website-publication", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  try {
    const post = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (post.getString("dealer") !== context.dealer.id) {
      return c.json(403, { error: "Cross-dealer website enqueue blocked" });
    }
    const isManager = context.role === "dealer_admin" || context.role === "super_admin";
    const token = helpers.readSessionToken(c);
    const ownerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner = !!ownerHash && ownerHash === post.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, post);
    if (!isManager && !isOwner && !isSamePerson) {
      return c.json(403, { error: "Post belongs to another person" });
    }
    if (policies.postImageReviewRequired(post, policies.geminiModelPolicySnapshot())) {
      return c.json(409, {
        error: "IMAGE_REVIEW_REQUIRED",
        code: "IMAGE_REVIEW_REQUIRED",
        message:
          "This saved image predates the current on-pixel safety review. Create a new post before sending it to the website.",
      });
    }
    const websitePublications = require(__hooks + "/websitePublications.js");
    if (!websitePublications.destinationConfiguration(context.dealer.id).enabled) {
      return c.json(409, {
        error: "WEBSITE_DESTINATION_UNAVAILABLE",
        code: "WEBSITE_DESTINATION_UNAVAILABLE",
        message:
          "The private website-draft destination is not configured for this dealership.",
      });
    }
    const body = $apis.requestInfo(c).data || {};
    const expectedPostRevision = (body.expected_post_revision || "").toString().trim();
    if (!expectedPostRevision) {
      return c.json(409, {
        error: "Save the latest caption and image before sending this website draft.",
        code: "WEBSITE_POST_REVISION_REQUIRED",
      });
    }
    const parsedDraft = websitePublications.parseWebsiteDraft(
      body.website_draft === undefined
        ? post.getString("website_draft")
        : body.website_draft,
    );
    if (!parsedDraft.ok || !parsedDraft.value || !parsedDraft.value.enabled) {
      return c.json(409, { error: "This post has no selected website draft" });
    }
    if (
      !websitePublications.websiteDraftMatchesScenario(
        post.getString("scenario_id"),
        context.dealer.getString("custom_scenarios"),
        parsedDraft.value,
      )
    ) {
      return c.json(409, {
        error: "Website draft does not match the selected post type",
        code: "WEBSITE_MAPPING_CONFLICT",
      });
    }
    const claim = websitePublications.claimPublicationForPost(
      post.id,
      parsedDraft.serialized,
      expectedPostRevision,
      context.dealer.id,
    );
    c.response().header().set("Cache-Control", "private, no-store");
    const summary = websitePublications.publicationSummaryForPost(
      claim.post,
      claim.publication,
    );
    const publicDraft = websitePublications.publicWebsiteDraftForPost(
      claim.post,
      context.dealer.getString("name"),
      context.dealer.getString("oem_affiliation"),
      policies.identityReviewExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
      ),
    );
    if (publicDraft.websiteDraft) {
      summary.websiteDraft = publicDraft.websiteDraft;
    }
    summary.identity_review_required = publicDraft.identityReviewRequired;
    summary.image_review_required =
      policies.postImageReviewRequired(
        claim.post,
        policies.geminiModelPolicySnapshot(),
      ) || undefined;
    summary.post_revision = claim.postRevision;
    summary.idempotent_replay = claim.idempotentReplay;
    return c.json(200, summary);
  } catch (err) {
    const code = (err && err.message ? err.message : "").toString();
    if (code === "website_post_revision_required") {
      return c.json(409, {
        error: "Save the latest caption and image before sending this website draft.",
        code: "WEBSITE_POST_REVISION_REQUIRED",
      });
    }
    if (code === "website_post_revision_conflict") {
      return c.json(409, {
        error:
          "The caption or image changed after the last save. Review and send again.",
        code: "WEBSITE_POST_REVISION_CONFLICT",
      });
    }
    if (code === "website_draft_already_sent") {
      return c.json(409, {
        error: "This website draft was already sent. Create another post to revise it.",
        code: "WEBSITE_DRAFT_ALREADY_SENT",
      });
    }
    if (code === "website_mapping_conflict") {
      return c.json(409, {
        error: "Website draft does not match the selected post type",
        code: "WEBSITE_MAPPING_CONFLICT",
      });
    }
    if (
      code === "creative_media_missing" ||
      code === "creative_media_empty" ||
      code === "creative_media_type_unsupported"
    ) {
      return c.json(409, {
        error: "Save a final website image before sending this draft.",
        code: "WEBSITE_CREATIVE_REQUIRED",
      });
    }
    console.error("[/api/app/posts/:id/website-publication] enqueue failed");
    return c.json(503, { error: "Website draft could not be queued" });
  }
});

routerAdd("POST", "/api/app/posts/:id/website-publication/retry", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  try {
    const post = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (post.getString("dealer") !== context.dealer.id) {
      return c.json(403, { error: "Cross-dealer website retry blocked" });
    }
    const isManager = context.role === "dealer_admin" || context.role === "super_admin";
    const token = helpers.readSessionToken(c);
    const ownerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner = !!ownerHash && ownerHash === post.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, post);
    if (!isManager && !isOwner && !isSamePerson) {
      return c.json(403, { error: "Post belongs to another person" });
    }
    if (policies.postImageReviewRequired(post, policies.geminiModelPolicySnapshot())) {
      return c.json(409, {
        error: "IMAGE_REVIEW_REQUIRED",
        code: "IMAGE_REVIEW_REQUIRED",
        message:
          "This saved image predates the current on-pixel safety review. Create a new post before retrying website delivery.",
      });
    }
    const websitePublications = require(__hooks + "/websitePublications.js");
    if (!websitePublications.destinationConfiguration(context.dealer.id).enabled) {
      return c.json(409, {
        error: "WEBSITE_DESTINATION_UNAVAILABLE",
        code: "WEBSITE_DESTINATION_UNAVAILABLE",
        message:
          "The private website-draft destination is not configured for this dealership.",
      });
    }
    const publication = websitePublications.retryPublication(post);
    const summary = websitePublications.publicationSummaryForPost(post, publication);
    const publicDraft = websitePublications.publicWebsiteDraftForPost(
      post,
      context.dealer.getString("name"),
      context.dealer.getString("oem_affiliation"),
      policies.identityReviewExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
      ),
    );
    if (publicDraft.websiteDraft) {
      summary.websiteDraft = publicDraft.websiteDraft;
    }
    summary.identity_review_required = publicDraft.identityReviewRequired;
    summary.image_review_required =
      policies.postImageReviewRequired(post, policies.geminiModelPolicySnapshot()) ||
      undefined;
    c.response().header().set("Cache-Control", "private, no-store");
    return c.json(200, summary);
  } catch (err) {
    const code = (err && err.message ? err.message : "").toString();
    if (
      code === "website_draft_already_ready" ||
      code === "approval_rejected" ||
      code === "website_mapping_conflict" ||
      code === "website_request_withdrawn" ||
      code === "website_request_not_sent"
    ) {
      return c.json(409, { error: code });
    }
    console.error("[/api/app/posts/:id/website-publication/retry] retry failed");
    return c.json(400, { error: "Website draft could not be retried" });
  }
});

// At-least-once private-draft delivery. The worker atomically leases each due
// row, recovers leases abandoned by a process restart, and caps each minute so
// provider trouble cannot monopolize PocketBase's JSVM worker pool.
cronAdd("deliver-private-website-drafts", "* * * * *", function () {
  try {
    require(__hooks + "/websitePublications.js").processDuePublications(10);
  } catch (_e) {
    console.error("[website publications] delivery tick failed");
  }
});

// Protected creative images are never exposed through PocketBase's public file
// route. This endpoint authorizes the manager (or submitting browser session)
// first and then streams the stored file from the configured local/S3 backend.
routerAdd("GET", "/api/app/posts/:id/creative-image", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;

  try {
    const record = $app.dao().findRecordById("posts", c.pathParam("id"));
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, { error: "Cross-dealer creative read blocked" });
    }

    const role = context.role;
    const isManager = role === "dealer_admin" || role === "super_admin";
    const token = helpers.readSessionToken(c);
    const currentOwnerHash = token ? helpers.hashSessionToken(token) : "";
    const isOwner =
      !!currentOwnerHash && currentOwnerHash === record.getString("owner_session_hash");
    const isSamePerson = helpers.isAuthoritativePostPerson(context, record);
    if (!isOwner && !isManager && !isSamePerson) {
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
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;
  const role = context.role;
  const isManager = role === "dealer_admin" || role === "super_admin";
  if (!isManager && !context.person) {
    return c.json(403, { error: "Personal session required" });
  }

  try {
    const query = $apis.requestInfo(c).query || {};
    const since = helpers.databaseTimestamp((query.since || "").toString());
    const until = helpers.databaseTimestamp((query.until || "").toString());
    const status = (query.approval_status || "").toString();
    const aggregate = (query.aggregate || "").toString().trim();
    const cursor = (query.cursor || "").toString().trim();
    const limitRaw = parseInt((query.limit || "200").toString(), 10);
    const limit = Math.min(Math.max(limitRaw || 200, 1), 1000);
    let cursorTime = "";
    let cursorId = "";
    if (aggregate && aggregate !== "leaderboard") {
      return c.json(400, {
        error: "INVALID_POST_AGGREGATE",
        code: "INVALID_POST_AGGREGATE",
        message: "The requested post aggregate is invalid.",
      });
    }
    if (cursor) {
      const cursorMatch = cursor.match(
        /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?)\|([A-Za-z0-9_-]{1,64})$/,
      );
      if (!cursorMatch) {
        return c.json(400, {
          error: "INVALID_POST_CURSOR",
          code: "INVALID_POST_CURSOR",
          message: "The post-history cursor is invalid.",
        });
      }
      cursorTime = helpers.databaseTimestamp(cursorMatch[1]);
      cursorId = cursorMatch[2];
    }

    if (aggregate === "leaderboard") {
      const summaryFilters = ["p.dealer = {:dealer}"];
      const summaryParams = { dealer: dealer.id };
      if (!isManager) {
        summaryFilters.push("p.attribution_authoritative = 1");
        summaryFilters.push("p.owner_person_id = {:person}");
        summaryParams.person = context.person.id;
      }
      if (since) {
        summaryFilters.push("p.generated_at >= {:since}");
        summaryParams.since = since;
      }
      if (until) {
        summaryFilters.push("p.generated_at <= {:until}");
        summaryParams.until = until;
      }
      if (status) {
        summaryFilters.push("p.approval_status = {:status}");
        summaryParams.status = status;
      }
      const summaryRows = arrayOf(
        new DynamicModel({
          salesperson: "",
          salespersonId: "",
          count: 0,
          videoCount: 0,
          releaseCount: 0,
          lastPostedAt: "",
        }),
      );
      $app
        .dao()
        .db()
        .newQuery(
          "SELECT " +
            "CASE WHEN p.attribution_authoritative = 1 " +
            "THEN COALESCE(NULLIF(s.name, ''), 'Former teammate') " +
            "ELSE 'Legacy unattributed' END AS salesperson, " +
            "CASE WHEN p.attribution_authoritative = 1 " +
            "THEN COALESCE(p.owner_person_id, '') ELSE '' END AS salespersonId, " +
            "COUNT(*) AS count, " +
            "COALESCE(SUM(CASE WHEN p.has_video = 1 THEN 1 ELSE 0 END), 0) AS videoCount, " +
            "COALESCE(SUM(CASE WHEN p.has_release = 1 THEN 1 ELSE 0 END), 0) AS releaseCount, " +
            "COALESCE(MAX(p.generated_at), '') AS lastPostedAt " +
            "FROM posts p LEFT JOIN salespeople s ON s.id = p.owner_person_id " +
            "WHERE " +
            summaryFilters.join(" AND ") +
            " GROUP BY p.attribution_authoritative, COALESCE(p.owner_person_id, ''), " +
            "CASE WHEN p.attribution_authoritative = 1 " +
            "THEN COALESCE(NULLIF(s.name, ''), 'Former teammate') " +
            "ELSE 'Legacy unattributed' END " +
            "ORDER BY count DESC, salesperson ASC",
        )
        .bind(summaryParams)
        .all(summaryRows);
      c.response().header().set("Cache-Control", "private, no-store");
      return c.json(200, {
        items: summaryRows.map((row) => ({
          salesperson: (row.salesperson || "Unattributed").toString(),
          salespersonId: (row.salespersonId || "").toString(),
          count: Number(row.count) || 0,
          videoCount: Number(row.videoCount) || 0,
          releaseCount: Number(row.releaseCount) || 0,
          lastPostedAt: (row.lastPostedAt || "").toString(),
        })),
      });
    }

    const filterParts = [`dealer = {:dealer}`];
    const params = { dealer: dealer.id };
    if (!isManager) {
      // Salespeople can recover their own work across browser sessions, but
      // never enumerate a teammate's customer posts. Legacy display
      // attribution was client-selectable, so only the server-owned marker/id
      // can grant cross-session recovery.
      filterParts.push(`attribution_authoritative = true`);
      filterParts.push(`owner_person_id = {:person}`);
      params.person = context.person.id;
    }
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
    if (cursorTime && cursorId) {
      filterParts.push(
        `(generated_at < {:cursorTime} || (generated_at = {:cursorTime} && id < {:cursorId}))`,
      );
      params.cursorTime = cursorTime;
      params.cursorId = cursorId;
    }

    const records = $app
      .dao()
      .findRecordsByFilter(
        "posts",
        filterParts.join(" && "),
        "-generated_at,-id",
        limit + 1,
        0,
        params,
      );
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;

    const allowedPlatformIds = helpers.allowedPostPlatformIds();
    const expectedAspectByFormat = {
      feed_portrait: "4:5",
      feed_square: "1:1",
      story_vertical: "9:16",
      marketplace: "16:9",
      gbp: "4:3",
    };
    const websitePublications = require(__hooks + "/websitePublications.js");
    const currentModelPolicy = policies.geminiModelPolicySnapshot();
    const websitePublicationByPost = websitePublications.publicationSummariesForDealer(
      dealer.id,
    );
    // Derived "Shared · Facebook" summary per post from post_share_events.
    // The route that writes them keeps at most 20 per post, so this read is
    // bounded by the page size. Ids are bound one placeholder each (dbx
    // rejects a JS array inside IN()), in chunks well under SQLite's limit.
    // A failed read leaves every summary null rather than failing the list.
    const shareSummaryByPost = {};
    try {
      const pagePostIds = page.map((r) => r.id);
      for (let start = 0; start < pagePostIds.length; start += 200) {
        const chunk = pagePostIds.slice(start, start + 200);
        const shareParams = { dealer: dealer.id };
        const placeholders = chunk.map((id, index) => {
          shareParams["post" + index] = id;
          return "{:post" + index + "}";
        });
        const shareRows = arrayOf(
          new DynamicModel({ post: "", channel: "", via: "", created: "" }),
        );
        $app
          .dao()
          .db()
          .newQuery(
            "SELECT post, channel, via, created FROM post_share_events " +
              "WHERE dealer = {:dealer} AND post IN (" +
              placeholders.join(", ") +
              ") ORDER BY created DESC, id DESC",
          )
          .bind(shareParams)
          .all(shareRows);
        for (let i = 0; i < shareRows.length; i++) {
          const postId = (shareRows[i].post || "").toString();
          const shareChannel = (shareRows[i].channel || "").toString();
          if (!postId || !shareChannel) continue;
          let summary = shareSummaryByPost[postId];
          if (!summary) {
            // Rows arrive newest first, so the first row seen is the latest.
            summary = {
              count: 0,
              last_shared_at: (shareRows[i].created || "").toString(),
              last_channel: shareChannel,
              last_via: (shareRows[i].via || "").toString(),
              channels: [],
              // Only a completed share sheet may be labelled "Shared"; a
              // download or a copied caption is not one. Kept apart from the
              // latest event so a later copy cannot hide an earlier share.
              sheet_count: 0,
              last_sheet_channel: "",
              last_sheet_at: "",
            };
            shareSummaryByPost[postId] = summary;
          }
          summary.count += 1;
          if (summary.channels.indexOf(shareChannel) === -1) {
            summary.channels.push(shareChannel);
          }
          if ((shareRows[i].via || "").toString() === "share_sheet") {
            if (summary.sheet_count === 0) {
              summary.last_sheet_channel = shareChannel;
              summary.last_sheet_at = (shareRows[i].created || "").toString();
            }
            summary.sheet_count += 1;
          }
        }
      }
    } catch (err) {
      console.error("[/api/app/posts] share summary error", err);
    }
    const items = page.map((r) => {
      let platformIds = [];
      const storedPlatformIdsRaw = r.getString("platform_ids");
      try {
        const parsed = JSON.parse(storedPlatformIdsRaw || "[]");
        if (Array.isArray(parsed)) {
          platformIds = parsed.filter(
            (id, index) =>
              typeof id === "string" &&
              allowedPlatformIds.indexOf(id) !== -1 &&
              parsed.indexOf(id) === index,
          );
        }
      } catch (_e) {}
      const parsedPlatformCaptions = helpers.parsePostPlatformCaptions(
        r.getString("platform_captions"),
        allowedPlatformIds,
        platformIds,
      );
      const storedPrimaryFormatId = r.getString("primary_format_id");
      const storedImageAspectRatio = r.getString("image_aspect_ratio");
      const hasValidOutputProfile =
        !!storedPrimaryFormatId &&
        expectedAspectByFormat[storedPrimaryFormatId] === storedImageAspectRatio;
      const primaryFormatId = hasValidOutputProfile ? storedPrimaryFormatId : "";
      const imageAspectRatio = hasValidOutputProfile ? storedImageAspectRatio : "";
      const storedWebsiteDraft = websitePublications.parseWebsiteDraft(
        r.getString("website_draft"),
      );
      const protectedCustomerName = r.getString("customer_name");
      const publicCustomerName =
        websitePublications.publicCustomerLabel(protectedCustomerName);
      const rawPlatformCaptions = parsedPlatformCaptions.ok
        ? parsedPlatformCaptions.value
        : {};
      const platformCaptionIds = Object.keys(rawPlatformCaptions);
      const rawWebsiteDraft =
        storedWebsiteDraft.ok &&
        storedWebsiteDraft.value &&
        storedWebsiteDraft.value.enabled
          ? storedWebsiteDraft.value
          : null;
      const allowedIdentityPhrases = [
        websitePublications.groundedIdentityPhrase(dealer.getString("name")),
        websitePublications.groundedIdentityPhrase(dealer.getString("oem_affiliation")),
        r.getString("salesperson_name"),
        websitePublications.publicCustomerLabel(r.getString("salesperson_name")),
        websitePublications.groundedIdentityPhrase(
          rawWebsiteDraft
            ? websitePublications.groundedVehicleIdentityPhrase(
                rawWebsiteDraft.vehicleDescription || "",
              )
            : "",
        ),
      ];
      const reviewValue = function (value) {
        return policies.reviewCustomerIdentityExcludingDisclosures(
          websitePublications.reviewPostCustomerIdentity,
          protectedCustomerName,
          [(value || "").toString()],
          allowedIdentityPhrases,
          (r.getBool ? r.getBool("release_required") : !!r.get("release_required")) &&
            !publicCustomerName,
        );
      };
      let identityReviewRequired = false;
      const captionReview = reviewValue(r.getString("caption"));
      if (captionReview.reviewRequired) identityReviewRequired = true;
      const publicCaption = captionReview.unexpectedIdentity
        ? "Caption held for customer-name review."
        : captionReview.projectedValues[0] || "";
      const disclosureReview = reviewValue(r.getString("disclosures"));
      if (disclosureReview.reviewRequired) identityReviewRequired = true;
      const publicDisclosures = disclosureReview.unexpectedIdentity
        ? "Disclosure held for customer-name review."
        : disclosureReview.projectedValues[0] || "";
      const publicPlatformCaptions = {};
      for (let i = 0; i < platformCaptionIds.length; i++) {
        const platformReview = reviewValue(rawPlatformCaptions[platformCaptionIds[i]]);
        if (platformReview.reviewRequired) {
          identityReviewRequired = true;
        }
        if (platformReview.unexpectedIdentity) {
          continue;
        }
        publicPlatformCaptions[platformCaptionIds[i]] =
          platformReview.projectedValues[0] || "";
      }
      let publicWebsiteDraft = null;
      if (rawWebsiteDraft) {
        const normalizedWebsiteLabel = (rawWebsiteDraft.customerDisplayName || "")
          .toString()
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();
        const normalizedProtectedName = protectedCustomerName
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();
        const websiteLabelSafe = rawWebsiteDraft.customerDisplayName
          ? websitePublications.releaseAuthorizesPublicCustomerLabel(
              protectedCustomerName,
              rawWebsiteDraft.customerDisplayName,
            ) ||
            (!!protectedCustomerName &&
              normalizedWebsiteLabel === normalizedProtectedName)
          : rawWebsiteDraft.kind !== "customer_story" || !!publicCustomerName;
        const websiteLabelNeedsProjection =
          !!rawWebsiteDraft.customerDisplayName &&
          !!protectedCustomerName &&
          normalizedWebsiteLabel === normalizedProtectedName &&
          normalizedWebsiteLabel !== publicCustomerName.toLowerCase();
        const titleReview = reviewValue(rawWebsiteDraft.title);
        const bodyReview = reviewValue(rawWebsiteDraft.body);
        const altReview = reviewValue(rawWebsiteDraft.altText);
        if (
          !websiteLabelSafe ||
          websiteLabelNeedsProjection ||
          titleReview.reviewRequired ||
          bodyReview.reviewRequired ||
          altReview.reviewRequired ||
          titleReview.unexpectedIdentity ||
          bodyReview.unexpectedIdentity ||
          altReview.unexpectedIdentity
        ) {
          identityReviewRequired = true;
        } else {
          publicWebsiteDraft = Object.assign({}, rawWebsiteDraft, {
            title: titleReview.projectedValues[0] || "",
            body: bodyReview.projectedValues[0] || "",
            altText: altReview.projectedValues[0] || "",
          });
          if (rawWebsiteDraft.kind === "customer_story" && publicCustomerName) {
            publicWebsiteDraft.customerDisplayName = publicCustomerName;
          } else {
            delete publicWebsiteDraft.customerDisplayName;
          }
        }
      }
      const imageReviewRequired = policies.postImageReviewRequired(
        r,
        currentModelPolicy,
      );
      const websitePublication = websitePublicationByPost[r.id]
        ? websitePublicationByPost[r.id]
        : websitePublications.publicationSummaryForPost(r, null);
      if (imageReviewRequired) {
        websitePublication.reviewUrl = "";
        websitePublication.lastError = "image_review_required";
      }
      return {
        id: r.id,
        dealer: r.getString("dealer"),
        salesperson_name: r.getString("salesperson_name"),
        salesperson_id: r.getString("salesperson_id"),
        attribution_authoritative: r.getBool
          ? r.getBool("attribution_authoritative")
          : !!r.get("attribution_authoritative"),
        generated_at: r.getString("generated_at"),
        // The compare-and-set token a reopened post must send with its next
        // draft save or share receipt; without it the editor is read-only.
        updated: r.getString("updated"),
        style: r.getString("style"),
        tone: r.getString("tone"),
        customer_name: publicCustomerName,
        scenario_id: r.getString("scenario_id"),
        vin: r.getString("vin"),
        has_release: r.getBool ? r.getBool("has_release") : !!r.get("has_release"),
        release_required: r.getBool
          ? r.getBool("release_required")
          : !!r.get("release_required"),
        release_status: r.getString("release_status"),
        has_video: r.getBool ? r.getBool("has_video") : !!r.get("has_video"),
        approval_status: r.getString("approval_status"),
        approved_by: r.getString("approved_by"),
        rejection_reason: r.getString("rejection_reason"),
        approved_at: r.getString("approved_at"),
        caption: publicCaption,
        caption_source:
          ["ai", "custom", "basic_fallback"].indexOf(r.getString("caption_source")) !==
          -1
            ? r.getString("caption_source")
            : null,
        disclosures: publicDisclosures,
        // Blank is a legacy unknown selection; explicit stored `[]` is the
        // intentional Website-only choice and must survive History restore.
        platform_ids: storedPlatformIdsRaw.trim() ? platformIds : undefined,
        media_output_mode:
          ["photo", "video", "both"].indexOf(r.getString("media_output_mode")) !== -1
            ? r.getString("media_output_mode")
            : "photo",
        platform_captions: publicPlatformCaptions,
        primary_format_id: primaryFormatId,
        image_aspect_ratio: imageAspectRatio,
        scheduled_for: r.getString("scheduled_for"),
        creative_image_url: r.getString("creative_image")
          ? `/api/app/posts/${r.id}/creative-image`
          : "",
        website_draft: publicWebsiteDraft,
        identity_review_required: identityReviewRequired || undefined,
        image_review_required: imageReviewRequired || undefined,
        website_publication: websitePublication,
        share_summary: shareSummaryByPost[r.id] || null,
      };
    });

    c.response().header().set("Cache-Control", "private, no-store");
    const payload = { items: items };
    if (hasMore && page.length) {
      const last = page[page.length - 1];
      payload.nextCursor = last.getString("generated_at") + "|" + last.id;
    }
    return c.json(200, payload);
  } catch (err) {
    console.error("[/api/app/posts] list error", err);
    return c.json(500, { error: "Failed to list posts" });
  }
});

routerAdd("PATCH", "/api/app/posts/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const policies = require(__hooks + "/requestPolicies.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  const dealer = context.dealer;
  const role = context.role;
  if (role !== "dealer_admin" && role !== "super_admin") {
    return c.json(403, {
      error: "Manager role required to set approval status",
    });
  }

  try {
    const id = c.pathParam("id");
    const body = $apis.requestInfo(c).data || {};
    const record = $app.dao().findRecordById("posts", id);
    const websitePublications = require(__hooks + "/websitePublications.js");

    // Approval authority matches the manager's list/view scope. There is no
    // audited tenant-selection mechanism, so even a global super-admin session
    // cannot blindly mutate another dealership's queue by guessing a post id.
    if (record.getString("dealer") !== dealer.id) {
      return c.json(403, {
        error: "Cross-dealer approval is not allowed",
      });
    }

    const decision = helpers.assertEnum(body.approval_status, ["approved", "rejected"]);
    if (record.getString("approval_status") !== "pending") {
      return c.json(409, { error: "This approval has already been decided" });
    }
    const approver = helpers.assertString(
      context.person ? context.person.getString("name") : "System Admin",
      120,
    );
    // A rejection without a reason leaves the salesperson guessing: the result
    // screen tells them to "create another post with the requested changes",
    // so there have to be requested changes to show. Approvals need none.
    //
    // Enforced client-side (components/ApprovalQueue.tsx), not here. Fly
    // ships this backend before Vercel ships the frontend that sends
    // rejection_reason (.github/workflows/fly-deploy.yml: release-frontend
    // needs: deploy), and the manager console the field replaced sent none at
    // all. A hard 400 here would break every rejection for the length of that
    // window, and again for any dealer stuck on a cached bundle past it. A
    // missing reason instead falls back to the exact copy the salesperson saw
    // before this feature existed (components/PostResult.tsx's
    // approvalGateMessage: "A manager rejected this creative..."), so nothing
    // breaks — a rejection without a reason is simply as informative as every
    // rejection used to be.
    const rejectionReason = helpers.assertString(
      (body.rejection_reason || "").toString().trim(),
      280,
    );

    if (
      decision === "approved" &&
      (!record.getString("caption") || !record.getString("creative_image"))
    ) {
      return c.json(409, {
        error: "Cannot approve a post without reviewable creative",
      });
    }
    if (
      decision === "approved" &&
      policies.postImageReviewRequired(record, policies.geminiModelPolicySnapshot())
    ) {
      return c.json(409, {
        error:
          "Image review required; reject and resubmit under the current creative policy.",
        code: "IMAGE_REVIEW_REQUIRED",
      });
    }
    if (
      decision === "approved" &&
      record.getBool("release_required") &&
      !websitePublications.hasValidLinkedRelease(record)
    ) {
      return c.json(409, {
        error: "A verified customer photo release is required before approval",
      });
    }
    if (decision === "approved") {
      // Re-evaluate the stored, immutable review copy against the current
      // dealer policy. This protects legacy queue entries and catches phrases
      // blocked after submission; rejection remains available to clear them.
      const allowedPlatformIds = helpers.allowedPostPlatformIds();
      let selectedPlatformIds = [];
      try {
        const parsed = JSON.parse(record.getString("platform_ids") || "[]");
        if (Array.isArray(parsed)) {
          selectedPlatformIds = parsed.filter(function (platformId, index) {
            return (
              typeof platformId === "string" &&
              allowedPlatformIds.indexOf(platformId) !== -1 &&
              parsed.indexOf(platformId) === index
            );
          });
        }
      } catch (_e) {}
      const platformCaptions = helpers.parsePostPlatformCaptions(
        record.getString("platform_captions"),
        allowedPlatformIds,
        selectedPlatformIds,
      );
      if (!platformCaptions.ok) {
        return c.json(409, {
          error: "Stored platform captions are invalid; reject and resubmit",
        });
      }
      const storedWebsiteDraft = websitePublications.parseWebsiteDraft(
        record.getString("website_draft"),
      );
      const websiteDraft =
        storedWebsiteDraft.ok &&
        storedWebsiteDraft.value &&
        storedWebsiteDraft.value.enabled
          ? storedWebsiteDraft.value
          : null;
      const platformCaptionIds = Object.keys(platformCaptions.value);
      const identityValues = [
        record.getString("caption"),
        record.getString("disclosures"),
      ].concat(
        platformCaptionIds.map(function (platformId) {
          return platformCaptions.value[platformId];
        }),
      );
      if (websiteDraft) {
        identityValues.push(
          websiteDraft.title || "",
          websiteDraft.body || "",
          websiteDraft.altText || "",
        );
      }
      const identityReview = policies.reviewCustomerIdentityExcludingDisclosures(
        websitePublications.reviewPostCustomerIdentity,
        record.getString("customer_name"),
        identityValues,
        [
          websitePublications.groundedIdentityPhrase(dealer.getString("name")),
          websitePublications.groundedIdentityPhrase(
            dealer.getString("oem_affiliation"),
          ),
          record.getString("salesperson_name"),
          websitePublications.publicCustomerLabel(record.getString("salesperson_name")),
          websitePublications.groundedIdentityPhrase(
            websiteDraft
              ? websitePublications.groundedVehicleIdentityPhrase(
                  websiteDraft.vehicleDescription || "",
                )
              : "",
          ),
        ],
        (record.getBool
          ? record.getBool("release_required")
          : !!record.get("release_required")) &&
          !websitePublications.publicCustomerLabel(record.getString("customer_name")),
      );
      const websiteLabelConflict =
        !!websiteDraft &&
        !!websiteDraft.customerDisplayName &&
        !websitePublications.releaseAuthorizesPublicCustomerLabel(
          record.getString("customer_name"),
          websiteDraft.customerDisplayName,
        );
      if (identityReview.reviewRequired || websiteLabelConflict) {
        return c.json(409, {
          error: "Customer-name review required; reject and resubmit.",
          code: "CUSTOMER_IDENTITY_REVIEW_REQUIRED",
        });
      }
      const compliance = policies.validatePostComplianceSet(
        [record.getString("caption")].concat(Object.values(platformCaptions.value)),
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
          "approved_at = {:approvedAt}, updated = {:updated}, " +
          "rejection_reason = {:rejectionReason} " +
          "WHERE id = {:id} AND dealer = {:dealer} " +
          "AND approval_status = 'pending'",
      )
      .bind({
        decision: decision,
        approver: approver,
        approvedAt: approvedAt,
        updated: approvedAt,
        // Approving clears any note from an earlier cycle so a stale reason
        // cannot trail an approved post.
        rejectionReason: decision === "rejected" ? rejectionReason : "",
        id: record.id,
        dealer: dealer.id,
      })
      .execute();
    if (!result || result.rowsAffected() !== 1) {
      return c.json(409, { error: "This approval has already been decided" });
    }
    try {
      require(__hooks + "/websitePublications.js").reconcilePublicationForPost(
        record.id,
      );
    } catch (_e) {}

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
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });

  try {
    const query = $apis.requestInfo(c).query || {};
    const roleFilter = (query.role || "").toString().trim();
    const dealerFilter = (query.dealer || "").toString().trim();
    const search = (query.q || "").toString().trim();
    const cursor = (query.cursor || "").toString().trim();
    const parsedLimit = parseInt((query.limit || "100").toString(), 10);
    const limit = Math.min(Math.max(parsedLimit || 100, 1), 200);
    const includeInactive =
      context.role !== "salesperson" &&
      (query.include_inactive || "").toString() === "true";
    const codesToShare =
      context.role !== "salesperson" &&
      (query.pin_needs_distribution || "").toString() === "true";
    const legacyCompatibility = helpers.legacyClientCompatibilityEnabled(c);

    if (roleFilter && roleFilter !== "manager" && roleFilter !== "salesperson") {
      return c.json(400, {
        error: "INVALID_ROLE_FILTER",
        code: "INVALID_ROLE_FILTER",
        message: "role must be manager or salesperson.",
      });
    }
    if (search.length > 120 || (cursor && !/^[A-Za-z0-9_-]{1,64}$/.test(cursor))) {
      return c.json(400, {
        error: "INVALID_ROSTER_QUERY",
        code: "INVALID_ROSTER_QUERY",
        message: "The roster query is invalid.",
      });
    }

    const filterParts = [];
    const params = {};
    if (context.role === "super_admin") {
      if (dealerFilter) {
        let targetDealer = null;
        try {
          targetDealer = $app.dao().findRecordById("dealers", dealerFilter);
        } catch (_e) {}
        if (
          !targetDealer ||
          (targetDealer.getBool && targetDealer.getBool("is_system"))
        ) {
          return c.json(400, {
            error: "INVALID_DEALER_FILTER",
            code: "INVALID_DEALER_FILTER",
            message: "The selected dealership is invalid.",
          });
        }
        filterParts.push("dealer = {:dealer}");
        params.dealer = dealerFilter;
      }
      if (roleFilter) {
        filterParts.push("role = {:role}");
        params.role = roleFilter;
      }
    } else {
      filterParts.push("dealer = {:dealer}");
      filterParts.push("role = {:role}");
      params.dealer = context.dealer.id;
      params.role = "salesperson";
    }
    if (!includeInactive) filterParts.push("active = true");
    if (search) {
      filterParts.push("name ~ {:search}");
      params.search = search;
    }
    if (codesToShare) {
      filterParts.push("pin_needs_distribution = true");
    }
    if (!filterParts.length) filterParts.push("1=1");

    // The personal-code namespace caps this collection at 10,000 rows. Load
    // the bounded, filtered id list once so `total` stays stable across cursor
    // pages instead of reporting only the remaining tail.
    const records = $app
      .dao()
      .findRecordsByFilter(
        "salespeople",
        filterParts.join(" && "),
        "id",
        10001,
        0,
        params,
      );
    if (records.length > 10000) {
      return c.json(500, {
        error: "ROSTER_CAPACITY_EXCEEDED",
        code: "ROSTER_CAPACITY_EXCEEDED",
        message: "The people roster exceeds the supported credential space.",
      });
    }
    let startIndex = 0;
    if (cursor) {
      while (startIndex < records.length && records[startIndex].id <= cursor) {
        startIndex++;
      }
    }
    const page = records.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + page.length < records.length;
    const dealerNames = {};
    const items = page.map((record) => {
      const item = helpers.serializePerson(record);
      if (legacyCompatibility) {
        // One-release bridge for the already-live UI. This is only a masked
        // presence marker; the reusable credential never leaves PocketBase.
        item.pin = item.hasPin ? "****" : "";
      }
      if (context.role === "super_admin") {
        const dealerId = record.getString("dealer");
        if (dealerNames[dealerId] === undefined) {
          try {
            dealerNames[dealerId] = $app
              .dao()
              .findRecordById("dealers", dealerId)
              .getString("name");
          } catch (_e) {
            dealerNames[dealerId] = "Unknown dealership";
          }
        }
        item.dealerName = dealerNames[dealerId];
      }
      return item;
    });
    c.response().header().set("Cache-Control", "private, no-store");
    const payload = { items: items, total: records.length };
    if (hasMore && page.length) payload.nextCursor = page[page.length - 1].id;
    return c.json(200, payload);
  } catch (err) {
    console.error("[/api/app/salespeople] list error", err);
    return c.json(500, { error: "Failed to list people" });
  }
});

routerAdd("POST", "/api/app/salespeople", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "dealer_admin" && context.role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const body = $apis.requestInfo(c).data || {};
    const legacyCompatibility = helpers.legacyClientCompatibilityEnabled(c);
    const name = (body.name || "").toString().trim();
    if (!name) {
      return c.json(400, {
        error: "NAME_REQUIRED",
        code: "NAME_REQUIRED",
        message: "Name is required.",
      });
    }

    let personRole = (body.role || "salesperson").toString().trim();
    if (personRole !== "manager" && personRole !== "salesperson") {
      return c.json(400, {
        error: "INVALID_PERSON_ROLE",
        code: "INVALID_PERSON_ROLE",
        message: "role must be manager or salesperson.",
      });
    }
    if (personRole === "manager" && context.role !== "super_admin") {
      return c.json(403, {
        error: "MANAGER_CREATE_FORBIDDEN",
        code: "MANAGER_CREATE_FORBIDDEN",
        message: "Only system admin can create managers.",
      });
    }
    if (context.role === "dealer_admin") personRole = "salesperson";

    let profile = {};
    try {
      profile = helpers.personProfileMutationData(body, context.role);
    } catch (profileErr) {
      const failure = helpers.personProfileErrorPayload(profileErr);
      return c.json(failure.status, failure.body);
    }

    let targetDealer = context.dealer;
    if (context.role === "super_admin") {
      const targetDealerId = (body.dealer || "").toString().trim();
      try {
        targetDealer = $app.dao().findRecordById("dealers", targetDealerId);
      } catch (_e) {
        targetDealer = null;
      }
      if (
        !targetDealer ||
        (targetDealer.getBool && targetDealer.getBool("is_system"))
      ) {
        return c.json(400, {
          error: "INVALID_DEALER",
          code: "INVALID_DEALER",
          message: "Select a valid dealership.",
        });
      }
    }

    let pin = helpers.generateUniquePersonPin();
    if (
      legacyCompatibility &&
      body.pin !== undefined &&
      body.pin !== null &&
      body.pin.toString().trim()
    ) {
      pin = helpers.assertPersonPinAvailable(body.pin.toString().trim(), "");
    }
    const salespeople = $app.dao().findCollectionByNameOrId("salespeople");
    const record = new Record(salespeople, {
      dealer: targetDealer.id,
      name: helpers.assertString(name, 120),
      // Storage keeps only the peppered hash; the plaintext code is returned
      // exactly once in this response for the manager to hand out.
      pin: "",
      pin_hash: helpers.personPinHash(pin),
      pin_needs_distribution: true,
      role: personRole,
      active: body.active === false ? false : true,
      created_at: new Date().toISOString(),
    });
    const profileFields = Object.keys(profile);
    for (let i = 0; i < profileFields.length; i++) {
      record.set(profileFields[i], profile[profileFields[i]]);
    }
    const createAudit = {
      dealerId: record.getString("dealer"),
      credentialPresent: true,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "action=create role=" + personRole,
    };
    helpers.runAuditedTransaction("person_pin_issued", createAudit, function (txDao) {
      txDao.saveRecord(record);
      createAudit.detail = "person=" + record.id + " action=create role=" + personRole;
    });
    const person = helpers.serializePerson(record);
    return c.json(200, {
      ...person,
      person: person,
      pin: pin,
    });
  } catch (err) {
    console.error("[/api/app/salespeople] create error", err);
    return c.json(400, {
      error: "PERSON_CREATE_FAILED",
      code: "PERSON_CREATE_FAILED",
      message: "Failed to create person.",
    });
  }
});

routerAdd("PATCH", "/api/app/salespeople/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "dealer_admin" && context.role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const personId = c.pathParam("id");
    const body = $apis.requestInfo(c).data || {};
    const legacyCompatibility = helpers.legacyClientCompatibilityEnabled(c);
    if (body.pin !== undefined && !legacyCompatibility) {
      return c.json(400, {
        error: "USE_PIN_ROTATION",
        code: "USE_PIN_ROTATION",
        message: "Use the access-code rotation action.",
      });
    }
    const hasPinUpdate = body.pin !== undefined;
    const requestedPin = hasPinUpdate ? body.pin.toString().trim() : "";
    const hasNameUpdate = body.name !== undefined;
    let requestedName = "";
    if (body.name !== undefined) {
      requestedName = body.name.toString().trim();
      if (!requestedName) return c.json(400, { error: "Name is required" });
      requestedName = helpers.assertString(requestedName, 120);
    }
    const hasActiveUpdate = typeof body.active === "boolean";
    const requestedActive = hasActiveUpdate ? body.active : false;
    const hasRoleUpdate = body.role !== undefined;
    let requestedRole = "";
    if (body.role !== undefined) {
      if (context.role !== "super_admin") {
        return c.json(403, { error: "Only system admin can change roles" });
      }
      requestedRole = body.role.toString().trim();
      if (requestedRole !== "manager" && requestedRole !== "salesperson") {
        return c.json(400, { error: "role must be manager or salesperson" });
      }
    }

    let profile = {};
    try {
      profile = helpers.personProfileMutationData(body, context.role);
    } catch (profileErr) {
      const failure = helpers.personProfileErrorPayload(profileErr);
      return c.json(failure.status, failure.body);
    }
    const profileFields = Object.keys(profile);

    const auditOptions = {
      dealerId: "",
      credentialPresent: hasPinUpdate,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    const outcome = helpers.runAuditedTransaction(
      function (result) {
        return result ? result.eventKind : "";
      },
      auditOptions,
      function (txDao) {
        // Every existing-person write starts from the current transactional
        // row. PocketBase 0.22 saves every schema column, so saving an object
        // loaded before the transaction could resurrect an old PIN, role, or
        // active flag after a concurrent security change.
        const txPerson = txDao.findRecordById("salespeople", personId);
        const existingRole = txPerson.getString("role") || "salesperson";
        if (
          (context.role !== "super_admin" &&
            txPerson.getString("dealer") !== context.dealer.id) ||
          (context.role !== "super_admin" && existingRole === "manager")
        ) {
          throw new Error("PERSON_EDIT_FORBIDDEN");
        }

        const wasActive = txPerson.getBool
          ? txPerson.getBool("active")
          : !!txPerson.get("active");
        let nextActive = wasActive;
        let nextRole = existingRole;
        let nextPin = "";
        let pinChanged = false;
        if (hasPinUpdate) {
          nextPin = helpers.assertPersonPinAvailableWithDao(
            txDao,
            requestedPin,
            txPerson.id,
          );
          const nextPinHash = helpers.personPinHash(nextPin);
          // Unchanged in either representation is a no-op: a not-yet-converted
          // row resubmitting its own plaintext must not revoke sessions.
          pinChanged =
            nextPinHash !== txPerson.getString("pin_hash") &&
            nextPin !== txPerson.getString("pin");
          if (pinChanged) {
            txPerson.set("pin", "");
            txPerson.set("pin_hash", nextPinHash);
            txPerson.set("pin_needs_distribution", true);
          }
        }
        if (hasNameUpdate) txPerson.set("name", requestedName);
        for (let i = 0; i < profileFields.length; i++) {
          txPerson.set(profileFields[i], profile[profileFields[i]]);
        }
        if (hasActiveUpdate) {
          nextActive = requestedActive;
          if (!wasActive && nextActive) {
            helpers.assertStoredPersonCredentialAvailableWithDao(txDao, txPerson);
          }
          txPerson.set("active", nextActive);
        }
        if (hasRoleUpdate) {
          nextRole = requestedRole;
          txPerson.set("role", nextRole);
        }

        const activeChanged = nextActive !== wasActive;
        const roleChanged = nextRole !== existingRole;
        const eventKind = pinChanged
          ? "person_pin_rotated"
          : roleChanged
            ? "person_role_changed"
            : activeChanged
              ? nextActive
                ? "person_reactivated"
                : "person_deactivated"
              : "";
        let revoked = 0;
        if (eventKind) {
          revoked = helpers.revokePersonSessionsWithDao(txDao, txPerson.id);
        }
        if (roleChanged && nextRole !== "manager") {
          const managerAccount = helpers.findManagerAccountByPersonWithDao(
            txDao,
            txPerson.id,
          );
          if (managerAccount) txDao.deleteRecord(managerAccount);
          txPerson.set("manager_username", "");
        }
        txDao.saveRecord(txPerson);
        auditOptions.dealerId = txPerson.getString("dealer");
        auditOptions.credentialPresent = pinChanged;
        auditOptions.detail =
          "person=" +
          txPerson.id +
          " sessions_revoked=" +
          revoked +
          " role_changed=" +
          roleChanged +
          " active_changed=" +
          activeChanged +
          " profile_changed=" +
          (profileFields.length > 0) +
          (pinChanged ? " action=legacy_patch" : "");
        return {
          person: txPerson,
          eventKind: eventKind,
          pinChanged: pinChanged,
          pin: nextPin,
        };
      },
    );
    const person = helpers.serializePerson(outcome.person);
    if (outcome.pinChanged) {
      c.response().header().set("Cache-Control", "private, no-store");
      return c.json(200, { ...person, person: person, pin: outcome.pin });
    }
    return c.json(200, person);
  } catch (err) {
    console.error("[/api/app/salespeople/:id] update error", err);
    if (
      (err && err.message ? err.message : "").toString() === "PERSON_EDIT_FORBIDDEN"
    ) {
      return c.json(403, { error: "Person edit is not allowed" });
    }
    const safeMessage = helpers.safeDealerMutationError(err);
    return c.json(400, {
      error: "PERSON_UPDATE_FAILED",
      code: "PERSON_UPDATE_FAILED",
      message:
        safeMessage === "Failed to save dealer"
          ? "Failed to update person."
          : safeMessage,
    });
  }
});

routerAdd("PUT", "/api/app/salespeople/:id/manager-login", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "super_admin") {
    return c.json(403, {
      error: "MANAGER_LOGIN_FORBIDDEN",
      code: "MANAGER_LOGIN_FORBIDDEN",
      message: "Only system admin can configure manager sign-in.",
    });
  }

  try {
    const personId = c.pathParam("id");
    const body = $apis.requestInfo(c).data || {};
    const username = helpers.normalizeManagerUsername(body.username);
    const password =
      body.password === undefined || body.password === null
        ? ""
        : body.password.toString();
    if (!helpers.isValidManagerUsername(username)) {
      return c.json(400, {
        error: "INVALID_MANAGER_USERNAME",
        code: "INVALID_MANAGER_USERNAME",
        message:
          "Username must be 3 to 32 characters, start with a letter, and use only letters, numbers, periods, dashes, or underscores.",
      });
    }
    if (!helpers.isStrongManagerPassword(password)) {
      return c.json(400, {
        error: "INVALID_MANAGER_PASSWORD",
        code: "INVALID_MANAGER_PASSWORD",
        message: "Password must be between 8 and 128 characters.",
      });
    }

    let revoked = 0;
    let action = "created";
    let committedPerson = null;
    const auditOptions = {
      dealerId: "",
      credentialPresent: true,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    helpers.runAuditedTransaction(
      "manager_login_configured",
      auditOptions,
      function (txDao) {
        // Re-read the target inside the same transaction as the credential
        // write. A stale record loaded before a concurrent role/deactivation
        // change could otherwise overwrite the newer authoritative state.
        const txPerson = txDao.findRecordById("salespeople", personId);
        if (txPerson.getString("role") !== "manager") {
          throw new Error("MANAGER_REQUIRED");
        }
        if (!txPerson.getBool("active")) {
          throw new Error("MANAGER_INACTIVE");
        }
        const normalized = helpers.assertManagerUsernameAvailableWithDao(
          txDao,
          username,
          txPerson.id,
        );
        let account = helpers.findManagerAccountByPersonWithDao(txDao, txPerson.id);
        if (!account) {
          const accounts = txDao.findCollectionByNameOrId("manager_accounts");
          account = new Record(accounts);
          account.set("person", txPerson.id);
        } else {
          action = "replaced";
        }
        account.setUsername(normalized);
        account.setPassword(password);
        txDao.saveRecord(account);
        revoked = helpers.revokePersonSessionsWithDao(txDao, txPerson.id);
        txPerson.set("manager_username", normalized);
        txDao.saveRecord(txPerson);
        committedPerson = txPerson;
        auditOptions.dealerId = txPerson.getString("dealer");
        auditOptions.detail =
          "person=" +
          txPerson.id +
          " action=" +
          action +
          " sessions_revoked=" +
          revoked;
      },
    );

    if (!committedPerson) throw new Error("MANAGER_LOGIN_COMMIT_MISSING");
    const person = helpers.serializePerson(committedPerson);
    return c.json(200, {
      ...person,
      person: person,
    });
  } catch (err) {
    console.error("[/api/app/salespeople/:id/manager-login] error", err);
    const message = (err && err.message ? err.message : "").toString();
    if (message === "MANAGER_REQUIRED" || message === "MANAGER_INACTIVE") {
      return c.json(409, {
        error: message,
        code: message,
        message:
          message === "MANAGER_INACTIVE"
            ? "Reactivate this manager before configuring sign-in."
            : "Username and password sign-in is available only for managers.",
      });
    }
    const usernameConflict =
      message.indexOf("username") !== -1 ||
      message.indexOf("Username") !== -1 ||
      message.indexOf("unique") !== -1;
    return c.json(usernameConflict ? 409 : 400, {
      error: usernameConflict
        ? "MANAGER_USERNAME_UNAVAILABLE"
        : "MANAGER_LOGIN_CONFIGURE_FAILED",
      code: usernameConflict
        ? "MANAGER_USERNAME_UNAVAILABLE"
        : "MANAGER_LOGIN_CONFIGURE_FAILED",
      message: usernameConflict
        ? "That manager username is already in use."
        : "Manager sign-in could not be configured.",
    });
  }
});

routerAdd("DELETE", "/api/app/salespeople/:id/manager-login", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "super_admin") {
    return c.json(403, {
      error: "MANAGER_LOGIN_FORBIDDEN",
      code: "MANAGER_LOGIN_FORBIDDEN",
      message: "Only system admin can disable manager sign-in.",
    });
  }

  try {
    const personId = c.pathParam("id");
    let revoked = 0;
    let committedPerson = null;
    const auditOptions = {
      dealerId: "",
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    helpers.runAuditedTransaction(
      "manager_login_disabled",
      auditOptions,
      function (txDao) {
        const txPerson = txDao.findRecordById("salespeople", personId);
        if (txPerson.getString("role") !== "manager") {
          throw new Error("MANAGER_REQUIRED");
        }
        const account = helpers.findManagerAccountByPersonWithDao(txDao, txPerson.id);
        revoked = helpers.revokePersonSessionsWithDao(txDao, txPerson.id);
        if (account) txDao.deleteRecord(account);
        txPerson.set("manager_username", "");
        txDao.saveRecord(txPerson);
        committedPerson = txPerson;
        auditOptions.dealerId = txPerson.getString("dealer");
        auditOptions.detail = "person=" + txPerson.id + " sessions_revoked=" + revoked;
      },
    );
    if (!committedPerson) throw new Error("MANAGER_LOGIN_COMMIT_MISSING");
    return c.json(200, helpers.serializePerson(committedPerson));
  } catch (err) {
    console.error("[/api/app/salespeople/:id/manager-login DELETE] error", err);
    const message = (err && err.message ? err.message : "").toString();
    if (message === "MANAGER_REQUIRED") {
      return c.json(409, {
        error: "MANAGER_REQUIRED",
        code: "MANAGER_REQUIRED",
        message: "This person is not a manager.",
      });
    }
    return c.json(400, {
      error: "MANAGER_LOGIN_DISABLE_FAILED",
      code: "MANAGER_LOGIN_DISABLE_FAILED",
      message: "Manager sign-in could not be disabled.",
    });
  }
});

routerAdd("POST", "/api/app/salespeople/:id/rotate-pin", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "dealer_admin" && context.role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const personId = c.pathParam("id");
    let pin = "";
    let committedPerson = null;
    const auditOptions = {
      dealerId: "",
      credentialPresent: true,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    helpers.runAuditedTransaction("person_pin_rotated", auditOptions, function (txDao) {
      const txPerson = txDao.findRecordById("salespeople", personId);
      if (
        context.role !== "super_admin" &&
        (txPerson.getString("dealer") !== context.dealer.id ||
          (txPerson.getString("role") || "salesperson") !== "salesperson")
      ) {
        throw new Error("PIN_ROTATE_FORBIDDEN");
      }
      pin = helpers.generateUniquePersonPinWithDao(txDao);
      const revoked = helpers.revokePersonSessionsWithDao(txDao, txPerson.id);
      txPerson.set("pin", "");
      txPerson.set("pin_hash", helpers.personPinHash(pin));
      txPerson.set("pin_needs_distribution", true);
      txDao.saveRecord(txPerson);
      committedPerson = txPerson;
      auditOptions.dealerId = txPerson.getString("dealer");
      auditOptions.detail =
        "person=" + txPerson.id + " action=rotate sessions_revoked=" + revoked;
    });
    if (!committedPerson || !pin) throw new Error("PIN_ROTATE_COMMIT_MISSING");
    return c.json(200, {
      person: helpers.serializePerson(committedPerson),
      pin: pin,
    });
  } catch (err) {
    console.error("[/api/app/salespeople/:id/rotate-pin] error", err);
    if ((err && err.message ? err.message : "").toString() === "PIN_ROTATE_FORBIDDEN") {
      return c.json(403, {
        error: "PIN_ROTATE_FORBIDDEN",
        code: "PIN_ROTATE_FORBIDDEN",
        message: "Access-code rotation is not allowed for this person.",
      });
    }
    return c.json(400, {
      error: "PIN_ROTATE_FAILED",
      code: "PIN_ROTATE_FAILED",
      message: "Failed to rotate the access code.",
    });
  }
});

// Access codes are stored only as peppered one-way hashes, so revealing a
// current code is cryptographically impossible. The route stays registered so
// stale clients receive an explanatory 410 instead of a confusing 404.
routerAdd("POST", "/api/app/salespeople/:id/reveal-pin", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  c.response().header().set("Cache-Control", "private, no-store");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  return c.json(410, {
    error: "PIN_REVEAL_RETIRED",
    code: "PIN_REVEAL_RETIRED",
    message:
      "Access codes are stored hashed and can no longer be revealed. Rotate the code to issue a new one.",
  });
});

routerAdd("POST", "/api/app/salespeople/:id/acknowledge-pin", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "dealer_admin" && context.role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const personId = c.pathParam("id");
    let committedPerson = null;
    const auditOptions = {
      dealerId: "",
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    helpers.runAuditedTransaction(
      "person_pin_acknowledged",
      auditOptions,
      function (txDao) {
        const txPerson = txDao.findRecordById("salespeople", personId);
        if (
          context.role !== "super_admin" &&
          (txPerson.getString("dealer") !== context.dealer.id ||
            (txPerson.getString("role") || "salesperson") !== "salesperson")
        ) {
          throw new Error("PIN_ACKNOWLEDGE_FORBIDDEN");
        }
        txPerson.set("pin_needs_distribution", false);
        txDao.saveRecord(txPerson);
        committedPerson = txPerson;
        auditOptions.dealerId = txPerson.getString("dealer");
        auditOptions.detail = "person=" + txPerson.id;
      },
    );
    if (!committedPerson) throw new Error("PIN_ACKNOWLEDGE_COMMIT_MISSING");
    return c.json(200, helpers.serializePerson(committedPerson));
  } catch (err) {
    console.error("[/api/app/salespeople/:id/acknowledge-pin] error", err);
    if (
      (err && err.message ? err.message : "").toString() === "PIN_ACKNOWLEDGE_FORBIDDEN"
    ) {
      return c.json(403, { error: "Acknowledgement is not allowed" });
    }
    return c.json(404, { error: "Person not found" });
  }
});

routerAdd("DELETE", "/api/app/salespeople/:id", (c) => {
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "No active session" });
  if (context.role !== "dealer_admin" && context.role !== "super_admin") {
    return c.json(403, { error: "Manager role required" });
  }

  try {
    const personId = c.pathParam("id");
    let revoked = 0;
    const auditOptions = {
      dealerId: "",
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "",
    };
    helpers.runAuditedTransaction("person_deactivated", auditOptions, function (txDao) {
      const txPerson = txDao.findRecordById("salespeople", personId);
      if (
        context.role !== "super_admin" &&
        (txPerson.getString("dealer") !== context.dealer.id ||
          (txPerson.getString("role") || "salesperson") === "manager")
      ) {
        throw new Error("PERSON_DEACTIVATE_FORBIDDEN");
      }
      revoked = helpers.revokePersonSessionsWithDao(txDao, txPerson.id);
      txPerson.set("active", false);
      txDao.saveRecord(txPerson);
      auditOptions.dealerId = txPerson.getString("dealer");
      auditOptions.detail = "person=" + txPerson.id + " sessions_revoked=" + revoked;
    });
    return c.json(200, { success: true });
  } catch (err) {
    console.error("[/api/app/salespeople/:id] deactivate error", err);
    if (
      (err && err.message ? err.message : "").toString() ===
      "PERSON_DEACTIVATE_FORBIDDEN"
    ) {
      return c.json(403, { error: "Person deactivation is not allowed" });
    }
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
    const data = helpers.dealerMutationData(body, false, false);
    if (!data.name) return c.json(400, { error: "Dealer name is required" });

    const record = new Record(dealers);
    const form = new RecordUpsertForm($app, record);
    form.setFullManageAccess(true);
    form.loadData(data);
    const logo = helpers.dealerLogoFile(c);
    if (logo) form.addFiles("logo", logo);
    const auditOptions = {
      dealerId: dealer.id,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "create name=" + data.name.toString().slice(0, 120),
    };
    helpers.runAuditedTransaction("dealer_created", auditOptions, function (txDao) {
      // PocketBase 0.22 forms support SetDao specifically for transactional
      // submits; this keeps the dealer row and audit receipt atomic.
      form.setDao(txDao);
      form.submit();
      auditOptions.detail = "dealer=" + record.id + " " + auditOptions.detail;
    });
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
    if (target.getBool && target.getBool("is_system")) {
      return c.json(403, { error: "The system dealer cannot be edited" });
    }
    helpers.restrictDealerLogoSchema(target.collection());
    const body = $apis.requestInfo(c).data || {};
    const data = helpers.dealerMutationData(body, false, false);
    if (data.name !== undefined && !data.name) {
      return c.json(400, { error: "Dealer name is required" });
    }
    // The creative-system rollout flag is the system administrator's switch.
    // A manager's save never changes it. The field is ignored rather than
    // rejected, so a settings form that echoes the stored value still saves.
    if (!isSuperAdmin) delete data.creative_system_v2;

    const form = new RecordUpsertForm($app, target);
    form.setFullManageAccess(true);
    form.loadData(data);
    const logo = helpers.dealerLogoFile(c);
    if (logo) form.addFiles("logo", logo);
    const auditOptions = {
      dealerId: target.id,
      ip: helpers.clientIP(c),
      userAgent: helpers.userAgent(c),
      detail: "dealer=" + target.id + " actor_role=" + role,
    };
    helpers.runAuditedTransaction("dealer_updated", auditOptions, function (txDao) {
      form.setDao(txDao);
      form.submit();
    });

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
    if (target.getBool && target.getBool("is_system")) {
      return c.json(400, { error: "The system dealer cannot be deleted" });
    }
    helpers.runAuditedTransaction(
      "dealer_deleted",
      {
        dealerId: dealer.id,
        ip: helpers.clientIP(c),
        userAgent: helpers.userAgent(c),
        detail: "dealer=" + target.id,
      },
      function (txDao) {
        txDao.deleteRecord(target);
      },
    );
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
    const search = (c.queryParam("q") || "").toString().trim();
    const cursor = (c.queryParam("cursor") || "").toString().trim();
    const rawLimit = (c.queryParam("limit") || "").toString().trim();
    if (search.length > 120 || (cursor && !/^[A-Za-z0-9_-]{1,64}$/.test(cursor))) {
      return c.json(400, {
        error: "INVALID_DEALER_QUERY",
        code: "INVALID_DEALER_QUERY",
        message: "The dealership query is invalid.",
      });
    }
    const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : 10001;
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      return c.json(400, {
        error: "INVALID_DEALER_QUERY",
        code: "INVALID_DEALER_QUERY",
        message: "limit must be a positive number.",
      });
    }
    // Existing clients intentionally receive the complete bounded list. New
    // callers opt into cursor pagination by supplying `limit`.
    const pageLimit = rawLimit ? Math.min(250, parsedLimit) : 10001;
    const params = {};
    let filter = "is_system != true";
    if (search) {
      filter += " && name ~ {:search}";
      params.search = search;
    }
    const records = $app
      .dao()
      .findRecordsByFilter("dealers", filter, "id", 10001, 0, params);
    let startIndex = 0;
    if (cursor) {
      while (startIndex < records.length && records[startIndex].id <= cursor) {
        startIndex++;
      }
    }
    const page = records.slice(startIndex, startIndex + pageLimit);
    const hasMore = startIndex + page.length < records.length;
    const items = page.map((r) => ({
      id: r.id,
      name: r.getString("name"),
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
      website: r.getString("website"),
      phone: r.getString("phone"),
      address: r.getString("address"),
      hours: r.getString("hours"),
      tagline: r.getString("tagline"),
      facebook_url: r.getString("facebook_url"),
      facebook_page_tag: r.getString("facebook_page_tag"),
      instagram_handle: r.getString("instagram_handle"),
      tiktok_handle: r.getString("tiktok_handle"),
      x_handle: r.getString("x_handle"),
      linkedin_company_tag: r.getString("linkedin_company_tag"),
      gbp_url: r.getString("gbp_url"),
      default_hashtags: r.getString("default_hashtags"),
      default_footer: r.getString("default_footer"),
      enabled_styles: r.getString("enabled_styles"),
      default_style: r.getString("default_style"),
      enabled_fun_styles: r.getString("enabled_fun_styles"),
      custom_scenarios: r.getString("custom_scenarios"),
    }));
    const payload = { items: items, total: records.length };
    if (hasMore && page.length) payload.nextCursor = page[page.length - 1].id;
    return c.json(200, payload);
  } catch (err) {
    console.error("[/api/app/dealers] list error", err);
    return c.json(500, { error: "Failed to list dealers" });
  }
});

// ---- Vehicle Walkaround Studio ------------------------------------------
// Heavy media I/O remains in the separately deployed worker/storage broker.
// These routes own tenant authority, state transitions, and durable handoffs.
routerAdd("POST", "/api/app/walkarounds", (c) => {
  return require(__hooks + "/walkarounds.js").createProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/uploads", (c) => {
  return require(__hooks + "/walkarounds.js").createUpload(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/uploads/:assetId/finalize", (c) => {
  return require(__hooks + "/walkarounds.js").finalizeUpload(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/release", (c) => {
  return require(__hooks + "/walkarounds.js").saveRelease(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/process", (c) => {
  return require(__hooks + "/walkarounds.js").processProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("GET", "/api/app/walkarounds/youtube/status", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeStatus(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/youtube/connect", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeConnect(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/youtube/complete", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeComplete(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("DELETE", "/api/app/walkarounds/youtube/disconnect", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeDisconnect(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("GET", "/api/app/walkarounds/:id", (c) => {
  return require(__hooks + "/walkarounds.js").getProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("GET", "/api/app/walkarounds/:id/assets/:kind/preview", (c) => {
  return require(__hooks + "/walkarounds.js").previewAsset(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("PATCH", "/api/app/walkarounds/:id/review", (c) => {
  return require(__hooks + "/walkarounds.js").reviewProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/re-edit", (c) => {
  return require(__hooks + "/walkarounds.js").reEditProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/approve", (c) => {
  return require(__hooks + "/walkarounds.js").approveProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("POST", "/api/app/walkarounds/:id/publish", (c) => {
  return require(__hooks + "/walkarounds.js").publishProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("DELETE", "/api/app/walkarounds/:id", (c) => {
  return require(__hooks + "/walkarounds.js").deleteProject(
    c,
    require(__hooks + "/helpers.js"),
  );
});
routerAdd("GET", "/api/internal/walkarounds/:id/production-context", (c) => {
  return require(__hooks + "/walkarounds.js").internalContext(c, "production");
});
routerAdd("POST", "/api/internal/walkarounds/:id/production-events", (c) => {
  return require(__hooks + "/walkarounds.js").productionEvent(c);
});
routerAdd("POST", "/api/internal/walkaround-tasks/claim", (c) => {
  return require(__hooks + "/walkarounds.js").claimTask(c);
});
routerAdd("POST", "/api/internal/walkaround-tasks/:taskId/ack", (c) => {
  return require(__hooks + "/walkarounds.js").ackTask(c);
});
routerAdd("POST", "/api/internal/walkaround-tasks/:taskId/nack", (c) => {
  return require(__hooks + "/walkarounds.js").nackTask(c);
});
routerAdd("POST", "/api/internal/walkaround-tasks/:taskId/renew", (c) => {
  return require(__hooks + "/walkarounds.js").renewTask(c);
});
routerAdd("GET", "/api/internal/walkarounds/:id/publication-context", (c) => {
  return require(__hooks + "/walkarounds.js").internalContext(c, "publication");
});
routerAdd("POST", "/api/internal/walkarounds/:id/publication-events", (c) => {
  return require(__hooks + "/walkarounds.js").publicationEvent(c);
});
routerAdd("POST", "/api/internal/walkarounds/:id/assets/:assetId/signed-read", (c) => {
  return require(__hooks + "/walkarounds.js").signedRead(c);
});
routerAdd("POST", "/api/internal/walkarounds/:id/youtube/upload-session", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeUploadSession(c);
});
routerAdd("POST", "/api/internal/walkarounds/:id/youtube/upload-next", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeUploadNext(c);
});
routerAdd("GET", "/api/internal/walkarounds/:id/youtube/videos/:videoId", (c) => {
  return require(__hooks + "/walkarounds.js").youtubeVideoStatus(c);
});
routerAdd(
  "POST",
  "/api/internal/walkarounds/:id/youtube/videos/:videoId/visibility",
  (c) => require(__hooks + "/walkarounds.js").youtubeVisibility(c),
);

// Daily background garbage collection of expired sessions and old audit logs (3:00 AM UTC)
cronAdd("session_gc_and_auth_cleanup", "0 3 * * *", () => {
  const helpers = require(__hooks + "/helpers.js");
  try {
    helpers.purgeExpiredSessionsAndOldEvents();
  } catch (e) {
    console.error("[cron:session_gc] failed:", e);
  }
});

cronAdd("walkaround_abandoned_upload_cleanup", "30 3 * * *", () => {
  try {
    require(__hooks + "/walkarounds.js").cleanupAbandonedUploads();
  } catch (_e) {
    console.error("[cron:walkaround_cleanup] failed");
  }
});
