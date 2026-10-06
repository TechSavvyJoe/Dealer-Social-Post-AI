import { describe, expect, it } from "vitest";
import {
  SECTION_FIELDS,
  SETTINGS_SECTION_ORDER,
  dirtySectionLabels,
  dirtySections,
  draftDealer,
  isSignatureLook,
  readReviewChoice,
  savedFormValues,
  toApprovalPolicy,
  type SettingsFormValues,
} from "../components/dealer-settings/settingsModel";
import type { Dealer } from "../types";
import type { SettingsSectionId } from "../utils/dealerSetupStatus";

/**
 * The settings form's dirty check before it was split by section, word for
 * word, over the same values. It is the oracle: the five per-section checks
 * must OR together to exactly this, for every single-field edit.
 */
const legacyDirty = (v: SettingsFormValues, dealer: Dealer): boolean => {
  const savedLook = isSignatureLook(dealer.signature_look) ? dealer.signature_look : "";
  const savedAlternateLook = isSignatureLook(dealer.alternate_look)
    ? dealer.alternate_look
    : "";
  const savedMotionSignature = dealer.motion_signature ?? null;
  const savedLogoPlacement = dealer.logo_placement ?? null;
  const brandDirty =
    v.signatureLook !== savedLook ||
    v.alternateLook !== savedAlternateLook ||
    JSON.stringify(v.voiceDo) !== JSON.stringify(dealer.brand_voice_do || []) ||
    JSON.stringify(v.voiceDont) !== JSON.stringify(dealer.brand_voice_dont || []) ||
    v.hashtagsLocked !== !!dealer.required_hashtags_locked ||
    v.playfulStyle !== (dealer.playful_style || "") ||
    JSON.stringify(v.motionSignature) !== JSON.stringify(savedMotionSignature) ||
    JSON.stringify(v.logoPlacement) !== JSON.stringify(savedLogoPlacement) ||
    v.imageQualityTier !== (dealer.image_quality_tier || "");
  const savedApprovalPolicy = toApprovalPolicy(
    !!dealer.requires_approval,
    readReviewChoice(!!dealer.requires_approval, dealer.approval_policy),
  );
  const workflowDirty =
    JSON.stringify(v.approvalPolicy) !== JSON.stringify(savedApprovalPolicy) ||
    JSON.stringify(v.categoryDestinations) !==
      JSON.stringify(dealer.category_destinations ?? null) ||
    JSON.stringify(v.featurePermissions) !==
      JSON.stringify(dealer.feature_permissions ?? null);
  const saved = savedFormValues(dealer);
  return (
    brandDirty ||
    workflowDirty ||
    v.voice !== (dealer.brand_voice || "") ||
    v.banned !== (dealer.banned_phrases || "") ||
    v.color !== (dealer.brand_color || "") ||
    v.oem !== (dealer.oem_affiliation || "") ||
    v.approval !== !!dealer.requires_approval ||
    v.disclosureOn === !!dealer.employee_disclosure_disabled ||
    v.disclosureText !== (dealer.employee_disclosure_text || "") ||
    v.website !== (dealer.website || "") ||
    v.phone !== (dealer.phone || "") ||
    v.address !== (dealer.address || "") ||
    // The old form compared the serialized week and the joined style list
    // against the same derivation of the saved record.
    v.hours !== saved.hours ||
    v.tagline !== (dealer.tagline || "") ||
    v.facebookUrl !== (dealer.facebook_url || "") ||
    v.facebookPageTag !== (dealer.facebook_page_tag || "") ||
    v.instagramHandle !== (dealer.instagram_handle || "") ||
    v.tiktokHandle !== (dealer.tiktok_handle || "") ||
    v.xHandle !== (dealer.x_handle || "") ||
    v.linkedinCompanyTag !== (dealer.linkedin_company_tag || "") ||
    v.gbpUrl !== (dealer.gbp_url || "") ||
    v.defaultHashtags !== (dealer.default_hashtags || "") ||
    v.defaultFooter !== (dealer.default_footer || "") ||
    v.enabledStyles !== saved.enabledStyles ||
    v.defaultStyle !== (dealer.default_style || "")
  );
};

/** One edit per saved value: a value that differs from the baseline. */
const EDITS: Record<keyof SettingsFormValues, (v: SettingsFormValues) => unknown> = {
  website: (v) => `${v.website}x`,
  phone: (v) => `${v.phone}1`,
  address: (v) => `${v.address} Suite 2`,
  hours: () => "Mon 9:00 AM–5:00 PM, Tue–Sun closed",
  tagline: (v) => `${v.tagline}!`,
  oem: (v) => `${v.oem} Ford`,
  facebookUrl: (v) => `${v.facebookUrl}/page`,
  facebookPageTag: (v) => `${v.facebookPageTag}Tag`,
  instagramHandle: (v) => `${v.instagramHandle}gram`,
  tiktokHandle: (v) => `${v.tiktokHandle}tok`,
  xHandle: (v) => `${v.xHandle}x`,
  linkedinCompanyTag: (v) => `${v.linkedinCompanyTag}in`,
  gbpUrl: (v) => `${v.gbpUrl}/g`,
  voice: (v) => `${v.voice} Plain.`,
  voiceDo: (v) => [...v.voiceDo, "Say thanks"],
  voiceDont: (v) => [...v.voiceDont, "No slang"],
  defaultHashtags: (v) => `${v.defaultHashtags}\n#More`,
  hashtagsLocked: (v) => !v.hashtagsLocked,
  defaultFooter: (v) => `${v.defaultFooter} Call us.`,
  banned: (v) => `${v.banned}\nfree car`,
  signatureLook: (v) => (v.signatureLook === "turbo" ? "showroom" : "turbo"),
  alternateLook: (v) => (v.alternateLook === "hometown" ? "showroom" : "hometown"),
  playfulStyle: (v) => (v.playfulStyle === "lego" ? "pixar" : "lego"),
  color: (v) => (v.color === "#123456" ? "#654321" : "#123456"),
  logoPlacement: () => ({ corner: "top_left", scale: 0.2 }),
  motionSignature: () => ({ style: "Spotlight", aspects: ["16:9"], audio: "none" }),
  imageQualityTier: (v) => (v.imageQualityTier === "studio" ? "standard" : "studio"),
  enabledStyles: () => "Modern & Bold",
  defaultStyle: (v) => (v.defaultStyle === "Modern & Bold" ? "" : "Modern & Bold"),
  approval: (v) => !v.approval,
  approvalPolicy: () => ({ mode: "first_n", firstN: 7 }),
  disclosureOn: (v) => !v.disclosureOn,
  disclosureText: (v) => `${v.disclosureText} I work at {dealer}.`,
  featurePermissions: () => ({ video: { team: false, people: {} } }),
  categoryDestinations: () => ({
    deliveries: {
      platformIds: ["facebook_feed"],
      formatIds: ["feed_portrait"],
      video: true,
    },
  }),
};

const sectionOf = (field: keyof SettingsFormValues): SettingsSectionId =>
  SETTINGS_SECTION_ORDER.find((section) => SECTION_FIELDS[section].includes(field))!;

const emptyDealer: Dealer = { id: "d-empty", name: "Southside Motors" };

const fullDealer: Dealer = {
  id: "d-full",
  name: "Northside Motors",
  website: "https://northside.example",
  phone: "517-555-0100",
  address: "1 Main St, Howell, MI 48843",
  hours: "Mon–Fri 9:00 AM–8:00 PM, Sat 9:00 AM–6:00 PM, Sun closed",
  tagline: "Family-owned since 1985",
  oem_affiliation: "Ford",
  facebook_url: "https://facebook.com/northside",
  facebook_page_tag: "NorthsideMotors",
  instagram_handle: "northside",
  tiktok_handle: "northside",
  x_handle: "northside",
  linkedin_company_tag: "northside-motors",
  gbp_url: "https://g.page/northside",
  brand_voice: "Warm and direct.",
  brand_voice_do: ["Use first names"],
  brand_voice_dont: ["Never shout"],
  default_hashtags: "#Northside",
  required_hashtags_locked: true,
  default_footer: "See you soon.",
  banned_phrases: "guaranteed approval",
  signature_look: "turbo",
  alternate_look: "hometown",
  playful_style: "lego",
  brand_color: "#123456",
  logo_placement: { corner: "bottom_right", scale: 0.18 },
  motion_signature: { style: "Golden Radiance", aspects: ["9:16"], audio: "cinematic" },
  image_quality_tier: "studio",
  enabled_styles: "Luxury & Elegance,Modern & Bold",
  default_style: "Modern & Bold",
  requires_approval: true,
  approval_policy: { mode: "per_category", categories: ["deliveries"] },
  employee_disclosure_disabled: false,
  employee_disclosure_text: "I work at {dealer}.",
  feature_permissions: { playful: { team: false, people: {} } },
  category_destinations: {
    service: {
      platformIds: ["facebook_feed"],
      formatIds: ["feed_portrait"],
      video: false,
    },
  },
};

describe("settings dirty check, split by section", () => {
  it("puts every saved value in exactly one section", () => {
    const keys = Object.keys(savedFormValues(emptyDealer)).sort();
    const listed = SETTINGS_SECTION_ORDER.flatMap((section) => [
      ...SECTION_FIELDS[section],
    ]).sort();
    expect(listed).toEqual(keys);
    expect(new Set(listed).size).toBe(listed.length);
    expect(Object.keys(EDITS).sort()).toEqual(keys);
  });

  for (const [name, dealer] of [
    ["a store that saved nothing", emptyDealer],
    ["a store that saved everything", fullDealer],
  ] as const) {
    describe(name, () => {
      const saved = savedFormValues(dealer);

      it("is clean untouched, by both the old expression and the split", () => {
        expect(legacyDirty(saved, dealer)).toBe(false);
        expect(Object.values(dirtySections(saved, saved))).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
      });

      for (const field of Object.keys(EDITS) as Array<keyof SettingsFormValues>) {
        it(`one edit to ${field}: the union equals the old expression and names one section`, () => {
          const edited = {
            ...saved,
            [field]: EDITS[field](saved),
          } as SettingsFormValues;
          expect(edited[field]).not.toEqual(saved[field]);
          const split = dirtySections(edited, saved);
          const union = Object.values(split).some(Boolean);
          expect(union).toBe(legacyDirty(edited, dealer));
          expect(union).toBe(true);
          expect(SETTINGS_SECTION_ORDER.filter((section) => split[section])).toEqual([
            sectionOf(field),
          ]);
        });
      }
    });
  }

  it("names every section with an edit, in rail order", () => {
    const saved = savedFormValues(emptyDealer);
    const one = { ...saved, voice: "Plain." };
    const two = { ...one, website: "https://a.example" };
    const three = { ...two, approval: true };
    expect(dirtySectionLabels(dirtySections(one, saved))).toBe("Voice");
    expect(dirtySectionLabels(dirtySections(two, saved))).toBe(
      "Store profile and Voice",
    );
    expect(dirtySectionLabels(dirtySections(three, saved))).toBe(
      "Store profile, Voice and Workflow",
    );
  });
});

describe("the sample's draft", () => {
  it("reads what Save would store, not the raw typing", () => {
    const saved = savedFormValues(emptyDealer);
    const draft = draftDealer(emptyDealer, {
      ...saved,
      facebookPageTag: "  @North Side Motors ",
      defaultFooter: "  Call us.  ",
      disclosureOn: false,
      approval: true,
      approvalPolicy: { mode: "first_n", firstN: 2 },
    });
    expect(draft.facebook_page_tag).toBe("NorthSideMotors");
    expect(draft.default_footer).toBe("Call us.");
    expect(draft.employee_disclosure_disabled).toBe(true);
    expect(draft.requires_approval).toBe(true);
    expect(draft.approval_policy).toEqual({ mode: "first_n", firstN: 2 });
    expect(draft.name).toBe(emptyDealer.name);
  });
});
