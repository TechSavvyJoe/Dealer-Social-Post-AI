import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { loadPocketBaseModule } from "../test/loadPocketBaseModule";

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
    expect(hook).toContain('"PHOTO_RELEASE_ALREADY_LINKED"');
    expect(hook).toContain('"Photo release is already linked to another post"');
    expect(hook).toContain("AND (post_id = '' OR post_id IS NULL)");
    expect(hook).toContain("result.rowsAffected() !== 1");
    expect(hook).toContain('post.set("has_release", true)');
    expect(hook).toContain("tx.saveRecord(post)");
    expect(hook.indexOf("SET post_id = {:postId}")).toBeLessThan(
      hook.indexOf('post.set("has_release", true)'),
    );
  });

  it.each([false, true])(
    "returns a 409 without post changes when consent is already linked (concurrent=%s)",
    (concurrent) => {
      const record = (id: string, values: Record<string, unknown>) => ({
        id,
        getString: (key: string) => String(values[key] ?? ""),
        getBool: (key: string) => Boolean(values[key]),
        set: vi.fn(),
      });
      const releaseValues = {
        dealer: "dealer-1",
        owner_session_hash: "owner",
        signature_png: "signature.png",
        customer_name: "Lisa",
        vin: "VIN",
        expires_at: "2099-01-01 00:00:00.000Z",
      };
      const release = record("release-1", {
        ...releaseValues,
        post_id: concurrent ? "" : "another-post",
      });
      const changedRelease = record("release-1", {
        ...releaseValues,
        post_id: "another-post",
      });
      const post = record("post-1", {
        dealer: "dealer-1",
        owner_session_hash: "owner",
        customer_name: "Lisa",
        vin: "VIN",
      });
      const saved = vi.fn();
      let releaseReads = 0;
      const tx = {
        findRecordById: (table: string) =>
          table === "posts" ? post : releaseReads++ === 0 ? release : changedRelease,
        saveRecord: saved,
        db: () => ({
          newQuery: () => ({
            bind: () => ({
              execute: () => ({ rowsAffected: () => 0 }),
            }),
          }),
        }),
      };
      const workspace = loadPocketBaseModule<Record<string, any>>(
        "postWorkspace.js",
        {},
      );
      let handler: ((context: unknown) => unknown) | undefined;
      let result: { status: number; payload: Record<string, unknown> } | undefined;
      const start = hook.indexOf(
        'routerAdd("POST", "/api/app/photo_releases/:id/link-post"',
      );
      runInNewContext(hook.slice(start, hook.indexOf("routerAdd(", start + 20)), {
        __hooks: "/hooks",
        cronAdd: () => {},
        routerAdd: (_method: string, _path: string, callback: typeof handler) => {
          handler = callback;
        },
        require: (path: string) => {
          if (path.endsWith("/postWorkspace.js"))
            return { ...workspace, assertActive: () => {} };
          if (path.endsWith("/websitePublications.js"))
            return { acquirePostWriteFence: () => {} };
          return {
            sessionContext: () => ({ dealer: { id: "dealer-1" } }),
            assertString: (value: string) => value,
            readSessionToken: () => "token",
            hashSessionToken: () => "owner",
            databaseTimestamp: (value: string) => value.replace("T", " "),
            normalizeReleaseIdentity: (value: string) => value,
            normalizeReleaseVin: (value: string) => value,
          };
        },
        $app: {
          dao: () => ({
            ...tx,
            runInTransaction: (callback: (dao: unknown) => void) => callback(tx),
          }),
        },
        $apis: { requestInfo: () => ({ data: { post_id: "post-1" } }) },
        console: { error: vi.fn() },
      });
      handler!({
        pathParam: () => "release-1",
        json: (status: number, payload: Record<string, unknown>) => {
          result = { status, payload };
          return result;
        },
      });
      expect(result).toEqual({
        status: 409,
        payload: {
          error: "Photo release is already linked to another post",
          code: "PHOTO_RELEASE_ALREADY_LINKED",
        },
      });
      expect(post.set).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
    },
  );

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
