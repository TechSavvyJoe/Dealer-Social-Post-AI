routerAdd("GET", "/api/app/vehicle-spins", (c) =>
  require(__hooks + "/vehicleSpins.js").handle(c, "list"),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "create"),
  $apis.bodyLimit(12000),
);
routerAdd("GET", "/api/app/vehicle-spins/:id", (c) =>
  require(__hooks + "/vehicleSpins.js").handle(c, "get"),
);
routerAdd("DELETE", "/api/app/vehicle-spins/:id", (c) =>
  require(__hooks + "/vehicleSpins.js").handle(c, "delete"),
);
routerAdd("GET", "/api/app/vehicle-spins/:id/frames/:angle", (c) =>
  require(__hooks + "/vehicleSpins.js").handle(c, "frame"),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/frames/:angle",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "upload"),
  $apis.bodyLimit(600000),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/finish",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "finish"),
  $apis.bodyLimit(12000),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/review",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "review"),
  $apis.bodyLimit(12000),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/share",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "share"),
  $apis.bodyLimit(12000),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/revoke",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "revoke"),
  $apis.bodyLimit(12000),
);
routerAdd(
  "POST",
  "/api/app/vehicle-spins/:id/export",
  (c) => require(__hooks + "/vehicleSpins.js").handle(c, "export"),
  $apis.bodyLimit(12000),
);
routerAdd("GET", "/api/public/vehicle-spin", (c) =>
  require(__hooks + "/vehicleSpins.js").publicRead(c, false),
);
routerAdd("GET", "/api/public/vehicle-spin/frames/:angle", (c) =>
  require(__hooks + "/vehicleSpins.js").publicRead(c, true),
);
