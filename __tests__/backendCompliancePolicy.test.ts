import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeCaptionSetForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";

type ComplianceResult = {
  ok: boolean;
  error: string;
  categories: string[];
  required_disclosures: string;
  legal_prohibited: boolean;
  dealer_blocked_phrases: string[];
};

type Policies = {
  canonicalPostCompliance(caption: string, bannedPhrases?: string): ComplianceResult;
  validatePostCompliance(
    caption: string,
    disclosures: string,
    bannedPhrases?: string,
  ): ComplianceResult;
  canonicalPostComplianceSet(
    captions: string[],
    bannedPhrases?: string,
  ): ComplianceResult;
  validatePostComplianceSet(
    captions: string[],
    disclosures: string,
    bannedPhrases?: string,
  ): ComplianceResult;
};

function loadPolicies(): Policies {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
    "utf8",
  );
  const module = { exports: {} as Policies };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const policies = loadPolicies();

describe("PocketBase post compliance policy", () => {
  it.each([
    "Finance it with 4.9% APR on approved credit.",
    "Drive today with $0 down.",
    "Lease for $399/mo for 36 months.",
    "Save up to $5,000 this month.",
    "Ask about your trade-in value.",
  ])("matches the canonical delivery disclosure for %s", (caption) => {
    const clientCanonical = prepareCaptionForDelivery(caption).disclosures;
    const serverCanonical = policies.canonicalPostCompliance(caption);

    expect(serverCanonical.required_disclosures).toBe(clientCanonical);
    expect(policies.validatePostCompliance(caption, clientCanonical).ok).toBe(true);
  });

  it("rejects a disclosure marker without the exact required text", () => {
    const result = policies.validatePostCompliance(
      "Finance it with 4.9% APR.",
      "— Disclosures —",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exact canonical/i);
  });

  it("rejects missing, edited, extra, and caption-embedded disclosures", () => {
    const caption = "Finance it with 4.9% APR.";
    const canonical = policies.canonicalPostCompliance(caption);

    expect(policies.validatePostCompliance(caption, "").ok).toBe(false);
    expect(
      policies.validatePostCompliance(
        caption,
        canonical.required_disclosures.replace("qualified", "eligible"),
      ).ok,
    ).toBe(false);
    expect(
      policies.validatePostCompliance(
        "A straightforward vehicle spotlight.",
        "— Disclosures —\nUnrequested legal copy.",
      ).ok,
    ).toBe(false);
    expect(
      policies.validatePostCompliance(
        `${caption}\n\n${canonical.required_disclosures}`,
        canonical.required_disclosures,
      ).error,
    ).toMatch(/submitted separately/i);
  });

  it("blocks prohibited credit claims regardless of supplied disclosures", () => {
    const result = policies.validatePostCompliance(
      "Everyone approved — no credit check.",
      "",
    );
    expect(result.ok).toBe(false);
    expect(result.legal_prohibited).toBe(true);
    expect(result.error).toMatch(/prohibited advertising/i);
  });

  it("matches dealer phrases case-insensitively across punctuation", () => {
    const result = policies.validatePostCompliance(
      "Our BIGGEST—SALE is live now.",
      "",
      "biggest sale, lowest price",
    );
    expect(result.ok).toBe(false);
    expect(result.dealer_blocked_phrases).toEqual(["biggest sale"]);
    expect(result.error).toMatch(/blocked by this dealership/i);
  });

  it("does not match a blocked word inside an unrelated longer word", () => {
    expect(
      policies.validatePostCompliance("A refined carpeted interior.", "", "car").ok,
    ).toBe(true);
  });

  it("validates one canonical disclosure union across all destination captions", () => {
    const captions = [
      "Congratulations on your delivery!",
      "Lease for $299/mo with approved credit.",
    ];
    const clientCanonical = analyzeCaptionSetForDelivery(captions).disclosures;
    const serverCanonical = policies.canonicalPostComplianceSet(captions);

    expect(serverCanonical.required_disclosures).toBe(clientCanonical);
    expect(policies.validatePostComplianceSet(captions, clientCanonical).ok).toBe(true);
    expect(policies.validatePostComplianceSet(captions, "").error).toMatch(
      /exact canonical/i,
    );
  });

  it("keeps the client and server union identical when captions trigger rules out of order", () => {
    const captions = [
      "Lease for $299/mo with approved credit.",
      "Qualified buyers can ask about 4.9% APR.",
    ];
    const clientCanonical = analyzeCaptionSetForDelivery(captions);
    const serverCanonical = policies.canonicalPostComplianceSet(captions);

    expect(clientCanonical.disclosureCategories).toEqual(["financing_apr", "lease"]);
    expect(serverCanonical.categories).toEqual(["financing_apr", "lease"]);
    expect(clientCanonical.disclosures).toBe(serverCanonical.required_disclosures);
    expect(
      policies.validatePostComplianceSet(captions, clientCanonical.disclosures).ok,
    ).toBe(true);
  });

  it("enforces compliance both on queue creation and before approval", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const firstValidation = hook.indexOf("policies.validatePostComplianceSet(");
    const secondValidation = hook.lastIndexOf("policies.validatePostComplianceSet(");
    const postSubmit = hook.indexOf("form.submit();", firstValidation);
    const conditionalApproval = hook.indexOf(
      "\"AND approval_status = 'pending' \"",
      secondValidation,
    );

    expect(firstValidation).toBeGreaterThan(-1);
    expect(secondValidation).toBeGreaterThan(firstValidation);
    expect(firstValidation).toBeLessThan(postSubmit);
    expect(secondValidation).toBeLessThan(conditionalApproval);
    expect(hook).toContain('dealer.getString("banned_phrases")');
    expect(hook).toContain("return c.json(400, { error: compliance.error })");
    expect(hook).toContain("return c.json(409, { error: compliance.error })");
  });

  it("wires the team-member disclosure fields through the backend as an opt-out", () => {
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751900000_employee_disclosure.js"),
      "utf8",
    );

    // The column must be the opt-OUT spelling. PocketBase reports an unset bool
    // as false, so an `..._enabled` field would read false for every dealership
    // that existed before the deploy and turn the disclosure off for all of them.
    expect(migration).toContain("employee_disclosure_disabled");
    expect(migration).not.toContain("employee_disclosure_enabled");
    expect(helpers).not.toContain("employee_disclosure_enabled");

    // The migration must add fields the way PB 0.22 actually applies them.
    expect(migration).toContain("schema.getFieldByName(field.name)");
    expect(migration).toContain("collection.schema.addField(new SchemaField(field))");

    // And it must ROLL BACK for real. `schema = Array.from(schema).filter(...)`
    // reports "Applied" and leaves the column in place on 0.22 (verified
    // against 0.22.55 on a copy of production data); removeField takes the
    // field id. The repo-wide rule below covers every migration; this keeps
    // the reference implementation pinned by name.
    expect(migration).toContain("dealers.schema.removeField(field.id)");
    // Match the assignment as it appears in code (collection-qualified), so the
    // migration's own comment naming the broken idiom does not trip this.
    expect(migration).not.toMatch(/\w+\.schema\s*=\s*Array\.from\(/);

    // Text limit, bool allowlist and serializer all carry the new fields.
    expect(helpers).toContain("employee_disclosure_text: 280");
    expect(helpers).toContain('"employee_disclosure_disabled",');
    expect(helpers).toContain(
      'employee_disclosure_text: record.getString("employee_disclosure_text")',
    );
    expect(helpers).toContain(
      'employee_disclosure_disabled: recordBool(record, "employee_disclosure_disabled")',
    );
  });

  it("keeps the team-member line out of the canonical Reg Z/M disclosure block", () => {
    // pb_hooks/requestPolicies.js requires posts.disclosures to equal the exact
    // canonical block, so the employee line has to live in the caption body.
    // A caption that leads with it must still validate.
    const prepared = prepareCaptionForDelivery(
      "Posted by a Bob Maxey Ford team member.\n\nDrive home today with 4.9% APR on approved credit.",
    );
    expect(prepared.caption.startsWith("Posted by a Bob Maxey Ford team member.")).toBe(
      true,
    );
    expect(prepared.disclosures).not.toContain("team member");
    expect(prepared.disclosures).toBeTruthy();
  });
});

/**
 * Schema removal in PocketBase 0.22 migrations.
 *
 * `collection.schema = Array.from(collection.schema).filter(...)` is a SILENT
 * NO-OP: the CLI prints "Applied", the migration is recorded as run, and the
 * column stays in both the table and the collection schema. Proven on 0.22.55
 * against a copy of real pb_data, twice — once when the idiom was first found
 * and again when the 21 files that carried it were converted. The rollback
 * path for every one of those schema changes had never worked.
 *
 * Worse than a broken rollback: one migration used the idiom in the UP
 * direction to drop a plaintext credential column, and believed it had.
 *
 * The working API takes the field ID: getFieldByName(name) then
 * removeField(field.id). This test makes the broken idiom unmergeable.
 */
describe("PocketBase migrations remove schema fields with an API that works", () => {
  const dir = resolve(process.cwd(), "pb_migrations");
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort();

  /** Strip comments so a migration may still DESCRIBE the broken idiom. */
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("has migrations to check", () => {
    expect(migrations.length).toBeGreaterThan(50);
  });

  it("never assigns a filtered copy back onto a collection schema", () => {
    const offenders: string[] = [];
    for (const name of migrations) {
      const code = withoutComments(readFileSync(resolve(dir, name), "utf8"));
      // The assignment as it appears in code: `<anything>.schema = Array.from(`.
      // `.indexes = Array.from(...)` is a different mechanism (a plain string
      // array) and is not in scope.
      for (const match of code.matchAll(/\b\w+\.schema\s*=\s*Array\.from\(/g)) {
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`pb_migrations/${name}:${line}`);
      }
    }
    expect(
      offenders,
      `these assign a filtered schema back, which PocketBase 0.22 ignores; use getFieldByName + removeField(field.id):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("only ever calls removeField with a field id, never a name", () => {
    // removeField(field.name), removeField("name") and removeField(field) are
    // three other ways to write a no-op or a wrong removal. The original
    // version of this rule only caught the string-literal case, so
    // removeField(field.name) — the mistake this codebase's own
    // getFieldByName(name) return value most invites — sailed through.
    const offenders: string[] = [];
    for (const name of migrations) {
      const code = withoutComments(readFileSync(resolve(dir, name), "utf8"));
      for (const match of code.matchAll(/\.removeField\(\s*([^)]*?)\s*\)/g)) {
        if (/^\w+\.id$/.test(match[1])) continue;
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`pb_migrations/${name}:${line}  removeField(${match[1]})`);
      }
    }
    expect(
      offenders,
      `removeField must be called with exactly <field>.id:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("never reads a collection schema as a JS array", () => {
    // `collection.schema` is a Go struct with no JS-visible length or index
    // access — `schema.length` reads `undefined` and `schema[i]` reads
    // `undefined`. A hand-rolled `for (let i = 0; i < s.length; i++)` helper
    // fed `collection.schema` therefore always returns "not found", so
    // `addField` runs even when the field already exists. On a database where
    // the migration is not recorded as applied but the column already exists
    // (a history-sync repair, a snapshot restore, a rebuilt volume) that
    // fails the whole `migrate up` with "duplicate column name" — a container
    // that never starts serving, since migrations run at boot. Reproduced
    // against the real 0.22.37 binary on 2026-09-11: an already-applied
    // migration written this way, re-run after its `_migrations` row was
    // deleted, failed exactly that way; converted to getFieldByName, it did
    // not.
    //
    // Passing `.schema` as an argument to anything is itself the signal: a
    // scan of every migration in this repo found zero legitimate uses of
    // `X.schema` followed by `,` or `)` — every real use is a method call
    // (`.getFieldByName(`, `.addField(`, `.removeField(`), never a value
    // handed to a helper.
    const offenders: string[] = [];
    for (const name of migrations) {
      const code = withoutComments(readFileSync(resolve(dir, name), "utf8"));
      for (const match of code.matchAll(/\w+\.schema\s*[,)]/g)) {
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`pb_migrations/${name}:${line}  ${match[0]}`);
      }
    }
    expect(
      offenders,
      `a collection schema is passed as a value rather than called as a method on:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("finishes the credential-column drop that the original migration only believed it did", () => {
    // 1750200000 dropped `code_attempted` with the no-op idiom, so the column
    // survived in production with the migration marked applied. A later
    // migration has to do it for real, and both must use the working API.
    const original = withoutComments(
      readFileSync(resolve(dir, "1750200000_harden_auth_events.js"), "utf8"),
    );
    expect(original).toContain('getFieldByName("code_attempted")');
    expect(original).toMatch(/removeField\(\s*\w+\.id\s*\)/);

    const purge = migrations.find((name) => /purge_code_attempted/.test(name));
    expect(
      purge,
      "a follow-up migration must drop code_attempted for real",
    ).toBeTruthy();
    const source = withoutComments(readFileSync(resolve(dir, purge!), "utf8"));
    expect(source).toContain('getFieldByName("code_attempted")');
    expect(source).toMatch(/removeField\(\s*field\.id\s*\)/);
    // Blank before drop, so the data is gone even if a drop ever no-ops again.
    expect(source).toMatch(/UPDATE auth_events SET code_attempted = ''/);
    // And rolling back must never recreate the credential sink.
    expect(source).toMatch(/\(_db\)\s*=>\s*\{\s*\}/);
  });
});
