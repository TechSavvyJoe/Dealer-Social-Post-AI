import type { Page } from "@playwright/test";

/**
 * Catch-all /api stub so a developer's live PocketBase (Vite → :8090) cannot
 * answer fixture e2e. Call BEFORE more-specific page.route handlers —
 * Playwright matches last-registered first, so later stubs win.
 */
export async function isolateFromLiveApi(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/telemetry") return json({ success: true });
    if (path === "/api/app/health") {
      return json({ ok: true, capabilities: {}, releaseSha: "test" });
    }
    if (path === "/api/app/session") {
      return json({ error: "No active session" }, 401);
    }
    if (path === "/api/app/posts" && method === "GET") return json({ items: [] });
    if (path === "/api/app/website-destinations") return json({ items: [] });
    if (path === "/api/app/studio-capabilities") {
      return json({ walkaround: false });
    }
    if (path === "/api/app/dealers") return json([]);
    if (path === "/api/app/salespeople") {
      return json({ items: [], nextCursor: null });
    }
    if (path === "/api/app/connections") return json({ items: [] });
    if (path === "/api/app/walkarounds/youtube/status") {
      return json({ connected: false });
    }
    if (path === "/api/app/dealership-invitation") {
      return json({ error: "No invitation" }, 404);
    }
    if (path.startsWith("/api/proxy/")) {
      return json({ error: "Unstubbed proxy in fixture" }, 500);
    }
    if (method === "GET") return json({});
    return json({ success: true });
  });
}
