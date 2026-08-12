import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");

describe("PocketBase 0.22 multipart routes", () => {
  it("does not pass parsed request-info objects to RecordUpsertForm", () => {
    expect(hook).not.toContain('form.loadRequest($apis.requestInfo(c), "")');
    expect(hook + helpers).toContain("$filesystem.fileFromMultipart(header)");
  });

  it("creates a durable unlinked release with minimized server-owned audit data", () => {
    expect(hook).toContain('c.formFile("signature_png")');
    expect(hook).toContain('form.addFiles("signature_png", signatureFile)');
    expect(hook).toContain("dealer: dealer.id");
    expect(hook).toContain("signed_at: new Date().toISOString()");
    expect(hook).toContain('post_id: ""');
    expect(hook).toContain('ip_hash: ""');
    expect(hook).toContain('user_agent: ""');
    expect(hook).not.toContain("$security.sha256(ip)");
    expect(hook).toContain("has_release: false");
    const minimizationMigration = readFileSync(
      resolve(
        process.cwd(),
        "pb_migrations/1750800500_minimize_photo_release_metadata.js",
      ),
      "utf8",
    );
    expect(minimizationMigration).toContain(
      "UPDATE photo_releases SET ip_hash = '', user_agent = ''",
    );
  });

  it("links consent one way only after validating release, post, tenant, and owner", () => {
    expect(hook).toContain('"/api/app/photo_releases/:id/link-post"');
    expect(hook).toContain('release.getString("dealer") !== dealer.id');
    expect(hook).toContain('post.getString("dealer") !== dealer.id');
    expect(hook).toContain("Cross-dealer release link blocked");
    expect(hook).toContain('currentOwnerHash !== post.getString("owner_session_hash")');
    expect(hook).toContain('error: "Photo release is already linked to another post"');
    expect(hook).toContain("AND (post_id = '' OR post_id IS NULL)");
    expect(hook).toContain("result.rowsAffected() !== 1");
    expect(hook).toContain('post.set("has_release", true)');
    expect(hook).toContain("$app.dao().saveRecord(post)");
    expect(hook.indexOf("SET post_id = {:postId}")).toBeLessThan(
      hook.indexOf('post.set("has_release", true)'),
    );
  });

  it("keeps dealer credentials out of CRUD and manages personal codes through audited actions", () => {
    expect(
      hook.match(/helpers\.dealerMutationData\(body, false, false\)/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(hook).not.toContain(
      "helpers.dealerMutationData(body, isSuperAdmin, isSuperAdmin)",
    );
    expect(helpers).toContain("if (allowCode && body.code !== undefined)");
    expect(helpers).toContain("if (code && !/^[A-Za-z0-9]{4,12}$/.test(code))");
    expect(helpers).toContain("function adminAuthFingerprint(account)");
    expect(helpers).toContain("function findActiveAdminLogin(username)");
    expect(helpers).toContain("Dealer logo must be a PNG, JPEG, or WebP image");
    expect(helpers).toContain("file.size > 5 * 1024 * 1024");
    expect(helpers).toContain(
      'options.mimeTypes = ["image/png", "image/jpeg", "image/webp"]',
    );
    expect(hook).toContain("helpers.restrictDealerLogoSchema(");
    expect(hook).toContain("The system dealer cannot be edited");
    expect(hook).toContain('"/api/app/salespeople/:id/rotate-pin"');
    expect(hook).toContain('"/api/app/salespeople/:id/reveal-pin"');
    expect(hook).toContain('"/api/app/salespeople/:id/acknowledge-pin"');
    expect(hook).toContain('helpers.runAuditedTransaction("person_pin_rotated"');
    // Reveal is retired: hashed storage makes returning a current code impossible.
    expect(hook).toContain('"PIN_REVEAL_RETIRED"');
    expect(hook).not.toContain('helpers.logAuthEvent("person_pin_revealed"');
    expect(hook).toContain("helpers.revokePersonSessionsWithDao(");
    expect(helpers).toContain("function revokeDealerSessions(");
    expect(helpers).toContain("function revokePersonSessions(");
    expect(hook).toContain("const logo = helpers.dealerLogoFile(c)");
  });
});
