import { describe, expect, it } from "vitest";
import type { PostRecord } from "../services/posts";
import {
  isAuthoritativePostOwner,
  postStatusFor,
  savedPostIdentityIsSafe,
  shareStatusDetail,
  toGeneratedPostFromRecord,
} from "./historyPost";

const basePost = (overrides: Partial<PostRecord> = {}): PostRecord => ({
  id: "post-1",
  dealer: "dealer-1",
  generated_at: "2026-09-01T12:00:00.000Z",
  salesperson_name: "Joe",
  salesperson_id: "person-1",
  caption: "Congrats on the new ride!",
  customer_name: "The Smith Family",
  scenario_id: "delivery",
  caption_source: "ai",
  approval_status: "n_a",
  has_release: true,
  release_required: true,
  release_status: "saved",
  creative_image_url: "/api/app/posts/post-1/creative",
  ...overrides,
});

describe("savedPostIdentityIsSafe", () => {
  it("quarantines a record the server flagged for identity review", () => {
    expect(savedPostIdentityIsSafe(basePost({ identity_review_required: true }))).toBe(
      false,
    );
  });

  it("allows dealer/OEM/vehicle grounding phrases in copy", () => {
    const post = basePost({
      caption: "Delivered from Bob Maxey Ford of Howell today!",
    });
    expect(
      savedPostIdentityIsSafe(post, { dealerName: "Bob Maxey Ford of Howell" }),
    ).toBe(true);
  });

  it("rejects a name in copy when no customer identity was ever supplied", () => {
    const post = basePost({
      caption: "Congrats to Michelle on her new Bronco!",
      customer_name: "",
      release_required: true,
    });
    expect(savedPostIdentityIsSafe(post)).toBe(false);
  });

  it("rejects a customerDisplayName mismatch on the website draft", () => {
    const post = basePost({
      website_draft: {
        title: "New arrival",
        body: "Great truck.",
        customerDisplayName: "The Johnson Family",
      } as PostRecord["website_draft"],
    });
    expect(savedPostIdentityIsSafe(post)).toBe(false);
  });

  it("allows the salesperson's own name in the masked phrase set", () => {
    const post = basePost({
      caption: "Ask for Joe on your next visit!",
      customer_name: "",
    });
    expect(savedPostIdentityIsSafe(post)).toBe(true);
  });
});

describe("toGeneratedPostFromRecord", () => {
  it("maps the stored fields, preserving rejectionReason and approvalStatus together", () => {
    const post = basePost({
      approval_status: "rejected",
      rejection_reason: "Please remove the price claim.",
    });
    const generated = toGeneratedPostFromRecord(post, {
      role: "salesperson",
      currentPersonId: "person-1",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(generated.approvalStatus).toBe("rejected");
    expect(generated.rejectionReason).toBe("Please remove the price claim.");
    expect(generated.image).toBe("data:image/jpeg;base64,AAAA");
    expect(generated.postId).toBe("post-1");
    expect(generated.imageReviewRequired).toBe(false);
  });

  it("marks a manager reopening another salesperson's post as read-only", () => {
    const post = basePost({
      salesperson_id: "person-2",
      owner_person_id: "person-1",
      attribution_authoritative: true,
    });
    const generated = toGeneratedPostFromRecord(post, {
      role: "dealer_admin",
      currentPersonId: "person-2",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(generated.historyReadOnly).toBe(true);
    expect(isAuthoritativePostOwner(post, "person-2")).toBe(false);
  });

  it("lets a manager edit a post they authoritatively own", () => {
    const post = basePost({
      salesperson_id: "legacy-display-id",
      owner_person_id: "person-2",
      attribution_authoritative: true,
    });
    const generated = toGeneratedPostFromRecord(post, {
      role: "dealer_admin",
      currentPersonId: "person-2",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(generated.historyReadOnly).toBe(false);
  });

  it("does not mark a salesperson's own reopened post as read-only", () => {
    const post = basePost({ salesperson_id: "person-1" });
    const generated = toGeneratedPostFromRecord(post, {
      role: "salesperson",
      currentPersonId: "person-1",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(generated.historyReadOnly).toBe(false);
  });

  it("derives releaseStatus save_failed when the release is required but not saved", () => {
    const post = basePost({
      has_release: false,
      release_required: true,
      release_status: "pending",
    });
    const generated = toGeneratedPostFromRecord(post, {
      role: "salesperson",
      currentPersonId: "person-1",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(generated.releaseStatus).toBe("save_failed");
  });
});

describe("postStatusFor", () => {
  it("blocks a quarantined identity or image ahead of any other status", () => {
    expect(
      postStatusFor({ identity_review_required: true, approval_status: "approved" }),
    ).toBe("review_blocked");
    expect(
      postStatusFor({ image_review_required: true, approval_status: "approved" }),
    ).toBe("review_blocked");
  });

  it("reads a rejection as changes requested even if it was shared before", () => {
    expect(
      postStatusFor({ approval_status: "rejected", share_summary: { count: 3 } }),
    ).toBe("changes");
  });

  it("reads a pending approval as waiting", () => {
    expect(postStatusFor({ approval_status: "pending" })).toBe("waiting");
  });

  it("reads a share-sheet record as shared once approval is out of the way", () => {
    expect(
      postStatusFor({
        approval_status: "approved",
        share_summary: {
          count: 1,
          last_via: "share_sheet",
          sheet_count: 1,
          last_sheet_channel: "facebook_feed",
        },
      }),
    ).toBe("shared");
  });

  it("never calls a download or a copied caption a share", () => {
    expect(
      postStatusFor({
        approval_status: "n_a",
        share_summary: { count: 1, last_via: "download", sheet_count: 0 },
      }),
    ).toBe("downloaded");
    expect(
      postStatusFor({
        approval_status: "n_a",
        share_summary: { count: 2, last_via: "copy", sheet_count: 0 },
      }),
    ).toBe("copied");
  });

  it("keeps an earlier share sheet visible after a later copy", () => {
    expect(
      postStatusFor({
        approval_status: "n_a",
        share_summary: {
          count: 2,
          last_via: "copy",
          last_channel: "instagram_feed",
          sheet_count: 1,
          last_sheet_channel: "facebook_feed",
        },
      }),
    ).toBe("shared");
  });

  it("judges an older backend without sheet_count by its latest event", () => {
    expect(
      postStatusFor({ share_summary: { count: 1, last_via: "share_sheet" } }),
    ).toBe("shared");
    expect(postStatusFor({ share_summary: { count: 1, last_via: "download" } })).toBe(
      "downloaded",
    );
    expect(postStatusFor({ share_summary: { count: 1, last_via: "copy" } })).toBe(
      "copied",
    );
  });

  it("trusts the share-sheet count over a contradictory latest event", () => {
    expect(
      postStatusFor({
        share_summary: { count: 1, last_via: "share_sheet", sheet_count: 0 },
      }),
    ).toBe("draft");
  });

  it("falls back to draft with nothing else to report", () => {
    expect(postStatusFor({ approval_status: "n_a" })).toBe("draft");
    expect(postStatusFor({})).toBe("draft");
    expect(postStatusFor({ share_summary: null })).toBe("draft");
  });
});

describe("shareStatusDetail", () => {
  it("names the latest share-sheet destination and time for a share", () => {
    expect(
      shareStatusDetail({
        count: 2,
        last_via: "copy",
        last_channel: "instagram_feed",
        last_shared_at: "2026-10-05 16:00:00.000Z",
        sheet_count: 1,
        last_sheet_channel: "linkedin",
        last_sheet_at: "2026-10-05 15:00:00.000Z",
      }),
    ).toEqual({ channel: "linkedin", at: "2026-10-05 15:00:00.000Z" });
  });

  it("names the latest event for a download, a copy or an older backend", () => {
    expect(
      shareStatusDetail({
        count: 1,
        last_via: "download",
        last_channel: "gbp",
        last_shared_at: "2026-10-05 15:00:00.000Z",
        sheet_count: 0,
        last_sheet_channel: "",
        last_sheet_at: "",
      }),
    ).toEqual({ channel: "gbp", at: "2026-10-05 15:00:00.000Z" });
    expect(
      shareStatusDetail({
        count: 1,
        last_via: "share_sheet",
        last_channel: "marketplace",
        last_shared_at: "2026-10-05 15:00:00.000Z",
      }),
    ).toEqual({ channel: "marketplace", at: "2026-10-05 15:00:00.000Z" });
  });
});
