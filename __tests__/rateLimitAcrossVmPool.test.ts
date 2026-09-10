import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  new Function("module", "exports", source)(module, module.exports);
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

  it("still limits per-VM when the shared store is unavailable, never fails open", () => {
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

  it("expires leaked slots in the per-VM fallback too, where there is no store", () => {
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
    // one without `ipKeyed` silently reopens the eviction path, and nothing
    // else in the suite would notice.
    const sources = [
      ["pb_hooks/main.pb.js", '"telemetry:" + helpers.clientIP(c)'],
      ["pb_hooks/walkarounds.js", '"walkaround-app:" + helpers.clientIP(c)'],
      ["pb_hooks/helpers.js", '"auth-sample:" + kind + ":" + (ip || "unknown")'],
    ] as const;
    for (const [file, keyExpression] of sources) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const at = source.indexOf(keyExpression);
      expect(at, `${file} no longer builds ${keyExpression}`).toBeGreaterThan(-1);
      // The option belongs to the same call; 400 characters covers the widest
      // of these three after prettier wraps them.
      expect(
        source.slice(at, at + 400),
        `${file}: ${keyExpression} is rate-limited without { ipKeyed: true }`,
      ).toContain("ipKeyed: true");
    }
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
