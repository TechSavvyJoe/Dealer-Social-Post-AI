const COOKIE = "dealer_invitation";
const MAX_AGE = 90 * 24 * 60 * 60;
function fingerprint(token) {
  return $security.sha256("dealer-social:invitation:v1:" + token);
}
function readToken(c) {
  const match = (c.request().header.get("Cookie") || "").match(
    /(?:^|;\s*)dealer_invitation=([a-f0-9]{64})(?:;|$)/,
  );
  return match ? match[1] : "";
}
function dealerForToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  const records = $app
    .dao()
    .findRecordsByFilter(
      "dealers",
      "invitation_hash = {:hash} && is_system = false",
      "id",
      2,
      0,
      { hash: fingerprint(token) },
    );
  return records.length === 1 ? records[0] : null;
}
function deviceDealer(c) {
  return dealerForToken(readToken(c));
}
function sessionAllowed(session, dealer) {
  const bound = session.getString("invitation_fingerprint");
  if (bound && bound !== dealer.getString("invitation_hash")) return false;
  // Manager-password sessions and authorized impersonation never bind to the
  // invitation cookie. Personal-code sessions always need a current binding.
  if (session.getBool("is_impersonation") || session.getString("manager_account"))
    return true;
  return !!bound && bound === dealer.getString("invitation_hash");
}
function buildCookie(token) {
  return (
    COOKIE +
    "=" +
    token +
    "; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
    MAX_AGE
  );
}
function headers(c) {
  c.response().header().set("Cache-Control", "private, no-store");
  c.response().header().set("Vary", "Cookie");
  c.response().header().set("X-Robots-Tag", "noindex, nofollow");
}
function publicRoute(c, redeem) {
  headers(c);
  const helpers = require(__hooks + "/helpers.js");
  const limit = helpers.checkProxyRateLimit(
    "invitation:" + helpers.clientIP(c),
    60,
    60000,
    { ipKeyed: true },
  );
  if (!limit.ok) {
    c.response().header().set("Retry-After", "60");
    return c.json(429, {
      error: "Please wait a minute before trying this invitation again.",
    });
  }
  try {
    const token = redeem ? ($apis.requestInfo(c).data || {}).token : readToken(c);
    const dealer = dealerForToken(token);
    if (!dealer)
      return c.json(404, {
        error:
          "This invitation is unavailable. Ask your manager for a current private link.",
      });
    if (redeem) {
      // Joining is explicit in the UI. End the old browser session before a
      // code for the invited store can be entered; never mix tenant workspaces.
      const oldToken = helpers.readSessionToken(c);
      const oldSession = oldToken ? helpers.findSessionByToken(oldToken) : null;
      if (oldSession) $app.dao().deleteRecord(oldSession);
      c.response().header().add("Set-Cookie", helpers.buildClearCookie());
      c.response().header().add("Set-Cookie", buildCookie(token));
    }
    return c.json(200, { id: dealer.id, name: dealer.getString("name") });
  } catch (_e) {
    return c.json(503, {
      error: "Dealership access is temporarily unavailable. Try again.",
    });
  }
}
function manage(c, mutate) {
  headers(c);
  const helpers = require(__hooks + "/helpers.js");
  const context = helpers.sessionContext(c);
  if (!context) return c.json(401, { error: "Sign in to manage dealership access." });
  const id = c.pathParam("id");
  if (
    (context.role !== "super_admin" && context.role !== "dealer_admin") ||
    (context.role !== "super_admin" && context.dealer.id !== id)
  )
    return c.json(403, {
      error: "Only this dealership's manager can manage invitations.",
    });
  try {
    let dealer = $app.dao().findRecordById("dealers", id);
    if (dealer.getBool("is_system"))
      return c.json(400, { error: "Select a dealership." });
    let token = "";
    let setIssuerDevice = false;
    if (mutate) {
      const action = ($apis.requestInfo(c).data || {}).action;
      if (action !== "issue" && action !== "require")
        return c.json(400, { error: "Choose an invitation action." });
      if (action === "issue")
        token = helpers.secureRandomString(64, "0123456789abcdef");
      helpers.runAuditedTransaction(
        "dealer_updated",
        {
          dealerId: id,
          credentialPresent: true,
          ip: helpers.clientIP(c),
          userAgent: helpers.userAgent(c),
          detail:
            action === "issue"
              ? "private invitation rotated"
              : "private invitation required",
        },
        function (tx) {
          const actor = helpers.sessionContext(c, tx);
          if (
            !actor ||
            (actor.role !== "super_admin" &&
              (actor.role !== "dealer_admin" || actor.dealer.id !== id))
          )
            throw new Error("AUTHORITY_CHANGED");
          dealer = tx.findRecordById("dealers", id);
          if (action === "issue") dealer.set("invitation_hash", fingerprint(token));
          else {
            if (!dealer.getString("invitation_hash")) throw new Error("ISSUE_FIRST");
            dealer.set("invitation_required", true);
          }
          tx.saveRecord(dealer);
          // Keep the manager performing this explicit action in their workspace
          // so the one-time link cannot disappear before they can copy it.
          // All other personal-code sessions retain their old binding.
          if (actor.role === "dealer_admin" && !actor.isImpersonating) {
            if (!actor.session.getString("manager_account")) {
              actor.session.set(
                "invitation_fingerprint",
                dealer.getString("invitation_hash"),
              );
              tx.saveRecord(actor.session);
            }
            setIssuerDevice = !!token;
          }
        },
      );
    }
    if (setIssuerDevice) c.response().header().add("Set-Cookie", buildCookie(token));
    return c.json(200, {
      required: dealer.getBool("invitation_required"),
      hasInvitation: !!dealer.getString("invitation_hash"),
      ...(token ? { token: token } : {}),
    });
  } catch (error) {
    return c.json(400, {
      error:
        error.message === "ISSUE_FIRST"
          ? "Create and distribute the private invitation first."
          : "Dealership access could not be updated.",
    });
  }
}
module.exports = { deviceDealer, sessionAllowed, publicRoute, manage };
