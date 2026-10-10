import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const module = { exports: {} as Record<string, (...args: any[]) => any> };
new Function("module", "exports", readFileSync("pb_hooks/helpers.js", "utf8"))(
  module,
  module.exports,
);
const actual = module.exports;
const source = readFileSync("pb_hooks/main.pb.js", "utf8");
const proxySource = source.slice(
  source.indexOf("const proxyHandler = (c) => {"),
  source.indexOf("// IMPORTANT: register"),
);

function harness(
  raw: string,
  options: {
    operation?: boolean;
    claimFails?: boolean;
    dealer?: boolean;
    path?: string;
    method?: string;
  } = {},
) {
  const headers = new Map<string, string>();
  const audit = vi.fn();
  const claim = vi.fn(() => {
    if (options.claimFails) throw new Error("database is locked: PRIVATE");
  });
  const helpers = {
    dealerFromSession: () => (options.dealer === false ? null : { id: "dealer-1" }),
    checkProxyRateLimit: () => ({ ok: true }),
    acquireProxyConcurrency: () => ({ ok: true, release: vi.fn() }),
    proxyPolicyVersionMismatch: () => ({ mismatch: false }),
    upstreamContentLength: () => null,
    providerResponseByteLength: actual.providerResponseByteLength,
    safeProviderTransportDiagnostic: actual.safeProviderTransportDiagnostic,
    secureRandomString: () => "0123456789abcdef",
    recordProxyGenerationEvent: audit,
    claimProviderResources: claim,
    logCoalescedAuthEvent: vi.fn(),
    clientIP: () => "",
    userAgent: () => "",
  };
  const policies = {
    isAllowedProxyRequest: () => true,
    providerOperationStartProvider: () => (options.operation ? "gemini" : null),
    providerResourceRequest: () => null,
    buildGeminiProxyRequest: () => ({ contents: [] }),
    proxyCostPolicy: () => null,
    providerResourcesFromResponse: () => [
      { resource_type: "operation", resource_name: "operations/synthetic" },
    ],
  };
  const upstream = vi.fn(() => ({
    raw,
    json: JSON.parse(raw),
    statusCode: 200,
    headers: {
      "content-type": ["application/json"],
      "set-cookie": ["PRIVATE"],
      "content-length": ["999"],
    },
  }));
  const proxy = new Function(
    "require",
    "$os",
    "$apis",
    "$http",
    "__hooks",
    `${proxySource}; return proxyHandler;`,
  )(
    (path: string) =>
      path.endsWith("helpers.js")
        ? helpers
        : path.endsWith("requestPolicies.js")
          ? policies
          : { runtimeValue: () => "synthetic-server-key" },
    { getenv: () => "" },
    {
      requestInfo: () => ({ method: options.method || "POST", data: {}, headers: {} }),
    },
    { send: upstream },
    "pb_hooks",
  );
  const c = {
    pathParam: () => options.path || "v1beta/models/gemini-test:generateContent",
    response: () => ({
      header: () => ({
        set: (name: string, value: string) => headers.set(name, value),
      }),
    }),
    json: vi.fn((status, body) => ({ status, body })),
    string: vi.fn((status, body) => ({ status, body })),
  };
  return { proxy: () => proxy(c), c, headers, audit, claim, upstream };
}

afterEach(() => vi.restoreAllMocks());

describe("validated Gemini response forwarding", () => {
  it.each([
    ["v1beta/models/gemini-test:generateContent", "POST", 100],
    ["v1beta/models/veo-test:predictLongRunning", "POST", 300],
    ["v1beta/operations/synthetic", "GET", 300],
    ["v1beta/files/synthetic:download", "GET", 300],
  ])("bounds %s upstream work to %s request budget", (path, method, timeout) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const h = harness("{}", { path: String(path), method: String(method) });
    h.proxy();
    expect(h.upstream).toHaveBeenCalledWith(expect.objectContaining({ timeout }));
  });

  it("preserves the exact JSON bytes after auditing and excludes provider cookies/length", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const raw =
      '{ "candidates": [{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"AAAA"}}]}}], "usageMetadata": {"promptTokenCount": 7} }';
    const h = harness(raw);
    expect(h.proxy()).toEqual({ status: 200, body: raw });
    expect(h.c.string).toHaveBeenCalledWith(200, raw);
    expect(h.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "dealer-1" }),
      expect.anything(),
      expect.anything(),
      200,
      "gemini",
      "",
      JSON.parse(raw),
      expect.anything(),
    );
    expect(h.audit.mock.invocationCallOrder[0]).toBeLessThan(
      h.c.string.mock.invocationCallOrder[0],
    );
    expect(h.headers.get("Content-Type")).toBe("application/json");
    expect(h.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.headers.has("Set-Cookie")).toBe(false);
    expect(h.headers.has("Content-Length")).toBe(false);
  });

  it("rejects an oversized body even when upstream omitted its length", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const h = harness(JSON.stringify({ data: "A".repeat(30 * 1024 * 1024) }));
    expect(h.proxy()).toEqual({
      status: 413,
      body: { error: "Provider response is too large" },
    });
    expect(h.c.string).not.toHaveBeenCalled();
  });

  it("does not expose an operation when its ownership claim fails", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness('{"name":"operations/synthetic"}', {
      operation: true,
      claimFails: true,
    });
    expect(h.proxy()).toEqual({
      status: 502,
      body: { error: "Could not secure provider resource" },
    });
    expect(h.c.string).not.toHaveBeenCalled();
  });

  it("still requires an authoritative session before contacting the provider", () => {
    const h = harness("{}", { dealer: false });
    expect(h.proxy()).toEqual({
      status: 401,
      body: { error: "Unauthorized proxy request" },
    });
    expect(h.upstream).not.toHaveBeenCalled();
  });
});

describe("prompt-free transport diagnostics", () => {
  it.each(["ASCII", "é", "漢字", "🚙", "\ud800", "\udc00", "A🚙é漢Z"])(
    "counts UTF-8 bytes for %j",
    (body) => {
      expect(actual.providerResponseByteLength(body)).toBe(Buffer.byteLength(body));
    },
  );
  it("classifies wrapped Go failures without returning their sensitive text or arbitrary fields", () => {
    const diagnostic = actual.safeProviderTransportDiagnostic({
      name: "GoError",
      code: "PRIVATE_TOKEN",
      value: new Error(
        "POST https://provider/?key=PRIVATE_TOKEN: context deadline exceeded; broken pipe",
      ),
      status: "PRIVATE_TOKEN",
    });
    expect(diagnostic).toBe("name=GoError flags=timeout,connection_closed");
    expect(
      actual.safeProviderTransportDiagnostic({
        name: "PRIVATE_TOKEN",
        code: "ECONNRESET",
        message: "PRIVATE_TOKEN",
      }),
    ).toBe("name=unknown code=ECONNRESET");
  });
});
