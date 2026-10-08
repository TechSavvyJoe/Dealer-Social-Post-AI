import { describe, expect, it } from "vitest";
import type { Dealer } from "../types";
import {
  approvalCell,
  boardColumns,
  boardSummary,
  looksInWords,
  missingLine,
} from "../components/admin/setupBoardModel";
import { dealerSetupStatus } from "../utils/dealerSetupStatus";

const complete: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  website: "https://northsidemotors.com",
  phone: "(517) 555-0100",
  address: "12 Main St, Howell, MI",
  logo: "/api/files/dealers/dealer-1/logo.png",
  brand_color: "#1d4ed8",
  facebook_url: "https://facebook.com/northside",
  facebook_page_tag: "northside",
  instagram_handle: "northside",
  brand_voice: "Plain and friendly.",
  signature_look: "showroom",
  requires_approval: false,
  approval_policy: null,
  employee_disclosure_disabled: false,
  creative_system_v2: true,
};

/** Missing Instagram and Brand voice: two counted rows. */
const partial: Dealer = {
  ...complete,
  id: "dealer-2",
  name: "Lakeside Kia",
  instagram_handle: "",
  brand_voice: "",
};

/** Everything counted is missing. */
const bare: Dealer = {
  id: "dealer-3",
  name: "Hillcrest Ford",
  creative_system_v2: false,
  employee_disclosure_disabled: false,
};

/** An older server: the creative fields are not in the list. */
const legacy = (dealer: Dealer): Dealer => {
  const copy = { ...dealer };
  delete copy.creative_system_v2;
  delete copy.employee_disclosure_disabled;
  delete copy.signature_look;
  return copy;
};

describe("the setup board's count sentence", () => {
  it("counts missing items across several stores", () => {
    expect(boardSummary([complete, partial, bare])).toBe(
      "3 dealerships. 8 setup items are missing across 2 of them.",
    );
    expect(boardSummary([complete, { ...partial, brand_voice: "Warm." }])).toBe(
      "2 dealerships. 1 setup item is missing across 1 of them.",
    );
  });

  it("speaks of one store in the singular", () => {
    expect(boardSummary([partial])).toBe("1 dealership. 2 setup items are missing.");
    expect(boardSummary([{ ...partial, brand_voice: "Warm." }])).toBe(
      "1 dealership. 1 setup item is missing.",
    );
    expect(boardSummary([complete])).toBe("1 dealership. It is fully set up.");
  });

  it("says when nothing is missing", () => {
    expect(boardSummary([complete, { ...complete, id: "dealer-4", name: "B" }])).toBe(
      "2 dealerships. Every one is fully set up.",
    );
  });

  it("gives only the store count when the list does not report the creative fields", () => {
    expect(boardSummary([legacy(complete), legacy(partial)])).toBe("2 dealerships.");
    // One unreported store is enough: its signature look cannot be counted.
    expect(boardSummary([complete, legacy(partial)])).toBe("2 dealerships.");
    expect(boardSummary([])).toBe("");
  });
});

describe("the setup board's columns", () => {
  it("has one column per counted row of the model, in the model's order", () => {
    const counted = dealerSetupStatus(complete).rows.filter((row) => row.counts);
    const columns = boardColumns([dealerSetupStatus(complete)]);
    expect(columns.map((column) => column.id)).toEqual(counted.map((row) => row.id));
    expect(columns.map((column) => column.label)).toEqual(
      counted.map((row) => row.label),
    );
    expect(columns.map((column) => column.header)).toEqual([
      "Profile",
      "Brand",
      "Facebook",
      "Instagram",
      "Voice",
      "Look",
    ]);
  });

  it("keeps a column the list does not report, so the gap shows as not reported", () => {
    const columns = boardColumns([dealerSetupStatus(legacy(complete))]);
    expect(columns.map((column) => column.id)).toContain("look");
    const look = dealerSetupStatus(legacy(complete)).rows.find(
      (row) => row.id === "look",
    );
    expect(look?.counts).toBe(false);
    expect(look?.state).toBe("unknown");
  });
});

describe("the Approval column", () => {
  it("names the server's rule in a few words", () => {
    expect(approvalCell(complete)).toEqual({ text: "Off", off: true });
    expect(approvalCell({ ...complete, requires_approval: true })).toEqual({
      text: "Every post",
      off: false,
    });
    expect(
      approvalCell({
        ...complete,
        requires_approval: true,
        approval_policy: { mode: "first_n", firstN: 3 },
      }).text,
    ).toBe("First 3 posts each");
    expect(
      approvalCell({
        ...complete,
        requires_approval: true,
        approval_policy: {
          mode: "per_category",
          categories: ["deliveries", "promotions"],
        },
      }).text,
    ).toBe("Deliveries and Promotions");
  });

  it("never names a rule the list did not report", () => {
    expect(approvalCell({ ...legacy(complete), requires_approval: true }).text).toBe(
      "On",
    );
  });
});

describe("the Looks in words", () => {
  it("names the signature and second Look", () => {
    expect(looksInWords({ ...complete, alternate_look: "hometown" })).toBe(
      "Showroom Look. Second Look: Hometown.",
    );
    expect(looksInWords(complete)).toBe("Showroom Look.");
  });

  it("says what posts use when no Look is chosen or the system is off", () => {
    expect(looksInWords({ ...complete, signature_look: "" })).toBe(
      "No signature Look chosen yet. Posts use the Showroom Look until one is chosen.",
    );
    expect(looksInWords({ ...complete, creative_system_v2: false })).toBe(
      "Showroom Look. Posts use the classic styles while the creative system is off.",
    );
  });

  it("never names a second Look that posts would not offer", () => {
    // No signature Look resolves to Showroom, so a Showroom second Look
    // collapses into it on every post (services/storeDefaults.ts).
    expect(
      looksInWords({ ...complete, signature_look: "", alternate_look: "showroom" }),
    ).toBe(
      "No signature Look chosen yet. Posts use the Showroom Look until one is chosen.",
    );
    // A different second Look is still offered beside the house default.
    expect(
      looksInWords({ ...complete, signature_look: "", alternate_look: "hometown" }),
    ).toBe(
      "No signature Look chosen yet. Second Look: Hometown. Posts use the Showroom Look until one is chosen.",
    );
  });
});

describe("the phone list's line", () => {
  it("says how much is set up and missing, or nothing when complete", () => {
    expect(missingLine(dealerSetupStatus(partial))).toBe("4 of 6 set up, 2 missing");
    expect(missingLine(dealerSetupStatus(complete))).toBeNull();
  });
});

describe("private dealership access readiness", () => {
  it("counts the invitation requirement only when reported by the server", () => {
    expect(dealerSetupStatus(complete).total).toBe(6);
    const pending = { ...complete, invitation_required: false, has_invitation: true };
    expect(dealerSetupStatus(pending).summary).toBe("6 of 7 set up");
    expect(dealerSetupStatus(pending).missing[0].id).toBe("private_access");
    expect(dealerSetupStatus({ ...pending, invitation_required: true }).summary).toBe(
      "7 of 7 set up",
    );
    expect(
      dealerSetupStatus({
        ...pending,
        invitation_required: true,
        has_invitation: false,
      }).missing[0].id,
    ).toBe("private_access");
    expect(boardColumns([dealerSetupStatus(pending)]).at(-1)?.header).toBe("Access");
  });
});
