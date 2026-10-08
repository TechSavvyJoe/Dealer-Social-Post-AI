// Real PocketBase only, fresh temporary data, synthetic users, zero provider calls.
// No URL override: this harness cannot target a customer deployment.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

const binary = process.env.POCKETBASE_TEST_BINARY;
assert(binary, "Set POCKETBASE_TEST_BINARY to the pinned 0.22.55 executable.");
assert.match(
  spawnSync(resolve(binary), ["--version"], { encoding: "utf8" }).stdout || "",
  /0\.22\.55\b/,
  "Use the pinned PocketBase version.",
);
const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "dsp-launch-capacity-"));
const output =
  process.env.LAUNCH_CAPACITY_EVIDENCE ||
  join(root, ".release-evidence/launch-capacity.json");
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((done) => server.close(done));
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex");
const probeSecret = randomBytes(24).toString("hex");
let child;
const measurements = [];
const checks = [];
const report = {
  status: "running",
  target: { dealerships: 25, users: 250, concurrency: 25 },
  checks,
  measurements,
  revision: process.env.GITHUB_SHA || "local-working-tree",
  environment: "isolated loopback backend; not a production latency benchmark",
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));

async function api(
  path,
  { cookie = "", data, method = "GET", expected = 200, ip = "203.0.113.254" } = {},
) {
  const start = performance.now();
  const response = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      "X-Dealer-Client-Contract": "2026-07-31.v4",
      "X-Dealer-Proxy-Secret": probeSecret,
      "X-Vercel-Forwarded-For": ip,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data && !(data instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, received ${response.status} (${value.code || value.error || "no code"})`,
  );
  return {
    value,
    ms: performance.now() - start,
    cookie: response.headers.get("set-cookie")?.match(/dealer_session=([^;]+)/)?.[0],
  };
}
async function parallel(items, fn, concurrency = 25) {
  let next = 0;
  return Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
function recordLatency(name, values) {
  values.sort((a, b) => a - b);
  measurements.push({
    name,
    requests: values.length,
    p50Ms: Math.round(values[Math.floor(values.length * 0.5)]),
    p95Ms: Math.round(values[Math.floor(values.length * 0.95)]),
    maxMs: Math.round(values.at(-1)),
  });
}

try {
  await cp(join(root, "pb_hooks"), join(scratch, "hooks"), { recursive: true });
  await mkdir(join(scratch, "public"));
  // This diagnostic endpoint exists only in the disposable copy. It cannot be
  // reached remotely and still requires a random per-run secret.
  await writeFile(
    join(scratch, "hooks/launch-probe.pb.js"),
    `
routerAdd("POST", "/__launch/capacity", (c) => {
  if (c.request().header.get("X-Probe-Secret") !== $os.getenv("LAUNCH_PROBE_SECRET")) return c.noContent(404);
  const data = $apis.requestInfo(c).data;
  const slot = require(__hooks + "/helpers.js").acquireProxyConcurrency("launch-probe:" + data.round, 1);
  if (!slot.ok) return c.json(200, {granted: false});
  // Hold every successful lease until the caller completes its entire burst.
  // Leases are cleaned by dropping this isolated database at the end.
  return c.json(200, {granted: true});
});
`,
  );
  child = spawn(
    resolve(binary),
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${join(scratch, "data")}`,
      `--hooksDir=${join(scratch, "hooks")}`,
      `--migrationsDir=${join(root, "pb_migrations")}`,
      `--publicDir=${join(scratch, "public")}`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        ADMIN_LOGIN_USERNAME: "launch.qa",
        ADMIN_LOGIN_PASSWORD: password,
        SALESPERSON_PIN_PEPPER: randomBytes(24).toString("hex"),
        GEMINI_API_KEY: "synthetic-not-a-provider-key",
        LAUNCH_PROBE_SECRET: probeSecret,
        VERCEL_TO_FLY_PROXY_SECRET: probeSecret,
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("Isolated PocketBase failed to boot.");
    try {
      const ready = await fetch(base + "/api/health", {
        signal: AbortSignal.timeout(500),
      });
      if (ready.ok) break;
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  const admin = (
    await api("/api/app/session", {
      method: "POST",
      data: { authType: "admin_password", username: "launch.qa", password },
    })
  ).cookie;
  assert(admin);
  const people = [];
  const dealers = [];
  for (let store = 0; store < 25; store++) {
    const dealer = (
      await api("/api/app/dealers", {
        method: "POST",
        cookie: admin,
        data: { name: `Synthetic Launch Store ${store + 1}`, requires_approval: true },
      })
    ).value;
    dealers.push(dealer);
    for (let person = 0; person < 10; person++) {
      const issued = (
        await api("/api/app/salespeople", {
          method: "POST",
          cookie: admin,
          data: {
            dealer: dealer.id,
            name: `Synthetic Team ${store + 1}-${person + 1}`,
            role: person === 0 ? "manager" : "salesperson",
          },
        })
      ).value;
      people.push({ ...issued, dealerId: dealer.id, ip: `203.0.113.${store + 1}` });
    }
  }
  console.log("Created 25 synthetic dealerships and 250 users.");
  checks.push(
    "25 stores and 250 personal identities provisioned through application routes",
  );
  const loginMs = [];
  await parallel(people, async (person) => {
    const login = await api("/api/app/session", {
      method: "POST",
      ip: person.ip,
      data: { dealerCode: person.pin, dealerId: person.dealerId },
    });
    assert.equal(login.value.dealer.id, person.dealerId);
    assert.equal(login.value.person.id, person.id);
    person.cookie = login.cookie;
    loginMs.push(login.ms);
  });
  recordLatency("250 sign-ins, 25 concurrent", loginMs);
  checks.push("Every sign-in resolved the exact person and store");
  const postMs = [];
  const jpeg = await readFile(join(root, "e2e/fixtures/spin-angle.jpg"));
  await parallel(people, async (person) => {
    const post = new FormData();
    for (const [key, value] of Object.entries({
      style: "Modern",
      tone: "Excited",
      caption: "Synthetic local launch canary. No provider call.",
      platform_ids: JSON.stringify(["facebook_feed", "instagram_feed"]),
      media_output_mode: "photo",
      primary_format_id: "feed_portrait",
      image_aspect_ratio: "4:5",
    }))
      post.append(key, value);
    post.append(
      "creative_image",
      new Blob([jpeg], { type: "image/jpeg" }),
      "synthetic.jpg",
    );
    const result = await api("/api/app/posts", {
      method: "POST",
      cookie: person.cookie,
      data: post,
    });
    assert.equal(result.value.dealer, person.dealerId);
    person.postId = result.value.id;
    postMs.push(result.ms);
  });
  recordLatency("250 draft saves, 25 concurrent", postMs);
  checks.push("250 posts saved with authoritative dealership identity");
  const readMs = [];
  await parallel(
    Array.from({ length: 1000 }, (_, i) => people[i % people.length]),
    async (person) => {
      const result = await api("/api/app/posts?limit=200", { cookie: person.cookie });
      const items = result.value.items || result.value;
      assert(Array.isArray(items));
      for (const post of items) assert.equal(post.dealer, person.dealerId);
      assert(items.some((post) => post.id === person.postId));
      readMs.push(result.ms);
    },
  );
  recordLatency("1,000 history reads, 25 concurrent", readMs);
  checks.push("History stayed inside its dealership under concurrent use");
  for (let store = 0; store < 25; store++) {
    const person = people[store * 10 + 1];
    const other = people[((store + 1) % 25) * 10 + 1];
    await api(`/api/app/posts/${other.postId}/status`, {
      cookie: person.cookie,
      expected: 403,
    });
    await api(`/api/app/salespeople/${other.id}`, {
      cookie: person.cookie,
      method: "PATCH",
      data: { active: false },
      expected: 403,
    });
  }
  checks.push(
    "Cross-store post reads and person mutations denied across every store pair",
  );
  await parallel(
    people,
    async (person) => {
      const created = await api("/api/app/vehicle-spins", {
        method: "POST",
        cookie: person.cookie,
        data: {
          vehicle: {
            title: "Synthetic capacity vehicle",
            vin: "",
            stock: "QA",
            mileage: "",
            highlights: [],
            caption: "Local load fixture only.",
          },
          frameCount: 24,
          background: "original",
          reviewedAllAngles: true,
          vehicleOnly: true,
        },
        expected: 201,
      });
      person.spinId = created.value.id;
    },
    5,
  );
  for (let store = 0; store < 25; store++) {
    const manager = people[store * 10];
    const list = (await api("/api/app/vehicle-spins", { cookie: manager.cookie }))
      .value;
    assert.equal(list.capacity.dealershipUsed, 10);
    assert.equal(list.capacity.personalUsed, 1);
    assert.equal(list.items.length, 10);
    assert.equal(list.capacity.canCreate, true);
    assert.equal(
      list.capacity.total,
      undefined,
      "Fleet usage must not be exposed to a dealer",
    );
    await api("/api/app/vehicle-spins/" + people[((store + 1) % 25) * 10].spinId, {
      cookie: manager.cookie,
      expected: 404,
    });
  }
  checks.push(
    "250 spin projects fit the launch allowance; store counts and private access remain isolated",
  );
  for (let round = 0; round < 20; round++) {
    const results = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const response = await fetch(base + "/__launch/capacity", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "Content-Type": "application/json",
            "X-Probe-Secret": probeSecret,
          },
          body: JSON.stringify({ round }),
        });
        assert.equal(response.status, 200);
        return (await response.json()).granted;
      }),
    );
    assert.equal(
      results.filter(Boolean).length,
      1,
      "Concurrent requests exceeded the provider lease limit",
    );
  }
  checks.push(
    "500 simultaneous lease attempts in 20 bursts granted exactly one slot per burst",
  );
  await api(`/api/app/salespeople/${people[1].id}`, {
    method: "PATCH",
    cookie: admin,
    data: { active: false },
  });
  await api("/api/app/session", { cookie: people[1].cookie, expected: 401 });
  checks.push("Deactivation immediately invalidated the existing browser session");
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2));
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  await rm(scratch, { recursive: true, force: true });
}
