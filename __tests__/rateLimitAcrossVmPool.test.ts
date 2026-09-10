import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  ) => { ok: boolean };
  acquireProxyConcurrency: (
    key: string,
    maxConcurrent: number,
  ) => { ok: boolean; release?: () => void };
  proxyRateLimitStateSize: () => number;
};

const runtime = globalThis as unknown as Record<string, unknown>;
const saved = runtime.$app;
afterEach(() => {
  runtime.$app = saved;
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
      vm.checkProxyRateLimit(`telemetry:203.0.113.${i}`, 30, 60_000);
    }
    expect(vm.proxyRateLimitStateSize()).toBeLessThanOrEqual(2048);
  });
});
