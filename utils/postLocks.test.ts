import { describe, expect, it } from "vitest";
import {
  checkCaptionIdentity,
  derivePostLocks,
  type CaptionIdentityContext,
  type DerivePostLocksInput,
} from "./postLocks";

const baseIdentity: CaptionIdentityContext = {
  customerDisplayName: undefined,
  dealerName: "Bob Maxey Ford of Howell",
  oemAffiliation: "Ford",
  vehicleDescription: "2025 Ford Bronco Sport",
  currentPersonName: "Joe Gallant",
  customerIdentityRequired: false,
  isCustomerStory: false,
};

const baseInput: DerivePostLocksInput = {
  captions: ["Big smiles today! Ford is proud to hand over another set of keys."],
  identity: baseIdentity,
  prohibited: [],
  imageReviewRequired: false,
  reviewRequired: false,
  approvalStatus: "n_a",
  rejectionReason: "",
  releaseStatus: "not_required",
  releaseLinkStatus: undefined,
  releaseId: undefined,
  postId: "post-1",
  customerDisplayName: undefined,
};

describe("checkCaptionIdentity", () => {
  it("allows grounded business phrases (dealer, OEM, vehicle)", () => {
    expect(
      checkCaptionIdentity(
        "Bob Maxey Ford of Howell is proud to deliver this 2025 Ford Bronco Sport.",
        baseIdentity,
      ),
    ).toBe(true);
  });

  it("rejects a wrong customer name when rejectAnyCustomerIdentity is forced", () => {
    expect(
      checkCaptionIdentity("Congrats to Michelle on her new Bronco!", {
        ...baseIdentity,
        customerIdentityRequired: true,
      }),
    ).toBe(false);
  });

  it("masks the salesperson's own name in generic prose but not a direct address", () => {
    expect(
      checkCaptionIdentity("Joe Gallant has a new Bronco ready for you.", baseIdentity),
    ).toBe(true);
  });

  it("rejects a different customer's name even when the correct one is expected", () => {
    expect(
      checkCaptionIdentity("Congrats to Michelle on her new Bronco!", {
        ...baseIdentity,
        customerDisplayName: "Sarah",
      }),
    ).toBe(false);
    expect(
      checkCaptionIdentity("Congrats, Sarah, on your new Bronco!", {
        ...baseIdentity,
        customerDisplayName: "Sarah",
      }),
    ).toBe(true);
  });
});

describe("derivePostLocks: precedence (image review > identity > claim > release > approval)", () => {
  it("locks on nothing when every gate is clear", () => {
    const locks = derivePostLocks(baseInput);
    expect(locks.deliveryLocked).toBe(false);
    expect(locks.identityLocked).toBe(false);
    expect(locks.claimLocked).toBe(false);
    expect(locks.releaseLocked).toBe(false);
    expect(locks.approvalLocked).toBe(false);
  });

  it("image review wins over every other lock", () => {
    const locks = derivePostLocks({
      ...baseInput,
      imageReviewRequired: true,
      captions: ["Congrats to Michelle!"],
      identity: { ...baseIdentity, customerIdentityRequired: true },
      prohibited: [
        {
          category: "prohibited_phrase",
          triggerPhrase: "guaranteed approval",
          disclosure: "",
          prohibited: true,
        },
      ],
      releaseStatus: "save_failed",
      reviewRequired: true,
      approvalStatus: "rejected",
    });
    expect(locks.primary.kind).toBe("image_review");
    expect(locks.primary.title).toBe("This image needs to be remade");
    expect(locks.primary.label).toBe("Image review required");
    expect(locks.primary.message).toBe(locks.imageReviewMessage);
    expect(locks.deliveryLocked).toBe(true);
  });

  it("identity wins over claim, release and approval", () => {
    const locks = derivePostLocks({
      ...baseInput,
      captions: ["Congrats to Michelle!"],
      identity: { ...baseIdentity, customerIdentityRequired: true },
      prohibited: [
        {
          category: "prohibited_phrase",
          triggerPhrase: "guaranteed approval",
          disclosure: "",
          prohibited: true,
        },
      ],
      releaseStatus: "save_failed",
      reviewRequired: true,
      approvalStatus: "rejected",
    });
    expect(locks.primary.kind).toBe("identity");
    expect(locks.primary.title).toBe("Check the customer's name");
    expect(locks.primary.label).toBe("Customer blocked");
  });

  it("claim wins over release and approval", () => {
    const locks = derivePostLocks({
      ...baseInput,
      prohibited: [
        {
          category: "prohibited_phrase",
          triggerPhrase: "guaranteed approval",
          disclosure: "",
          prohibited: true,
        },
      ],
      releaseStatus: "save_failed",
      reviewRequired: true,
      approvalStatus: "rejected",
    });
    expect(locks.primary.kind).toBe("claim");
    expect(locks.primary.title).toBe("Caption needs a fix");
    expect(locks.primary.label).toBe("Claim blocked");
    expect(locks.primary.message).toContain("prohibited advertising claim");
  });

  it("release wins over approval, and repairable vs. not-saved keep their own copy", () => {
    const repairable = derivePostLocks({
      ...baseInput,
      releaseStatus: "save_failed",
      releaseLinkStatus: "link_failed",
      releaseId: "release-1",
      postId: "post-1",
      reviewRequired: true,
      approvalStatus: "rejected",
    });
    expect(repairable.releaseLinkRepairable).toBe(true);
    expect(repairable.primary.kind).toBe("release");
    expect(repairable.primary.title).toBe("Photo release not attached yet");
    expect(repairable.primary.label).toBe("Release not attached");
    expect(repairable.releaseMessage).toContain("nothing needs to be signed again");

    const notSaved = derivePostLocks({
      ...baseInput,
      releaseStatus: "save_failed",
      releaseLinkStatus: undefined,
      reviewRequired: true,
      approvalStatus: "rejected",
    });
    expect(notSaved.releaseLinkRepairable).toBe(false);
    expect(notSaved.primary.title).toBe("Photo release not saved");
    expect(notSaved.primary.label).toBe("Release not saved");
    expect(notSaved.releaseMessage).toContain("was not stored");
  });

  it("release stays locked without both ids even when the link failed", () => {
    const locks = derivePostLocks({
      ...baseInput,
      releaseStatus: "save_failed",
      releaseLinkStatus: "link_failed",
      releaseId: undefined,
      postId: "post-1",
    });
    expect(locks.releaseLinkRepairable).toBe(false);
  });

  it("approval is the fallback reason, with the verbatim rejection copy", () => {
    const rejectedWithReason = derivePostLocks({
      ...baseInput,
      reviewRequired: true,
      approvalStatus: "rejected",
      rejectionReason: "Please remove the pricing claim.",
    });
    expect(rejectedWithReason.deliveryLocked).toBe(true);
    expect(rejectedWithReason.primary.kind).toBe("approval");
    expect(rejectedWithReason.primary.label).toBe("Changes requested");
    expect(rejectedWithReason.approvalMessage).toBe(
      "Your manager asked for a change: Please remove the pricing claim. Start a new post to make it.",
    );

    const rejectedNoReason = derivePostLocks({
      ...baseInput,
      reviewRequired: true,
      approvalStatus: "rejected",
      rejectionReason: "",
    });
    expect(rejectedNoReason.approvalMessage).toBe(
      "Your manager sent this back. Start a new post with the changes.",
    );

    const pending = derivePostLocks({
      ...baseInput,
      reviewRequired: true,
      approvalStatus: "pending",
    });
    expect(pending.approvalLocked).toBe(true);
    expect(pending.approvalMessage).toBe(
      "Your manager needs to approve this image and caption. It's saved in My work, and sharing unlocks here as soon as it's approved.",
    );

    const submissionFailed = derivePostLocks({
      ...baseInput,
      reviewRequired: true,
      approvalStatus: "submission_failed",
    });
    expect(submissionFailed.approvalMessage).toBe(
      "This post couldn't be sent for approval. Check your connection, then start a new post.",
    );

    const approved = derivePostLocks({
      ...baseInput,
      reviewRequired: true,
      approvalStatus: "approved",
    });
    expect(approved.approvalLocked).toBe(false);
    expect(approved.deliveryLocked).toBe(false);
    expect(approved.approvalMessage).toBe(
      "Your manager approved this post. You can share it now. To change anything, start a new post.",
    );
  });

  it("identityMessage names the customer, or falls back when there is none", () => {
    const named = derivePostLocks({
      ...baseInput,
      captions: ["Congrats to Michelle!"],
      identity: { ...baseIdentity, customerIdentityRequired: true },
      customerDisplayName: "Sarah",
    });
    expect(named.identityMessage).toBe(
      "The caption seems to name someone other than Sarah. Edit the caption to remove that name, then share.",
    );

    const unnamed = derivePostLocks({
      ...baseInput,
      captions: ["Congrats to Michelle!"],
      identity: { ...baseIdentity, customerIdentityRequired: true },
      customerDisplayName: undefined,
    });
    expect(unnamed.identityMessage).toBe(
      "The caption names a person who hasn't signed a release. Remove the name or use the customer's first name.",
    );
  });
});
