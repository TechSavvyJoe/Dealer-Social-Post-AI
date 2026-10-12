import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archivePost,
  restorePost,
  bulkArchivePosts,
  bulkRestorePosts,
  getPostDetail,
  listPostsPage,
  setApprovalStatus,
} from "./posts";
import { setActiveAuthEpoch } from "../utils/authBoundary";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const reply = (value: unknown) => {
  setActiveAuthEpoch(0);
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
const request = {
  expectedPostRevision: "2026-10-12 12:00:00.000Z",
  expectedWorkspaceRevision: 0,
};
const receipt = {
  id: "post-1",
  post_revision: request.expectedPostRevision,
  workspace_revision: 1,
  archived: true,
  archived_at: "2026-10-12T13:00:00.000Z",
  archived_by: "Manager",
};
describe("content workspace post adapter", () => {
  it("encodes all discovery options and preserves full matching count metadata", async () => {
    const fetch = reply({
      items: [],
      total: 1007,
      counts: { n_a: 1, pending: 2, approved: 1000, rejected: 4 },
      nextCursor: "opaque",
    });
    const page = await listPostsPage({
      q: "rare & ready",
      since: "2026-10-01",
      until: "2026-10-12",
      ownerPersonId: "person-1",
      archived: "archived",
      media: "video_generated",
      websiteStatus: "published",
      sort: "newest_updated",
      approvalStatus: "approved",
      limit: 50,
      cursor: "before",
    });
    const params = new URL(fetch.mock.calls[0][0], "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      q: "rare & ready",
      since: "2026-10-01",
      until: "2026-10-12",
      owner_person_id: "person-1",
      archived: "archived",
      media: "video_generated",
      website_status: "published",
      sort: "newest_updated",
      approval_status: "approved",
      limit: "50",
      cursor: "before",
    });
    expect(page.total).toBe(1007);
    expect(page.counts?.approved).toBe(1000);
  });
  it("remains compatible with an older list response without totals or workspace metadata", async () => {
    reply({ items: [] });
    expect(await listPostsPage()).toEqual({ items: [], nextCursor: undefined });
  });
  it("projects detail through the customer identity boundary and exposes no fake video URL", async () => {
    const fetch = reply({
      id: "post-1",
      dealer: "dealer-1",
      generated_at: request.expectedPostRevision,
      customer_name: "Lisa Sample",
      caption: "Congratulations to Lisa Sample!",
      has_video: true,
      video_availability: "unavailable",
      archived: true,
      workspace_revision: 1,
    });
    const detail = await getPostDetail("post/1");
    expect(fetch.mock.calls[0][0]).toBe("/api/app/posts/post%2F1");
    expect(detail.customer_name).toBe("Lisa");
    expect(JSON.stringify(detail)).not.toContain("Lisa Sample");
    expect(detail.video_availability).toBe("unavailable");
    expect(detail.archived).toBe(true);
  });
  it.each([archivePost, restorePost])(
    "sends both observed CAS revisions, including valid zero",
    async (fn) => {
      const fetch = reply(receipt);
      expect(await fn("post/1", request)).toEqual(receipt);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        expected_post_revision: request.expectedPostRevision,
        expected_workspace_revision: 0,
      });
    },
  );
  it.each([bulkArchivePosts, bulkRestorePosts])(
    "preserves per-item partial outcomes without collapsing them into success",
    async (fn) => {
      const result = {
        results: [
          { id: "post-1", ok: true, receipt },
          {
            id: "post-2",
            ok: false,
            status: 409,
            code: "POST_WORKSPACE_REVISION_CONFLICT",
            message: "Reload",
          },
        ],
      };
      const fetch = reply(result);
      expect(
        await fn([
          { id: "post-1", ...request },
          { id: "post-2", ...request },
        ]),
      ).toEqual(result);
      expect(JSON.parse(fetch.mock.calls[0][1].body).items[0]).toEqual({
        id: "post-1",
        expected_post_revision: request.expectedPostRevision,
        expected_workspace_revision: 0,
      });
    },
  );
  it("does not issue writes when CAS identity is missing or a batch repeats IDs", () => {
    const fetch = reply({});
    expect(() =>
      archivePost("post-1", { ...request, expectedPostRevision: "" }),
    ).toThrow("revisions");
    expect(() =>
      restorePost("post-1", { ...request, expectedWorkspaceRevision: -1 }),
    ).toThrow("revisions");
    expect(() =>
      bulkArchivePosts([
        { id: "post-1", ...request },
        { id: "post-1", ...request },
      ]),
    ).toThrow("unique");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends current creative revision with a workspace approval decision", async () => {
    const fetch = reply({});
    await setApprovalStatus(
      "post-1",
      "approved",
      "Manager",
      undefined,
      request.expectedPostRevision,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected_post_revision).toBe(
      request.expectedPostRevision,
    );
  });
});
