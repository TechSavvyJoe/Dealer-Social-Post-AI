import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEALER_BRAND_FIELDS,
  encodeDealerBrandFields,
  getAllDealers,
  pickDealerBrandFields,
} from "../services/database";
import { listSalespeople, updatePerson } from "../services/salespeople";

/** Exactly what pb_hooks serializeDealer emits for the phase-1 fields. */
const sessionDealer = {
  id: "dealer-1",
  name: "Northside Motors",
  signature_look: "showroom",
  alternate_look: "",
  default_tone: "Professional",
  playful_style: "pixar",
  motion_signature: { style: "Golden Radiance", aspects: ["9:16"], audio: "cinematic" },
  logo_placement: { corner: "bottom_right", scale: 0.18 },
  brand_voice_do: ["Use first names"],
  brand_voice_dont: ["Never shout"],
  required_hashtags_locked: true,
  category_destinations: {
    deliveries: {
      platformIds: ["facebook"],
      formatIds: ["feed_portrait"],
      video: true,
    },
  },
  approval_policy: { mode: "first_n", firstN: 3 },
  feature_permissions: { playful: { team: true, people: {} } },
  image_quality_tier: "studio",
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dealer brand field mapping", () => {
  it("picks every phase-1 field from the session payload in its typed form", () => {
    const picked = pickDealerBrandFields(sessionDealer);
    expect(Object.keys(picked).sort()).toEqual([...DEALER_BRAND_FIELDS].sort());
    expect(picked).toEqual({
      signature_look: "showroom",
      alternate_look: "",
      default_tone: "Professional",
      playful_style: "pixar",
      motion_signature: sessionDealer.motion_signature,
      logo_placement: sessionDealer.logo_placement,
      brand_voice_do: ["Use first names"],
      brand_voice_dont: ["Never shout"],
      required_hashtags_locked: true,
      category_destinations: sessionDealer.category_destinations,
      approval_policy: sessionDealer.approval_policy,
      feature_permissions: sessionDealer.feature_permissions,
      image_quality_tier: "studio",
    });
  });

  it("tolerates raw records that still carry JSON text or unknown values", () => {
    const picked = pickDealerBrandFields({
      signature_look: "bogus",
      motion_signature: JSON.stringify({
        style: "Spotlight",
        aspects: [],
        audio: "none",
      }),
      logo_placement: "not json",
      brand_voice_do: '["Keep it short", 7]',
      required_hashtags_locked: "true",
      image_quality_tier: "ultra",
    });
    expect(picked.signature_look).toBe("");
    expect(picked.motion_signature).toEqual({
      style: "Spotlight",
      aspects: [],
      audio: "none",
    });
    expect(picked.logo_placement).toBeNull();
    expect(picked.brand_voice_do).toEqual(["Keep it short"]);
    expect(picked.required_hashtags_locked).toBe(true);
    expect(picked.image_quality_tier).toBe("");
    expect(picked.approval_policy).toBeNull();
  });

  it("carries the brand fields through the admin dealer list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [sessionDealer] }),
    });
    const [dealer] = await getAllDealers();
    expect(dealer.signature_look).toBe("showroom");
    expect(dealer.motion_signature).toEqual(sessionDealer.motion_signature);
    expect(dealer.required_hashtags_locked).toBe(true);
    expect(dealer.approval_policy).toEqual({ mode: "first_n", firstN: 3 });
  });

  it("encodes only the fields present for the multipart PATCH body", () => {
    expect(
      encodeDealerBrandFields({
        signature_look: "turbo",
        motion_signature: { style: "Liquid Chrome", aspects: ["9:16"], audio: "funk" },
        logo_placement: null,
        brand_voice_do: ["Use first names"],
        required_hashtags_locked: false,
        image_quality_tier: "",
      }),
    ).toEqual({
      signature_look: "turbo",
      motion_signature: '{"style":"Liquid Chrome","aspects":["9:16"],"audio":"funk"}',
      logo_placement: "",
      brand_voice_do: '["Use first names"]',
      required_hashtags_locked: false,
      image_quality_tier: "",
    });
  });
});

describe("person profile field mapping", () => {
  const personRow = {
    id: "person-1",
    dealer: "dealer-1",
    name: "Taylor Morgan",
    role: "salesperson",
    active: true,
    hasPin: true,
    pinNeedsDistribution: false,
    hasManagerLogin: false,
    managerScope: true,
    signatureLine: "Ask for Taylor.",
    defaultCategory: "deliveries",
    playfulDefault: false,
  };

  it("passes the four camelCase profile fields through normalizePerson", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [personRow] }),
    });
    const [person] = await listSalespeople();
    expect(person).toMatchObject({
      managerScope: true,
      signatureLine: "Ask for Taylor.",
      defaultCategory: "deliveries",
      playfulDefault: false,
    });
  });

  it("leaves the profile fields undefined when the server omits them", async () => {
    const { managerScope, signatureLine, defaultCategory, playfulDefault, ...legacy } =
      personRow;
    void managerScope;
    void signatureLine;
    void defaultCategory;
    void playfulDefault;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [legacy] }),
    });
    const [person] = await listSalespeople();
    expect(person.managerScope).toBeUndefined();
    expect(person.signatureLine).toBeUndefined();
    expect(person.defaultCategory).toBeUndefined();
    expect(person.playfulDefault).toBeUndefined();
  });

  it("sends the snake_case keys PATCH /api/app/salespeople/:id expects", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => personRow,
    });
    const updated = await updatePerson("person-1", {
      name: "Taylor Morgan",
      active: true,
      managerScope: true,
      signatureLine: "Ask for Taylor.",
      defaultCategory: "deliveries",
      playfulDefault: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/app/salespeople/person-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Taylor Morgan",
      active: true,
      manager_scope: true,
      signature_line: "Ask for Taylor.",
      default_category: "deliveries",
      playful_default: false,
    });
    expect(updated.managerScope).toBe(true);
    expect(updated.signatureLine).toBe("Ask for Taylor.");
  });

  it("omits profile keys the caller did not set", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => personRow,
    });
    await updatePerson("person-1", { name: "Taylor Morgan", active: false });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Taylor Morgan",
      active: false,
    });
  });
});
