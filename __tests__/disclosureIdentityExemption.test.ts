/**
 * Canonical disclosure text never reaches the customer-name guard.
 *
 * Production regression (PR #35, 30327d9): the server's own canonical
 * disclosure block — "— Disclosures —\n" plus each triggered rule's fixed legal
 * text — was read by the customer-name guard as naming a customer ("Taxes",
 * "Lessee", "Disclosures" look like names). Any customer post whose caption
 * triggered a disclosure was refused at save (400 CUSTOMER_IDENTITY_CONFLICT),
 * locked at share and approval, and quarantined in History and on reopen.
 *
 * The rule, identical on both sides: before a value reaches the guard, take out
 * the canonical disclosure material by exact string match — only where it is
 * bounded by whitespace (a line break for the header) or the ends of the value
 * — put a line break in its place, and review what remains. Server:
 * policies.reviewCustomerIdentityExcludingDisclosures in
 * pb_hooks/requestPolicies.js, called by all five routes. Client:
 * stripCanonicalDisclosures in utils/complianceDisclosures.ts.
 *
 * The first version replaced the material with nothing, so legal copy became a
 * separator the guard could not see: "Big day" + <APR text> + "Jessica…"
 * reached the guard as "Big dayJessica…", and a spaced copy lost the sentence
 * break before the name. The separator probes below pin that on every route
 * and on the client.
 *
 * These tests run the real routes against fakes of the PocketBase runtime,
 * with the real policy, helper and identity-review modules doing the deciding.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeCaptionSetForDelivery,
  canonicalDisclosureMaterial,
  stripCanonicalDisclosures,
} from "../utils/complianceDisclosures";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";
import { checkCaptionIdentity } from "../utils/postLocks";
import { savedPostIdentityIsSafe } from "../utils/historyPost";
import {
  logPost,
  projectPostRecordForUi,
  updatePostDraft,
  type PostRecord,
} from "../services/posts";

type AnyRecord = Record<string, unknown>;

type IdentityReview = {
  publicLabel: string;
  projectedValues: string[];
  projectionApplied: boolean;
  reviewRequired: boolean;
  unexpectedIdentity: boolean;
};
type ReviewFn = (
  protectedName: string,
  values: string[],
  allowedPhrases: unknown[],
  rejectUnnamed: boolean,
) => IdentityReview;
type Policies = {
  canonicalPostComplianceSet(
    captions: string[],
    bannedPhrases?: string,
  ): { categories: string[]; required_disclosures: string };
  validatePostComplianceSet(
    captions: string[],
    disclosures: string,
    bannedPhrases?: string,
  ): { ok: boolean };
  canonicalDisclosureMaterial(): string[];
  stripCanonicalDisclosures(text: string): string;
  reviewCustomerIdentityExcludingDisclosures(
    review: ReviewFn,
    protectedName: string,
    values: string[],
    allowedPhrases: unknown[],
    rejectUnnamed: boolean,
  ): IdentityReview;
  geminiModelPolicySnapshot(): { version: string };
};
type Website = AnyRecord & {
  reviewPostCustomerIdentity: ReviewFn;
  groundedIdentityPhrase(phrase: string): { phrase: string; grounded: true };
  publicCustomerLabel(value: string): string;
};

const loadCommonJs = <T>(relativePath: string): T => {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

const realHelpers = loadCommonJs<AnyRecord>("pb_hooks/helpers.js");
const policies = loadCommonJs<Policies>("pb_hooks/requestPolicies.js");
const website = loadCommonJs<Website>("pb_hooks/websitePublications.js");
const hookSource = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
const currentPolicyVersion = policies.geminiModelPolicySnapshot().version;

const routeSource = (start: string, end: string): string => {
  const from = hookSource.indexOf(start);
  expect(from, `route ${start} exists`).toBeGreaterThan(-1);
  const to = hookSource.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return hookSource.slice(from, to);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEALER = "Bob Maxey Ford of Howell";
const OEM = "Ford";
const SALESPERSON = "Joe Gallant";
const CUSTOMER = "Michelle Johnson";

// One caption per rule, in canonical order; each triggers only its own rule.
const TRIGGERS = [
  ["financing_apr", "Finance it at 1.9% APR."],
  ["zero_down", "Drive home with $0 down."],
  ["lease", "Lease yours for $299/mo."],
  ["rebate_pricing", "Take $3,000 off MSRP."],
  ["trade_value", "Ask about your trade-in value."],
] as const;

/** Every non-empty combination of the five rules (31 of them). */
const COMBINATIONS: Array<{ label: string; captions: string[] }> = [];
for (let mask = 1; mask < 1 << TRIGGERS.length; mask++) {
  const picked = TRIGGERS.filter((_trigger, index) => mask & (1 << index));
  COMBINATIONS.push({
    label: picked.map(([category]) => category).join("+"),
    captions: picked.map(([, caption]) => caption),
  });
}

const serverDisclosures = (captions: string[]): string =>
  policies.canonicalPostComplianceSet(captions, "").required_disclosures;

/** The allowed phrases every route builds for a post with no website draft. */
const routeAllowedPhrases = (): unknown[] => [
  website.groundedIdentityPhrase(DEALER),
  website.groundedIdentityPhrase(OEM),
  SALESPERSON,
  website.publicCustomerLabel(SALESPERSON),
  website.groundedIdentityPhrase(""),
];

const review = (
  protectedName: string,
  values: string[],
  rejectUnnamed: boolean,
  allowedPhrases: unknown[] = routeAllowedPhrases(),
): IdentityReview =>
  policies.reviewCustomerIdentityExcludingDisclosures(
    website.reviewPostCustomerIdentity,
    protectedName,
    values,
    allowedPhrases,
    rejectUnnamed,
  );

/** A canonical block with a name planted between two real disclosures. */
const plantedBlock = (planted: string): string => {
  const block = serverDisclosures(TRIGGERS.map(([, caption]) => caption));
  const material = canonicalDisclosureMaterial();
  return block.replace(material[3], `${material[3]} ${planted}`);
};

const MATERIAL = canonicalDisclosureMaterial();

/**
 * The adversarial review's probes: canonical legal copy used as a separator
 * between ordinary text and a customer name. None triggers a disclosure rule,
 * so compliance passes with empty disclosures. The guard refused every one of
 * them before the exemption existed, and must still.
 */
const SEPARATOR_PROBES: Array<[string, string]> = [
  ["glued", `Big day${MATERIAL[1]}Jessica is loving her new Ford!`],
  [
    "spaced",
    `Nothing beats a delivery like this ${MATERIAL[1]} Jessica is officially a Bronco owner!`,
  ],
  ["glued on the left", `Big day${MATERIAL[1]} Jessica is loving her new Ford!`],
  ["glued on the right", `Big day ${MATERIAL[1]}Jessica is loving her new Ford!`],
];

/** The protected surname beside legal copy: it must still be redacted. */
const SURNAME_PROBES: Array<[string, string]> = [
  ["glued", `What a day${MATERIAL[5]}Johnson family, enjoy the new Bronco!`],
  ["spaced", `What a day ${MATERIAL[5]} Johnson family, enjoy the new Bronco!`],
];

/**
 * The header used as a separator in website copy, which may contain it. The
 * header does not end a sentence, so mid-line a reader reads straight through
 * it: "Welcome to the — Disclosures — Ford Family Jessica!" names Jessica, and
 * the guard only sees that while the header stays in.
 */
const HEADER_PROBES: Array<[string, string]> = [
  ["glued", `Congratulations${MATERIAL[0]}Jessica Smith`],
  ["spaced", `Congratulations ${MATERIAL[0]} Jessica Smith`],
  ["mid-line", `Welcome to the ${MATERIAL[0]} Ford Family Jessica!`],
];

/** Named customer, and a customer-required post with no approved name. */
const IDENTITY_MODES: Array<[string, string, boolean]> = [
  ["named", CUSTOMER, false],
  ["reject-any", "", true],
];

// ---------------------------------------------------------------------------
// The shared rule, at the review the routes call
// ---------------------------------------------------------------------------

describe("server review with canonical disclosures excluded", () => {
  // The exact probe from the production report, pinned as regression rows.
  it.each(TRIGGERS.map(([category, caption]) => [category, caption]))(
    "clears the reported probe for %s",
    (_category, caption) => {
      const disclosures = policies.canonicalPostComplianceSet(
        [caption],
        "",
      ).required_disclosures;
      const probe = policies.reviewCustomerIdentityExcludingDisclosures(
        website.reviewPostCustomerIdentity,
        CUSTOMER,
        [disclosures],
        [website.groundedIdentityPhrase(DEALER), website.groundedIdentityPhrase(OEM)],
        false,
      );
      expect(probe.unexpectedIdentity).toBe(false);
      expect(probe.reviewRequired).toBe(false);
      expect(probe.projectedValues).toEqual([disclosures]);
    },
  );

  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "never flags the canonical block for %s, named or reject-any",
    (_label, captions) => {
      const disclosures = serverDisclosures(captions as string[]);
      expect(disclosures.startsWith("— Disclosures —\n")).toBe(true);
      // Named customer, and a customer-required post with no approved name.
      for (const [name, rejectAny] of [
        [CUSTOMER, false],
        ["Michelle", false],
        ["", true],
      ] as const) {
        const result = review(name, [disclosures], rejectAny);
        expect(result.unexpectedIdentity, `${name || "reject-any"}`).toBe(false);
        expect(result.reviewRequired, `${name || "reject-any"}`).toBe(false);
        expect(result.projectedValues).toEqual([disclosures]);
      }
    },
  );

  it("keeps the canonical block byte-for-byte when a surname is also a legal word", () => {
    // "Stock" is in the rebate disclosure ("specific stock units"). The
    // redaction used to rewrite it to "the customer", so the stored block no
    // longer matched the canonical text and the save failed compliance.
    const disclosures = serverDisclosures(["Take $3,000 off MSRP."]);
    const result = review("Jennifer Stock", [disclosures], false);
    expect(result.projectedValues).toEqual([disclosures]);
    expect(result.reviewRequired).toBe(false);
  });

  it.each([
    ["a space", " "],
    ["a line break", "\n"],
    ["a tab", "\t"],
  ])(
    "redacts a protected full name whose surname opens a legal rule (seam via %s)",
    (_label, gap) => {
      // Customer "Anna Lease": stripping the lease rule ("Lease offer with…")
      // would remove the surname before the redaction runs, and "Anna Lease"
      // would publish unredacted. A seam that forms the protected name keeps
      // the value out of the exemption, so it is reviewed as written.
      const leaseRule = canonicalDisclosureMaterial().find((m) =>
        m.startsWith("Lease "),
      )!;
      expect(leaseRule).toBeTruthy();
      const value = `Congrats Anna${gap}${leaseRule}`;
      const result = review("Anna Lease", [value], false);
      expect(result.reviewRequired).toBe(true);
      expect(result.projectedValues[0]).not.toMatch(/\bAnna\s+Lease\b/);
    },
  );

  it("keeps the exemption when the full name already sits in the free text", () => {
    // The name is redacted either way; the seam check must not fall back to
    // reviewing the legal words (the original production bug).
    const disclosures = serverDisclosures(["Lease yours for $299/mo."]);
    const result = review(
      CUSTOMER,
      ["Congrats Michelle Johnson! Lease yours for $299/mo.", disclosures],
      false,
    );
    expect(result.unexpectedIdentity).toBe(false);
    expect(result.projectedValues[1]).toBe(disclosures);
  });

  it("still redacts the protected name around canonical material and keeps the legal copy", () => {
    const material = canonicalDisclosureMaterial();
    const value = `Congrats Michelle Johnson! ${material[3]}`;
    const result = review(CUSTOMER, [value], false);
    expect(result.unexpectedIdentity).toBe(false);
    expect(result.projectionApplied).toBe(true);
    expect(result.reviewRequired).toBe(true);
    expect(result.projectedValues).toEqual([`Congrats Michelle! ${material[3]}`]);
  });

  it.each([
    "Congrats Jessica!",
    "Thanks to Jessica Smith for the review.",
    "Congratulations Sarah Williams!",
  ])("still flags a name planted inside a real disclosure block: %s", (planted) => {
    const block = plantedBlock(planted);
    expect(review(CUSTOMER, [block], false).unexpectedIdentity).toBe(true);
    expect(review("", [block], true).unexpectedIdentity).toBe(true);
    // Before the header, and fused against the legal copy with no spaces.
    const material = canonicalDisclosureMaterial();
    expect(review(CUSTOMER, [`${planted}\n\n${block}`], false).unexpectedIdentity).toBe(
      true,
    );
    expect(
      review(CUSTOMER, [`${material[0]}\n${planted}${material[1]}`], false)
        .unexpectedIdentity,
    ).toBe(true);
  });

  it("still flags edited legal copy that carries a name", () => {
    const block = serverDisclosures(["Finance it at 1.9% APR."]).replace(
      "Not all buyers will qualify.",
      "Not all buyers will qualify. Congrats Jessica!",
    );
    // An edited paragraph is not canonical, so all of it is reviewed.
    expect(policies.stripCanonicalDisclosures(block)).toContain(
      "Advertised APR is for qualified buyers",
    );
    expect(review(CUSTOMER, [block], false).unexpectedIdentity).toBe(true);
  });

  it("still refuses a caption that itself names an unapproved customer", () => {
    const caption = "Congrats Jessica! Lease yours for $299/mo.";
    const result = review(CUSTOMER, [caption, serverDisclosures([caption])], false);
    expect(result.unexpectedIdentity).toBe(true);
    expect(review("", [caption], true).unexpectedIdentity).toBe(true);
  });

  it("is the review all five routes call, and none calls the guard directly", () => {
    expect(hookSource).not.toContain("websitePublications.reviewPostCustomerIdentity(");
    const call = "policies.reviewCustomerIdentityExcludingDisclosures(";
    const routes: string[] = [];
    for (
      let at = hookSource.indexOf(call);
      at !== -1;
      at = hookSource.indexOf(call, at + 1)
    ) {
      // The guard itself is always the function handed in.
      expect(
        hookSource
          .slice(at + call.length)
          .trimStart()
          .startsWith("websitePublications.reviewPostCustomerIdentity,"),
      ).toBe(true);
      const routeStart = hookSource.lastIndexOf("routerAdd(", at);
      routes.push(
        hookSource.slice(routeStart, hookSource.indexOf(", (c)", routeStart)),
      );
    }
    expect(routes).toEqual([
      'routerAdd("POST", "/api/app/posts"',
      'routerAdd("PATCH", "/api/app/posts/:id/draft"',
      'routerAdd("POST", "/api/app/posts/:id/shared"',
      'routerAdd("GET", "/api/app/posts"',
      'routerAdd("PATCH", "/api/app/posts/:id"',
    ]);
  });
});

describe("canonical material is never a separator the guard cannot see", () => {
  const displayedVerdict = (name: string, value: string, rejectAny: boolean) =>
    website.reviewPostCustomerIdentity(name, [value], routeAllowedPhrases(), rejectAny)
      .unexpectedIdentity;

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name, rejectAny]) => [
        shape,
        mode,
        caption,
        name,
        rejectAny,
      ]),
    ),
  )(
    "refuses the %s probe (%s), as the guard did before the exemption",
    (_shape, _mode, caption, name, rejectAny) => {
      // The guard on the text a reader sees.
      expect(
        displayedVerdict(name as string, caption as string, rejectAny as boolean),
      ).toBe(true);
      const result = review(name as string, [caption as string], rejectAny as boolean);
      expect(result.unexpectedIdentity).toBe(true);
      expect(result.reviewRequired).toBe(true);
      // The guard sees either the value exactly as written (glued legal copy is
      // kept) or a line break where the legal copy was — never the text on
      // either side fused together.
      const stripped = policies.stripCanonicalDisclosures(caption as string);
      expect(stripped === caption || /\n\s*Jessica/.test(stripped)).toBe(true);
    },
  );

  it.each(SURNAME_PROBES)(
    "still redacts the protected surname in the %s probe and keeps the legal copy",
    (_shape, caption) => {
      const result = review(CUSTOMER, [caption], false);
      expect(result.projectionApplied).toBe(true);
      expect(result.reviewRequired).toBe(true);
      expect(result.projectedValues[0]).not.toContain("Johnson");
      expect(result.projectedValues[0]).toContain(MATERIAL[5]);
    },
  );

  it.each(
    HEADER_PROBES.flatMap(([shape, value]) =>
      IDENTITY_MODES.map(([mode, name, rejectAny]) => [
        shape,
        mode,
        value,
        name,
        rejectAny,
      ]),
    ),
  )(
    "refuses the header used as a %s separator in website copy (%s)",
    (_shape, _mode, value, name, rejectAny) => {
      expect(
        displayedVerdict(name as string, value as string, rejectAny as boolean),
      ).toBe(true);
      expect(
        review(name as string, [value as string], rejectAny as boolean)
          .unexpectedIdentity,
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Route harnesses
// ---------------------------------------------------------------------------

type RouteResult = { status: number; payload: AnyRecord };

const fakeRecord = (id: string, values: AnyRecord) => {
  const record = {
    id,
    values,
    getString: (field: string) => (values[field] ?? "").toString(),
    getBool: (field: string) => Boolean(values[field]),
    get: (field: string) => values[field],
    set: (field: string, value: unknown) => {
      values[field] = value;
    },
  };
  return record;
};

const dealer = (overrides: AnyRecord = {}) =>
  fakeRecord("dealer-1", { name: DEALER, oem_affiliation: OEM, ...overrides });
const salesperson = fakeRecord("person-1", { name: SALESPERSON });
const manager = fakeRecord("manager-1", { name: "Dana Manager" });

const storedPost = (overrides: AnyRecord = {}): AnyRecord => {
  const caption = "Congrats Michelle! Lease yours for $299/mo.";
  return {
    dealer: "dealer-1",
    owner_session_hash: "hash:token-author",
    owner_person_id: "person-1",
    attribution_authoritative: true,
    salesperson_name: SALESPERSON,
    approval_status: "n_a",
    scenario_id: "customer_delivery",
    release_required: true,
    has_release: true,
    release_status: "saved",
    customer_name: CUSTOMER,
    caption,
    disclosures: serverDisclosures([caption]),
    platform_ids: JSON.stringify(["facebook_feed", "instagram_feed"]),
    platform_captions: JSON.stringify({ facebook_feed: caption }),
    creative_image: "creative.jpg",
    model_policy_version: currentPolicyVersion,
    website_draft: "",
    generated_at: "2026-09-22 10:00:00.000Z",
    updated: "2026-09-22 10:00:00.000Z",
    ...overrides,
  };
};

const routeContext = (
  source: string,
  globals: AnyRecord,
  websiteOverrides: AnyRecord = {},
) => {
  let handler: ((c: unknown) => RouteResult) | undefined;
  const moduleFor = (path: string) => {
    if (path.endsWith("/helpers.js")) return globals.helpers;
    if (path.endsWith("/requestPolicies.js")) return policies;
    if (path.endsWith("/websitePublications.js")) {
      return { ...website, ...websiteOverrides };
    }
    throw new Error("unexpected require " + path);
  };
  runInNewContext(source, {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: moduleFor,
    console: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
    ...globals,
  });
  expect(handler).toBeTypeOf("function");
  return handler!;
};

const routeRequest = (extra: AnyRecord = {}) => ({
  pathParam: () => "post-1",
  formFile: () => null,
  response: () => ({ header: () => ({ set: vi.fn() }) }),
  json: (status: number, payload: AnyRecord) => ({ status, payload }),
  ...extra,
});

const sessionHelpers = (context: AnyRecord) => ({
  ...realHelpers,
  sessionContext: () => context,
  readSessionToken: () => "token-author",
  hashSessionToken: (value: string) => "hash:" + value,
  checkProxyRateLimit: () => ({ ok: true }),
});

const salespersonContext = (dealerRecord = dealer()) => ({
  dealer: dealerRecord,
  person: salesperson,
  session: { id: "session-1" },
  role: "salesperson",
});

// POST /api/app/posts ------------------------------------------------------

const runSave = (body: AnyRecord) => {
  const source = routeSource(
    'routerAdd("POST", "/api/app/posts",',
    'routerAdd("PATCH", "/api/app/posts/:id/draft"',
  );
  const stored: AnyRecord[] = [];
  const handler = routeContext(source, {
    helpers: sessionHelpers(salespersonContext()),
    $app: {
      dao: () => ({
        findCollectionByNameOrId: () => ({ name: "posts" }),
        findRecordsByFilter: () => [],
        deleteRecord: vi.fn(),
      }),
    },
    $apis: { requestInfo: () => ({ data: body }) },
    $filesystem: {},
    Record: function Record() {
      return fakeRecord("", {});
    },
    RecordUpsertForm: function RecordUpsertForm(
      _app: unknown,
      record: ReturnType<typeof fakeRecord>,
    ) {
      return {
        setFullManageAccess: vi.fn(),
        loadData: (data: AnyRecord) => Object.assign(record.values, data),
        addFiles: vi.fn(),
        submit: () => {
          record.id = "post-new";
          record.values.updated = "2026-09-22 10:00:00.000Z";
          stored.push({ ...record.values });
        },
      };
    },
  });
  const result = handler(routeRequest());
  return { result, stored };
};

const saveBody = (overrides: AnyRecord = {}): AnyRecord => {
  const caption =
    (overrides.caption as string) ?? "Congrats Michelle! Lease yours for $299/mo.";
  const platformCaptions = (overrides.platformCaptions as Record<string, string>) ?? {
    facebook_feed: caption,
  };
  const { platformCaptions: _omit, ...rest } = overrides;
  return {
    customer_name: CUSTOMER,
    scenario_id: "customer_delivery",
    caption,
    disclosures: serverDisclosures([caption, ...Object.values(platformCaptions)]),
    platform_ids: JSON.stringify(["facebook_feed", "instagram_feed"]),
    platform_captions: JSON.stringify(platformCaptions),
    ...rest,
  };
};

describe("POST /api/app/posts saves a customer post that carries disclosures", () => {
  it.each([["Michelle"], [CUSTOMER]])(
    "saves the reported lease caption for customer %s (was 400)",
    (customerName) => {
      const body = saveBody({ customer_name: customerName });
      const { result, stored } = runSave(body);
      expect(result.status).toBe(200);
      expect(result.payload.customer_name).toBe("Michelle");
      expect(result.payload.updated).toBe("2026-09-22 10:00:00.000Z");
      expect(stored).toHaveLength(1);
      expect(stored[0].caption).toBe("Congrats Michelle! Lease yours for $299/mo.");
      // The legal copy is stored exactly as the server wrote it.
      expect(stored[0].disclosures).toBe(body.disclosures);
      expect(
        policies.validatePostComplianceSet(
          [stored[0].caption as string],
          stored[0].disclosures as string,
        ).ok,
      ).toBe(true);
    },
  );

  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "saves every disclosure combination with a customer named: %s",
    (_label, captions) => {
      const caption = `Congrats Michelle! ${(captions as string[]).join(" ")}`;
      const { result, stored } = runSave(saveBody({ caption }));
      expect(result.status).toBe(200);
      expect(stored[0].disclosures).toBe(serverDisclosures([caption]));
    },
  );

  it("saves a customer-required post with no approved name when its copy is name-free", () => {
    const caption = "Another happy delivery! Lease yours for $299/mo.";
    const { result, stored } = runSave(saveBody({ customer_name: "", caption }));
    expect(result.status).toBe(200);
    expect(stored[0].release_required).toBe(true);
    expect(stored[0].disclosures).toBe(serverDisclosures([caption]));
  });

  it("still refuses a caption that names an unapproved customer", () => {
    const { result, stored } = runSave(
      saveBody({ caption: "Congrats Jessica! Lease yours for $299/mo." }),
    );
    expect(result.status).toBe(400);
    expect(result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
    expect(stored).toHaveLength(0);
  });

  it("still refuses a name planted inside the disclosure block", () => {
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const block = serverDisclosures([caption]);
    const material = canonicalDisclosureMaterial();
    const { result, stored } = runSave(
      saveBody({
        caption,
        disclosures: block.replace(material[3], `${material[3]} Congrats Jessica!`),
      }),
    );
    expect(result.status).toBe(400);
    expect(result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
    expect(stored).toHaveLength(0);
  });

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "refuses legal copy used as a %s separator before a name (%s)",
    (_shape, _mode, caption, name) => {
      const body = saveBody({ customer_name: name, caption });
      // No rule fires, so compliance alone would let it through.
      expect(body.disclosures).toBe("");
      const { result, stored } = runSave(body);
      expect(result.status).toBe(400);
      expect(result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
      expect(stored).toHaveLength(0);
    },
  );

  it.each(SURNAME_PROBES)(
    "redacts the protected surname beside %s legal copy and keeps the legal copy",
    (_shape, caption) => {
      const { result, stored } = runSave(saveBody({ caption }));
      expect(result.status).toBe(200);
      expect(stored).toHaveLength(1);
      // The release signer stays private on the record; the copy never has it.
      expect(stored[0].customer_name).toBe(CUSTOMER);
      expect(stored[0].caption).not.toContain("Johnson");
      expect(stored[0].platform_captions).not.toContain("Johnson");
      expect(stored[0].caption).toContain(MATERIAL[5]);
    },
  );

  it.each(
    HEADER_PROBES.flatMap(([shape, value]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, value, name]),
    ),
  )(
    "refuses the header used as a %s separator in the website title (%s)",
    (_shape, _mode, title, name) => {
      const { result, stored } = runSave(
        saveBody({
          customer_name: name,
          caption: "Another happy delivery!",
          website_draft: JSON.stringify({
            schemaVersion: 1,
            enabled: true,
            kind: "customer_story",
            category: "deliveries",
            title,
            body: "Another happy delivery at the dealership today.",
            altText: "A new Bronco in the showroom.",
            ...(name ? { customerDisplayName: "Michelle" } : {}),
          }),
        }),
      );
      expect(result.status).toBe(400);
      expect(result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
      expect(stored).toHaveLength(0);
    },
  );
});

// PATCH /api/app/posts/:id/draft -------------------------------------------

const runDraft = (
  body: AnyRecord,
  postOverrides: AnyRecord = {},
  options: { omitExpectedRevision?: boolean } = {},
) => {
  const source = routeSource(
    'routerAdd("PATCH", "/api/app/posts/:id/draft"',
    'routerAdd("POST", "/api/app/posts/:id/video-generated"',
  );
  const post = fakeRecord("post-1", storedPost(postOverrides));
  const saved: AnyRecord[] = [];
  const log = vi.fn();
  const txDao = {
    db: () => ({
      newQuery: () => ({
        bind: () => ({ execute: () => ({ rowsAffected: () => 1 }) }),
      }),
    }),
    findRecordById: () => post,
  };
  const handler = routeContext(
    source,
    {
      console: { error: vi.fn(), log, warn: vi.fn() },
      helpers: sessionHelpers(salespersonContext()),
      $app: {
        dao: () => ({
          findRecordById: () => post,
          runInTransaction: (fn: (dao: typeof txDao) => void) => fn(txDao),
        }),
      },
      $apis: {
        requestInfo: () => ({
          data: {
            ...(options.omitExpectedRevision
              ? {}
              : { expected_post_revision: post.getString("updated") }),
            ...body,
          },
        }),
      },
      $filesystem: {},
      RecordUpsertForm: function RecordUpsertForm() {
        let data: AnyRecord = {};
        return {
          setFullManageAccess: vi.fn(),
          setDao: vi.fn(),
          loadData: (value: AnyRecord) => {
            data = value;
          },
          addFiles: vi.fn(),
          submit: () => saved.push(data),
        };
      },
    },
    {
      findPublicationForPost: () => null,
      findPublicationForPostWithDaoStrict: () => null,
    },
  );
  return { result: handler(routeRequest()), saved, log };
};

describe("PATCH /api/app/posts/:id/draft", () => {
  it("rejects absent and stale revisions after the client rollout", () => {
    const valid = storedPost();
    const legacy = runDraft(
      {
        caption: valid.caption,
        disclosures: valid.disclosures,
      },
      {},
      { omitExpectedRevision: true },
    );
    expect(legacy.result).toMatchObject({
      status: 409,
      payload: { code: "POST_DRAFT_REVISION_REQUIRED" },
    });
    expect(legacy.saved).toHaveLength(0);

    const stale = runDraft({
      expected_post_revision: "2026-09-21 09:00:00.000Z",
      caption: valid.caption,
      disclosures: valid.disclosures,
    });
    expect(stale.result).toMatchObject({
      status: 409,
      payload: { code: "POST_DRAFT_REVISION_CONFLICT" },
    });
    expect(stale.saved).toHaveLength(0);
    expect(stale.log).not.toHaveBeenCalledWith(
      expect.stringContaining("[revision-legacy-client]"),
    );
  });

  it.each([
    ["blank", ""],
    ["non-string", { revision: "2026-09-20 10:00:00.000Z" }],
    ["oversized", "x".repeat(81)],
  ])(
    "rejects a %s supplied revision instead of treating it as legacy",
    (_label, revision) => {
      const valid = storedPost();
      const result = runDraft({
        expected_post_revision: revision,
        caption: valid.caption,
        disclosures: valid.disclosures,
      });
      expect(result.result).toMatchObject({
        status: 409,
        payload: { code: "POST_DRAFT_REVISION_REQUIRED" },
      });
      expect(result.saved).toHaveLength(0);
    },
  );

  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "saves an edited customer draft with disclosures: %s",
    (_label, captions) => {
      const caption = `Congrats Michelle! ${(captions as string[]).join(" ")}`;
      const disclosures = serverDisclosures([caption]);
      const { result, saved } = runDraft({
        caption,
        disclosures,
        platform_captions: JSON.stringify({ facebook_feed: caption }),
      });
      expect(result.status).toBe(200);
      expect(saved).toEqual([
        {
          caption,
          disclosures,
          platform_captions: JSON.stringify({ facebook_feed: caption }),
        },
      ]);
    },
  );

  it("still refuses a planted name and an unapproved caption name", () => {
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const planted = runDraft({
      caption,
      disclosures: plantedBlock("Congrats Jessica!"),
    });
    expect(planted.result.status).toBe(400);
    expect(planted.result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
    expect(planted.saved).toHaveLength(0);

    const named = runDraft({
      caption: "Congrats Jessica! Lease yours for $299/mo.",
      disclosures: serverDisclosures([caption]),
    });
    expect(named.result.status).toBe(400);
    expect(named.result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
    expect(named.saved).toHaveLength(0);
  });

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "refuses legal copy used as a %s separator before a name (%s)",
    (_shape, _mode, caption, name) => {
      const { result, saved } = runDraft(
        {
          caption,
          disclosures: "",
          platform_captions: JSON.stringify({ facebook_feed: caption }),
        },
        { customer_name: name },
      );
      expect(result.status).toBe(400);
      expect(result.payload.code).toBe("CUSTOMER_IDENTITY_CONFLICT");
      expect(saved).toHaveLength(0);
    },
  );

  it.each(SURNAME_PROBES)(
    "redacts the protected surname beside %s legal copy",
    (_shape, caption) => {
      const { result, saved } = runDraft({
        caption,
        disclosures: serverDisclosures([caption]),
        platform_captions: JSON.stringify({ facebook_feed: caption }),
      });
      expect(result.status).toBe(200);
      expect(saved).toHaveLength(1);
      expect(JSON.stringify(saved[0])).not.toContain("Johnson");
      expect(saved[0].caption).toContain(MATERIAL[5]);
    },
  );
});

// POST /api/app/posts/:id/shared -------------------------------------------

const runShare = (postOverrides: AnyRecord = {}) => {
  const source = routeSource(
    'routerAdd("POST", "/api/app/posts/:id/shared"',
    'routerAdd("GET", "/api/app/posts/:id/website-publication"',
  );
  const post = fakeRecord("post-1", storedPost(postOverrides));
  const events: ReturnType<typeof fakeRecord>[] = [];
  const txDao = {
    db: () => ({
      newQuery: () => ({
        bind: () => ({ execute: () => ({ rowsAffected: () => 1 }) }),
      }),
    }),
    findRecordById: () => post,
    findRecordsByFilter: () => [],
    findCollectionByNameOrId: (name: string) => ({ name }),
    saveRecord: (record: ReturnType<typeof fakeRecord>) => {
      record.values.created = "2026-09-23 10:00:00.000Z";
      events.push(record);
    },
    deleteRecord: vi.fn(),
  };
  const handler = routeContext(source, {
    helpers: sessionHelpers(salespersonContext()),
    $app: {
      dao: () => ({
        findRecordById: () => post,
        runInTransaction: (fn: (dao: typeof txDao) => void) => fn(txDao),
      }),
    },
    $apis: {
      requestInfo: () => ({
        data: {
          channel: "facebook_feed",
          via: "share_sheet",
          expected_post_revision: post.getString("updated"),
        },
      }),
    },
    Record: function Record() {
      return fakeRecord("", {});
    },
  });
  return { result: handler(routeRequest()), events };
};

describe("POST /api/app/posts/:id/shared", () => {
  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "records a share for a customer post with disclosures: %s",
    (_label, captions) => {
      const offers = (captions as string[]).join(" ");
      for (const [customerName, caption] of [
        [CUSTOMER, `Congrats Michelle! ${offers}`],
        // A customer-required post with no approved name.
        ["", `Another happy delivery! ${offers}`],
      ]) {
        const { result, events } = runShare({
          customer_name: customerName,
          caption,
          platform_captions: JSON.stringify({ facebook_feed: caption }),
          disclosures: serverDisclosures([caption]),
        });
        expect(result.status, JSON.stringify(result.payload)).toBe(200);
        expect(events).toHaveLength(1);
      }
    },
  );

  it("still holds a name planted beside canonical material and an unapproved caption name", () => {
    const material = canonicalDisclosureMaterial();
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    // Legal copy pasted into a destination caption with a name beside it.
    const variant = `${caption} ${material[3]} Congrats Jessica!`;
    const planted = runShare({
      platform_captions: JSON.stringify({ facebook_feed: variant }),
      disclosures: serverDisclosures([caption, variant]),
    });
    expect(planted.result.status).toBe(409);
    expect(planted.result.payload.code).toBe("IDENTITY_REVIEW_REQUIRED");
    expect(planted.events).toHaveLength(0);

    // A planted disclosure block is not canonical, so the claim lock (which
    // runs first) holds it.
    const block = runShare({ disclosures: plantedBlock("Congrats Jessica!") });
    expect(block.result.status).toBe(409);
    expect(block.events).toHaveLength(0);

    const named = "Congrats Jessica! Lease yours for $299/mo.";
    const wrongName = runShare({
      caption: named,
      platform_captions: JSON.stringify({ facebook_feed: named }),
      disclosures: serverDisclosures([named]),
    });
    expect(wrongName.result.status).toBe(409);
    expect(wrongName.result.payload.code).toBe("IDENTITY_REVIEW_REQUIRED");
    expect(wrongName.events).toHaveLength(0);
  });

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "holds legal copy used as a %s separator before a name (%s)",
    (_shape, _mode, caption, name) => {
      const { result, events } = runShare({
        customer_name: name,
        caption,
        platform_captions: JSON.stringify({ facebook_feed: caption }),
        disclosures: "",
      });
      expect(result.status).toBe(409);
      expect(result.payload.code).toBe("IDENTITY_REVIEW_REQUIRED");
      expect(events).toHaveLength(0);
    },
  );

  it("records a share when a website draft carries the canonical block, and still holds a name planted in it", () => {
    // Codex on #38: the share route reviewed the caption set with the
    // exemption but the website draft through publicWebsiteDraftForPost with
    // the raw guard, so a draft the save route accepted still returned 409.
    // A canonical block only fits a site_update body (900 chars; a
    // customer_story body is capped at 280), so that is the real shape.
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const block = serverDisclosures([caption]);
    const websiteDraft = (body: string) =>
      JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        kind: "site_update",
        category: "promotions",
        title: "Lease specials this month",
        body,
        altText: "A new Escape in the showroom.",
      });
    const base = {
      caption,
      platform_captions: JSON.stringify({ facebook_feed: caption }),
      disclosures: block,
    };
    const lead = "Lease a new Escape this month.";

    const clean = runShare({
      ...base,
      website_draft: websiteDraft(`${lead}\n\n${block}`),
    });
    expect(clean.result.status, JSON.stringify(clean.result.payload)).toBe(200);
    expect(clean.events).toHaveLength(1);

    const planted = runShare({
      ...base,
      website_draft: websiteDraft(`${lead}\n\n${block} Congrats Jessica!`),
    });
    expect(planted.result.status).toBe(409);
    expect(planted.events).toHaveLength(0);
  });

  it.each(SURNAME_PROBES)(
    "holds the protected surname beside %s legal copy",
    (_shape, caption) => {
      const { result, events } = runShare({
        caption,
        platform_captions: JSON.stringify({ facebook_feed: caption }),
        disclosures: serverDisclosures([caption]),
      });
      expect(result.status).toBe(409);
      expect(result.payload.code).toBe("IDENTITY_REVIEW_REQUIRED");
      expect(events).toHaveLength(0);
    },
  );
});

// GET /api/app/posts (History list projection) -----------------------------

const runList = (postOverrides: AnyRecord[]) => {
  const source = routeSource(
    'routerAdd("GET", "/api/app/posts",',
    'routerAdd("PATCH", "/api/app/posts/:id",',
  );
  const posts = postOverrides.map((overrides, index) =>
    fakeRecord(`post-${index + 1}`, storedPost(overrides)),
  );
  const handler = routeContext(
    source,
    {
      helpers: sessionHelpers(salespersonContext()),
      $apis: { requestInfo: () => ({ query: { limit: "50" } }) },
      $app: {
        dao: () => ({
          findRecordsByFilter: () => posts,
          db: () => ({
            newQuery: () => ({ bind: () => ({ all: () => undefined }) }),
          }),
        }),
      },
      arrayOf: () => [],
      DynamicModel: function DynamicModel(shape: AnyRecord) {
        return shape;
      },
    },
    { publicationSummariesForDealer: () => ({}) },
  );
  const result = handler(routeRequest());
  expect(result.status).toBe(200);
  return result.payload.items as AnyRecord[];
};

describe("GET /api/app/posts History projection and the client reopen", () => {
  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "lists and reopens a customer post with disclosures unquarantined: %s",
    (_label, captions) => {
      const caption = `Congrats Michelle! ${(captions as string[]).join(" ")}`;
      const anonymous = `Another happy delivery! ${(captions as string[]).join(" ")}`;
      const items = runList([
        {
          caption,
          disclosures: serverDisclosures([caption]),
          platform_captions: JSON.stringify({ facebook_feed: caption }),
        },
        {
          customer_name: "",
          caption: anonymous,
          disclosures: serverDisclosures([anonymous]),
          platform_captions: JSON.stringify({ facebook_feed: anonymous }),
        },
      ]);
      for (const [index, item] of items.entries()) {
        const expectedCaption = index === 0 ? caption : anonymous;
        expect(item.identity_review_required).toBeUndefined();
        expect(item.caption).toBe(expectedCaption);
        expect(item.disclosures).toBe(serverDisclosures([expectedCaption]));
        expect(item.platform_captions).toEqual({ facebook_feed: expectedCaption });

        // services/posts.ts reopen, on exactly what the server listed.
        const reopened = projectPostRecordForUi(item as unknown as PostRecord, {
          dealerName: DEALER,
          oemAffiliation: OEM,
          salespersonName: SALESPERSON,
        });
        expect(reopened.identity_review_required).toBeUndefined();
        expect(reopened.caption).toBe(expectedCaption);
        expect(reopened.disclosures).toBe(serverDisclosures([expectedCaption]));
        expect(
          savedPostIdentityIsSafe(reopened, {
            dealerName: DEALER,
            oemAffiliation: OEM,
          }),
        ).toBe(true);
      }
    },
  );

  it("still holds a planted disclosure name and an unapproved caption name", () => {
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const named = "Congrats Jessica! Lease yours for $299/mo.";
    const [planted, wrongName] = runList([
      { caption, disclosures: plantedBlock("Congrats Jessica!") },
      {
        caption: named,
        disclosures: serverDisclosures([named]),
        platform_captions: JSON.stringify({ facebook_feed: named }),
      },
    ]);
    expect(planted.identity_review_required).toBe(true);
    expect(planted.disclosures).toBe("Disclosure held for customer-name review.");
    expect(planted.caption).toBe(caption);
    expect(wrongName.identity_review_required).toBe(true);
    expect(wrongName.caption).toBe("Caption held for customer-name review.");
    expect(JSON.stringify([planted, wrongName])).not.toContain("Jessica");
  });

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "quarantines legal copy used as a %s separator before a name (%s)",
    (_shape, _mode, caption, name) => {
      const [item] = runList([
        {
          customer_name: name,
          caption,
          platform_captions: JSON.stringify({ facebook_feed: caption }),
          disclosures: "",
        },
      ]);
      expect(item.identity_review_required).toBe(true);
      expect(item.caption).toBe("Caption held for customer-name review.");
      expect(item.platform_captions).toEqual({});
      expect(JSON.stringify(item)).not.toContain("Jessica");
    },
  );

  it.each(SURNAME_PROBES)(
    "redacts the protected surname beside %s legal copy and flags the post",
    (_shape, caption) => {
      const [item] = runList([
        {
          caption,
          platform_captions: JSON.stringify({ facebook_feed: caption }),
          disclosures: serverDisclosures([caption]),
        },
      ]);
      expect(item.identity_review_required).toBe(true);
      expect(JSON.stringify(item)).not.toContain("Johnson");
      expect(item.caption).toContain(MATERIAL[5]);
    },
  );

  it.each(
    HEADER_PROBES.flatMap(([shape, value]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, value, name]),
    ),
  )(
    "withholds a website title using the header as a %s separator (%s)",
    (_shape, _mode, title, name) => {
      const [item] = runList([
        {
          customer_name: name,
          caption: "Another happy delivery!",
          platform_captions: JSON.stringify({
            facebook_feed: "Another happy delivery!",
          }),
          disclosures: "",
          website_draft: JSON.stringify({
            schemaVersion: 1,
            enabled: true,
            kind: "customer_story",
            category: "deliveries",
            title,
            body: "Another happy delivery at the dealership today.",
            altText: "A new Bronco in the showroom.",
            ...(name ? { customerDisplayName: "Michelle" } : {}),
          }),
        },
      ]);
      expect(item.identity_review_required).toBe(true);
      expect(JSON.stringify(item)).not.toContain("Jessica");
    },
  );
});

// PATCH /api/app/posts/:id (approval) --------------------------------------

const runApproval = (postOverrides: AnyRecord = {}) => {
  const source = routeSource(
    'routerAdd("PATCH", "/api/app/posts/:id",',
    'routerAdd("GET", "/api/app/salespeople"',
  );
  const post = fakeRecord(
    "post-1",
    storedPost({ approval_status: "pending", ...postOverrides }),
  );
  const updates: AnyRecord[] = [];
  const handler = routeContext(
    source,
    {
      helpers: sessionHelpers({
        dealer: dealer(),
        person: manager,
        session: { id: "session-2" },
        role: "dealer_admin",
      }),
      $apis: { requestInfo: () => ({ data: { approval_status: "approved" } }) },
      $app: {
        dao: () => ({
          findRecordById: () => post,
          db: () => ({
            newQuery: () => ({
              bind: (params: AnyRecord) => ({
                execute: () => {
                  updates.push(params);
                  return { rowsAffected: () => 1 };
                },
              }),
            }),
          }),
        }),
      },
    },
    {
      hasValidLinkedRelease: () => true,
      reconcilePublicationForPost: () => undefined,
    },
  );
  return { result: handler(routeRequest()), updates };
};

describe("PATCH /api/app/posts/:id approval", () => {
  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "approves a customer post with disclosures: %s",
    (_label, captions) => {
      const caption = `Congrats Michelle! ${(captions as string[]).join(" ")}`;
      const { result, updates } = runApproval({
        caption,
        disclosures: serverDisclosures([caption]),
        platform_captions: JSON.stringify({ facebook_feed: caption }),
      });
      expect(result.status, JSON.stringify(result.payload)).toBe(200);
      expect(updates).toHaveLength(1);
      expect(updates[0].decision).toBe("approved");
    },
  );

  it("approves a name-free customer-required post with disclosures", () => {
    const caption = "Another happy delivery! Lease yours for $299/mo.";
    const { result } = runApproval({
      customer_name: "",
      caption,
      disclosures: serverDisclosures([caption]),
      platform_captions: JSON.stringify({ facebook_feed: caption }),
    });
    expect(result.status).toBe(200);
  });

  it("still holds a planted disclosure name and an unapproved caption name", () => {
    const planted = runApproval({ disclosures: plantedBlock("Congrats Jessica!") });
    expect(planted.result.status).toBe(409);
    expect(planted.result.payload.code).toBe("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
    expect(planted.updates).toHaveLength(0);

    const caption = "Congrats Jessica! Lease yours for $299/mo.";
    const named = runApproval({
      caption,
      disclosures: serverDisclosures([caption]),
      platform_captions: JSON.stringify({ facebook_feed: caption }),
    });
    expect(named.result.status).toBe(409);
    expect(named.result.payload.code).toBe("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
    expect(named.updates).toHaveLength(0);
  });

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "holds legal copy used as a %s separator before a name (%s)",
    (_shape, _mode, caption, name) => {
      const { result, updates } = runApproval({
        customer_name: name,
        caption,
        platform_captions: JSON.stringify({ facebook_feed: caption }),
        disclosures: "",
      });
      expect(result.status).toBe(409);
      expect(result.payload.code).toBe("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
      expect(updates).toHaveLength(0);
    },
  );

  it.each(SURNAME_PROBES)(
    "holds the protected surname beside %s legal copy",
    (_shape, caption) => {
      const { result, updates } = runApproval({
        caption,
        platform_captions: JSON.stringify({ facebook_feed: caption }),
        disclosures: serverDisclosures([caption]),
      });
      expect(result.status).toBe(409);
      expect(result.payload.code).toBe("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
      expect(updates).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const clientSafe = (text: string, customer: string | undefined) =>
  captionUsesOnlyExpectedCustomer(stripCanonicalDisclosures(text), customer, {
    allowedPhrases: [DEALER, OEM],
    maskedPhrases: [SALESPERSON, "Joe"],
    rejectAnyCustomerIdentity: !customer,
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("client: the same rule before the guard", () => {
  it.each(COMBINATIONS.map(({ label, captions }) => [label, captions]))(
    "the client block matches the server's and clears the guard: %s",
    (_label, captions) => {
      const client = analyzeCaptionSetForDelivery(captions as string[]).disclosures;
      expect(client).toBe(serverDisclosures(captions as string[]));
      expect(clientSafe(client, "Michelle")).toBe(true);
      expect(clientSafe(client, undefined)).toBe(true);
    },
  );

  it.each([
    "Congrats Jessica!",
    "Thanks to Jessica Smith for the review.",
    "Congratulations Sarah Williams!",
  ])("still flags a name planted inside a real disclosure block: %s", (planted) => {
    expect(clientSafe(plantedBlock(planted), "Michelle")).toBe(false);
    expect(clientSafe(plantedBlock(planted), undefined)).toBe(false);
  });

  it("posts a customer caption with disclosures instead of refusing it before save", async () => {
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const disclosures = analyzeCaptionSetForDelivery([caption]).disclosures;
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "post-client-1",
        dealer: "dealer-1",
        generated_at: "2026-09-23 10:00:00.000Z",
        customer_name: "Michelle",
        release_required: true,
        caption,
        disclosures,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved = await logPost({
      customerName: CUSTOMER,
      customerIdentityRequired: true,
      caption,
      disclosures,
      platformCaptions: { facebook_feed: caption },
      grounding: {
        dealerName: DEALER,
        oemAffiliation: OEM,
        salespersonName: SALESPERSON,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as FormData;
    expect(form.get("disclosures")).toBe(disclosures);
    expect(saved?.identity_review_required).toBeUndefined();
    expect(saved?.disclosures).toBe(disclosures);

    // The reopened draft saves again without a client-side refusal.
    const draftFetch = vi.fn(async () =>
      jsonResponse({ id: "post-client-1", updated: true, post_revision: "r2" }),
    );
    vi.stubGlobal("fetch", draftFetch);
    await expect(
      updatePostDraft("post-client-1", {
        caption,
        expectedPostRevision: "r1",
        disclosures,
        platformCaptions: { facebook_feed: caption },
        grounding: {
          dealerName: DEALER,
          oemAffiliation: OEM,
          salespersonName: SALESPERSON,
        },
      }),
    ).resolves.toMatchObject({ updated: true });
    expect(draftFetch).toHaveBeenCalledTimes(1);
  });

  it("still refuses before save when the caption or the block names someone else", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    await expect(
      logPost({
        customerName: CUSTOMER,
        caption,
        disclosures: plantedBlock("Congrats Jessica!"),
      }),
    ).rejects.toThrow("not authorized");
    await expect(
      logPost({
        customerName: CUSTOMER,
        caption: "Congrats Jessica! Lease yours for $299/mo.",
        disclosures: analyzeCaptionSetForDelivery([caption]).disclosures,
      }),
    ).rejects.toThrow("not authorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reopen quarantines a planted block but not the canonical one", () => {
    const caption = "Congrats Michelle! Lease yours for $299/mo.";
    const base: PostRecord = {
      id: "post-reopen",
      dealer: "dealer-1",
      generated_at: "2026-09-23 10:00:00.000Z",
      customer_name: "Michelle",
      release_required: true,
      caption,
    };
    const clean = projectPostRecordForUi({
      ...base,
      disclosures: analyzeCaptionSetForDelivery([caption]).disclosures,
    });
    expect(clean.identity_review_required).toBeUndefined();
    const planted = projectPostRecordForUi({
      ...base,
      disclosures: plantedBlock("Congrats Jessica!"),
    });
    expect(planted.identity_review_required).toBe(true);
    expect(planted.disclosures).toBe("Disclosure held for customer-name review.");
  });

  const CLIENT_GROUNDING = {
    dealerName: DEALER,
    oemAffiliation: OEM,
    salespersonName: SALESPERSON,
  };

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "refuses legal copy used as a %s separator before save (%s)",
    async (_shape, _mode, caption, name) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        logPost({
          customerName: (name as string) || undefined,
          customerIdentityRequired: true,
          caption: caption as string,
          disclosures: "",
          platformCaptions: { facebook_feed: caption as string },
          grounding: CLIENT_GROUNDING,
        }),
      ).rejects.toThrow("not authorized");
      // The same text arriving only as a destination caption.
      await expect(
        logPost({
          customerName: (name as string) || undefined,
          customerIdentityRequired: true,
          caption: "Another happy delivery!",
          platformCaptions: { facebook_feed: caption as string },
          grounding: CLIENT_GROUNDING,
        }),
      ).rejects.toThrow("not authorized");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(
    SEPARATOR_PROBES.flatMap(([shape, caption]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, caption, name]),
    ),
  )(
    "the share lock, reopen and History search hold the %s separator probe (%s)",
    (_shape, _mode, caption, name) => {
      const publicName = name ? "Michelle" : "";
      // The client guard on the text a reader sees refused it before the
      // exemption existed.
      expect(clientSafe(caption as string, publicName || undefined)).toBe(false);
      expect(
        captionUsesOnlyExpectedCustomer(caption as string, publicName || undefined, {
          allowedPhrases: [DEALER, OEM],
          maskedPhrases: [SALESPERSON, "Joe"],
          rejectAnyCustomerIdentity: !publicName,
        }),
      ).toBe(false);
      const context = {
        customerDisplayName: publicName,
        dealerName: DEALER,
        oemAffiliation: OEM,
        currentPersonName: SALESPERSON,
        customerIdentityRequired: true,
      };
      expect(checkCaptionIdentity(caption as string, context)).toBe(false);
      // What the share sheet actually sends: the caption plus a real footer.
      const footer = analyzeCaptionSetForDelivery([
        "Lease yours for $299/mo.",
      ]).disclosures;
      expect(checkCaptionIdentity(`${caption}\n\n${footer}`, context)).toBe(false);

      const record: PostRecord = {
        id: "post-separator",
        dealer: "dealer-1",
        generated_at: "2026-09-23 10:00:00.000Z",
        customer_name: publicName,
        release_required: true,
        caption: caption as string,
        disclosures: "",
        platform_captions: { facebook_feed: caption as string },
      };
      const reopened = projectPostRecordForUi(record, CLIENT_GROUNDING);
      expect(reopened.identity_review_required).toBe(true);
      expect(savedPostIdentityIsSafe(record, CLIENT_GROUNDING)).toBe(false);
    },
  );

  it.each(
    HEADER_PROBES.flatMap(([shape, value]) =>
      IDENTITY_MODES.map(([mode, name]) => [shape, mode, value, name]),
    ),
  )(
    "refuses the header used as a %s separator in website copy (%s)",
    async (_shape, _mode, title, name) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const websiteDraft = {
        schemaVersion: 1,
        enabled: true,
        kind: "customer_story",
        category: "deliveries",
        title: title as string,
        body: "Another happy delivery at the dealership today.",
        altText: "A new Bronco in the showroom.",
        ...(name ? { customerDisplayName: "Michelle" } : {}),
      } as unknown as NonNullable<PostRecord["website_draft"]>;
      await expect(
        logPost({
          customerName: (name as string) || undefined,
          customerIdentityRequired: true,
          caption: "Another happy delivery!",
          websiteDraft,
          grounding: CLIENT_GROUNDING,
        }),
      ).rejects.toThrow("not authorized");
      expect(fetchMock).not.toHaveBeenCalled();
      const record: PostRecord = {
        id: "post-website-separator",
        dealer: "dealer-1",
        generated_at: "2026-09-23 10:00:00.000Z",
        customer_name: name ? "Michelle" : "",
        release_required: true,
        caption: "Another happy delivery!",
        website_draft: websiteDraft,
      };
      expect(
        projectPostRecordForUi(record, CLIENT_GROUNDING).identity_review_required,
      ).toBe(true);
      expect(savedPostIdentityIsSafe(record, CLIENT_GROUNDING)).toBe(false);
    },
  );

  it("the result-screen lock treats canonical material the same way", () => {
    const material = canonicalDisclosureMaterial();
    const context = {
      customerDisplayName: "Michelle",
      dealerName: DEALER,
      oemAffiliation: OEM,
      currentPersonName: SALESPERSON,
      customerIdentityRequired: true,
    };
    expect(
      checkCaptionIdentity(
        `Congrats Michelle! Lease yours for $299/mo. ${material[3]}`,
        context,
      ),
    ).toBe(true);
    expect(
      checkCaptionIdentity(
        `Congrats Jessica! Lease yours for $299/mo. ${material[3]}`,
        context,
      ),
    ).toBe(false);
  });
});
