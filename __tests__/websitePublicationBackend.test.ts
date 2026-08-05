import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type WebsiteModule = {
  WEBSITE_BODY_LIMITS: { customer_story: number; site_update: number };
  parseWebsiteDraft(raw: unknown): {
    ok: boolean;
    error?: string;
    value?: Record<string, unknown> | null;
    serialized?: string;
  };
  destinationConfiguration(dealerId: string): {
    enabled: boolean;
    secret: string;
    allowedDealerId: string;
    siteUrl: string;
    endpointUrl: string;
  };
  publicDestinationConfiguration(dealerId: string): Record<string, unknown>;
  resolveWebsiteMapping(
    scenarioId: string,
    customScenariosJson?: string,
  ): { scenarioId: string; kind: string; category: string } | null;
  websiteDraftMatchesScenario(
    scenarioId: string,
    customScenariosJson: string,
    draft: Record<string, unknown>,
  ): boolean;
  publicCustomerLabel(value: string): string;
  replaceProtectedCustomerName(value: string, protectedName: string): string;
  containsVinLike(value: string): boolean;
  containsSensitiveContactText(value: string): boolean;
  base64EncodeBytes(value: number[]): string;
  hmacHeaders(
    rawBody: string,
    timestamp: string,
    nonce: string,
    secret: string,
    crypto: {
      sha256(value: string): string;
      hs256(value: string, key: string): string;
    },
  ): { bodyHash: string; signature: string; message: string };
  buildOutboundContent(
    post: unknown,
    draft: Record<string, unknown>,
    media: Record<string, string>,
  ): Record<string, unknown>;
  payloadSentAtForFirstQueue(publication: unknown, now: string): string;
  acceptedDestinationState(
    statusCode: number,
    responseStatus: string,
    draftId: string,
    reviewUrl: string,
    idempotentReplay: boolean,
  ): string;
  statusReplayResponseIsBound(
    isStatusReplay: boolean,
    idempotentReplay: boolean,
    draftId: string,
    existingRemoteDraftId: string,
  ): boolean;
  claimPublicationForPost(
    postId: string,
    requestedDraft: unknown,
    expectedPostRevision: string,
    expectedDealerId: string,
  ): {
    post: unknown;
    publication: unknown;
    idempotentReplay: boolean;
    postRevision: string;
  };
  publicationEventIdForPostRevision(
    postId: string,
    postRevision: string,
    sourceSnapshotHash: string,
    securityApi: { sha256(value: string): string },
  ): string;
  publicationEventRevisionMatches(
    eventId: string,
    postId: string,
    postRevision: string,
    securityApi: { sha256(value: string): string },
  ): boolean | null;
  publicationSourceSnapshotHash(
    post: unknown,
    draft: Record<string, unknown>,
    media: Record<string, string>,
    securityApi: { sha256(value: string): string },
  ): string;
  verifyPublicationSourceSnapshot(
    publication: unknown,
    post: unknown,
    draft: Record<string, unknown>,
    media: Record<string, string>,
    securityApi: { sha256(value: string): string },
  ): void;
};

function loadWebsiteModule(): WebsiteModule {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/websitePublications.js"),
    "utf8",
  );
  const module = { exports: {} as WebsiteModule };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const website = loadWebsiteModule();

function postRecord(values: Record<string, unknown>) {
  return {
    id: "post_123",
    getString(field: string) {
      return (values[field] ?? "").toString();
    },
    getBool(field: string) {
      return Boolean(values[field]);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Customer Hub website publication contract", () => {
  it.each([
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
  ])("canonically maps %s to %s / %s", (scenarioId, kind, category) => {
    expect(website.resolveWebsiteMapping(scenarioId)).toEqual({
      scenarioId,
      kind,
      category,
    });
  });

  it("rejects browser attempts to move a POST TYPE into another website lane", () => {
    expect(
      website.websiteDraftMatchesScenario("new_arrival", "[]", {
        enabled: true,
        kind: "customer_story",
        category: "inventory",
      }),
    ).toBe(false);
    expect(
      website.websiteDraftMatchesScenario("customer_delivery", "[]", {
        enabled: true,
        kind: "site_update",
        category: "deliveries",
      }),
    ).toBe(false);

    const custom = JSON.stringify([
      {
        id: "local_delivery",
        label: "Local Delivery",
        category: "delivery",
        requiresCustomer: true,
        promptAdditions: "Celebrate the customer.",
      },
    ]);
    expect(website.resolveWebsiteMapping("local_delivery", custom)).toEqual({
      scenarioId: "local_delivery",
      kind: "customer_story",
      category: "deliveries",
    });
    expect(website.resolveWebsiteMapping("unknown", custom)).toBeNull();
  });

  it("validates the two destination copy budgets exactly", () => {
    expect(website.WEBSITE_BODY_LIMITS).toEqual({
      customer_story: 280,
      site_update: 900,
    });
    const common = {
      schemaVersion: 1,
      enabled: true,
      category: "delivery",
      title: "A great delivery day",
      altText: "Customer beside a newly delivered vehicle",
    };
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({ ...common, kind: "customer_story", body: "x".repeat(280) }),
      ).ok,
    ).toBe(true);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({ ...common, kind: "customer_story", body: "x".repeat(281) }),
      ).ok,
    ).toBe(false);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({ ...common, kind: "site_update", body: "x".repeat(900) }),
      ).ok,
    ).toBe(true);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({ ...common, kind: "site_update", body: "x".repeat(901) }),
      ).ok,
    ).toBe(false);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({
          ...common,
          kind: "customer_story",
          body: "A customer delivery prepared for review.",
          privacyFlags: ["faces_visible", "minor_may_be_visible"],
        }),
      ).ok,
    ).toBe(true);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({
          ...common,
          kind: "customer_story",
          body: "A customer delivery prepared for review.",
          privacyFlags: ["browser_invented_flag"],
        }),
      ).ok,
    ).toBe(false);
    expect(
      website.parseWebsiteDraft(
        JSON.stringify({
          ...common,
          kind: "customer_story",
          body: "A customer delivery prepared for review.",
          privacyFlags: Array.from({ length: 6 }, () => "faces_visible"),
        }),
      ).ok,
    ).toBe(false);
  });

  it("fails the single-site tenant guard closed and never returns the secret", () => {
    const values: Record<string, string> = {
      CUSTOMER_HUB_URL: "HTTPS://JoeGallant.Example/",
      CUSTOMER_HUB_SECRET: "s".repeat(48),
      CUSTOMER_HUB_DESTINATION_ID: "joe_customer_hub",
      CUSTOMER_HUB_DEALER_ID: "dealer_joe",
    };
    vi.stubGlobal("$os", { getenv: (name: string) => values[name] ?? "" });

    expect(website.destinationConfiguration("dealer_other").enabled).toBe(false);
    expect(website.destinationConfiguration("dealer_joe")).toMatchObject({
      enabled: true,
      siteUrl: "https://joegallant.example",
      endpointUrl: "https://joegallant.example/api/integrations/dealer-social/content",
    });
    const publicConfig = website.publicDestinationConfiguration("dealer_joe");
    expect(publicConfig).toMatchObject({
      id: "joe_customer_hub",
      enabled: true,
      mode: "private_draft",
    });
    expect(publicConfig).not.toHaveProperty("secret");
    delete values.CUSTOMER_HUB_DEALER_ID;
    expect(website.destinationConfiguration("dealer_joe").enabled).toBe(false);
  });

  it("refreshes a waiting row's sentAt only before its first delivery attempt", () => {
    const original = "2026-06-01T12:00:00.000Z";
    const queuedAt = "2026-08-04T22:00:00.000Z";
    const publicationRecord = (values: Record<string, unknown>) => ({
      getString(field: string) {
        return (values[field] ?? "").toString();
      },
      getInt(field: string) {
        return Number(values[field]) || 0;
      },
    });

    expect(
      website.payloadSentAtForFirstQueue(
        publicationRecord({
          attempts: 0,
          payload_hash: "",
          last_attempt_at: "",
          payload_sent_at: original,
        }),
        queuedAt,
      ),
    ).toBe(queuedAt);
    expect(
      website.payloadSentAtForFirstQueue(
        publicationRecord({
          attempts: 1,
          payload_hash: "",
          last_attempt_at: original,
          payload_sent_at: original,
        }),
        queuedAt,
      ),
    ).toBe(original);
    expect(
      website.payloadSentAtForFirstQueue(
        publicationRecord({
          attempts: 0,
          payload_hash: "a".repeat(64),
          last_attempt_at: "",
          payload_sent_at: original,
        }),
        queuedAt,
      ),
    ).toBe(original);
  });

  it("matches the frozen cross-repo lowercase-hex HMAC contract vector", () => {
    const rawBody =
      '{"schemaVersion":1,"eventId":"event_contract_1","destinationId":"joe_customer_hub","sourcePostId":"post_contract_1","sourceDealerId":"dealer_contract_1","sourceRevision":1,"sentAt":"2026-08-04T22:00:00.000Z","content":{"kind":"site_update","postTypeId":"new_arrival","category":"inventory","title":"A fresh arrival worth a look","body":"A new arrival is ready for Joe to review with you.","disclosures":"Availability and details require current verification.","altText":"Blue vehicle parked outside the Howell showroom","media":{"mimeType":"image/jpeg","filename":"arrival.jpg","base64":"/9j/4AAQSkZJRgABAQEAYABgAAD/2Q=="}}}';
    const timestamp = "1785890400";
    const nonce = "contract_nonce_0001";
    const secret = "dealer-social-contract-secret-2026-v1";
    const expectedHash =
      "b8f9e89b4caa42ecb0b6c867cc05095b91fb05f04599c1e2eb8d1f1a41b7c220";
    const expectedSignature =
      "89f5eb33bb521c8178791fa0d927afe4f7ab678e6806190418bfda048d4f0c2a";
    const crypto = {
      sha256(value: string) {
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
      hs256(value: string, key: string) {
        return createHmac("sha256", key).update(value, "utf8").digest("hex");
      },
    };

    const signed = website.hmacHeaders(rawBody, timestamp, nonce, secret, crypto);
    const expectedMessage = `${timestamp}.${nonce}.${expectedHash}`;
    expect(signed).toEqual({
      bodyHash: expectedHash,
      message: expectedMessage,
      signature: expectedSignature,
    });
    expect(createHash("sha256").update(rawBody).digest("hex")).toBe(expectedHash);
    expect(createHmac("sha256", secret).update(expectedMessage).digest("hex")).toBe(
      expectedSignature,
    );
    expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the immutable event identity to the exact saved revision and media", () => {
    const crypto = {
      sha256(value: string) {
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
    };
    const post = postRecord({
      dealer: "dealer_joe",
      scenario_id: "customer_delivery",
      customer_name: "",
      disclosures: "",
    });
    const draft = {
      schemaVersion: 1,
      enabled: true,
      kind: "customer_story",
      category: "deliveries",
      title: "A happy delivery",
      body: "A customer is ready to enjoy the vehicle they chose.",
      altText: "Customer standing beside a newly delivered vehicle",
    };
    const media = {
      mimeType: "image/jpeg",
      filename: "website-post-post_123.jpg",
      base64: "/9j/synthetic-one/2Q==",
    };
    const snapshotHash = website.publicationSourceSnapshotHash(
      post,
      draft,
      media,
      crypto,
    );
    const eventId = website.publicationEventIdForPostRevision(
      post.id,
      "2026-08-05 09:42:00.000Z",
      snapshotHash,
      crypto,
    );

    expect(eventId).toMatch(/^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/);
    expect(eventId).toHaveLength(78);
    expect(
      website.publicationEventRevisionMatches(
        eventId,
        post.id,
        "2026-08-05 09:42:00.000Z",
        crypto,
      ),
    ).toBe(true);
    expect(
      website.publicationEventRevisionMatches(
        eventId,
        post.id,
        "2026-08-05 09:43:00.000Z",
        crypto,
      ),
    ).toBe(false);
    expect(() =>
      website.verifyPublicationSourceSnapshot(
        postRecord({ event_id: eventId }),
        post,
        draft,
        media,
        crypto,
      ),
    ).not.toThrow();
    expect(() =>
      website.verifyPublicationSourceSnapshot(
        postRecord({ event_id: eventId }),
        post,
        draft,
        { ...media, base64: "/9j/synthetic-two/2Q==" },
        crypto,
      ),
    ).toThrow("payload_revision_conflict");
  });

  it("serializes competing final handoffs so one exact revision wins", () => {
    class MutableRecord {
      id = "";
      collectionName: string;
      values: Record<string, unknown>;

      constructor(collection: { name: string }, values: Record<string, unknown> = {}) {
        this.collectionName = collection.name;
        this.values = { ...values };
      }

      getString(field: string) {
        return (this.values[field] ?? "").toString();
      }

      getBool(field: string) {
        return Boolean(this.values[field]);
      }

      getInt(field: string) {
        return Number(this.values[field]) || 0;
      }

      set(field: string, value: unknown) {
        this.values[field] = value;
      }

      baseFilesPath() {
        return `posts/${this.id}`;
      }
    }

    const crypto = {
      sha256(value: string) {
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
      randomStringWithAlphabet(length: number) {
        return "r".repeat(length);
      },
    };
    const environment: Record<string, string> = {
      CUSTOMER_HUB_URL: "https://joegallant.example",
      CUSTOMER_HUB_SECRET: "s".repeat(48),
      CUSTOMER_HUB_DESTINATION_ID: "joe_customer_hub",
      CUSTOMER_HUB_DEALER_ID: "dealer_joe",
    };
    const installHarness = () => {
      const post = new MutableRecord(
        { name: "posts" },
        {
          dealer: "dealer_joe",
          scenario_id: "customer_delivery",
          customer_name: "",
          disclosures: "",
          approval_status: "n_a",
          release_required: false,
          creative_image: "final.jpg",
          website_draft: "",
          updated: "2026-08-05 09:42:00.000Z",
        },
      );
      post.id = "post_123";
      const dealer = new MutableRecord({ name: "dealers" }, { custom_scenarios: "[]" });
      dealer.id = "dealer_joe";
      const publications: MutableRecord[] = [];
      const transactions: string[][] = [];
      let activeOperations: string[] = [];

      const txDao = {
        db() {
          return {
            newQuery(sql: string) {
              return {
                bind() {
                  return this;
                },
                execute() {
                  if (sql.includes("UPDATE posts SET updated = updated")) {
                    activeOperations.push("write-fence");
                    return { rowsAffected: () => 1 };
                  }
                  throw new Error(`Unexpected query: ${sql}`);
                },
              };
            },
          };
        },
        findRecordById(collection: string, id: string) {
          if (collection === "posts" && id === post.id) {
            activeOperations.push("read-post");
            return post;
          }
          if (collection === "dealers" && id === dealer.id) return dealer;
          throw new Error("Record not found");
        },
        findRecordsByFilter(
          collection: string,
          _filter: string,
          _sort: string,
          _limit: number,
          _offset: number,
          params: Record<string, string>,
        ) {
          if (collection !== "website_publications") return [];
          activeOperations.push("read-publication");
          return publications.filter(
            (publication) =>
              publication.getString("post") === params.post &&
              (!params.destination ||
                publication.getString("destination_id") === params.destination),
          );
        },
        findCollectionByNameOrId(name: string) {
          return { name };
        },
        saveRecord(record: MutableRecord) {
          if (record.collectionName === "posts") {
            record.set("updated", "2026-08-05 09:42:01.000Z");
            return;
          }
          if (!record.id) record.id = `publication_${publications.length + 1}`;
          record.set("updated", "2026-08-05 09:42:01.000Z");
          if (!publications.includes(record)) publications.push(record);
        },
      };
      const rootDao = {
        runInTransaction(callback: (dao: typeof txDao) => void) {
          activeOperations = [];
          transactions.push(activeOperations);
          callback(txDao);
        },
      };
      let readerUsed = false;
      vi.stubGlobal("Record", MutableRecord);
      vi.stubGlobal("$security", crypto);
      vi.stubGlobal("$os", {
        getenv: (name: string) => environment[name] ?? "",
        tempDir: () => "/tmp",
        writeFile: () => undefined,
        truncate: () => undefined,
        readFile: () => new Uint8Array(3),
        remove: () => undefined,
      });
      vi.stubGlobal("$app", {
        dao: () => rootDao,
        newFilesystem: () => ({
          exists: () => true,
          getFile: () => {
            readerUsed = false;
            return {
              size: () => 3,
              contentType: () => "image/jpeg",
              read: (buffer: Uint8Array) => {
                if (readerUsed) return 0;
                readerUsed = true;
                buffer[0] = 1;
                buffer[1] = 2;
                buffer[2] = 3;
                return 3;
              },
              close: () => undefined,
            };
          },
          close: () => undefined,
        }),
      });
      return { post, publications, transactions };
    };

    const draftA = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      kind: "customer_story",
      category: "deliveries",
      title: "First winning draft",
      body: "The first exact website draft wins the serialized handoff.",
      altText: "Synthetic customer delivery test image",
    });
    const draftB = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      kind: "customer_story",
      category: "deliveries",
      title: "Competing draft",
      body: "A different concurrent website draft must not also succeed.",
      altText: "Different synthetic customer delivery test image",
    });
    const originalRevision = "2026-08-05 09:42:00.000Z";
    const state = installHarness();

    const winner = website.claimPublicationForPost(
      "post_123",
      draftA,
      originalRevision,
      "dealer_joe",
    );
    expect(winner.idempotentReplay).toBe(false);
    expect(state.publications).toHaveLength(1);
    expect(JSON.parse(state.post.getString("website_draft"))).toMatchObject({
      title: "First winning draft",
    });
    expect(state.publications[0].getString("event_id")).toMatch(
      /^wp_s_[a-f0-9]{32}_[a-f0-9]{40}$/,
    );

    expect(() =>
      website.claimPublicationForPost(
        "post_123",
        draftB,
        originalRevision,
        "dealer_joe",
      ),
    ).toThrow("website_draft_already_sent");
    expect(state.publications).toHaveLength(1);
    expect(JSON.parse(state.post.getString("website_draft"))).toMatchObject({
      title: "First winning draft",
    });

    const retry = website.claimPublicationForPost(
      "post_123",
      draftA,
      originalRevision,
      "dealer_joe",
    );
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.publication).toBe(winner.publication);
    expect(state.publications).toHaveLength(1);
    expect(() =>
      website.claimPublicationForPost(
        "post_123",
        draftA,
        "2026-08-05 09:42:00.500Z",
        "dealer_joe",
      ),
    ).toThrow("website_draft_already_sent");
    expect(
      state.transactions.every((operations) => operations[0] === "write-fence"),
    ).toBe(true);

    const stale = installHarness();
    expect(() =>
      website.claimPublicationForPost(
        "post_123",
        draftA,
        "2026-08-05 09:41:59.000Z",
        "dealer_joe",
      ),
    ).toThrow("website_post_revision_conflict");
    expect(stale.publications).toHaveLength(0);
    expect(stale.post.getString("website_draft")).toBe("");
  });

  it("accepts published or withdrawn only as authenticated replay outcomes", () => {
    const draftId = "draft_contract_1";
    const reviewUrl = "https://joegallant.example/studio/updates#draft_contract_1";
    expect(
      website.acceptedDestinationState(201, "draft", draftId, reviewUrl, false),
    ).toBe("draft_ready");
    expect(
      website.acceptedDestinationState(200, "published", draftId, reviewUrl, true),
    ).toBe("published");
    expect(website.acceptedDestinationState(200, "withdrawn", draftId, "", true)).toBe(
      "withdrawn",
    );
    expect(
      website.acceptedDestinationState(201, "published", draftId, reviewUrl, false),
    ).toBe("");
    expect(website.acceptedDestinationState(201, "withdrawn", draftId, "", false)).toBe(
      "",
    );
    expect(website.acceptedDestinationState(409, "withdrawn", draftId, "", true)).toBe(
      "",
    );
  });

  it("binds every status replay to the exact acknowledged Hub draft", () => {
    expect(
      website.statusReplayResponseIsBound(
        true,
        true,
        "draft_contract_1",
        "draft_contract_1",
      ),
    ).toBe(true);
    expect(
      website.statusReplayResponseIsBound(
        true,
        false,
        "draft_contract_1",
        "draft_contract_1",
      ),
    ).toBe(false);
    expect(
      website.statusReplayResponseIsBound(
        true,
        true,
        "different_draft",
        "draft_contract_1",
      ),
    ).toBe(false);
    expect(
      website.statusReplayResponseIsBound(false, false, "first_delivery_draft", ""),
    ).toBe(true);
  });

  it("encodes binary media without UTF-8 corruption", () => {
    const bytes = [0, 255, 128, 65, 194, 169, 1, 2, 3, 4];
    expect(website.base64EncodeBytes(bytes)).toBe(
      Buffer.from(bytes).toString("base64"),
    );
  });

  it("redacts protected full names, never derives a VIN, and keeps disclosures separate", () => {
    const post = postRecord({
      scenario_id: "customer_delivery",
      customer_name: "Mary Jane Smith",
      disclosures: "Final sale terms are available from the dealership.",
    });
    const content = website.buildOutboundContent(
      post,
      {
        kind: "customer_story",
        category: "deliveries",
        title: "Congratulations, Mary Jane Smith!",
        body: "Mary Jane Smith and the Smith family picked up a wonderful vehicle.",
        altText: "Mary Jane Smith standing next to the vehicle",
        customerDisplayName: "Mary Jane Smith",
        vehicleDescription: "",
        privacyFlags: ["faces_visible", "license_plate_visible"],
      },
      { mimeType: "image/jpeg", filename: "website-post-post_123.jpg", base64: "AA==" },
    );

    expect(content).toMatchObject({
      customerDisplayName: "Mary S.",
      vehicleDescription: "the vehicle they chose",
      disclosures: "Final sale terms are available from the dealership.",
      privacyFlags: ["faces_visible", "license_plate_visible"],
    });
    expect(JSON.stringify(content)).not.toContain("Mary Jane Smith");
    expect(content.body).toBe(
      "Mary S. and Mary S.'s family picked up a wonderful vehicle.",
    );
    expect(content).not.toHaveProperty("vin");
  });

  it("does not invent a vehicle for a customer testimonial", () => {
    const post = postRecord({
      scenario_id: "customer_testimonial",
      customer_name: "Alex Morgan",
      disclosures: "",
    });
    const content = website.buildOutboundContent(
      post,
      {
        kind: "customer_story",
        category: "deliveries",
        title: "What Alex M. had to say",
        body: "Alex M. shared a thoughtful note about the dealership experience.",
        altText: "Customer testimonial shared with the dealership",
        customerDisplayName: "Alex M.",
        vehicleDescription: "",
      },
      { mimeType: "image/jpeg", filename: "testimonial.jpg", base64: "AA==" },
    );

    expect(content.vehicleDescription).toBe("Customer experience");
  });

  it("neutralizes every protected non-first name token, including possessives", () => {
    expect(
      website.replaceProtectedCustomerName(
        "Congratulations to Smith on the new SUV. Smith’s new SUV is ready.",
        "Jordan Smith",
      ),
    ).toBe(
      "Congratulations to the customer on the new SUV. the customer's new SUV is ready.",
    );
    expect(
      website.replaceProtectedCustomerName(
        "Michael and Smith joined Jordan Michael Smith for delivery.",
        "Jordan Michael Smith",
      ),
    ).toBe("the customer and the customer joined Jordan S. for delivery.");
  });

  it("preserves automotive makes that match a surname without exposing the customer", () => {
    expect(
      website.replaceProtectedCustomerName(
        "Jane Ford chose a 2025 Ford Explorer. The Ford family loves Ford’s new SUV.",
        "Jane Ford",
      ),
    ).toBe(
      "Jane F. chose a 2025 Ford Explorer. Jane F.'s family loves the customer's new SUV.",
    );

    const content = website.buildOutboundContent(
      postRecord({
        scenario_id: "customer_delivery",
        customer_name: "Jane Ford",
        disclosures: "Bob Maxey Ford makes no guarantee of vehicle availability.",
      }),
      {
        kind: "customer_story",
        category: "deliveries",
        title: "A special delivery day",
        body: "Jane Ford is ready for a new chapter.",
        altText: "Customer standing beside a Ford Explorer",
        customerDisplayName: "Jane Ford",
        vehicleDescription: "2025 Ford Explorer",
      },
      { mimeType: "image/jpeg", filename: "ford-delivery.jpg", base64: "AA==" },
    );

    expect(content.vehicleDescription).toBe("2025 Ford Explorer");
    expect(content.disclosures).toBe(
      "Bob Maxey Ford makes no guarantee of vehicle availability.",
    );
    expect(JSON.stringify(content)).not.toContain("Jane Ford");
  });

  it("fails closed when verbatim server disclosures contain a protected family name", () => {
    const post = postRecord({
      scenario_id: "customer_delivery",
      customer_name: "Jane Smith",
      disclosures: "The Smith family accepted the final terms.",
    });
    expect(() =>
      website.buildOutboundContent(
        post,
        {
          kind: "customer_story",
          category: "deliveries",
          title: "A special delivery day",
          body: "Jane Smith chose a wonderful new vehicle.",
          altText: "Jane Smith beside the vehicle",
          customerDisplayName: "Jane Smith",
          vehicleDescription: "the vehicle they chose",
        },
        {
          mimeType: "image/jpeg",
          filename: "website-post-post_123.jpg",
          base64: "AA==",
        },
      ),
    ).toThrow("private_identifier_in_website_copy");
  });

  it("fails closed when verbatim server disclosures contain financial identity data", () => {
    const post = postRecord({
      scenario_id: "new_arrival",
      customer_name: "",
      disclosures: "Internal routing number must be confirmed before sharing.",
    });
    expect(() =>
      website.buildOutboundContent(
        post,
        {
          kind: "site_update",
          category: "inventory",
          title: "A fresh arrival",
          body: "A newly arrived vehicle is ready for a closer look.",
          altText: "Vehicle parked outside the showroom",
        },
        {
          mimeType: "image/jpeg",
          filename: "website-post-post_123.jpg",
          base64: "AA==",
        },
      ),
    ).toThrow("private_contact_in_website_copy");
  });

  it("predicts contact-data and VIN privacy rejections before delivery", () => {
    expect(website.containsVinLike("VIN 1FTFW1E50PFA12345")).toBe(true);
    expect(website.containsSensitiveContactText("joe@example.com")).toBe(true);
    expect(website.containsSensitiveContactText("https://example.com/customer")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("joegallant.me/private-offer")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("customer-preview.app/draft")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("inventory-tools.dev")).toBe(true);
    expect(website.containsSensitiveContactText("sales-assistant.ai/private")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("Call (517) 555-1212")).toBe(true);
    expect(website.containsSensitiveContactText("Call 5175551212")).toBe(true);
    expect(website.containsSensitiveContactText("Call 15175551212")).toBe(true);
    expect(website.containsSensitiveContactText("SSN 123-45-6789")).toBe(true);
    expect(website.containsSensitiveContactText("Bank account details enclosed")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("Routing number on file")).toBe(true);
    expect(website.containsSensitiveContactText("Credit card details")).toBe(true);
    expect(website.containsSensitiveContactText("Driver's license image")).toBe(true);
    expect(website.containsSensitiveContactText("Release signature attached")).toBe(
      true,
    );
    expect(website.containsSensitiveContactText("123 Main Street")).toBe(true);
    expect(website.containsSensitiveContactText("42 Oak Parkway")).toBe(true);
    expect(website.containsSensitiveContactText("7 Lake View Terrace")).toBe(true);
    expect(website.containsSensitiveContactText("A great delivery day")).toBe(false);
  });

  it("persists an immutable outbox lease, retry, and crash-recovery contract", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const worker = readFileSync(
      resolve(process.cwd(), "pb_hooks/websitePublications.js"),
      "utf8",
    );
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751000000_website_publication_outbox.js"),
      "utf8",
    );

    expect(hook).toContain('"/api/app/website-destinations"');
    expect(hook).toContain('"/api/app/posts/:id/website-publication/retry"');
    expect(hook).toContain("websiteDraftMatchesScenario");
    expect(hook).toContain('code: "WEBSITE_MAPPING_CONFLICT"');
    const createRoute = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/posts"'),
      hook.indexOf('routerAdd("PATCH", "/api/app/posts/:id/draft"'),
    );
    expect(createRoute).not.toContain("createPublicationForPost(record)");
    const explicitHandoffRoute = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/website-publication"'),
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/website-publication/retry"'),
    );
    expect(explicitHandoffRoute).toContain("body.website_draft");
    expect(explicitHandoffRoute).toContain("body.expected_post_revision");
    expect(explicitHandoffRoute).toContain("claimPublicationForPost(");
    expect(explicitHandoffRoute).toContain("summary.websiteDraft = storedDraft.value");
    expect(explicitHandoffRoute).toContain("WEBSITE_POST_REVISION_CONFLICT");
    expect(explicitHandoffRoute).toContain("WEBSITE_DRAFT_ALREADY_SENT");
    const publicationStatusRoute = hook.slice(
      hook.indexOf('routerAdd("GET", "/api/app/posts/:id/website-publication"'),
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/website-publication"'),
    );
    expect(publicationStatusRoute).toContain(
      "summary.websiteDraft = storedDraft.value",
    );
    const publicationRetryRoute = hook.slice(
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/website-publication/retry"'),
      hook.indexOf('cronAdd("deliver-private-website-drafts"'),
    );
    expect(publicationRetryRoute).toContain("summary.websiteDraft = storedDraft.value");
    expect(publicationRetryRoute).toContain(
      'c.response().header().set("Cache-Control", "private, no-store")',
    );
    const editableDraftRoute = hook.slice(
      hook.indexOf('routerAdd("PATCH", "/api/app/posts/:id/draft"'),
      hook.indexOf('routerAdd("POST", "/api/app/posts/:id/video-generated"'),
    );
    expect(editableDraftRoute).toContain("runInTransaction");
    expect(editableDraftRoute).toContain(
      "UPDATE posts SET updated = updated WHERE id = {:post}",
    );
    expect(editableDraftRoute).toContain("findPublicationForPostWithDaoStrict");
    expect(editableDraftRoute).toContain("post_revision:");
    expect(hook).toContain('const storedPlatformIdsRaw = r.getString("platform_ids")');
    expect(hook).toContain(
      "platform_ids: storedPlatformIdsRaw.trim() ? platformIds : undefined",
    );
    expect(hook).toContain('cronAdd("deliver-private-website-drafts", "* * * * *"');
    expect(worker).toContain("payload_sent_at");
    expect(worker).toContain('status: "not_requested"');
    expect(worker).toContain("claimPublicationForPost");
    expect(worker).toContain("acquirePostWriteFence(txDao, postId)");
    expect(worker).toContain("publicationSourceSnapshotHash");
    expect(worker).toContain("verifyPublicationSourceSnapshot");
    expect(worker).toContain(
      'if (!publication) throw new Error("website_request_not_sent")',
    );
    expect(worker).not.toContain(
      "if (!publication) return createPublicationForPost(post)",
    );
    expect(worker).toContain("payload_revision_conflict");
    expect(worker).toContain('publication.set("payload_hash", bodyHash)');
    expect(worker).toContain("status = 'delivering'");
    expect(worker).toContain("WHEN status IN ('queued', 'retrying')");
    expect(worker).toContain("THEN MIN(COALESCE(attempts, 0) + 1, 8)");
    expect(worker).toContain("status IN ('queued', 'retrying', 'draft_ready')");
    expect(worker).toContain("WEBSITE_STATUS_REFRESH_MS");
    expect(worker).toContain("status = 'draft_ready'");
    expect(worker).toContain('hasRemoteDraft ? "draft_ready" : "retrying"');
    expect(worker).toContain("if (!isStatusReplay)");
    expect(worker).toContain("suspendStatusReplay");
    expect(worker).toContain("next_attempt_at != '' && next_attempt_at <= {:now}");
    expect(worker).toContain("recoverStaleDeliveries");
    expect(worker).toContain('if (currentStatus === "withdrawn")');
    expect(worker).toContain("Math.min(Math.max(limit || 10, 1), 25)");
    expect(migration).toContain("idx_website_publications_revision");
    expect(migration).toContain("idx_website_publications_due");
    expect(migration).toContain("listRule: null");
  });
});
