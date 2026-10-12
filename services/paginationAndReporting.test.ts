import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard } from "./posts";
import { listSalespeople } from "./salespeople";
import { setActiveAuthEpoch } from "../utils/authBoundary";

afterEach(() => {
  vi.unstubAllGlobals();
});

const person = (id: string, name: string) => ({
  id,
  dealer: "dealer-1",
  name,
  role: "salesperson",
  active: true,
  hasPin: true,
  pinNeedsDistribution: false,
});

describe("complete roster and reporting reads", () => {
  it("walks every bounded salesperson page instead of silently stopping at 100", async () => {
    setActiveAuthEpoch(40);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [person("person-1", "Alex")],
            nextCursor: "person-1",
            total: 2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [person("person-2", "Jordan")],
            total: 2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSalespeople(true)).resolves.toMatchObject([
      { id: "person-1", name: "Alex" },
      { id: "person-2", name: "Jordan" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=200");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=person-1");
  });

  it("uses the server aggregate so counts above the former 1,000-row cap stay exact", async () => {
    setActiveAuthEpoch(41);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              salesperson: "Alex",
              salespersonId: "person-1",
              count: 1250,
              videoCount: 400,
              releaseCount: 1200,
              lastPostedAt: "2026-07-28 12:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const entries = await getLeaderboard(
      "dealer-1",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    expect(entries[0]).toMatchObject({
      salesperson: "Alex",
      salespersonId: "person-1",
      count: 1250,
    });
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("aggregate=leaderboard");
    expect(requestUrl).not.toContain("limit=1000");
  });

  it("implements the aggregate in tenant-scoped SQL and keeps normal history cursor-paged", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const route = hook.slice(
      hook.indexOf('routerAdd("GET", "/api/app/posts"'),
      hook.indexOf(
        'routerAdd("PATCH", "/api/app/posts/:id"',
        hook.indexOf('routerAdd("GET", "/api/app/posts"'),
      ),
    );

    expect(route).toContain('aggregate === "leaderboard"');
    expect(route).toContain('summaryFilters = ["p.dealer = {:dealer}"]');
    expect(route).toContain("COUNT(*) AS count");
    expect(route).toContain("GROUP BY p.attribution_authoritative");
    expect(route).toContain("COALESCE(p.owner_person_id, '')");
    const workspace = readFileSync(
      resolve(process.cwd(), "pb_hooks/postWorkspace.js"),
      "utf8",
    );
    expect(workspace).toContain("options.limit + 1");
    expect(workspace).toContain("payload.nextCursor");
  });
});
