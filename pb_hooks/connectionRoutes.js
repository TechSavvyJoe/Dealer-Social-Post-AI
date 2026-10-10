// Custom session-gated routes are the only public surface for managed secrets.
function helpers() {
  return require(__hooks + "/helpers.js");
}
function config() {
  return require(__hooks + "/connectionConfig.js");
}
function headers(c) {
  c.response().header().set("Cache-Control", "private, no-store");
  c.response().header().set("Vary", "Cookie");
}
function actor(c, systemOnly) {
  headers(c);
  const context = helpers().sessionContext(c);
  if (!context) throw new Error("CONNECTION_UNAUTHORIZED");
  if (
    systemOnly
      ? context.role !== "super_admin"
      : ["super_admin", "dealer_admin"].indexOf(context.role) < 0
  )
    throw new Error("CONNECTION_FORBIDDEN");
  return context;
}
function selectedDealer(context, input) {
  const requested = input || "";
  if (context.role !== "super_admin") {
    if (requested && requested !== context.dealer.id)
      throw new Error("CONNECTION_FORBIDDEN");
    return context.dealer.id;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(requested))
    throw new Error("CONNECTION_DEALER_REQUIRED");
  const dealer = $app.dao().findRecordById("dealers", requested);
  if (dealer.getBool("is_system")) throw new Error("CONNECTION_DEALER_REQUIRED");
  return dealer.id;
}
function mutation(c) {
  const request = c.request(),
    site = String(request.header.get("Sec-Fetch-Site") || "");
  if (site === "cross-site") throw new Error("CONNECTION_FORBIDDEN");
  const origin = String(request.header.get("Origin") || "");
  if (!origin) return; // Non-browser operations still require a valid session.
  const local =
    !String($os.getenv("FLY_APP_NAME") || "") &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin);
  const allowed = [
    "https://dealer-social-post-ai.vercel.app",
    "https://dealer-social-post-ai-production.fly.dev",
  ];
  const configured = String($os.getenv("APP_ORIGIN") || "").trim();
  if (configured) allowed.push(configured);
  if (!local && allowed.indexOf(origin) < 0) throw new Error("CONNECTION_FORBIDDEN");
}
function dto(row) {
  const labels = {
    text: "Caption access",
    images: "Image generation",
    video: "AI video generation",
    website: "Private website draft",
    processing: "Complete video package",
    youtube: "Private YouTube playback",
  };
  const relevant =
    row.service === "gemini"
      ? ["text", "images", "video"]
      : row.service === "anthropic"
        ? ["text"]
        : row.service === "openai"
          ? ["text", "images"]
          : row.service === "website"
            ? ["website"]
            : ["processing", "youtube"];
  return {
    service: row.service,
    scope: row.scope,
    dealerId: row.dealerId || undefined,
    configured: row.configured === true,
    enabled: row.enabled === true,
    revision: row.revision,
    state: row.state,
    settings: row.settings || {},
    credentialConfigured: row.credentialConfigured || {},
    capabilities: relevant.map(function (id) {
      return {
        id: id,
        label: labels[id],
        state: row.capabilities && row.capabilities[id] ? "verified" : "not_tested",
      };
    }),
    lastVerifiedAt: (row.verification && row.verification.checkedAt) || undefined,
    errorCode: row.code || (row.verification && row.verification.code) || undefined,
    nextAction:
      row.state === "off"
        ? "Set up when needed"
        : row.state === "needs_setup"
          ? "Set up"
          : row.state === "ready"
            ? "Manage"
            : "Test",
  };
}
function failure(c, error) {
  const message = String((error && error.message) || "");
  const code = /^CONNECTION_[A-Z_]{1,70}$/.test(message)
    ? message
    : "CONNECTION_REQUEST_FAILED";
  const status =
    code === "CONNECTION_UNAUTHORIZED"
      ? 401
      : code === "CONNECTION_FORBIDDEN"
        ? 403
        : /CONFLICT|STALE|BUSY|CHANGED|NOT_CONFIGURED/.test(code)
          ? 409
          : /STORAGE|TRANSPORT/.test(code)
            ? 503
            : 400;
  return c.json(status, {
    error: code,
    code: code,
    message:
      "The connection could not complete this step. Review its settings or refresh its status before trying again.",
  });
}
function inventory(c) {
  try {
    const context = actor(c, true),
      cfg = config();
    const dealers = $app
      .dao()
      .findRecordsByFilter("dealers", "is_system = false", "+name,+id", 200, 0)
      .map(function (dealer) {
        return { id: dealer.id, name: dealer.getString("name") };
      });
    const services = ["gemini", "anthropic", "openai", "walkaround"].map(
      function (service) {
        return dto(cfg.getPublicConfig(service));
      },
    );
    dealers.forEach(function (dealer) {
      services.push(dto(cfg.getPublicConfig("website", dealer.id)));
    });
    // Backend deploys before frontend promotion; keep older cached admin
    // clients readable without exposing secrets or claiming delivery proof.
    function legacyState(service, dealerId) {
      const row = services.find(function (item) {
        return (
          item.service === service &&
          (service !== "website" || item.dealerId === dealerId)
        );
      });
      return {
        configured: !!(row && row.configured),
        enabled: !!(row && row.enabled && row.configured),
        verification: "not_tested",
      };
    }
    const legacyDealerId = String($os.getenv("CUSTOMER_HUB_DEALER_ID") || "").trim();
    const policy = require(__hooks + "/requestPolicies.js").geminiModelPolicySnapshot();
    return c.json(200, {
      scope: "guided_setup",
      providers: {
        gemini: legacyState("gemini"),
        anthropic: legacyState("anthropic"),
        openai: legacyState("openai"),
      },
      automation: {
        customer_hub: Object.assign(legacyState("website", legacyDealerId), {
          dealerId: legacyDealerId,
        }),
        walkaround: legacyState("walkaround"),
      },
      services: services,
      dealers: dealers,
      secureStorageAvailable: cfg.getPublicConfig("gemini").storageReady,
      apiContractVersion: helpers().API_CONTRACT_VERSION,
      capabilities: helpers().PROXY_CAPABILITIES,
      modelPolicyVersion: String(policy.version),
    });
  } catch (error) {
    return failure(c, error);
  }
}
function dealerStatus(c) {
  try {
    const context = actor(c, false),
      dealer = context.dealer.id,
      cfg = config();
    const website = dto(cfg.getPublicConfig("website", dealer)),
      walkaround = dto(cfg.getPublicConfig("walkaround"));
    walkaround.settings = {};
    walkaround.credentialConfigured = {};
    // Processing is shared; a successful channel test never proves another dealership's YouTube account. Its account status remains in the existing scoped broker flow.
    walkaround.capabilities = walkaround.capabilities.filter(function (capability) {
      return capability.id !== "youtube";
    });
    return c.json(200, { services: [website, walkaround] });
  } catch (error) {
    return failure(c, error);
  }
}
function proofs(c) {
  try {
    const context = actor(c, false),
      service = c.queryParam("service"),
      dealer = selectedDealer(context, c.queryParam("dealerId"));
    if (["website", "walkaround"].indexOf(service) < 0)
      throw new Error("CONNECTION_SERVICE_INVALID");
    const rows = $app
      .dao()
      .findRecordsByFilter(
        service === "website" ? "posts" : "walkaround_projects",
        "dealer = {:dealer}",
        "-updated,-id",
        20,
        0,
        { dealer: dealer },
      );
    const items = rows.map(function (row) {
      const state = row.getString(
        service === "website" ? "approval_status" : "production_state",
      );
      const label =
        service === "website"
          ? (row.getString("scenario_id") || "Website post").replace(/_/g, " ")
          : "Vehicle walkaround";
      return {
        id: row.id,
        label: label + " · " + row.getString("created").slice(0, 10),
        state: state || "draft",
      };
    });
    return c.json(200, { items: items });
  } catch (error) {
    return failure(c, error);
  }
}
function save(c) {
  try {
    const context = actor(c, true);
    mutation(c);
    const service = c.pathParam("service"),
      body = $apis.requestInfo(c).data || {};
    const dealer =
      service === "website" ? selectedDealer(context, body.dealerId) : undefined;
    if (service !== "website" && body.dealerId)
      throw new Error("CONNECTION_SCOPE_INVALID");
    const limit = helpers().checkProxyRateLimit(
      "connections:save:" + context.dealer.id,
      15,
      60000,
    );
    if (!limit.ok)
      return c.json(429, {
        code: "CONNECTION_RATE_LIMITED",
        error: "Please wait before changing another connection.",
      });
    return c.json(
      200,
      dto(
        config().saveConfig(
          service,
          dealer,
          {
            enabled: body.enabled,
            settings: body.settings || {},
            credentials: body.credentials || {},
            expectedRevision: body.expectedRevision,
            confirmApply: body.confirmApply,
          },
          body.expectedRevision,
          context,
        ),
      ),
    );
  } catch (error) {
    return failure(c, error);
  }
}
function test(c) {
  try {
    const context = actor(c, false);
    mutation(c);
    const service = c.pathParam("service"),
      body = $apis.requestInfo(c).data || {},
      cfg = config();
    if (service !== "website" && context.role !== "super_admin")
      throw new Error("CONNECTION_FORBIDDEN");
    const targetDealer =
      service === "website" || service === "walkaround"
        ? selectedDealer(context, body.dealerId)
        : "";
    const dealer = service === "website" ? targetDealer : undefined;
    const operation = {
      idempotencyKey: body.idempotencyKey,
      proofId: body.proofId || "",
      targetDealerId: targetDealer,
    };
    const limit = helpers().checkProxyRateLimit(
      "connections:test:" + context.dealer.id,
      6,
      60000,
    );
    if (!limit.ok)
      return c.json(429, {
        code: "CONNECTION_RATE_LIMITED",
        error: "Please wait before running another test.",
      });
    if (["gemini", "anthropic", "openai"].indexOf(service) >= 0) {
      return c.json(
        200,
        dto(
          require(__hooks + "/connectionVerification.js").runProviderTest(
            service,
            body.expectedRevision,
            context,
            operation,
          ),
        ),
      );
    }
    const ticket = cfg.reserveVerification(
      service,
      dealer,
      body.expectedRevision,
      context,
      operation,
    );
    if (ticket.replay) return c.json(200, dto(ticket.result));
    let proof;
    try {
      proof =
        service === "website"
          ? require(__hooks + "/websitePublications.js").testWebsiteDraft(
              targetDealer,
              body.proofId,
              body.expectedRevision,
              context,
            )
          : require(__hooks + "/walkarounds.js").verifyCompletedProject(
              targetDealer,
              body.proofId,
              body.expectedRevision,
            );
    } catch (_error) {
      return c.json(
        200,
        dto(
          cfg.finalizeVerification(ticket, {
            ok: false,
            capabilities: [],
            code: "CONNECTION_TEST_FAILED",
          }),
        ),
      );
    }
    // A pending draft is not successful evidence. Its outbox retains identity
    // and resumes delivery; a later explicit test can verify that same draft.
    const result = cfg.finalizeVerification(ticket, {
      ok: proof.ready === true,
      capabilities: proof.ready === true ? proof.capabilities : [],
      code:
        proof.status === "pending"
          ? "CONNECTION_DRAFT_PENDING"
          : "CONNECTION_TEST_FAILED",
    });
    return c.json(200, dto(result));
  } catch (error) {
    return failure(c, error);
  }
}
module.exports = {
  inventory: inventory,
  dealerStatus: dealerStatus,
  proofs: proofs,
  save: save,
  test: test,
  dto: dto,
};
