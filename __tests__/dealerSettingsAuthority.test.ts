/**
 * Which dealer settings a manager may change, and what the system
 * administrator's dealer list returns. Runs the real PATCH and list routes and
 * the real helpers against fakes of the PocketBase runtime.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type AnyRecord = Record<string, unknown>;
type RouteResult = { status: number; payload: AnyRecord };

const loadCommonJs = <T>(relativePath: string): T => {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

const realHelpers = loadCommonJs<{
  dealerMutationData: (
    body: AnyRecord,
    allowCode: boolean,
    allowAdmin: boolean,
  ) => AnyRecord;
  serializeDealer: (record: unknown) => AnyRecord;
}>("pb_hooks/helpers.js");
const hookSource = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");

const patchDealer = (role: string, body: AnyRecord, sessionDealerId = "dealer-1") => {
  const from = hookSource.indexOf('routerAdd("PATCH", "/api/app/dealers/:id"');
  const to = hookSource.indexOf("routerAdd(", from + 20);
  expect(from).toBeGreaterThan(-1);
  const loaded: AnyRecord[] = [];
  let handler: ((c: unknown) => RouteResult) | undefined;
  runInNewContext(hookSource.slice(from, to), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: () => ({
      dealerFromSession: () => ({ id: sessionDealerId }),
      sessionRoleFromCookie: () => role,
      restrictDealerLogoSchema: vi.fn(),
      dealerMutationData: realHelpers.dealerMutationData,
      dealerLogoFile: () => null,
      clientIP: () => "203.0.113.5",
      userAgent: () => "vitest",
      runAuditedTransaction: (
        _event: string,
        _options: unknown,
        fn: (dao: unknown) => void,
      ) => fn({}),
      safeDealerMutationError: (err: unknown) => String(err),
    }),
    $apis: { requestInfo: () => ({ data: body }) },
    $app: {
      dao: () => ({
        findRecordById: () => ({
          id: "dealer-1",
          getBool: () => false,
          collection: () => ({}),
        }),
      }),
    },
    RecordUpsertForm: function RecordUpsertForm() {
      return {
        setFullManageAccess: vi.fn(),
        setDao: vi.fn(),
        addFiles: vi.fn(),
        loadData: (data: AnyRecord) => loaded.push({ ...data }),
        submit: vi.fn(),
      };
    },
    console: { error: vi.fn(), log: vi.fn() },
  });
  const result = handler!({
    pathParam: () => "dealer-1",
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
  return { result, loaded };
};

describe("PATCH /api/app/dealers/:id — who may change what", () => {
  const body = {
    name: "Northline Motors",
    requires_approval: "true",
    creative_system_v2: "true",
  };

  it("ignores the creative-system rollout flag from a manager and saves the rest", () => {
    const { result, loaded } = patchDealer("dealer_admin", body);
    expect(result.status).toBe(200);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      name: "Northline Motors",
      requires_approval: true,
    });
    expect(loaded[0]).not.toHaveProperty("creative_system_v2");
  });

  it("lets the system administrator switch the creative system for a store", () => {
    const { result, loaded } = patchDealer("super_admin", body);
    expect(result.status).toBe(200);
    expect(loaded[0]).toMatchObject({
      creative_system_v2: true,
      requires_approval: true,
    });
  });

  it("still refuses a salesperson and a manager of another store", () => {
    expect(patchDealer("salesperson", body).result.status).toBe(403);
    expect(patchDealer("dealer_admin", body, "dealer-2").result.status).toBe(403);
  });
});

/** Runs the real dealer-list route against one saved dealer record. */
const listDealers = (role: string, saved: { text: AnyRecord; flags: AnyRecord }) => {
  const from = hookSource.indexOf('routerAdd("GET", "/api/app/dealers"');
  const to = hookSource.indexOf("routerAdd(", from + 20);
  expect(from).toBeGreaterThan(-1);
  const record = {
    id: "dealer-1",
    getString: (field: string) => String(saved.text[field] ?? ""),
    getBool: (field: string) => saved.flags[field] === true,
    get: (field: string) => saved.text[field] ?? saved.flags[field],
  };
  let handler: ((c: unknown) => RouteResult) | undefined;
  runInNewContext(hookSource.slice(from, to), {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: () => ({
      dealerFromSession: () => ({ id: "system" }),
      sessionRoleFromCookie: () => role,
      serializeDealer: realHelpers.serializeDealer,
    }),
    $app: { dao: () => ({ findRecordsByFilter: () => [record] }) },
    console: { error: vi.fn(), log: vi.fn() },
  });
  return handler!({
    queryParam: () => "",
    json: (status: number, payload: AnyRecord) => ({ status, payload }),
  });
};

describe("GET /api/app/dealers — what the system administrator sees", () => {
  const saved = {
    text: {
      name: "Northline Motors",
      code: "4821",
      admin_code: "9137",
      logo: "logo_abc.png",
      signature_look: "hometown",
      approval_policy: '{"mode":"first_n","firstN":3}',
      employee_disclosure_text: "Posted by a Northline team member.",
    },
    flags: {
      requires_approval: true,
      creative_system_v2: true,
      employee_disclosure_disabled: false,
    },
  };

  it("reports each store's creative-system switch, look, approval rule and disclosure", () => {
    const result = listDealers("super_admin", saved);
    expect(result.status).toBe(200);
    const items = result.payload.items as AnyRecord[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "dealer-1",
      name: "Northline Motors",
      logo: "/api/files/dealers/dealer-1/logo_abc.png",
      requires_approval: true,
      signature_look: "hometown",
      approval_policy: { mode: "first_n", firstN: 3 },
      employee_disclosure_disabled: false,
      employee_disclosure_text: "Posted by a Northline team member.",
      creative_system_v2: true,
    });
  });

  it("never lists a store's legacy access codes", () => {
    const result = listDealers("super_admin", saved);
    const items = result.payload.items as AnyRecord[];
    expect(items[0]).not.toHaveProperty("code");
    expect(items[0]).not.toHaveProperty("admin_code");
    const serialized = JSON.stringify(result.payload);
    expect(serialized).not.toContain("4821");
    expect(serialized).not.toContain("9137");
  });

  it("is still the system administrator's alone", () => {
    expect(listDealers("dealer_admin", saved).status).toBe(403);
    expect(listDealers("salesperson", saved).status).toBe(403);
  });

  /** Every column the hand-written list item used to read, filled in. */
  const fullRecord = {
    text: {
      name: "Northline Motors",
      logo: "logo_abc.png",
      brand_voice: "Friendly and local.",
      banned_phrases: "cheap",
      oem_affiliation: "Ford",
      brand_color: "#1e40af",
      website: "https://northline.example",
      phone: "555-0100",
      address: "1 Main St",
      hours: "9-7",
      tagline: "Home of the deal",
      facebook_url: "https://facebook.com/northline",
      facebook_page_tag: "NorthlineMotors",
      instagram_handle: "northline",
      tiktok_handle: "northline.tt",
      x_handle: "northline_x",
      linkedin_company_tag: "Northline Motors",
      gbp_url: "https://g.page/northline",
      default_hashtags: "#northline",
      default_footer: "Visit us today.",
      enabled_styles: "clean,bold",
      default_style: "clean",
      enabled_fun_styles: "retro",
      custom_scenarios: '[{"id":"open_house"}]',
      signature_look: "hometown",
      setup_notes: "Waiting on the Facebook Page invite.",
    },
    flags: { requires_approval: true, creative_system_v2: true },
  };

  /** The item the route built before it used serializeDealer (B4). */
  const legacyListItem = (id: string, text: AnyRecord, flags: AnyRecord) => {
    const s = (field: string) => String(text[field] ?? "");
    return {
      id,
      name: s("name"),
      logo: s("logo") ? `/api/files/dealers/${id}/${s("logo")}` : "",
      brand_voice: s("brand_voice"),
      banned_phrases: s("banned_phrases"),
      oem_affiliation: s("oem_affiliation"),
      requires_approval: flags.requires_approval === true,
      brand_color: s("brand_color"),
      website: s("website"),
      phone: s("phone"),
      address: s("address"),
      hours: s("hours"),
      tagline: s("tagline"),
      facebook_url: s("facebook_url"),
      facebook_page_tag: s("facebook_page_tag"),
      instagram_handle: s("instagram_handle"),
      tiktok_handle: s("tiktok_handle"),
      x_handle: s("x_handle"),
      linkedin_company_tag: s("linkedin_company_tag"),
      gbp_url: s("gbp_url"),
      default_hashtags: s("default_hashtags"),
      default_footer: s("default_footer"),
      enabled_styles: s("enabled_styles"),
      default_style: s("default_style"),
      enabled_fun_styles: s("enabled_fun_styles"),
      custom_scenarios: s("custom_scenarios"),
    };
  };

  it("returns every field the session serializer returns, plus the setup notes", () => {
    const result = listDealers("super_admin", fullRecord);
    const item = (result.payload.items as AnyRecord[])[0];
    const serialized = realHelpers.serializeDealer({
      id: "dealer-1",
      getString: (field: string) => String((fullRecord.text as AnyRecord)[field] ?? ""),
      getBool: (field: string) => (fullRecord.flags as AnyRecord)[field] === true,
      get: () => undefined,
    });
    expect(Object.keys(item).sort()).toEqual(
      [...Object.keys(serialized), "setup_notes"].sort(),
    );
    expect(item).toEqual({
      ...serialized,
      setup_notes: "Waiting on the Facebook Page invite.",
    });
  });

  it("gives an uploaded logo the file route even when its name starts with http", () => {
    const named = {
      text: { ...fullRecord.text, logo: "https-logo_x1.png" },
      flags: {},
    };
    const item = (listDealers("super_admin", named).payload.items as AnyRecord[])[0];
    expect(item.logo).toBe("/api/files/dealers/dealer-1/https-logo_x1.png");

    const absolute = {
      text: { ...fullRecord.text, logo: "https://cdn.example/logo.png" },
      flags: {},
    };
    const kept = (listDealers("super_admin", absolute).payload.items as AnyRecord[])[0];
    expect(kept.logo).toBe("https://cdn.example/logo.png");
  });

  it("keeps every value the list returned before, logo path included", () => {
    const withLogo = listDealers("super_admin", fullRecord);
    expect((withLogo.payload.items as AnyRecord[])[0]).toMatchObject(
      legacyListItem("dealer-1", fullRecord.text, fullRecord.flags),
    );

    const noLogo = { text: { ...fullRecord.text, logo: "" }, flags: {} };
    const bare = (listDealers("super_admin", noLogo).payload.items as AnyRecord[])[0];
    expect(bare).toMatchObject(legacyListItem("dealer-1", noLogo.text, noLogo.flags));
    expect(bare.logo).toBe("");
    expect(bare.requires_approval).toBe(false);
  });
});
