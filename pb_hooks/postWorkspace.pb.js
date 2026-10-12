routerAdd("GET", "/api/app/posts/:id", (c) =>
  require(__hooks + "/postWorkspace.js").detail(c),
);
routerAdd("POST", "/api/app/posts/:id/archive", (c) =>
  require(__hooks + "/postWorkspace.js").mutate(c, true, false),
);
routerAdd("POST", "/api/app/posts/:id/restore", (c) =>
  require(__hooks + "/postWorkspace.js").mutate(c, false, false),
);
routerAdd("POST", "/api/app/posts/workspace/archive", (c) =>
  require(__hooks + "/postWorkspace.js").mutate(c, true, true),
);
routerAdd("POST", "/api/app/posts/workspace/restore", (c) =>
  require(__hooks + "/postWorkspace.js").mutate(c, false, true),
);
