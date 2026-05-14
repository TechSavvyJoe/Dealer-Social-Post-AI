routerAdd("GET", "/api/test-cookie", (c) => {
  const cookies = c.request().header.get("Cookie") || "";
  c.response().header().add("Set-Cookie", "test=123; Path=/; HttpOnly");
  return c.json(200, { cookies });
});
