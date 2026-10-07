import { describe, expect, it } from "vitest";
import type { Dealer } from "../types";
import {
  describeApproval,
  describeApprovalShort,
  dealerSetupStatus,
  displayUrl,
  missingSummary,
  SETTINGS_SECTION_LABELS,
  settingsSectionStatus,
  type SettingsSectionId,
  type SetupRowId,
} from "./dealerSetupStatus";

/** A store with every counted area saved, in the admin list's field names. */
const complete: Dealer = {
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  logo: "/api/files/dealers/dealer-1/logo.png",
  brand_color: "#1d4ed8",
  website: "https://www.bobmaxeyford.com/",
  phone: "(517) 555-0100",
  address: "2798 E Grand River Ave, Howell, MI",
  facebook_url: "https://facebook.com/bobmaxeyfordhowell",
  facebook_page_tag: "bobmaxeyfordhowell",
  instagram_handle: "bobmaxeyford",
  gbp_url: "https://g.page/r/bob-maxey-ford",
  brand_voice: "Friendly, local and proud of Howell.",
  signature_look: "hometown",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  creative_system_v2: false,
};

const row = (dealer: Dealer, id: SetupRowId) => {
  const found = dealerSetupStatus(dealer).rows.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`row ${id} not found`);
  return found;
};

describe("dealerSetupStatus", () => {
  it("counts the six store areas and reports a complete store as ready", () => {
    const status = dealerSetupStatus(complete);
    expect(status.total).toBe(6);
    expect(status.ready).toBe(6);
    expect(status.summary).toBe("6 of 6 set up");
    expect(status.rows.filter((r) => r.counts).map((r) => r.id)).toEqual([
      "profile",
      "brand",
      "facebook",
      "instagram",
      "voice",
      "look",
    ]);
    expect(status.missing).toEqual([]);
    expect(status.rows.map((r) => r.id)).toEqual([
      "profile",
      "brand",
      "facebook",
      "instagram",
      "gbp",
      "tiktok",
      "x",
      "linkedin",
      "voice",
      "look",
      "approval",
      "disclosure",
      "creative_system",
    ]);
  });

  it("shows saved public values in plain words", () => {
    expect(row(complete, "profile").value).toEqual([
      "bobmaxeyford.com",
      "(517) 555-0100",
      "2798 E Grand River Ave, Howell, MI",
    ]);
    expect(row(complete, "brand").value).toEqual(["Logo uploaded", "#1D4ED8"]);
    expect(row(complete, "brand").swatch).toBe("#1d4ed8");
    expect(row(complete, "facebook").value).toEqual([
      "facebook.com/bobmaxeyfordhowell",
      "Tags @bobmaxeyfordhowell",
    ]);
    expect(row(complete, "instagram").value).toEqual(["@bobmaxeyford"]);
    expect(row(complete, "gbp").value).toEqual(["g.page/r/bob-maxey-ford"]);
    expect(row(complete, "voice").value).toEqual([
      "Friendly, local and proud of Howell.",
    ]);
    expect(row(complete, "look").value).toEqual(["Hometown"]);
    expect(row(complete, "look").guidance).toBeNull();
  });

  it("names exactly what is missing and where it is set", () => {
    const status = dealerSetupStatus({
      ...complete,
      phone: "  ",
      address: "",
      instagram_handle: "",
      signature_look: "",
    });
    expect(status.summary).toBe("3 of 6 set up");
    expect(missingSummary(status)).toBe("Store profile, Instagram and Signature look");
    const profile = row({ ...complete, phone: "", address: "" }, "profile");
    expect(profile.state).toBe("missing");
    expect(profile.value).toEqual(["bobmaxeyford.com"]);
    expect(profile.guidance).toBe(
      "Add the phone and address: open as the manager, then Settings > Store profile.",
    );
    expect(row({ ...complete, instagram_handle: "" }, "instagram").guidance).toBe(
      "Add the Instagram handle: open as the manager, then Settings > Channels.",
    );
    expect(
      row({ ...complete, facebook_url: "", facebook_page_tag: "" }, "facebook")
        .guidance,
    ).toBe(
      "Add the Facebook page URL and page tag: open as the manager, then Settings > Channels.",
    );
    expect(row({ ...complete, brand_voice: "" }, "voice").guidance).toBe(
      "Write the brand voice: open as the manager, then Settings > Voice.",
    );
    expect(row({ ...complete, signature_look: "" }, "look").guidance).toBe(
      "Choose a signature look: open as the manager, then Settings > Creative.",
    );
  });

  it("offers both ways to add the logo and sends the brand color to Creative", () => {
    expect(row({ ...complete, logo: undefined }, "brand").guidance).toBe(
      "Upload the logo with Edit on this card, or open as the manager, then Settings > Creative.",
    );
    expect(row({ ...complete, brand_color: "" }, "brand").guidance).toBe(
      "Set the brand color: open as the manager, then Settings > Creative.",
    );
    const neither = row({ ...complete, logo: "", brand_color: undefined }, "brand");
    expect(neither.guidance).toBe(
      "Upload the logo with Edit on this card, or open as the manager, then Settings > Creative to add the logo and brand color.",
    );
    expect(neither.swatch).toBeUndefined();
  });

  it("never counts TikTok, X or LinkedIn against the store", () => {
    const status = dealerSetupStatus(complete);
    for (const id of ["tiktok", "x", "linkedin"] as const) {
      const optional = row(complete, id);
      expect(optional.state).toBe("optional");
      expect(optional.counts).toBe(false);
      expect(optional.attention).toBe(false);
    }
    expect(status.missing).toEqual([]);
    const withTiktok = row({ ...complete, tiktok_handle: "@bobmaxey" }, "tiktok");
    expect(withTiktok.state).toBe("ready");
    expect(withTiktok.value).toEqual(["@bobmaxey"]);
    expect(dealerSetupStatus({ ...complete, tiktok_handle: "bobmaxey" }).total).toBe(6);
  });

  it("reports the team-member disclosure on unless the store opted out", () => {
    const on = row(complete, "disclosure");
    expect(on.state).toBe("on");
    expect(on.attention).toBe(false);
    expect(on.value).toEqual(["Standard wording"]);
    expect(
      row(
        { ...complete, employee_disclosure_text: "Posted by our team." },
        "disclosure",
      ).value,
    ).toEqual(["Custom wording"]);
    const off = row({ ...complete, employee_disclosure_disabled: true }, "disclosure");
    expect(off.state).toBe("off");
    expect(off.attention).toBe(true);
    expect(off.guidance).toBe(
      "To turn it back on, open as the manager, then Settings > Workflow.",
    );
  });

  it("reports the streamlined creative system switch", () => {
    expect(row(complete, "creative_system").state).toBe("off");
    expect(
      row({ ...complete, creative_system_v2: true }, "creative_system").state,
    ).toBe("on");
  });

  it("says 'not reported' instead of 'missing' when the list omits the creative fields", () => {
    const legacy: Dealer = { ...complete };
    delete legacy.creative_system_v2;
    delete legacy.employee_disclosure_disabled;
    legacy.signature_look = "";
    legacy.requires_approval = true;
    const status = dealerSetupStatus(legacy);
    expect(row(legacy, "look").state).toBe("unknown");
    expect(row(legacy, "look").counts).toBe(false);
    expect(row(legacy, "disclosure").state).toBe("unknown");
    expect(row(legacy, "creative_system").state).toBe("unknown");
    expect(row(legacy, "approval").value).toEqual(["Review is on"]);
    expect(status.total).toBe(5);
    expect(status.summary).toBe("5 of 5 set up");
    expect(status.missing).toEqual([]);
    expect(row(legacy, "look").reason).toBeNull();
  });
});

describe("describeApproval: the switch decides, the policy only narrows", () => {
  it("is off whenever the switch is off, whatever the policy says", () => {
    expect(describeApproval(false, null)).toBe("No approval required");
    expect(describeApproval(false, { mode: "first_n", firstN: 3 })).toBe(
      "No approval required",
    );
    expect(describeApproval(false, { mode: "always" })).toBe("No approval required");
  });

  it("reviews every post when the policy cannot narrow", () => {
    expect(describeApproval(true, null)).toBe("Every post");
    expect(describeApproval(true, undefined)).toBe("Every post");
    expect(describeApproval(true, { mode: "none" })).toBe("Every post");
    expect(describeApproval(true, { mode: "always" })).toBe("Every post");
    expect(describeApproval(true, { mode: "first_n", firstN: 0 })).toBe("Every post");
    expect(describeApproval(true, { mode: "first_n", firstN: 2.5 })).toBe("Every post");
    expect(describeApproval(true, { mode: "per_category", categories: [] })).toBe(
      "Every post",
    );
  });

  it("describes a person's first approved posts and selected post types", () => {
    expect(describeApproval(true, { mode: "first_n", firstN: 1 })).toBe(
      "Until each person has 1 approved post",
    );
    expect(describeApproval(true, { mode: "first_n", firstN: 5 })).toBe(
      "Until each person has 5 approved posts",
    );
    expect(
      describeApproval(true, {
        mode: "per_category",
        categories: ["deliveries", "service", "deliveries"],
      }),
    ).toBe(
      "Selected post types: Deliveries and Service, plus any post with a customer",
    );
    // The server reviews any post with a customer only when Deliveries is selected.
    expect(
      describeApproval(true, {
        mode: "per_category",
        categories: ["service", "promotions"],
      }),
    ).toBe("Selected post types: Service and Promotions");
  });

  it("feeds the approval row from the saved record", () => {
    const row = dealerSetupStatus({
      ...complete,
      requires_approval: true,
      approval_policy: { mode: "per_category", categories: ["promotions"] },
    }).rows.find((r) => r.id === "approval");
    expect(row?.state).toBe("on");
    expect(row?.value).toEqual(["Selected post types: Promotions"]);
    expect(row?.counts).toBe(false);
  });
});

describe("store hours", () => {
  it("shows saved hours in the store profile without counting them", () => {
    const withHours = { ...complete, hours: "Mon–Fri 9 AM–8 PM, Sat 9 AM–6 PM" };
    expect(row(withHours, "profile").value).toEqual([
      "bobmaxeyford.com",
      "(517) 555-0100",
      "2798 E Grand River Ave, Howell, MI",
      "Hours: Mon–Fri 9 AM–8 PM, Sat 9 AM–6 PM",
    ]);
    expect(dealerSetupStatus(withHours).summary).toBe("6 of 6 set up");
    // A store without hours is still set up, and hours never fill a missing field.
    expect(row({ ...complete, hours: "  " }, "profile").state).toBe("ready");
    const noPhone = row({ ...withHours, phone: "" }, "profile");
    expect(noPhone.state).toBe("missing");
    expect(noPhone.guidance).toBe(
      "Add the phone: open as the manager, then Settings > Store profile.",
    );
  });
});

describe("displayUrl", () => {
  it("drops the scheme, www and trailing slash", () => {
    expect(displayUrl(" https://www.example.com/ ")).toBe("example.com");
    expect(displayUrl("http://example.com/inventory/")).toBe("example.com/inventory");
  });
});

describe("Google Business Profile is optional", () => {
  it("is never missing and never counted, saved or not", () => {
    const unsaved = row({ ...complete, gbp_url: "" }, "gbp");
    expect(unsaved.state).toBe("optional");
    expect(unsaved.counts).toBe(false);
    expect(unsaved.attention).toBe(false);
    expect(unsaved.reason).toBeNull();
    expect(unsaved.guidance).toBe(
      "Optional: if the store posts on Google Business Profile, open as the manager, then Settings > Channels.",
    );
    const status = dealerSetupStatus({ ...complete, gbp_url: "" });
    expect(status.summary).toBe("6 of 6 set up");
    expect(status.missing).toEqual([]);
    const saved = row(complete, "gbp");
    expect(saved.state).toBe("ready");
    expect(saved.counts).toBe(false);
    expect(saved.value).toEqual(["g.page/r/bob-maxey-ford"]);
  });
});

describe("sections and reasons", () => {
  const expectedSections: Record<SetupRowId, SettingsSectionId | null> = {
    profile: "profile",
    brand: "creative",
    facebook: "channels",
    instagram: "channels",
    gbp: "channels",
    tiktok: "channels",
    x: "channels",
    linkedin: "channels",
    voice: "voice",
    look: "creative",
    approval: "workflow",
    disclosure: "workflow",
    creative_system: null,
  };

  it("names the settings section that fixes every row", () => {
    const rows = dealerSetupStatus(complete).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.section]))).toEqual(
      expectedSections,
    );
  });

  /** Nothing saved at all, but the server reports the creative fields. */
  const empty: Dealer = {
    id: "dealer-2",
    name: "Lakeside Kia",
    signature_look: "",
    requires_approval: false,
    approval_policy: null,
    employee_disclosure_disabled: false,
    creative_system_v2: true,
  };

  it("sets a reason exactly when a row is missing", () => {
    for (const dealer of [complete, empty, { ...empty, creative_system_v2: false }]) {
      for (const r of dealerSetupStatus(dealer).rows) {
        if (r.state === "missing") {
          expect(r.reason, r.id).toMatch(/^[A-Z].*\.$/);
        } else {
          expect(r.reason, r.id).toBeNull();
        }
      }
    }
  });

  it("says what each gap costs, and only what the code does", () => {
    expect(row(empty, "profile").reason).toBe(
      "The caption writer has no website, phone and address to mention.",
    );
    expect(row({ ...complete, phone: "" }, "profile").reason).toBe(
      "The caption writer has no phone to mention.",
    );
    expect(row({ ...complete, logo: "" }, "brand").reason).toBe(
      "Designed photos show the store name as text instead of a logo.",
    );
    expect(row({ ...complete, brand_color: "" }, "brand").reason).toBe(
      "The app uses its default blue for this store.",
    );
    expect(row(empty, "brand").reason).toBe(
      "Designed photos show the store name as text instead of a logo. The app uses its default blue for this store.",
    );
    expect(row(empty, "facebook").reason).toBe(
      "Facebook captions cannot tag the store.",
    );
    expect(row({ ...complete, facebook_page_tag: "" }, "facebook").reason).toBe(
      "Facebook captions cannot tag the store.",
    );
    // Nothing in the app reads the page address, so no cost is claimed for it.
    expect(row({ ...complete, facebook_url: "" }, "facebook").reason).toBe(
      "The page address is only kept on file; no post uses it.",
    );
    expect(row(empty, "instagram").reason).toBe(
      "Instagram captions cannot tag the store.",
    );
    expect(row(empty, "voice").reason).toBe(
      "Captions are written without the store's voice.",
    );
    expect(row(empty, "look").reason).toBe(
      "Posts use the Showroom Look until one is chosen.",
    );
    expect(row({ ...empty, creative_system_v2: false }, "look").reason).toBe(
      "Posts use the classic styles; no Look is applied.",
    );
  });
});

describe("settingsSectionStatus", () => {
  it("labels every section and reads ready sections from the saved record", () => {
    const sections = settingsSectionStatus(complete);
    expect(Object.keys(sections)).toEqual([
      "profile",
      "channels",
      "voice",
      "creative",
      "workflow",
    ]);
    for (const [id, label] of Object.entries(SETTINGS_SECTION_LABELS)) {
      expect(sections[id as SettingsSectionId].label).toBe(label);
      expect(sections[id as SettingsSectionId].id).toBe(id);
    }
    expect(sections.profile).toMatchObject({ ready: 1, total: 1, state: "ready" });
    expect(sections.channels).toMatchObject({ ready: 2, total: 2, state: "ready" });
    expect(sections.voice).toMatchObject({ ready: 1, total: 1, state: "ready" });
    expect(sections.creative).toMatchObject({ ready: 2, total: 2, state: "ready" });
  });

  it("reports partial, empty and Workflow's none", () => {
    const sections = settingsSectionStatus({
      ...complete,
      instagram_handle: "",
      brand_voice: "",
      logo: "",
      signature_look: "",
    });
    expect(sections.channels).toMatchObject({ ready: 1, total: 2, state: "partial" });
    expect(sections.voice).toMatchObject({ ready: 0, total: 1, state: "empty" });
    expect(sections.creative).toMatchObject({ ready: 0, total: 2, state: "empty" });
    expect(sections.profile.state).toBe("ready");
    expect(sections.workflow).toMatchObject({ ready: 0, total: 0, state: "none" });
    // Optional channels never move the Channels count.
    expect(
      settingsSectionStatus({ ...complete, gbp_url: "", tiktok_handle: "" }).channels,
    ).toMatchObject({ ready: 2, total: 2, state: "ready" });
  });

  it("does not count a look the server did not report", () => {
    const legacy: Dealer = { ...complete, signature_look: "" };
    delete legacy.creative_system_v2;
    expect(settingsSectionStatus(legacy).creative).toMatchObject({
      ready: 1,
      total: 1,
      state: "ready",
    });
  });
});

describe("describeApprovalShort", () => {
  it("names the rule in a few words", () => {
    expect(describeApprovalShort(false, { mode: "first_n", firstN: 3 })).toBe("Off");
    expect(describeApprovalShort(true, null)).toBe("Every post");
    expect(describeApprovalShort(true, { mode: "first_n", firstN: 3 })).toBe(
      "First 3 posts each",
    );
    expect(describeApprovalShort(true, { mode: "first_n", firstN: 1 })).toBe(
      "First post each",
    );
    expect(
      describeApprovalShort(true, {
        mode: "per_category",
        categories: ["deliveries", "promotions"],
      }),
    ).toBe("Deliveries and Promotions");
  });

  it("agrees with describeApproval on every input", () => {
    const policies: Array<Parameters<typeof describeApproval>[1]> = [
      null,
      undefined,
      { mode: "none" },
      { mode: "always" },
      { mode: "first_n" },
      { mode: "first_n", firstN: 0 },
      { mode: "first_n", firstN: -2 },
      { mode: "first_n", firstN: 2.5 },
      { mode: "first_n", firstN: "4" as unknown as number },
      { mode: "first_n", firstN: 1 },
      { mode: "first_n", firstN: 12 },
      { mode: "per_category" },
      { mode: "per_category", categories: [] },
      { mode: "per_category", categories: ["bogus" as never] },
      { mode: "per_category", categories: ["service"] },
      { mode: "per_category", categories: ["deliveries", "deliveries"] },
      { mode: "per_category", categories: ["team", "community", "inventory"] },
      { mode: "mystery" as never },
      "first_n" as never,
    ];
    for (const requiresApproval of [true, false]) {
      for (const policy of policies) {
        const long = describeApproval(requiresApproval, policy);
        const short = describeApprovalShort(requiresApproval, policy);
        const label = JSON.stringify({ requiresApproval, policy });
        expect(long === "No approval required", label).toBe(short === "Off");
        expect(long === "Every post", label).toBe(short === "Every post");
        if (long.startsWith("Until each person has ")) {
          const n = long.match(/has (\d+) approved/)?.[1];
          expect(short, label).toBe(
            n === "1" ? "First post each" : `First ${n} posts each`,
          );
        }
        if (long.startsWith("Selected post types: ")) {
          const types = long
            .replace("Selected post types: ", "")
            .replace(", plus any post with a customer", "");
          expect(short, label).toBe(types);
        }
      }
    }
  });
});
