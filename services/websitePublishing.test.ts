import { afterEach, describe, expect, it, vi } from "vitest";
import { logPost } from "./posts";
import { POST_SCENARIOS } from "./postScenarios";
import {
  buildFinalWebsiteDraftFallback,
  buildFallbackWebsiteDraft,
  buildWebsiteDraftPrompt,
  cleanWebsiteMarketingCopy,
  enqueueWebsitePublication,
  listWebsiteDestinations,
  mapScenarioToWebsiteDraft,
  parseWebsiteDraftResponse,
  replaceFullCustomerName,
  safeWebsiteReviewUrl,
  toSafeCustomerDisplayName,
  toSafeVehicleDescription,
  websitePublicationIsSettled,
  websitePublicationNeedsStatusRefresh,
  websitePublicationPollDelay,
} from "./websitePublishing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST TYPE to Customer Hub mapping", () => {
  const expected = [
    ["customer_delivery", "customer_story", "deliveries"],
    ["preowned_spotlight", "site_update", "inventory"],
    ["new_arrival", "site_update", "inventory"],
    ["trade_in_spotlight", "site_update", "inventory"],
    ["service_promotion", "site_update", "service"],
    ["recall_complete", "site_update", "service"],
    ["customer_testimonial", "customer_story", "deliveries"],
    ["sold_by_salesperson", "customer_story", "team"],
    ["model_year_end", "site_update", "promotions"],
    ["community_event", "site_update", "community"],
    ["team_anniversary", "site_update", "team"],
    ["test_drive_invite", "site_update", "promotions"],
  ] as const;

  it("covers every built-in POST TYPE exactly once", () => {
    expect(POST_SCENARIOS).toHaveLength(12);
    expect(expected.map(([id]) => id)).toEqual(
      POST_SCENARIOS.map((scenario) => scenario.id),
    );
  });

  it.each(expected)("maps %s to %s / %s", (id, kind, category) => {
    expect(mapScenarioToWebsiteDraft(id)).toMatchObject({ kind, category });
  });

  it("maps custom customer/delivery scenarios to a story and safely defaults unknown ids", () => {
    const custom = JSON.stringify([
      {
        id: "local_delivery",
        label: "Local Delivery",
        category: "delivery",
        requiresCustomer: true,
        promptAdditions: "Celebrate the customer.",
      },
    ]);
    expect(mapScenarioToWebsiteDraft("local_delivery", custom)).toMatchObject({
      kind: "customer_story",
      category: "deliveries",
    });
    expect(mapScenarioToWebsiteDraft("missing", custom)).toMatchObject({
      kind: "site_update",
      category: "community",
    });
  });
});

describe("private website draft parser and privacy boundary", () => {
  const customerSource = {
    scenarioId: "customer_delivery",
    dealerName: "Example Motors",
    caption:
      "Jane Smith found the perfect SUV.\nVisit https://examplemotors.com or call (555) 222-1212.\n#HappyCustomer #DeliveryDay",
    customerDisplayName: "Jane Smith",
    vehicleDescription: "2025 Ford Explorer ST",
  };

  it("keeps customer-story metadata deterministic and first-name-only", () => {
    const result = parseWebsiteDraftResponse(
      JSON.stringify({
        title: "Jane Smith Starts a New Chapter",
        body: "Jane Smith is ready for new adventures.\nSee more at www.examplemotors.com.",
        altText: "Jane Smith standing beside the vehicle at delivery.",
        category: "deliveries",
        privacyFlags: ["faces_visible", "license_plate_visible"],
      }),
      customerSource,
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.draft).toMatchObject({
      enabled: true,
      kind: "customer_story",
      category: "deliveries",
      customerDisplayName: "Jane",
      vehicleDescription: "2025 Ford Explorer ST",
      schemaVersion: 1,
    });
    expect(result.draft.title).toContain("Jane");
    expect(result.draft.body).toContain("Jane");
    expect(result.draft.altText).not.toContain("Jane Smith");
    expect(JSON.stringify(result.draft)).not.toContain("Jane Smith");
    expect(JSON.stringify(result.draft)).not.toContain("examplemotors.com");
    expect(JSON.stringify(result.draft)).not.toContain("555");
    expect(result.draft.body.length).toBeLessThanOrEqual(280);
  });

  it("falls back deterministically for malformed JSON or a changed category", () => {
    const malformed = parseWebsiteDraftResponse("not-json", customerSource);
    const categorySwap = parseWebsiteDraftResponse(
      JSON.stringify({
        title: "A valid-looking title",
        body: "A valid-looking body that is long enough for the parser.",
        altText: "A general description of the finished creative.",
        category: "inventory",
        privacyFlags: [],
      }),
      customerSource,
    );

    expect(malformed.source).toBe("deterministic_fallback");
    expect(categorySwap.source).toBe("deterministic_fallback");
    expect(malformed.draft.privacyFlags).toContain("review_visual_privacy");
    expect(malformed.draft.body).not.toContain("https://");
    expect(malformed.draft.body).not.toMatch(/#HappyCustomer/);
  });

  it("removes an invented second customer from website metadata and fallback body", () => {
    const mixedIdentitySource = {
      ...customerSource,
      caption:
        "Congratulations to Jane and Jordan! Jane and Jordan just celebrated a special delivery day.",
    };
    const result = parseWebsiteDraftResponse(
      JSON.stringify({
        title: "Welcome, Jane and Jordan",
        body: "Jane and Jordan are ready for the road ahead.",
        altText: "Jane and Jordan standing beside the vehicle.",
        category: "deliveries",
        privacyFlags: [],
      }),
      mixedIdentitySource,
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.draft.customerDisplayName).toBe("Jane");
    expect(JSON.stringify(result.draft)).not.toContain("Jordan");
    expect(result.draft.body).toContain("Jane");
  });

  it("takes the schema-bound JSON straight and still recovers prose-mode output", () => {
    const inventorySource = {
      scenarioId: "new_arrival",
      dealerName: "Example Motors",
      caption: "A fresh arrival is on the lot and ready for a look.",
    };
    const draft = {
      title: "Fresh arrival on the lot",
      body: "A new vehicle just landed and is ready for a closer look at the store.",
      altText: "A vehicle parked on the dealership lot.",
      category: "inventory",
      privacyFlags: [],
    };

    // Structured path: the whole payload is valid JSON, parsed strictly.
    const structured = parseWebsiteDraftResponse(
      JSON.stringify(draft),
      inventorySource,
    );
    expect(structured.source).toBe("ai");
    expect(structured.draft.title).toBe("Fresh arrival on the lot");

    // Legacy prose fallback for a proxy that predates the schema registry:
    // markdown fences and surrounding commentary still parse.
    const fenced = parseWebsiteDraftResponse(
      "```json\n" + JSON.stringify(draft) + "\n```",
      inventorySource,
    );
    expect(fenced.source).toBe("ai");
    expect(fenced.draft.title).toBe("Fresh arrival on the lot");

    const chatty = parseWebsiteDraftResponse(
      `Sure! Here is the metadata:\n${JSON.stringify(draft)}\nLet me know if you want changes.`,
      inventorySource,
    );
    expect(chatty.source).toBe("ai");
    expect(chatty.draft.altText).toBe("A vehicle parked on the dealership lot.");

    // A non-JSON answer still falls back deterministically rather than throwing.
    expect(parseWebsiteDraftResponse("no json here", inventorySource).source).toBe(
      "deterministic_fallback",
    );
  });

  it("keeps kind-specific limits without inventing a testimonial vehicle", () => {
    const longCopy = Array.from({ length: 300 }, () => "update").join(" ");
    const story = buildFallbackWebsiteDraft({
      scenarioId: "customer_testimonial",
      dealerName: "Example Motors",
      caption: longCopy,
      customerDisplayName: "Alex Morgan",
    });
    const update = buildFallbackWebsiteDraft({
      scenarioId: "community_event",
      dealerName: "Example Motors",
      caption: longCopy,
    });

    expect(story.body.length).toBeLessThanOrEqual(280);
    expect(story.vehicleDescription).toBe("Customer experience");
    expect(update.body.length).toBeLessThanOrEqual(900);
    expect(update).not.toHaveProperty("vehicleDescription");
  });

  it("does not expose full names or contact/identity data in the AI prompt", () => {
    const prompt = buildWebsiteDraftPrompt(customerSource);
    expect(prompt).toContain("Jane");
    expect(prompt).not.toContain("Jane Smith");
    expect(prompt).not.toContain("examplemotors.com");
    expect(prompt).not.toContain("555");
    expect(prompt).toContain("Do not include email addresses");
  });

  it("normalizes safe public labels and rejects VIN-bearing vehicle labels", () => {
    expect(toSafeCustomerDisplayName("  Jane   Marie Smith ")).toBe("Jane");
    expect(toSafeCustomerDisplayName("jane@example.com")).toBeUndefined();
    expect(toSafeVehicleDescription("2025 Ford Explorer ST")).toBe(
      "2025 Ford Explorer ST",
    );
    expect(
      toSafeVehicleDescription("2025 Ford Explorer 1FM5K8GC4SGB12345"),
    ).toBeUndefined();
    expect(replaceFullCustomerName("Thanks Jane Smith!", "Jane Smith", "Jane")).toBe(
      "Thanks Jane!",
    );
  });

  it("removes website-intake PII and dealer contact lines", () => {
    const cleaned = cleanWebsiteMarketingCopy(
      [
        "A community update from Example Motors.",
        "Email sales@example.com",
        "Call 555-222-1212",
        "Visit 123 Main Street",
        "VIN 1FM5K8GC4SGB12345",
      ].join("\n"),
    );
    expect(cleaned).toBe("A community update from Example Motors.");
  });

  it("binds review links to the configured HTTPS destination origin", async () => {
    expect(
      safeWebsiteReviewUrl("https://unconfigured.example/studio/draft-1"),
    ).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "joe_customer_hub",
                  label: "Website",
                  siteUrl: "https://joegallant.me",
                  enabled: true,
                  mode: "private_draft",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await listWebsiteDestinations();
    expect(safeWebsiteReviewUrl("https://joegallant.me/studio/draft-1")).toBe(
      "https://joegallant.me/studio/draft-1",
    );
    expect(safeWebsiteReviewUrl("https://evil.example/draft-1")).toBeUndefined();
    expect(safeWebsiteReviewUrl("http://joegallant.me/draft-1")).toBeUndefined();
    expect(
      safeWebsiteReviewUrl("https://user:password@joegallant.me/draft-1"),
    ).toBeUndefined();
  });

  it("redacts protected family-name phrasing", () => {
    expect(
      replaceFullCustomerName(
        "The Smith family is celebrating today.",
        "Jordan Smith",
        "Jordan",
      ),
    ).toBe("the customer’s family is celebrating today.");
    expect(
      replaceFullCustomerName(
        "Congratulations to Smith on Smith’s new SUV.",
        "Jordan Smith",
        "Jordan",
      ),
    ).toBe("Congratulations to the customer on the customer’s new SUV.");
  });

  it("keeps automotive makes intact while redacting customer uses of the same surname", () => {
    expect(
      replaceFullCustomerName(
        "Jane Ford chose a 2025 Ford Explorer. The Ford family loves Ford’s new SUV.",
        "Jane Ford",
        "Jane",
      ),
    ).toBe(
      "Jane chose a 2025 Ford Explorer. the customer’s family loves the customer’s new SUV.",
    );
    expect(
      replaceFullCustomerName("Mrs. Ford visited Bob Maxey Ford.", "Jane Ford", "Jane"),
    ).toBe("Jane visited Bob Maxey Ford.");
  });

  it("quietly refreshes a ready draft until the Hub reports a final state", () => {
    expect(websitePublicationIsSettled("draft_ready")).toBe(true);
    expect(websitePublicationNeedsStatusRefresh("draft_ready")).toBe(true);
    expect(websitePublicationNeedsStatusRefresh("published")).toBe(false);
    expect(websitePublicationNeedsStatusRefresh("withdrawn")).toBe(false);
    expect(websitePublicationNeedsStatusRefresh("not_requested")).toBe(false);
    expect(websitePublicationPollDelay("draft_ready")).toBe(60_000);
    expect(websitePublicationPollDelay("waiting_approval")).toBe(10_000);
  });

  it("rebuilds final website copy from the edited caption without changing its route", () => {
    const final = buildFinalWebsiteDraftFallback({
      dealerName: "Example Motors",
      caption: "The final edited wording for this delivery.\n#DeliveryDay",
      currentDraft: {
        enabled: true,
        kind: "customer_story",
        category: "deliveries",
        title: "Welcome, Jane",
        body: "Old first-generation wording.",
        altText: "Customer delivery creative.",
        customerDisplayName: "Jane",
        schemaVersion: 1,
      },
    });

    expect(final.kind).toBe("customer_story");
    expect(final.category).toBe("deliveries");
    expect(final.title).toBe("Welcome, Jane");
    expect(final.body).toBe("The final edited wording for this delivery.");
    expect(final.body).not.toContain("Old first-generation wording");
    expect(final.altText).toContain("review the final image");
    expect(final.altText).not.toBe("Customer delivery creative.");
    expect(final.privacyFlags).toContain("review_visual_privacy");
  });

  it("sends the final website draft only through the explicit handoff endpoint", async () => {
    const draft = buildFallbackWebsiteDraft({
      scenarioId: "preowned_spotlight",
      dealerName: "Example Motors",
      caption: "Final inventory update.",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "queued", attempts: 0, websiteDraft: draft }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enqueueWebsitePublication("post-final-1", draft, "2026-08-05 09:42:00.000Z"),
    ).resolves.toMatchObject({ status: "queued", websiteDraft: draft });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/posts/post-final-1/website-publication",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          website_draft: draft,
          expected_post_revision: "2026-08-05 09:42:00.000Z",
        }),
      }),
    );
  });
});

describe("website draft post-log contract", () => {
  it("sends website copy and legal disclosures as separate fields", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("data:image/")) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        request = init;
        return new Response(
          JSON.stringify({
            id: "website-post-1",
            dealer: "dealer-1",
            generated_at: "2026-08-04T12:00:00.000Z",
            approval_status: "n_a",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await logPost({
      customerName: "Jane",
      customerIdentityRequired: true,
      caption: "Delivery day",
      disclosures: "Offer subject to approved credit.",
      imageDataUrl: "data:image/png;base64,AQID",
      websiteDraft: {
        enabled: true,
        kind: "customer_story",
        category: "deliveries",
        title: "Welcome, Jane",
        body: "Jane is ready for the road ahead.",
        altText: "Customer delivery creative from Example Motors.",
        customerDisplayName: "Jane",
        vehicleDescription: "the vehicle they chose",
        schemaVersion: 1,
      },
    });

    const form = request?.body as FormData;
    const draft = JSON.parse(String(form.get("website_draft")));
    expect(draft.body).toBe("Jane is ready for the road ahead.");
    expect(draft.body).not.toContain("approved credit");
    expect(form.get("disclosures")).toBe("Offer subject to approved credit.");
  });
});
