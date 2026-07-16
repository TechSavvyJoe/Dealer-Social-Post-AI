import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hook = readFileSync(
  resolve(process.cwd(), "pb_hooks/main.pb.js"),
  "utf8",
);
const helpers = readFileSync(
  resolve(process.cwd(), "pb_hooks/helpers.js"),
  "utf8",
);

describe("PocketBase 0.22 multipart routes", () => {
  it("does not pass parsed request-info objects to RecordUpsertForm", () => {
    expect(hook).not.toContain('form.loadRequest($apis.requestInfo(c), "")');
    expect(hook + helpers).toContain("$filesystem.fileFromMultipart(header)");
  });

  it("creates a durable unlinked release with tenant and audit data forced server-side", () => {
    expect(hook).toContain('c.formFile("signature_png")');
    expect(hook).toContain('form.addFiles("signature_png", signatureFile)');
    expect(hook).toContain("dealer: dealer.id");
    expect(hook).toContain("signed_at: new Date().toISOString()");
    expect(hook).toContain('post_id: ""');
    expect(hook).toContain('data.ip_hash = ip ? $security.sha256(ip) : ""');
    expect(hook).toContain("has_release: false");
  });

  it("links consent one way only after validating release, post, tenant, and owner", () => {
    expect(hook).toContain('"/api/app/photo_releases/:id/link-post"');
    expect(hook).toContain(
      'release.getString("dealer") !== dealer.id',
    );
    expect(hook).toContain('post.getString("dealer") !== dealer.id');
    expect(hook).toContain("Cross-dealer release link blocked");
    expect(hook).toContain(
      'currentOwnerHash !== post.getString("owner_session_hash")',
    );
    expect(hook).toContain(
      'error: "Photo release is already linked to another post"',
    );
    expect(hook).toContain("AND (post_id = '' OR post_id IS NULL)");
    expect(hook).toContain("result.rowsAffected() !== 1");
    expect(hook).toContain('post.set("has_release", true)');
    expect(hook).toContain("$app.dao().saveRecord(post)");
    expect(hook.indexOf("SET post_id = {:postId}")).toBeLessThan(
      hook.indexOf('post.set("has_release", true)'),
    );
  });

  it("lets only super-admins mutate credentials and validates dealer codes", () => {
    expect(hook).toContain(
      "helpers.dealerMutationData(body, isSuperAdmin, isSuperAdmin)",
    );
    expect(helpers).toContain("if (allowCode && body.code !== undefined)");
    expect(helpers).toContain("if (!/^[0-9]{6}$/.test(code))");
    expect(helpers).toContain("!/^[A-Za-z0-9]{4,12}$/.test(adminCode)");
    expect(helpers).toContain(
      'findFirstRecordByFilter("dealers", filter, params)',
    );
    expect(helpers).toContain("Dealer logo must be a PNG, JPEG, or WebP image");
    expect(helpers).toContain("file.size > 5 * 1024 * 1024");
    expect(helpers).toContain(
      'options.mimeTypes = ["image/png", "image/jpeg", "image/webp"]',
    );
    expect(hook).toContain("helpers.restrictDealerLogoSchema(");
    expect(hook).toContain("Dealer and manager codes must be different");
    expect(hook).toContain(
      "The system-admin dealer code must be rotated through the deployment secret runbook",
    );
    expect(hook).toContain('helpers.logAuthEvent("dealer_credentials_rotated"');
    expect(hook).toContain("helpers.revokeDealerSessions(");
    expect(helpers).toContain("function revokeDealerSessions(");
    expect(hook).toContain("const logo = helpers.dealerLogoFile(c)");
  });
});
