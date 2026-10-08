import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCapacityHarness } from "../test/providerCapacityHarness";
let capacity: ReturnType<typeof createCapacityHarness>;
beforeEach(() => {
  capacity = createCapacityHarness();
});
afterEach(() => capacity.close());

/**
 * PocketBase 0.22 serves hook callbacks from a pool of JSVM runtimes
 * (--hooksPool, default 25) and each runtime gets its own require() instance of
 * helpers.js. Counters held in module scope are therefore per-VM: the "global"
 * provider concurrency cap of 12 that the 1 GB machine sizing depends on was
 * really up to 12 x 25, and the per-minute buckets were as many times too
 * permissive.
 *
 * These tests simulate the pool by loading helpers.js twice and pointing both
 * copies at one shared $app.store(), the same mechanism walkarounds.js already
 * uses for replay nonces.
 */
type Helpers = {
  checkProxyRateLimit: (
    key: string,
    maxPerWindow: number,
    windowMs: number,
    options?: { ipKeyed?: boolean },
  ) => { ok: boolean };
  acquireProxyConcurrency: (
    key: string,
    maxConcurrent: number,
  ) => { ok: boolean; count?: number; release?: () => void };
  proxyRateLimitStateSize: () => number;
};

const runtime = globalThis as unknown as Record<string, unknown>;
const saved = runtime.$app;
afterEach(() => {
  runtime.$app = saved;
  vi.useRealTimers();
});

/** One store object standing in for the process-wide $app.store(). */
const makeSharedStore = () => {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k),
    set: (k: string, v: unknown) => data.set(k, v),
    remove: (k: string) => data.delete(k),
    getAll: () => Object.fromEntries(data),
  };
};

const loadVm = (): Helpers => {
  const source = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
  const module = { exports: {} as Helpers };
  new Function("module", "exports", "require", "__hooks", source)(
    module,
    module.exports,
    () => capacity,
    "pb_hooks",
  );
  return module.exports;
};

describe("throttles are enforced across the whole JSVM pool", () => {
  it("counts one dealer's provider slots across two pool VMs, not per VM", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };

    const vmA = loadVm();
    const vmB = loadVm();

    // A cap of 2 must mean 2 in total, not 2 per runtime.
    expect(vmA.acquireProxyConcurrency("provider:dealer-a", 2).ok).toBe(true);
    expect(vmB.acquireProxyConcurrency("provider:dealer-a", 2).ok).toBe(true);
    expect(vmB.acquireProxyConcurrency("provider:dealer-a", 2).ok).toBe(false);
    expect(vmA.acquireProxyConcurrency("provider:dealer-a", 2).ok).toBe(false);
  });

  it("frees a slot for the whole pool when any VM releases it", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };

    const vmA = loadVm();
    const vmB = loadVm();

    const held = vmA.acquireProxyConcurrency("provider:dealer-b", 1);
    expect(held.ok).toBe(true);
    expect(vmB.acquireProxyConcurrency("provider:dealer-b", 1).ok).toBe(false);

    held.release?.();
    expect(vmB.acquireProxyConcurrency("provider:dealer-b", 1).ok).toBe(true);
  });

  it("shares the per-minute rate bucket across VMs", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };

    const vmA = loadVm();
    const vmB = loadVm();

    // Three requests against a limit of 3, spread over two runtimes.
    expect(vmA.checkProxyRateLimit("ip:203.0.113.9", 3, 60_000).ok).toBe(true);
    expect(vmB.checkProxyRateLimit("ip:203.0.113.9", 3, 60_000).ok).toBe(true);
    expect(vmA.checkProxyRateLimit("ip:203.0.113.9", 3, 60_000).ok).toBe(true);
    // The fourth crosses the boundary regardless of which VM serves it.
    expect(vmB.checkProxyRateLimit("ip:203.0.113.9", 3, 60_000).ok).toBe(false);
  });

  it("keeps rate fallback and database leases when the shared store is unavailable", () => {
    // No $app at all: the fallback must keep counting, not stop enforcing.
    runtime.$app = undefined;
    const vm = loadVm();

    expect(vm.acquireProxyConcurrency("provider:dealer-c", 1).ok).toBe(true);
    expect(vm.acquireProxyConcurrency("provider:dealer-c", 1).ok).toBe(false);
    expect(vm.checkProxyRateLimit("ip:198.51.100.4", 1, 60_000).ok).toBe(true);
    expect(vm.checkProxyRateLimit("ip:198.51.100.4", 1, 60_000).ok).toBe(false);
  });

  it("keeps the shared bucket map bounded", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vm = loadVm();

    for (let i = 0; i < 3000; i += 1) {
      vm.checkProxyRateLimit(`telemetry:203.0.113.${i}`, 30, 60_000, {
        ipKeyed: true,
      });
    }
    // Both tables together stay under their combined ceiling.
    expect(vm.proxyRateLimitStateSize()).toBeLessThanOrEqual(2048 + 512);
  });
});

/**
 * A shared counter that only ever goes down when someone remembers to put it
 * back is a counter that eventually stops going down. `release()` is called
 * from a `finally`, so the ordinary path is covered; a pool runtime torn down
 * mid-request, or a host-side panic inside $http.send, is not. While the count
 * was per-VM a leak cost one of 25 runtimes. Shared across the pool it costs
 * every dealership: provider:global is capped at 12, so twelve leaks make every
 * generation return 503 "Provider capacity is temporarily busy" until someone
 * redeploys, with nothing in the logs pointing at the cause.
 *
 * The fix gives slots the expiry that rate buckets always had. These tests pin
 * both halves of it — that a leak heals, and that the TTL is long enough not to
 * quietly raise the cap it enforces.
 */
describe("leaked provider slots expire instead of poisoning the pool", () => {
  const START = new Date("2026-09-10T12:00:00.000Z");
  /** Elapsed time as the pool sees it. helpers.js reads Date.now() directly. */
  const atSecondsIn = (seconds: number) =>
    vi.setSystemTime(new Date(START.getTime() + seconds * 1000));

  it("reclaims a slot whose release never ran", () => {
    vi.useFakeTimers();
    atSecondsIn(0);
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vmA = loadVm();
    const vmB = loadVm();

    // vmA takes the last slot and is then torn down: no release, ever.
    expect(vmA.acquireProxyConcurrency("provider:global", 1).ok).toBe(true);
    expect(vmB.acquireProxyConcurrency("provider:global", 1).ok).toBe(false);

    // Long after any request could still be running, the pool recovers on its
    // own rather than waiting for a redeploy.
    atSecondsIn(390);
    expect(vmB.acquireProxyConcurrency("provider:global", 1).ok).toBe(true);
  });

  it("holds the slot past the 300s upstream timeout, so the cap still means something", () => {
    vi.useFakeTimers();
    atSecondsIn(0);
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vmA = loadVm();
    const vmB = loadVm();

    expect(vmA.acquireProxyConcurrency("provider:global", 1).ok).toBe(true);

    // $http.send is given 300 seconds for Veo. A TTL inside that window would
    // hand the slot to a second request while the first is still upstream,
    // which is the same failure the cap exists to prevent.
    atSecondsIn(310);
    expect(vmB.acquireProxyConcurrency("provider:global", 1).ok).toBe(false);
  });

  it("releases only the caller's own slot, not whatever the pool holds", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vmA = loadVm();
    const vmB = loadVm();

    const mine = vmA.acquireProxyConcurrency("provider:dealer-d", 2);
    const theirs = vmB.acquireProxyConcurrency("provider:dealer-d", 2);
    expect(mine.ok).toBe(true);
    expect(theirs.ok).toBe(true);

    mine.release?.();

    // Exactly one slot came free. A decrement-a-number release could not tell
    // these two apart; dropping a token can.
    expect(vmA.acquireProxyConcurrency("provider:dealer-d", 2).ok).toBe(true);
    expect(vmB.acquireProxyConcurrency("provider:dealer-d", 2).ok).toBe(false);
  });

  it("stays idempotent, so a double release cannot invent capacity", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vm = loadVm();

    const first = vm.acquireProxyConcurrency("provider:dealer-e", 1);
    first.release?.();
    const second = vm.acquireProxyConcurrency("provider:dealer-e", 1);
    expect(second.ok).toBe(true);

    // The stale handle firing again must not free the slot the second caller
    // is currently holding.
    first.release?.();
    expect(vm.acquireProxyConcurrency("provider:dealer-e", 1).ok).toBe(false);
  });

  it("expires database leases even when the shared memory store is unavailable", () => {
    vi.useFakeTimers();
    atSecondsIn(0);
    runtime.$app = undefined;
    const vm = loadVm();

    expect(vm.acquireProxyConcurrency("provider:dealer-f", 1).ok).toBe(true);
    expect(vm.acquireProxyConcurrency("provider:dealer-f", 1).ok).toBe(false);

    atSecondsIn(390);
    expect(vm.acquireProxyConcurrency("provider:dealer-f", 1).ok).toBe(true);
  });
});

/**
 * Eviction sorts ascending by resetAt and drops the lowest first, which is
 * every 60-second bucket — the per-dealer proxy, OpenAI, Anthropic and image
 * throttles. While the bucket table was per-VM a flood of source IPs crowded
 * out one runtime's map and the other 24 kept counting. Sharing the table
 * across the pool made that ceiling pool-wide, so a distributed flood against
 * the unauthenticated telemetry endpoint could clear a paying dealership's
 * per-minute limit as a side effect.
 *
 * IP-keyed keys now count in their own table. These tests pin the separation
 * and, just as importantly, which call sites opt into it.
 */
describe("an unauthenticated flood cannot evict a dealership's throttle", () => {
  const flood = (vm: Helpers, n: number) => {
    for (let i = 0; i < n; i += 1) {
      vm.checkProxyRateLimit(`telemetry:198.51.100.${i}`, 30, 60_000, {
        ipKeyed: true,
      });
    }
  };

  it("leaves a dealer's bucket counting after the IP table is filled past its cap", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vm = loadVm();

    // Two of a limit of three, so the dealer bucket is mid-window and would be
    // visibly reset if it were evicted.
    expect(vm.checkProxyRateLimit("dealer:d1", 3, 60_000).ok).toBe(true);
    expect(vm.checkProxyRateLimit("dealer:d1", 3, 60_000).ok).toBe(true);

    flood(vm, 3000);

    // The third request still passes and the fourth still fails. If the flood
    // had evicted the bucket, the count would have restarted at 1 and this
    // dealer would get four more.
    expect(vm.checkProxyRateLimit("dealer:d1", 3, 60_000).ok).toBe(true);
    expect(vm.checkProxyRateLimit("dealer:d1", 3, 60_000).ok).toBe(false);
  });

  it("does not let a flood evict the fixed ceiling that bounds it", () => {
    const store = makeSharedStore();
    runtime.$app = { store: () => store };
    const vm = loadVm();

    // "telemetry:ingress" shares the telemetry: prefix but is one fixed key,
    // and it is the global cap on the same endpoint. A namespace chosen by key
    // prefix would have filed it with the per-IP buckets, where the flood it
    // exists to contain could evict it.
    for (let i = 0; i < 240; i += 1) {
      expect(vm.checkProxyRateLimit("telemetry:ingress", 240, 60_000).ok).toBe(true);
    }
    flood(vm, 3000);
    expect(vm.checkProxyRateLimit("telemetry:ingress", 240, 60_000).ok).toBe(false);
  });

  it("names every IP-keyed call site, so a new one cannot land in the tenant table", () => {
    // A key built from a client IP has cardinality an attacker picks. Adding
    // one without `ipKeyed` silently reopens the eviction path.
    //
    // A hardcoded list of call sites was tried here first, and it went stale
    // the same day it was written: a fourth call
    // (pb_hooks/walkarounds.js, "walkaround-internal:" + helpers.clientIP(c))
    // already existed, unconverted, and this test's own title — "names every
    // IP-keyed call site" — was false while it passed. Discovering every
    // checkProxyRateLimit call whose key argument mentions clientIP(c), by
    // scanning the real files rather than naming sites in advance, is the
    // only way this test's claim can stay true as new call sites are added.
    const files = [
      "pb_hooks/main.pb.js",
      "pb_hooks/walkarounds.js",
      "pb_hooks/helpers.js",
    ];
    const CALL = "checkProxyRateLimit(";
    let ipKeyedCallsFound = 0;
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      let searchFrom = 0;
      for (;;) {
        const callStart = source.indexOf(CALL, searchFrom);
        if (callStart === -1) break;
        const argsStart = callStart + CALL.length;
        let depth = 1;
        let i = argsStart;
        for (; i < source.length && depth > 0; i++) {
          if (source[i] === "(") depth++;
          else if (source[i] === ")") depth--;
        }
        const call = source.slice(callStart, i);
        searchFrom = i;
        const keyArg = call.slice(
          0,
          call.indexOf(",") === -1 ? call.length : call.indexOf(","),
        );
        if (!keyArg.includes("clientIP(c)")) continue;
        ipKeyedCallsFound += 1;
        const line = source.slice(0, callStart).split("\n").length;
        expect(
          call,
          `${file}:${line}: an IP-keyed key is rate-limited without { ipKeyed: true }`,
        ).toContain("ipKeyed: true");
      }
    }
    // The `auth-sample:` key in helpers.js is IP-keyed too (it embeds `ip`,
    // a caller-supplied client IP) but is not built with `clientIP(c)`
    // textually, so the scan above cannot see it; pin it by its own shape so
    // it is not silently dropped from coverage.
    const helpersSource = readFileSync(
      resolve(process.cwd(), "pb_hooks/helpers.js"),
      "utf8",
    );
    const authSampleKey = '"auth-sample:" + kind + ":" + (ip || "unknown")';
    const at = helpersSource.indexOf(authSampleKey);
    expect(
      at,
      "pb_hooks/helpers.js no longer builds the auth-sample key",
    ).toBeGreaterThan(-1);
    expect(
      helpersSource.slice(at, at + 400),
      "pb_hooks/helpers.js: the auth-sample key is rate-limited without { ipKeyed: true }",
    ).toContain("ipKeyed: true");

    // A guard on the guard: if clientIP(c) stops appearing as a key anywhere,
    // this test would trivially pass having checked nothing.
    expect(ipKeyedCallsFound).toBeGreaterThanOrEqual(3);
  });

  it("would fail this enumeration for a genuinely unconverted clientIP call site", () => {
    // Proves the scan above does not just pass by construction: a
    // deliberately broken source string reproduces exactly the pre-fix shape
    // of pb_hooks/walkarounds.js's walkaround-internal call.
    const source = `
      const rate = helpers.checkProxyRateLimit(
        "walkaround-internal:" + helpers.clientIP(c),
        300,
        60 * 1000,
      );
    `;
    const CALL = "checkProxyRateLimit(";
    const callStart = source.indexOf(CALL);
    let depth = 1;
    let i = callStart + CALL.length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    const call = source.slice(callStart, i);
    expect(call).toContain("clientIP(c)");
    expect(call).not.toContain("ipKeyed: true");
  });

  it("still separates the tables when the shared store is unavailable", () => {
    // The per-VM fallback has its own map per namespace, not one shared map.
    runtime.$app = undefined;
    const vm = loadVm();

    expect(vm.checkProxyRateLimit("dealer:d2", 1, 60_000).ok).toBe(true);
    // Same string, different table: the IP-keyed call must not see the tenant
    // bucket that the previous line just created.
    expect(vm.checkProxyRateLimit("dealer:d2", 1, 60_000, { ipKeyed: true }).ok).toBe(
      true,
    );
    // And each table still enforces on its own side.
    expect(vm.checkProxyRateLimit("dealer:d2", 1, 60_000).ok).toBe(false);
    expect(vm.checkProxyRateLimit("dealer:d2", 1, 60_000, { ipKeyed: true }).ok).toBe(
      false,
    );
  });
});

/**
 * The per-VM fallback exists so a broken store degrades to per-runtime
 * counting instead of no counting. The write side always honoured that; the
 * read side did not. writeSharedBucket parked a value in the local map when
 * `store.set` threw, but readSharedBucket returned undefined on a store miss
 * without ever consulting that map, so a store that accepted reads and
 * rejected writes made every limit start a fresh bucket on every request —
 * fully open, silently. Found by a pre-merge review that built exactly that
 * store; these tests keep it built.
 */
describe("a store that reads but will not write still enforces every limit", () => {
  const makeReadOnlyStore = () => {
    const data = new Map<string, unknown>();
    return {
      get: (k: string) => data.get(k),
      set: () => {
        throw new Error("store is read-only");
      },
      remove: (k: string) => data.delete(k),
      getAll: () => Object.fromEntries(data),
    };
  };

  it("keeps the per-minute rate limit closed", () => {
    runtime.$app = { store: () => makeReadOnlyStore() };
    const vm = loadVm();
    let allowed = 0;
    for (let i = 0; i < 50; i += 1) {
      if (vm.checkProxyRateLimit("dealer:ro", 3, 60_000).ok) allowed += 1;
    }
    // A limit of 3 means 3, not 50.
    expect(allowed).toBe(3);
  });

  it("keeps the provider concurrency cap closed", () => {
    runtime.$app = { store: () => makeReadOnlyStore() };
    const vm = loadVm();
    let granted = 0;
    for (let i = 0; i < 20; i += 1) {
      if (vm.acquireProxyConcurrency("provider:ro", 2).ok) granted += 1;
    }
    expect(granted).toBe(2);
  });
});
