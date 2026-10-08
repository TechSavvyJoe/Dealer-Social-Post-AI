routerAdd("GET", "/api/app/dealership-invitation", (c) =>
  require(__hooks + "/dealershipInvitations.js").publicRoute(c, false),
);
routerAdd(
  "POST",
  "/api/app/dealership-invitation",
  (c) => require(__hooks + "/dealershipInvitations.js").publicRoute(c, true),
  $apis.bodyLimit(512),
);
routerAdd("GET", "/api/app/dealers/:id/invitation", (c) =>
  require(__hooks + "/dealershipInvitations.js").manage(c, false),
);
routerAdd(
  "POST",
  "/api/app/dealers/:id/invitation",
  (c) => require(__hooks + "/dealershipInvitations.js").manage(c, true),
  $apis.bodyLimit(512),
);
