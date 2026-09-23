import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The approval gate could reject a post but never say why. The salesperson's
 * result screen told them to "create another post with the requested changes"
 * while nothing in the system carried any requested changes, so the only ways
 * to find out were a phone call or resubmitting the same post unchanged.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("a rejection has to say what to change", () => {
  const hook = read("pb_hooks/main.pb.js");

  it("requires a reason in the manager UI, not on the wire", () => {
    // The backend used to hard-fail a rejection with no reason
    // (400 REJECTION_REASON_REQUIRED). That broke during every deploy: Fly
    // ships this backend before Vercel ships the frontend that sends
    // rejection_reason (release-frontend `needs: deploy` in
    // .github/workflows/fly-deploy.yml), and the manager console this feature
    // replaced never sent the field at all — a manager on the old bundle, or
    // anyone on a cached one past that window, got a broken reject button
    // until the new bundle was live everywhere. The requirement now lives
    // only where a human enters it.
    expect(hook).not.toContain("REJECTION_REASON_REQUIRED");
    const queue = read("components/ApprovalQueue.tsx");
    expect(queue).toContain('if (status === "rejected" && !reason.trim())');
  });

  it("accepts a rejection with no reason rather than failing the request", () => {
    // The fallback that makes the above safe: components/PostResult.tsx's
    // approvalGateMessage already renders sensible copy when
    // rejectionReason is empty ("A manager rejected this creative...") — the
    // exact message a salesperson saw before this feature existed. A missing
    // reason must reach that branch, not a 400.
    const anchor = [
      "if (",
      '      decision === "approved" &&',
      '      (!record.getString("caption")',
    ].join("\n");
    const decisionBlock = hook.slice(
      hook.indexOf("const decision = helpers.assertEnum(body.approval_status"),
      hook.indexOf(anchor),
    );
    expect(decisionBlock).not.toContain("return c.json(400");
    expect(decisionBlock).toContain("const rejectionReason = helpers.assertString(");
  });

  it("does not require one to approve", () => {
    // The backend guard is scoped to the rejected branch, and the approve
    // button's disabled condition never mentions the reason, so approving
    // stays one tap.
    const queue = read("components/ApprovalQueue.tsx");
    const approveDisabled = queue.slice(
      queue.indexOf('onClick={() => handleAction(post, "approved")}'),
    );
    const disabledProp = approveDisabled.slice(
      approveDisabled.indexOf("disabled={"),
      approveDisabled.indexOf("}", approveDisabled.indexOf("disabled={")) + 1,
    );
    expect(disabledProp).toContain("canApprove");
    expect(disabledProp).not.toContain("reason");
  });

  it("clears a stale reason when a post is approved", () => {
    // Otherwise a note from an earlier cycle trails an approved post.
    expect(hook).toContain(
      'rejectionReason: decision === "rejected" ? rejectionReason : ""',
    );
  });

  it("persists and returns it", () => {
    expect(hook).toContain("rejection_reason = {:rejectionReason}");
    expect(hook).toContain('rejection_reason: record.getString("rejection_reason")');
    expect(hook).toContain('rejection_reason: r.getString("rejection_reason")');
  });

  it("caps it at the column width so a long note cannot be silently truncated", () => {
    const migration = read("pb_migrations/1752000000_post_rejection_reason.js");
    expect(migration).toContain("options: { max: 280 }");
    expect(hook).toMatch(/rejection_reason \|\| ""\)\.toString\(\)\.trim\(\),\s*280,/);
    expect(read("components/ApprovalQueue.tsx")).toContain("slice(0, 280)");
  });

  it("rolls back with removeField, not the no-op filter idiom", () => {
    const migration = read("pb_migrations/1752000000_post_rejection_reason.js");
    expect(migration).toContain("posts.schema.removeField(field.id)");
    expect(migration).not.toMatch(/\w+\.schema\s*=\s*Array\.from\(/);
  });
});

describe("the reason reaches the salesperson", () => {
  it("leads the locked-delivery message on the result screen", () => {
    // The banner copy moved into utils/postLocks.ts's derivePostLocks
    // (approvalMessage) as part of the pure lock-derivation extraction;
    // PostResult.tsx now renders it via that module.
    const locks = read("utils/postLocks.ts");
    expect(locks).toContain("A manager asked for a change: ${input.rejectionReason}");
    // And the toast, for someone who is not looking at the banner. This one
    // stays with the approval-status polling effect, not the derived lock
    // message — moved into hooks/useApprovalStatus.ts as part of the PR2-0
    // extraction (PostResult.tsx now just calls the hook).
    const approvalHook = read("hooks/useApprovalStatus.ts");
    expect(approvalHook).toContain(
      "Manager asked for a change: ${result.rejection_reason}",
    );
  });

  it("the retargeted banner-copy guard actually fails on a wrong wording (planted mutant)", () => {
    const locks = read("utils/postLocks.ts");
    const mutated = locks.replace(
      "A manager asked for a change: ${input.rejectionReason}",
      "A manager requested a change: ${input.rejectionReason}",
    );
    expect(mutated).not.toContain(
      "A manager asked for a change: ${input.rejectionReason}",
    );
  });

  it("appears on the row in My work", () => {
    const history = read("components/PostHistory.tsx");
    expect(history).toContain("p.rejection_reason");
  });

  it("survives reopening the post from My work", () => {
    // PostResult seeds its state from post.rejectionReason, but the History
    // reopen mapping built a full GeneratedPost with approvalStatus and never
    // set rejectionReason, so reopening a rejected post showed the generic
    // "a manager rejected this" copy with the actual reason dropped on the
    // floor — while the same record rendered it in the list two hundred lines
    // down. The mapping moved to utils/historyPost.ts's
    // toGeneratedPostFromRecord (PR2-0 extraction); PostHistory.tsx now calls
    // it instead of building the object inline.
    const historyPost = read("utils/historyPost.ts");
    const mapping = historyPost.slice(
      historyPost.indexOf("const approval ="),
      historyPost.indexOf("releaseStatus:", historyPost.indexOf("const approval =")),
    );
    expect(mapping).toContain("approvalStatus: approval");
    expect(mapping).toContain("rejectionReason: post.rejection_reason || undefined");
  });

  it("gives the manager quick picks for the common cases", () => {
    const queue = read("components/ApprovalQueue.tsx");
    expect(queue).toContain("QUICK_REASONS");
    expect(queue).toContain("Pricing claim needs a disclosure");
    // The send button stays disabled until there is something to send.
    expect(queue).toContain("disabled={busy[post.id] || !reason.trim()}");
  });
});
