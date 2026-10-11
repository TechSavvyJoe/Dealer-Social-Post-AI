import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

function load(file: string, require = (_: string): any => ({})) {
  const module = { exports: {} as any };
  new Function("module", "exports", "require", "__hooks", readFileSync(file, "utf8"))(
    module,
    module.exports,
    require,
    "pb_hooks",
  );
  return module.exports;
}
const adapter = load("pb_hooks/omniVideo.js");
const policies = load("pb_hooks/requestPolicies.js");
const actualHelpers = load("pb_hooks/helpers.js", () => adapter);
const source = readFileSync("pb_hooks/main.pb.js", "utf8");
const handlerSource = source.slice(
  source.indexOf("const proxyHandler = (c) => {"),
  source.indexOf("// IMPORTANT: register"),
);
const name = "operations/omni-" + "A".repeat(32);
const input = (resolution = "720p") => ({
  instances: [
    {
      prompt: "Synthetic dealership vehicle",
      image: { mimeType: "image/jpeg", bytesBase64Encoded: "aGVsbG8=" },
    },
  ],
  parameters: {
    aspectRatio: "16:9",
    personGeneration: "allow_adult",
    durationSeconds: 8,
    resolution,
  },
});

function harness(
  options: {
    alias?: string;
    task?: string;
    resolution?: string;
    poll?: string;
    owns?: boolean;
    mapping?: boolean;
    response?: any;
    raw?: string;
    status?: number;
    queueFails?: boolean;
    claimFails?: boolean;
  } = {},
) {
  const headers = new Map();
  const events: string[] = [];
  const helpers = {
    dealerFromSession: () => ({ id: "dealer-a" }),
    checkProxyRateLimit: () => ({ ok: true }),
    acquireProxyConcurrency: () => ({ ok: true, release: vi.fn() }),
    proxyPolicyVersionMismatch: () => ({ mismatch: false }),
    upstreamContentLength: actualHelpers.upstreamContentLength,
    providerResponseByteLength: actualHelpers.providerResponseByteLength,
    safeProviderTransportDiagnostic: actualHelpers.safeProviderTransportDiagnostic,
    omniKeyFingerprint: () => "a".repeat(64),
    proxyGenerationIdentity: actualHelpers.proxyGenerationIdentity,
    secureRandomString: (size: number) => "A".repeat(size),
    dealerOwnsProviderResource: vi.fn(() => options.owns !== false),
    findOmniInteraction: vi.fn(() =>
      options.mapping === false ? null : { getString: () => "opaque/provider?PRIVATE" },
    ),
    saveOmniInteraction: vi.fn(() => {
      events.push("save");
      if (options.queueFails) throw new Error("PRIVATE");
    }),
    claimProviderResources: vi.fn(() => {
      events.push("claim");
      if (options.claimFails) throw new Error("PRIVATE");
    }),
    cleanupOmniProviderInteraction: vi.fn(() => true),
    recordProxyGenerationEvent: vi.fn((..._args: any[]) => {}),
  };
  const payload = options.response ?? {
    id: "opaque/provider?PRIVATE",
    status: "in_progress",
    steps: [{ private: "PRIVATE" }],
  };
  const upstream = vi.fn((_request: any) => {
    events.push("dispatch");
    return {
      statusCode: options.status ?? 200,
      raw: options.raw ?? JSON.stringify(payload),
      json: options.raw ? undefined : payload,
      headers: { "content-type": "application/json" },
    };
  });
  const proxy = new Function(
    "require",
    "$os",
    "$apis",
    "$http",
    "__hooks",
    `${handlerSource}; return proxyHandler;`,
  )(
    (path: string) =>
      path.endsWith("helpers.js")
        ? helpers
        : path.endsWith("requestPolicies.js")
          ? policies
          : path.endsWith("omniVideo.js")
            ? adapter
            : { runtimeValue: () => "synthetic-server-key" },
    { getenv: () => "" },
    {
      requestInfo: () => ({
        method: options.poll ? "GET" : "POST",
        data: input(options.resolution),
        headers: options.task ? { "x-generation-task": options.task } : {},
        query: { key: "CLIENT_SECRET", arbitrary: "ignored-for-omni" },
      }),
    },
    { send: upstream },
    "pb_hooks",
  );
  const context = {
    pathParam: () =>
      options.poll
        ? `v1beta/${options.poll}`
        : `v1beta/models/${options.alias || adapter.MODEL}:predictLongRunning`,
    response: () => ({
      header: () => ({ set: (k: string, v: string) => headers.set(k, v) }),
    }),
    json: (status: number, body: any) => ({ status, body }),
    string: (status: number, body: any) => ({ status, body }),
  };
  return { run: () => proxy(context), upstream, helpers, events, headers };
}

afterEach(() => vi.restoreAllMocks());

describe("Omni backend compatibility boundary", () => {
  it.each([
    "veo-3.1-fast-generate-preview",
    "veo-3.1-generate-preview",
    "veo-3.1-lite-generate-preview",
    "gemini-omni-1.1-flash",
  ])(
    "translates %s once, saves mapping then claim, and audits the actual model",
    (alias) => {
      const h = harness({
        alias,
        resolution: alias === "veo-3.1-generate-preview" ? "1080p" : "720p",
      });
      const result = h.run();
      expect(result).toEqual({ status: 200, body: { name, done: false } });
      expect(h.events).toEqual(["dispatch", "save", "claim"]);
      expect(h.upstream).toHaveBeenCalledTimes(1);
      const call = h.upstream.mock.calls[0] as any;
      expect(call[0]).toMatchObject({
        url: "https://generativelanguage.googleapis.com/v1beta/interactions",
        method: "POST",
        timeout: 80,
        headers: { "x-goog-api-key": "synthetic-server-key" },
      });
      expect(JSON.parse(call[0].body)).toMatchObject({
        model: adapter.MODEL,
        background: true,
        store: true,
        stream: false,
        response_format: { duration: "8s", delivery: "inline" },
      });
      expect(h.helpers.recordProxyGenerationEvent.mock.calls[0][6]).toBe(adapter.MODEL);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    },
  );
  it.each([
    ["video_standard", "720p"],
    ["video_quality", "1080p"],
  ])("validates shared-model %s by task", (task, resolution) => {
    expect(harness({ task, resolution }).run().status).toBe(200);
    const rejected = harness({
      task,
      resolution: resolution === "720p" ? "1080p" : "720p",
    });
    expect(rejected.run().status).toBe(400);
    expect(rejected.upstream).not.toHaveBeenCalled();
  });
  it("denies a foreign dealer before private lookup or provider contact", () => {
    const h = harness({ poll: name, owns: false });
    expect(h.run().status).toBe(403);
    expect(h.helpers.findOmniInteraction).not.toHaveBeenCalled();
    expect(h.upstream).not.toHaveBeenCalled();
  });
  it("denies expired/missing mappings without provider contact", () => {
    const h = harness({ poll: name, mapping: false });
    expect(h.run().status).toBe(403);
    expect(h.upstream).not.toHaveBeenCalled();
  });
  it("polls the encoded opaque ID with a short deadline and returns only projected fields", () => {
    const h = harness({ poll: name });
    expect(h.run()).toEqual({ status: 200, body: { name, done: false } });
    expect(h.upstream.mock.calls[0][0]).toMatchObject({
      method: "GET",
      timeout: 30,
      url: "https://generativelanguage.googleapis.com/v1beta/interactions/opaque%2Fprovider%3FPRIVATE",
      body: "",
    });
  });
  it("preserves actual legacy Veo operation polls", () => {
    const response = {
      name: "models/veo-3.1-generate-preview/operations/old",
      done: false,
    };
    const h = harness({ poll: response.name, response });
    expect(h.run()).toEqual({ status: 200, body: JSON.stringify(response) });
    expect(h.upstream.mock.calls[0][0].url).toContain(
      "models/veo-3.1-generate-preview/operations/old",
    );
    expect(h.helpers.findOmniInteraction).not.toHaveBeenCalled();
  });
  it.each([404, 400, 503])(
    "redacts upstream %s and cannot trigger a legacy fallback",
    (status) => {
      const h = harness({
        status,
        response: {
          error: { message: "Invalid or unsupported generation request PRIVATE" },
        },
      });
      expect(h.run()).toEqual({
        status: 502,
        body: { error: "Video provider request did not complete" },
      });
      expect(h.upstream).toHaveBeenCalledTimes(1);
      expect(h.helpers.saveOmniInteraction).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed starts and never exposes raw upstream body", () => {
    const h = harness({ raw: "<html>PRIVATE</html>" });
    expect(h.run()).toEqual({
      status: 502,
      body: { error: "Video provider response could not be read" },
    });
    const badId = harness({ response: { id: "PRIVATE\nBAD", status: "in_progress" } });
    expect(badId.run().status).toBe(502);
    expect(badId.helpers.saveOmniInteraction).not.toHaveBeenCalled();
  });
  it("persists received IDs before rejecting oversized payloads", () => {
    const h = harness({
      response: {
        id: "opaque/provider?PRIVATE",
        status: "completed",
        PRIVATE: "A".repeat(30 * 1024 * 1024),
      },
    });
    expect(h.run().status).toBe(413);
    expect(h.events).toEqual(["dispatch", "save"]);
    expect(h.helpers.claimProviderResources).not.toHaveBeenCalled();
  });
  it("keeps durable cleanup when ownership fails", () => {
    const h = harness({ claimFails: true });
    expect(h.run()).toEqual({
      status: 502,
      body: { error: "Could not secure video operation" },
    });
    expect(h.events).toEqual(["dispatch", "save", "claim"]);
    expect(h.helpers.cleanupOmniProviderInteraction).not.toHaveBeenCalled();
    expect(h.helpers.recordProxyGenerationEvent.mock.calls[0][4]).toBe(502);
  });
  it("attempts cleanup after queue-save failure without a paid replay", () => {
    const h = harness({ queueFails: true });
    expect(h.run().status).toBe(502);
    expect(h.helpers.cleanupOmniProviderInteraction).toHaveBeenCalledWith(
      "opaque/provider?PRIVATE",
      expect.anything(),
    );
    expect(h.helpers.claimProviderResources).not.toHaveBeenCalled();
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });
  it("projects arbitrary provider errors to static legacy errors", () => {
    const h = harness({
      poll: name,
      response: {
        id: "PRIVATE",
        status: "failed",
        error: { message: "PRIVATE", prompt: "PRIVATE" },
        steps: [{ text: "PRIVATE" }],
      },
    });
    const result = h.run();
    expect(result.status).toBe(200);
    expect(result.body.done).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

const runtime = globalThis as any;
const previousRuntime = {
  $app: runtime.$app,
  $http: runtime.$http,
  Record: runtime.Record,
  $security: runtime.$security,
};
afterEach(() => Object.assign(runtime, previousRuntime));
function recoveryHarness(responses: any[]) {
  const rows: any[] = [];
  runtime.$security = {
    sha256: (text: string) => createHash("sha256").update(text).digest("hex"),
  };
  runtime.Record = class {
    values: any;
    constructor(_collection: any, values: any) {
      this.values = { ...values };
    }
    getString(key: string) {
      return this.values[key] || "";
    }
    getInt(key: string) {
      return this.values[key] || 0;
    }
    set(key: string, value: any) {
      this.values[key] = value;
    }
  };
  const dao = {
    findCollectionByNameOrId: () => ({}),
    saveRecord: vi.fn((record: any) => {
      if (!rows.includes(record)) rows.push(record);
    }),
    deleteRecord: vi.fn((record: any) => rows.splice(rows.indexOf(record), 1)),
    findFirstRecordByFilter: (_table: any, _filter: any, params: any) =>
      rows.find((row) => row.values.operation_name === params.name),
    findRecordsByFilter: vi.fn(() =>
      rows.filter(
        (row) =>
          row.values.cleanup_after <=
          actualHelpers.databaseTimestamp(new Date().toISOString()),
      ),
    ),
  };
  runtime.$app = { dao: () => dao };
  const send = vi.fn((_request: any) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  runtime.$http = { send };
  return { rows, dao, send };
}
const transport = {
  baseUrl: "https://generativelanguage.googleapis.com/",
  apiKey: "synthetic-server-key",
  keyFingerprint: createHash("sha256").update("synthetic-server-key").digest("hex"),
};
const statusResponse = (status: string, statusCode = 200) => ({
  statusCode,
  json: { status },
});

describe("durable private Omni recovery", () => {
  it("stores only opaque identities and bounded scheduling metadata for 24 hours", () => {
    const h = recoveryHarness([]);
    const before = Date.now();
    const record = actualHelpers.saveOmniInteraction(
      name,
      "opaque/provider",
      transport.apiKey,
    );
    expect(Object.keys(record.values).sort()).toEqual(
      [
        "operation_name",
        "provider_id",
        "key_fingerprint",
        "expires_at",
        "cleanup_after",
        "cleanup_attempts",
      ].sort(),
    );
    expect(Date.parse(record.values.expires_at)).toBeGreaterThanOrEqual(
      before + 24 * 60 * 60 * 1000,
    );
    expect(actualHelpers.findOmniInteraction(name)).toBe(record);
    record.set("expires_at", "2000-01-01 00:00:00.000Z");
    expect(actualHelpers.findOmniInteraction(name)).toBeNull();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(1); // expiration denies reads but retains cleanup
  });
  it("cancels a running interaction, reconciles terminal status, then deletes", () => {
    const h = recoveryHarness([
      statusResponse("in_progress"),
      statusResponse("cancelled"),
      statusResponse("cancelled"),
      { statusCode: 200 },
    ]);
    expect(
      actualHelpers.cleanupOmniProviderInteraction("opaque/provider", transport),
    ).toBe(true);
    expect(h.send.mock.calls.map(([request]) => [request.method, request.url])).toEqual(
      [
        ["GET", transport.baseUrl + "v1beta/interactions/opaque%2Fprovider"],
        ["POST", transport.baseUrl + "v1beta/interactions/opaque%2Fprovider/cancel"],
        ["GET", transport.baseUrl + "v1beta/interactions/opaque%2Fprovider"],
        ["DELETE", transport.baseUrl + "v1beta/interactions/opaque%2Fprovider"],
      ],
    );
  });
  it("retains a retry record through transport/provider/delete failure and removes it after delete404", () => {
    const h = recoveryHarness([new Error("PRIVATE")]);
    const row = actualHelpers.saveOmniInteraction(name, "opaque", transport.apiKey);
    row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    expect(actualHelpers.pruneOmniInteractions(transport)).toEqual({
      deleted: 0,
      retried: 1,
    });
    expect(h.rows).toHaveLength(1);
    expect(row.values.cleanup_attempts).toBe(1);
    expect(Date.parse(row.values.cleanup_after)).toBeGreaterThan(Date.now());
    row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    h.send.mockImplementationOnce(() => statusResponse("completed"));
    h.send.mockImplementationOnce(() => ({ statusCode: 503 }));
    expect(actualHelpers.pruneOmniInteractions(transport).retried).toBe(1);
    expect(h.rows).toHaveLength(1);
    row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    h.send.mockImplementationOnce(() => statusResponse("completed"));
    h.send.mockImplementationOnce(() => ({ statusCode: 404 }));
    expect(actualHelpers.pruneOmniInteractions(transport)).toEqual({
      deleted: 1,
      retried: 0,
    });
    expect(h.rows).toHaveLength(0);
  });
  it("never deletes while cancellation has not settled", () => {
    const h = recoveryHarness([
      statusResponse("queued"),
      statusResponse("in_progress"),
      statusResponse("in_progress"),
    ]);
    expect(actualHelpers.cleanupOmniProviderInteraction("opaque", transport)).toBe(
      false,
    );
    expect(h.send.mock.calls.some(([request]) => request.method === "DELETE")).toBe(
      false,
    );
  });
  it.each(["incomplete", "budget_exceeded", "requires_action"])(
    "deletes terminal %s without cancellation",
    (state) => {
      const h = recoveryHarness([statusResponse(state), { statusCode: 200 }]);
      expect(actualHelpers.cleanupOmniProviderInteraction("opaque", transport)).toBe(
        true,
      );
      expect(h.send.mock.calls.map(([request]) => request.method)).toEqual([
        "GET",
        "DELETE",
      ]);
    },
  );
  it("keeps recovery rows when a rotated key cannot see the old interaction", () => {
    const h = recoveryHarness([{ statusCode: 404 }]);
    const row = actualHelpers.saveOmniInteraction(name, "opaque", transport.apiKey);
    row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    expect(
      actualHelpers.pruneOmniInteractions({
        ...transport,
        apiKey: "different-project-key",
      }),
    ).toEqual({ deleted: 0, retried: 1 });
    expect(h.rows).toHaveLength(1);
    expect(row.values.key_fingerprint).toBe(transport.keyFingerprint);
    row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    h.send.mockImplementationOnce(() => ({ statusCode: 404 }));
    expect(actualHelpers.pruneOmniInteractions(transport).deleted).toBe(1);
    expect(h.rows).toHaveLength(0);
  });
  it("caps cleanup to ninety seconds with individually bounded requests", () => {
    const h = recoveryHarness([]);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let i = 0; i < 20; i++) {
      const row = actualHelpers.saveOmniInteraction(
        "operations/omni-" + String(i).padStart(32, "A"),
        "opaque" + i,
        transport.apiKey,
      );
      row.set("cleanup_after", "2000-01-01 00:00:00.000Z");
    }
    h.send.mockImplementation((request) => {
      expect(request.timeout).toBeLessThanOrEqual(10);
      now += request.timeout * 1000;
      return request.method === "GET"
        ? statusResponse("completed")
        : { statusCode: 200 };
    });
    const start = now;
    actualHelpers.pruneOmniInteractions(transport);
    expect(now - start).toBeLessThanOrEqual(90_000);
    expect(h.send.mock.calls.length).toBeLessThanOrEqual(9);
    expect(h.rows.length).toBeGreaterThan(0);
  });
  it("refuses to down-migrate a pending recovery queue", () => {
    let down: any;
    const migration = readFileSync(
      "pb_migrations/1791660000_omni_interactions.js",
      "utf8",
    );
    const deleteCollection = vi.fn();
    let records: any[] = [{}];
    new Function("migrate", "Dao", "Collection", migration)(
      (_up: any, rollback: any) => {
        down = rollback;
      },
      class {
        findRecordsByFilter() {
          return records;
        }
        findCollectionByNameOrId() {
          return {};
        }
        deleteCollection = deleteCollection;
      },
      class {},
    );
    expect(() => down({})).toThrow("Cannot remove pending video recovery state");
    expect(deleteCollection).not.toHaveBeenCalled();
    records = [];
    down({});
    expect(deleteCollection).toHaveBeenCalledOnce();
  });
  it("locks mapping access and has no cascade or media fields", () => {
    let collection: any;
    const migration = readFileSync(
      "pb_migrations/1791660000_omni_interactions.js",
      "utf8",
    );
    new Function("migrate", "Dao", "Collection", migration)(
      (up: any) => up({}),
      class {
        saveCollection(c: any) {
          collection = c;
        }
      },
      class {
        constructor(data: any) {
          Object.assign(this, data);
        }
      },
    );
    expect(collection.schema.map((field: any) => field.name)).toEqual([
      "operation_name",
      "provider_id",
      "key_fingerprint",
      "expires_at",
      "cleanup_after",
      "cleanup_attempts",
    ]);
    expect(collection.schema.every((field: any) => field.type !== "relation")).toBe(
      true,
    );
    for (const rule of [
      "listRule",
      "viewRule",
      "createRule",
      "updateRule",
      "deleteRule",
    ])
      expect(collection[rule]).toBeNull();
  });
});
