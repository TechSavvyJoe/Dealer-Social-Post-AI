import { test, expect, type Page, type Route, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";

const dealerId = "northline-dealer";
const managerId = "qa-manager";
const authorId = "qa-author";
const stamp = "2026-10-11T12:00:00.000Z";

function makePost(index: number, overrides: Record<string, unknown> = {}) {
  const pending = index === 1 || index === 2;
  return {
    id: `workspace-post-${index}`,
    dealer: dealerId,
    salesperson_name: index % 2 ? "Jamie Rivera" : "Morgan Lee",
    salesperson_id: authorId,
    owner_person_id: authorId,
    attribution_authoritative: true,
    generated_at: new Date(Date.UTC(2026, 9, 11, 12, 0, -index)).toISOString(),
    updated: `2026-10-11 12:00:${String(index % 60).padStart(2, "0")}.000Z`,
    style: "Modern & Bold",
    tone: "Professional",
    customer_name: "",
    scenario_id: "customer_delivery",
    vin: "",
    has_release: false,
    release_required: false,
    release_status: "not_required",
    has_video: false,
    approval_status: pending ? "pending" : "n_a",
    approved_by: "",
    rejection_reason: "",
    approved_at: "",
    caption: `Synthetic saved caption ${index}`,
    disclosures: "",
    platform_ids: ["facebook_feed"],
    media_output_mode: "photo",
    platform_captions: {},
    primary_format_id: "feed_square",
    image_aspect_ratio: "1:1",
    creative_image_url: `/api/app/posts/workspace-post-${index}/creative-image`,
    scheduled_for: "",
    website_draft: null,
    website_publication: { status: "not_requested", reviewUrl: "", lastError: "" },
    share_summary: null,
    archived: false,
    workspace_revision: 0,
    archived_at: "",
    archived_by: "",
    video_availability: "not_generated",
    ...overrides,
  };
}

async function installApiFixture(
  page: Page,
  role: "salesperson" | "dealer_admin",
  failedWebsite = false,
) {
  const records = Array.from({ length: 235 }, (_, index) =>
    makePost(
      index + 1,
      index === 229 ? { caption: "Needle search beyond page one" } : {},
    ),
  );
  if (failedWebsite)
    records[0].website_publication = {
      status: "failed",
      reviewUrl: "",
      lastError: "Transport unavailable",
    };
  const people = [
    {
      id: authorId,
      dealer: dealerId,
      name: "Jamie Rivera",
      role: "salesperson",
      active: true,
    },
    {
      id: "qa-author-2",
      dealer: dealerId,
      name: "Morgan Lee",
      role: "salesperson",
      active: true,
    },
  ];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/app/session") {
      if (method === "GET")
        return reply({
          role,
          dealer: {
            id: dealerId,
            name: "Northline Motors",
            requires_approval: true,
            approval_policy: { mode: "always" },
            brand_voice: "Helpful and clear",
            brand_color: "#234a73",
            brand_primary_color: "#234a73",
          },
          person: {
            id: role === "dealer_admin" ? managerId : authorId,
            dealer: dealerId,
            name: role === "dealer_admin" ? "Casey Manager" : "Jamie Rivera",
            role,
            active: true,
          },
        });
      return reply({ error: "fixture does not accept sign-in" }, 400);
    }
    if (path === "/api/telemetry") return reply({ success: true });
    if (path === "/api/app/salespeople") return reply({ items: people });
    if (path === "/api/app/posts" && method === "GET") {
      // The overview requests aggregate rows before entering Content. A post
      // DTO is not a leaderboard row; keep this separate fixture empty.
      if (url.searchParams.get("aggregate") === "leaderboard")
        return reply({ items: [] });
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const status = url.searchParams.get("approval_status") || "";
      const archive = url.searchParams.get("archived") || "active";
      const limit = Number(url.searchParams.get("limit") || 200);
      const cursor = url.searchParams.get("cursor") || "";
      const queryMatches = records.filter((post) => {
        if (archive !== "all" && post.archived !== (archive === "archived"))
          return false;
        if (status && post.approval_status !== status) return false;
        return (
          !q || `${post.caption} ${post.salesperson_name}`.toLowerCase().includes(q)
        );
      });
      const cursorId = cursor.split("|").at(-1);
      const start = cursorId
        ? queryMatches.findIndex((post) => post.id === cursorId) + 1
        : 0;
      const items = queryMatches.slice(start, start + limit);
      const nextCursor =
        start + limit < queryMatches.length
          ? `newest_updated|${items.at(-1)?.updated}|${items.at(-1)?.id}`
          : undefined;
      return reply({
        items,
        total: queryMatches.length,
        counts: {
          n_a: 0,
          pending: queryMatches.filter((p) => p.approval_status === "pending").length,
          approved: 0,
          rejected: 0,
        },
        ...(nextCursor ? { nextCursor } : {}),
      });
    }
    const detailMatch = path.match(/^\/api\/app\/posts\/([^/]+)$/);
    if (/^\/api\/app\/posts\/[^/]+\/creative-image$/.test(path)) {
      return route.fulfill({
        path: resolve(process.cwd(), "public/samples/delivery.webp"),
      });
    }
    if (detailMatch && method === "GET") {
      const post = records.find(
        (item) => item.id === decodeURIComponent(detailMatch[1]),
      );
      return post ? reply(post) : reply({ error: "not found" }, 404);
    }
    if (
      path === "/api/app/posts/workspace/archive" ||
      path === "/api/app/posts/workspace/restore"
    ) {
      const restore = path.endsWith("restore");
      const body = request.postDataJSON() as {
        items: Array<{ id: string; expected_workspace_revision: number }>;
      };
      const results = body.items.map((entry) => {
        const post = records.find((item) => item.id === entry.id);
        if (
          !post ||
          post.workspace_revision !== entry.expected_workspace_revision ||
          (!restore && entry.id === "workspace-post-2")
        ) {
          return {
            id: entry.id,
            ok: false,
            status: 409,
            code: "POST_WORKSPACE_REVISION_CONFLICT",
            message: "Reload this post",
          };
        }
        post.archived = !restore;
        post.workspace_revision += 1;
        post.archived_at = restore ? "" : stamp;
        post.archived_by = restore ? "" : "Casey Manager";
        mutations.push(`${restore ? "restore" : "archive"}:${entry.id}`);
        return {
          id: entry.id,
          ok: true,
          receipt: {
            id: entry.id,
            post_revision: post.updated,
            workspace_revision: post.workspace_revision,
            archived: post.archived,
            archived_at: post.archived_at,
            archived_by: post.archived_by,
          },
        };
      });
      return reply({ results });
    }
    if (detailMatch && method === "PATCH") {
      const post = records.find(
        (item) => item.id === decodeURIComponent(detailMatch[1]),
      );
      if (!post) return reply({ error: "not found" }, 404);
      const body = request.postDataJSON() as { approval_status: string };
      post.approval_status = body.approval_status;
      post.approved_by = "Casey Manager";
      post.updated = stamp;
      mutations.push(`approve:${post.id}`);
      return reply({ id: post.id, approval_status: post.approval_status });
    }
    if (path === "/api/app/studio-capabilities") return reply({ walkaround: false });
    if (path === "/api/app/posts" && method === "POST") return reply({});
    return reply({ items: [] });
  });
  await page.addInitScript((recorded) => {
    (window as unknown as { __workspaceMutations: string[] }).__workspaceMutations =
      recorded;
  }, mutations);
}

test.describe("Content workspace", () => {
  test("searches beyond the first server page and keeps list/detail usable on narrow screens", async ({
    page,
  }, testInfo: TestInfo) => {
    await installApiFixture(page, "salesperson");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open my work" }).click();
    await expect(page.getByText("235 posts")).toBeVisible();
    const rows = page.getByRole("list", { name: "Saved posts" }).getByRole("listitem");
    await expect(rows).toHaveCount(50);
    await page.screenshot({ path: testInfo.outputPath("my-work-desktop-list.png") });
    await rows
      .first()
      .getByRole("button", { name: /Inspect Delivery/ })
      .click();
    const inspector = page.locator('[aria-label="Content details"]');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("img", { name: /Saved creative/ })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("my-work-desktop-inspector.png"),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: "Content details" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("my-work-mobile-inspector-390x844.png"),
    });
    await page.getByRole("button", { name: "Close content details" }).click();

    await page.getByRole("button", { name: "Active posts" }).click();
    await expect(rows).toHaveCount(50);
    await expect(page.getByText("235 posts")).toBeVisible();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(rows).toHaveCount(100);

    await page
      .getByRole("searchbox", { name: "Search saved posts" })
      .fill("Needle search");
    await expect(page.getByText("1 post")).toBeVisible();
    const result = page.getByRole("button", { name: /Inspect Delivery/ });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByRole("dialog", { name: "Content details" })).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: "Content details" })
        .getByText("Needle search beyond page one"),
    ).toBeVisible();
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  });

  test("manager reviews next pending post, archives with partial outcome, then restores", async ({
    page,
  }, testInfo: TestInfo) => {
    await installApiFixture(page, "dealer_admin");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByRole("tab", { name: "Content" }).click();
    await expect(page.getByText("2 posts")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-desktop-list.png") });
    await page
      .getByRole("button", { name: /Inspect Delivery by Jamie Rivera/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(
      page
        .locator('[aria-label="Content details"]')
        .getByRole("img", { name: /Saved creative/ }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("manager-desktop-inspector.png"),
    });
    await page.getByRole("button", { name: "Review next" }).click();
    await expect(
      page.getByLabel("Content details").getByText("Synthetic saved caption 2"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Post approved for this saved version.")).toBeVisible();

    await page.getByRole("button", { name: "Close content details" }).click();
    await page.getByRole("combobox", { name: "Review status" }).selectOption("all");
    await expect(page.getByText("235 posts")).toBeVisible();
    const selectDelivery = page.getByRole("checkbox", {
      name: "Select Delivery for bulk actions",
    });
    await selectDelivery.nth(0).check();
    await selectDelivery.nth(1).check();
    await page.getByRole("button", { name: "Archive selected" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive posts" })
      .click();
    await expect(page.getByText("1 archived · 1 couldn’t be archived.")).toBeVisible();
    await page.getByRole("button", { name: "Archived" }).click();
    await expect(page.getByText("1 post archived")).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Select Delivery for bulk actions" })
      .first()
      .check();
    await page.getByRole("button", { name: "Restore selected" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore posts" })
      .click();
    await expect(page.getByText(/restored/)).toBeVisible();
  });
});

test("mobile inspector follows safe-area and live banner header geometry", async ({
  page,
  browserName,
  context,
}, testInfo) => {
  await installApiFixture(page, "salesperson");
  await page.setViewportSize({ width: 390, height: 844 });
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: {
        top: 59,
        topMax: 59,
        bottom: 34,
        bottomMax: 34,
        left: 0,
        leftMax: 0,
        right: 0,
        rightMax: 0,
      },
    });
  }
  await page.goto("/");
  await page
    .getByRole("region", { name: "My work" })
    .getByRole("button", { name: "See all" })
    .click();
  await page
    .getByRole("button", { name: /Inspect Delivery/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Content details" });
  const measure = () =>
    page.evaluate(() => ({
      header: document.querySelector("header")!.getBoundingClientRect().bottom,
      inspector: document
        .querySelector('[aria-label="Content details"]')!
        .getBoundingClientRect().top,
    }));
  await expect
    .poll(async () => {
      const r = await measure();
      return Math.abs(r.inspector - r.header);
    })
    .toBeLessThan(1);
  await page.evaluate(() => {
    const header = document.querySelector("header")!;
    const banner = document.createElement("div");
    banner.dataset.testid = "chrome-banner";
    banner.style.cssText = "height:88px;flex:0 0 88px";
    banner.textContent = "Synthetic update banner";
    header.before(banner);
  });
  await expect
    .poll(async () => {
      const r = await measure();
      return Math.abs(r.inspector - r.header);
    })
    .toBeLessThan(1);
  await dialog.getByRole("button", { name: "Archive post" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Archive post" })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("inspector-banner-safe-area.png"),
  });
  await dialog.getByRole("button", { name: "Back to results" }).click();
  await expect(
    page.getByRole("button", { name: /Inspect Delivery/ }).first(),
  ).toBeFocused();
});

test("manager teammate inspector follows website retry through queued to review link", async ({
  page,
}) => {
  await installApiFixture(page, "dealer_admin", true);
  let retried = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/app/website-destinations")
      return reply({
        items: [
          {
            id: "website",
            label: "Private website",
            enabled: true,
            siteUrl: "https://website.example",
            mode: "private_draft",
          },
        ],
      });
    if (path === "/api/app/posts/workspace-post-1/website-publication/retry") {
      retried = true;
      return reply({ status: "queued", lastError: "" });
    }
    if (path === "/api/app/posts/workspace-post-1/website-publication")
      return reply(
        retried
          ? {
              status: "draft_ready",
              reviewUrl: "https://website.example/review/1",
              lastError: "",
            }
          : { status: "failed", lastError: "Transport unavailable" },
      );
    return route.fallback();
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Content" }).click();
  await page
    .getByRole("button", { name: /Inspect Delivery by Jamie Rivera/ })
    .first()
    .click();
  const inspector = page.getByLabel("Content details");
  await expect(inspector.getByRole("button", { name: "Open post" })).toHaveCount(0);
  await inspector.getByRole("button", { name: "Retry website draft" }).click();
  await expect(inspector.getByText("Website draft · Queued")).toBeVisible();
  await expect(
    inspector.getByRole("link", { name: "Review website draft" }),
  ).toHaveAttribute("href", "https://website.example/review/1", { timeout: 15000 });
  await expect(
    inspector.getByRole("button", { name: "Retry website draft" }),
  ).toHaveCount(0);
});
