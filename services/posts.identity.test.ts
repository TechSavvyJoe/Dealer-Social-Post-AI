import { describe, expect, it } from "vitest";
import {
  logPost,
  projectPostRecordForUi,
  updatePostDraft,
  type PostRecord,
} from "./posts";

const record = (overrides: Partial<PostRecord> = {}): PostRecord => ({
  id: "post-1",
  dealer: "dealer-1",
  generated_at: "2026-08-14T12:00:00.000Z",
  ...overrides,
});

describe("post UI identity projection", () => {
  it("keeps the exact signer out of cards, captions, variants, and website drafts", () => {
    const projected = projectPostRecordForUi(
      record({
        customer_name: "Lisa Marie Sample",
        caption: "Lisa Marie Sample is celebrating a delivery day.",
        platform_captions: {
          instagram_feed: "Congratulations to Lisa Marie Sample!",
        },
        website_draft: {
          enabled: true,
          kind: "customer_story",
          category: "deliveries",
          title: "Welcome, Lisa Marie Sample",
          body: "Lisa Marie Sample is ready for the road ahead.",
          altText: "Lisa Marie Sample beside the vehicle.",
          customerDisplayName: "Lisa Marie Sample",
          schemaVersion: 1,
        },
      }),
    );

    expect(projected.customer_name).toBe("Lisa");
    expect(JSON.stringify(projected)).not.toContain("Lisa Marie Sample");
    expect(projected.caption).toContain("Lisa");
    expect(projected.website_draft?.customerDisplayName).toBe("Lisa");
  });

  it("blocks mixed customer identities before a post or reopened draft is saved", async () => {
    await expect(
      logPost({
        customerName: "Lisa Marie Sample",
        caption:
          "Congratulations to Lisa and Jordan! Lisa and Jordan just celebrated a delivery day.",
      }),
    ).rejects.toThrow("not authorized");

    projectPostRecordForUi(
      record({ id: "post-mixed", customer_name: "Lisa Marie Sample" }),
    );
    await expect(
      updatePostDraft("post-mixed", {
        caption: "Lisa and Jordan just celebrated a delivery day.",
      }),
    ).rejects.toThrow("not authorized");
  });

  it("fails closed when copy names a customer but the post has no approved label", async () => {
    await expect(
      logPost({
        customerIdentityRequired: true,
        caption:
          "Meet Jordan! A memorable delivery day is underway, and the whole team is excited to celebrate.",
      }),
    ).rejects.toThrow("not authorized");

    const projected = projectPostRecordForUi(
      record({
        id: "post-no-approved-name",
        release_required: true,
        caption:
          "Congratulations to Jordan! A memorable delivery day is underway for the whole team.",
      }),
    );
    expect(projected.identity_review_required).toBe(true);
    expect(projected.caption).toBe("Caption held for customer-name review.");
    expect(JSON.stringify(projected)).not.toContain("Jordan");
  });

  it("does not quarantine grounded inventory copy when no customer is required", () => {
    const projected = projectPostRecordForUi(
      record({
        id: "post-inventory",
        release_required: false,
        caption:
          "Bronco just arrived at the dealership, and the showroom team is ready to share the details.",
      }),
    );
    expect(projected.identity_review_required).toBeUndefined();
    expect(projected.caption).toContain("Bronco just arrived");
  });

  it("quarantines legacy wrong-name copy before it reaches a normal UI", () => {
    const projected = projectPostRecordForUi(
      record({
        customer_name: "Lisa Marie Sample",
        caption:
          "Congratulations to Lisa and Jordan! Lisa and Jordan just celebrated a delivery day.",
        platform_captions: {
          instagram_feed: "Lisa and Jordan are ready for the road ahead.",
        },
      }),
    );

    expect(projected.identity_review_required).toBe(true);
    expect(projected.caption).toBe("Caption held for customer-name review.");
    expect(projected.platform_captions).toEqual({});
    expect(JSON.stringify(projected)).not.toContain("Jordan");
  });
});
