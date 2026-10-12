import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getPostApprovalStatus,
  logPost,
  markPostVideoGenerated,
} from "../services/posts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("approval submission client", () => {
  it("uploads the exact review caption, disclosures, and creative image", async () => {
    let apiRequest: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("data:image/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      apiRequest = init;
      return new Response(
        JSON.stringify({
          id: "post-review-1",
          dealer: "dealer-1",
          generated_at: "2026-07-15T12:00:00.000Z",
          approval_status: "pending",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await logPost({
      requiresApproval: true,
      salespersonName: "Jordan",
      caption: "Exact submitted caption",
      disclosures: "Offer subject to approved credit.",
      imageDataUrl: "data:image/png;base64,AQID",
    });

    expect(result?.id).toBe("post-review-1");
    expect(apiRequest?.body).toBeInstanceOf(FormData);
    const form = apiRequest?.body as FormData;
    expect(form.get("caption")).toBe("Exact submitted caption");
    expect(form.get("disclosures")).toBe("Offer subject to approved credit.");
    const creative = form.get("creative_image");
    expect(creative).toBeInstanceOf(File);
    expect((creative as File).type).toBe("image/png");
  });

  it("polls the owner-scoped status route without caching", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "post id",
            approval_status: "approved",
            approved_by: "Manager",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPostApprovalStatus("post id");

    expect(result.approval_status).toBe("approved");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/posts/post%20id/status",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("records a completed video through the owner-scoped idempotent route", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "post id", has_video: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(markPostVideoGenerated("post id")).resolves.toEqual({
      id: "post id",
      has_video: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/posts/post%20id/video-generated",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

describe("approval backend invariants", () => {
  it("binds status and creative reads to the dealer and submitting session", () => {
    const hook =
      readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8") +
      readFileSync(resolve(process.cwd(), "pb_hooks/postProjection.js"), "utf8");

    expect(hook).toContain('"/api/app/posts/:id/status"');
    expect(hook).toContain('"/api/app/posts/:id/creative-image"');
    expect(hook).toContain('"/api/app/posts/:id/video-generated"');
    expect(hook).toContain('record.getString("owner_session_hash")');
    expect(hook).toContain('record.getString("dealer") !== dealer.id');
    expect(hook).toContain("helpers.hashSessionToken(token)");
    expect(hook).toContain(
      'const ownerSessionHash = token ? helpers.hashSessionToken(token) : ""',
    );
    expect(hook).toContain("owner_session_hash: ownerSessionHash");
    // The video flag is a column-scoped, dealer-scoped write (it must not
    // rewrite the post or move its revision; see postRevisionReceipts.test.ts).
    expect(hook).toContain('"UPDATE posts SET has_video = 1 "');
    expect(hook).toContain(
      '"WHERE id = {:post} AND dealer = {:dealer} AND COALESCE(has_video, 0) = 0 "',
    );
    expect(hook).not.toContain('record.set("has_video", true)');
    expect(hook).toContain("has_video: false");
    expect(hook).toContain('error: "Post belongs to another session"');
    expect(hook).toContain("$filesystem.fileFromMultipart(header)");
    expect(hook).toContain("$app.newFilesystem()");
    expect(hook).toContain('"Cache-Control", "private, no-store"');
  });

  it("repairs the original empty posts-to-dealers relation on fresh installs", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750300200_add_approval_creative.js"),
      "utf8",
    );

    expect(migration).toContain(
      'const dealers = dao.findCollectionByNameOrId("dealers")',
    );
    expect(migration).toContain("dealerOptions.collectionId = dealers.id");
    expect(migration).toContain("dealerField.options = dealerOptions");
  });

  it("prevents blind manager approval and exposes review copy only to managers", () => {
    const hook =
      readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8") +
      readFileSync(resolve(process.cwd(), "pb_hooks/postProjection.js"), "utf8");
    const queue = readFileSync(
      resolve(process.cwd(), "components/ApprovalQueue.tsx"),
      "utf8",
    );

    expect(hook).toContain(
      'error: "Cannot approve a post without reviewable creative"',
    );
    expect(hook).toContain('error: "This approval has already been decided"');
    expect(hook).toContain(
      'context.person ? context.person.getString("name") : "System Admin"',
    );
    expect(hook).not.toContain("body.approved_by");
    expect(hook).toContain("AND approval_status = 'pending'");
    expect(hook).toContain("result.rowsAffected() !== 1");
    expect(hook).toContain('record.getString("dealer") !== dealer.id');
    expect(hook).not.toContain("Super-admin bypasses for cross-tenant support");
    expect(hook).toContain('["approved", "rejected"]');
    expect(hook).toContain("caption: publicCaption");
    expect(hook).toContain("identity_review_required: identityReviewRequired");
    expect(hook).toContain("image_review_required:");
    expect(hook).toContain("policies.postImageReviewRequired(");
    expect(hook).toContain("IMAGE_REVIEW_REQUIRED");
    expect(hook).toContain("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
    expect(hook).toContain("identityReview.reviewRequired");
    expect(hook).toContain("websitePublications.hasValidLinkedRelease(record)");
    expect(hook).toContain("creative_image_url:");
    expect(queue).toContain("post.creative_image_url");
    expect(queue).toContain("post.caption");
    expect(queue).toContain("!hasReviewCreative");
    expect(queue).toContain("post.identity_review_required");
    expect(queue).toContain("post.image_review_required");
    expect(queue).toContain("Customer-name review required");
    expect(queue).toContain("!identityReviewRequired");
    expect(queue).toContain("!imageReviewRequired");
  });
});
