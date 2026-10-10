// Fresh PocketBase 0.22.55 + loopback provider only. Never opens existing pb_data.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";

const binary = resolve(
  process.env.POCKETBASE_TEST_BINARY || "/tmp/dsp-connections-pb-02255/pocketbase",
);
assert.match(
  spawnSync(binary, ["--version"], { encoding: "utf8" }).stdout || "",
  /0\.22\.55\b/,
  "Pinned PocketBase 0.22.55 is required.",
);
const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "dsp-omni-video-"));
const probeSecret = randomBytes(24).toString("hex");
const password = randomBytes(24).toString("hex");
const checks = [];
const providerRequests = [];
const providerState = new Map();
const marker = "SYNTHETIC_PRIVATE_PROVIDER_MARKER";
const mediaBytes = Buffer.alloc(1200);
Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex").copy(mediaBytes);
mediaBytes.writeUInt32BE(mediaBytes.length - 24, 24);
mediaBytes.write("mdat", 28);
const mp4 = mediaBytes.toString("base64");
let nextStart = "queued";
let failDeletes = false;
let child;
let db;
let logs = "";
let provider;
const report = {
  status: "running",
  environment: "fresh PocketBase 0.22.55; loopback stub; synthetic fixtures",
  checks,
};

function completed(id) {
  return {
    id,
    status: "completed",
    metadata: { marker },
    input: marker,
    errors: [{ code: marker, message: marker }],
    steps: [
      { type: "user_input", content: [{ type: "image", data: marker }] },
      { type: "thought", content: [{ type: "thought", text: marker }] },
      {
        type: "model_output",
        content: [{ type: "video", mime_type: "video/mp4", data: mp4 }],
      },
    ],
  };
}

try {
  provider = createHttpServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const url = new URL(req.url, "http://127.0.0.1");
      const request = {
        method: req.method,
        path: url.pathname,
        body: raw ? JSON.parse(raw) : null,
      };
      providerRequests.push(request);
      const respond = (status, value) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(value === undefined ? "" : JSON.stringify(value));
      };
      if (req.headers["x-goog-api-key"] !== "synthetic-not-a-provider-key")
        return respond(404, { error: { message: "Synthetic wrong-project key" } });
      if (req.method === "POST" && url.pathname === "/v1beta/interactions") {
        const mode = nextStart;
        nextStart = "queued";
        if (mode === "404")
          return respond(404, { error: { message: marker, code: "not_found" } });
        const id = `v1_opaque+/:=${providerRequests.length}`;
        providerState.set(id, "completed");
        if (mode === "malformed")
          return respond(200, {
            id,
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "video",
                    mime_type: "video/mp4",
                    uri: "https://private.invalid/" + marker,
                  },
                ],
              },
            ],
          });
        return respond(200, {
          id,
          status: "queued",
          metadata: { marker },
          input: marker,
          steps: [{ type: "user_input", content: [{ type: "text", text: marker }] }],
        });
      }
      const cancel = url.pathname.match(/^\/v1beta\/interactions\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancel) {
        const id = decodeURIComponent(cancel[1]);
        if (!providerState.has(id)) return respond(404, { error: {} });
        providerState.set(id, "cancelled");
        return respond(200, { id, status: "cancelled" });
      }
      const interaction = url.pathname.match(/^\/v1beta\/interactions\/([^/]+)$/);
      if (interaction) {
        const id = decodeURIComponent(interaction[1]);
        if (!providerState.has(id)) return respond(404, { error: {} });
        if (req.method === "DELETE") {
          if (failDeletes) return respond(503, { error: { message: marker } });
          providerState.delete(id);
          return respond(200);
        }
        if (req.method === "GET")
          return respond(
            200,
            providerState.get(id) === "completed"
              ? completed(id)
              : { id, status: providerState.get(id) },
          );
      }
      if (
        req.method === "GET" &&
        url.pathname === "/v1beta/operations/legacy-veo-canary"
      )
        return respond(200, {
          name: "operations/legacy-veo-canary",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { encodedVideo: mp4 } }],
            },
          },
        });
      return respond(404, { error: { message: "Unexpected loopback route" } });
    } catch (_) {
      res.writeHead(500);
      res.end("{}");
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const providerBase = `http://127.0.0.1:${provider.address().port}/`;
  const portFinder = createNetServer();
  portFinder.listen(0, "127.0.0.1");
  await once(portFinder, "listening");
  const port = portFinder.address().port;
  await new Promise((done) => portFinder.close(done));
  const base = `http://127.0.0.1:${port}`;
  await cp(join(root, "pb_hooks"), join(scratch, "hooks"), { recursive: true });
  await cp(join(root, "pb_migrations"), join(scratch, "migrations"), {
    recursive: true,
  });
  await mkdir(join(scratch, "public"));
  // Replace only literal Google origin in disposable hooks, never source hooks
  // or a production environment setting. All Gemini paths resolve to the stub.
  for (const file of ["main.pb.js", "helpers.js"]) {
    const path = join(scratch, "hooks", file);
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replaceAll("https://generativelanguage.googleapis.com/", providerBase),
    );
  }
  await writeFile(
    join(scratch, "hooks/omni-canary-probe.pb.js"),
    `
routerAdd("POST", "/__omni/probe", (c) => {
  if (c.request().header.get("X-Probe-Secret") !== $os.getenv("OMNI_PROBE_SECRET")) return c.noContent(404);
  const data = $apis.requestInfo(c).data;
  const helpers = require(__hooks + "/helpers.js");
  if (data.action === "claimLegacy") {
    helpers.claimProviderResource(data.dealer, {provider: "gemini", resource_type: "operation", resource_id: "operations/legacy-veo-canary"});
    return c.json(200, {ok: true});
  }
  if (data.action === "resetRate") {
    $app.store().set("proxyRate:dealer:" + data.dealer + ":video-start", JSON.stringify({count: 0, resetAt: Date.now() + 60000}));
    return c.json(200, {ok: true});
  }
  if (data.action === "cleanup") return c.json(200, helpers.pruneOmniInteractions({baseUrl: ${JSON.stringify(providerBase)}, apiKey: data.rotatedKey ? "synthetic-rotated-project-key" : "synthetic-not-a-provider-key"}));
  return c.noContent(404);
});
`,
  );
  child = spawn(
    binary,
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${join(scratch, "data")}`,
      `--hooksDir=${join(scratch, "hooks")}`,
      `--migrationsDir=${join(scratch, "migrations")}`,
      `--publicDir=${join(scratch, "public")}`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        ADMIN_LOGIN_USERNAME: "omni.qa",
        ADMIN_LOGIN_PASSWORD: password,
        SALESPERSON_PIN_PEPPER: randomBytes(24).toString("hex"),
        GEMINI_API_KEY: "synthetic-not-a-provider-key",
        OMNI_PROBE_SECRET: probeSecret,
        VERCEL_TO_FLY_PROXY_SECRET: probeSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-16000);
    });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error("Isolated PocketBase failed to boot: " + logs.slice(-4000));
    try {
      if (
        (await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  assert(ready, "Fresh PocketBase readiness timeout");
  async function api(
    path,
    {
      cookie = "",
      data,
      method = "GET",
      expected = 200,
      task = "",
      probe = false,
    } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      signal: AbortSignal.timeout(30000),
      headers: {
        "X-Dealer-Client-Contract": "2026-07-31.v4",
        "X-Dealer-Proxy-Secret": probeSecret,
        "X-Vercel-Forwarded-For": "203.0.113.210",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(task ? { "X-Generation-Task": task } : {}),
        ...(probe ? { "X-Probe-Secret": probeSecret } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const value = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${response.status} ${JSON.stringify(value).slice(0, 300)}`,
    );
    return {
      value,
      cookie: response.headers.get("set-cookie")?.match(/dealer_session=([^;]+)/)?.[0],
      headers: response.headers,
    };
  }
  const probe = (data) => api("/__omni/probe", { method: "POST", data, probe: true });
  const admin = (
    await api("/api/app/session", {
      method: "POST",
      data: { authType: "admin_password", username: "omni.qa", password },
    })
  ).cookie;
  assert(admin);
  const stores = [];
  for (let i = 0; i < 2; i++) {
    const dealer = (
      await api("/api/app/dealers", {
        method: "POST",
        cookie: admin,
        data: { name: `Synthetic Omni Store ${i + 1}`, requires_approval: true },
      })
    ).value;
    const invitation = (
      await api(`/api/app/dealers/${dealer.id}/invitation`, {
        method: "POST",
        cookie: admin,
        data: { action: "issue" },
      })
    ).value;
    const person = (
      await api("/api/app/salespeople", {
        method: "POST",
        cookie: admin,
        data: {
          dealer: dealer.id,
          name: `Synthetic Omni Person ${i + 1}`,
          role: "salesperson",
        },
      })
    ).value;
    const session = await api("/api/app/session", {
      method: "POST",
      cookie: `dealer_invitation=${invitation.token}`,
      data: { dealerCode: person.pin, dealerId: dealer.id },
    });
    assert.equal(session.value.dealer.id, dealer.id);
    assert(session.cookie);
    stores.push({ id: dealer.id, cookie: session.cookie });
  }
  checks.push(
    "two synthetic dealerships and personal identities provisioned through normal app APIs",
  );
  db = new DatabaseSync(join(scratch, "data/data.db"));
  const image = (await readFile(join(root, "e2e/fixtures/spin-angle.jpg"))).toString(
    "base64",
  );
  const body = (quality = false) => ({
    instances: [
      {
        prompt: "Synthetic continuous car orbit.",
        image: { mimeType: "image/jpeg", bytesBase64Encoded: image },
      },
    ],
    parameters: {
      aspectRatio: "16:9",
      personGeneration: "allow_adult",
      durationSeconds: quality ? 8 : 6,
      resolution: quality ? "1080p" : "720p",
      negativePrompt: "No second car, no dialogue.",
    },
  });
  const cases = [
    ["gemini-omni-1.1-flash", "video_standard", false, 0],
    ["gemini-omni-1.1-flash", "video_quality", true, 1],
    ["veo-3.1-fast-generate-preview", "", false, 0],
    ["veo-3.1-generate-preview", "", true, 1],
    ["veo-3.1-lite-generate-preview", "", false, 0],
  ];
  const handles = [];
  for (const [model, task, quality, store] of cases) {
    const before = providerRequests.length;
    const started = await api(`/api/proxy/v1beta/models/${model}:predictLongRunning`, {
      method: "POST",
      cookie: stores[store].cookie,
      data: body(quality),
      task,
    });
    const handle = started.value.name;
    assert.match(handle, /^operations\/omni-[A-Za-z0-9]{32}$/);
    assert.deepEqual(started.value, { name: handle, done: false });
    const sent = providerRequests[before];
    assert.equal(sent.path, "/v1beta/interactions");
    assert.equal(sent.method, "POST");
    assert.equal(sent.body.model, "gemini-omni-1.1-flash");
    assert.equal(sent.body.background, true);
    assert.equal(sent.body.store, true);
    assert.equal(sent.body.stream, false);
    assert.deepEqual(sent.body.generation_config, {
      video_config: { task: "image_to_video" },
    });
    assert.equal(sent.body.response_format.resolution, quality ? "1080p" : "720p");
    assert.equal(sent.body.response_format.duration, quality ? "8s" : "6s");
    assert.equal(sent.body.response_format.delivery, "inline");
    assert.equal(sent.body.input[0].type, "image");
    assert.match(sent.body.input[1].text, /No second car, no dialogue/);
    assert.doesNotMatch(
      JSON.stringify(sent.body),
      /personGeneration|negativePrompt|generate_audio|system_instruction|temperature/,
    );
    const upstreamCount = providerRequests.length;
    await api(`/api/proxy/v1beta/${handle}`, {
      cookie: stores[1 - store].cookie,
      expected: 403,
    });
    assert.equal(
      providerRequests.length,
      upstreamCount,
      "Foreign tenant denial must precede provider GET",
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      const polled = await api(`/api/proxy/v1beta/${handle}`, {
        cookie: stores[store].cookie,
      });
      assert.equal(polled.value.done, true);
      assert.equal(
        polled.value.response.generateVideoResponse.generatedSamples[0].video
          .encodedVideo,
        mp4,
      );
      assert.doesNotMatch(
        JSON.stringify(polled.value),
        new RegExp(marker + "|v1_opaque|steps|input|thought"),
      );
    }
    const record = db
      .prepare("SELECT * FROM omni_interactions WHERE operation_name = ?")
      .get(handle);
    assert(record);
    assert.equal(
      record.key_fingerprint,
      createHash("sha256").update("synthetic-not-a-provider-key").digest("hex"),
    );
    assert.notEqual(handle, record.provider_id);
    assert(
      Date.parse(record.expires_at.replace(" ", "T")) >
        Date.now() + 23 * 60 * 60 * 1000,
    );
    handles.push(handle);
  }
  checks.push(
    "standard, quality and all three legacy aliases dispatch only Omni; opaque handles; tenant denial before provider access; repeated redacted polls",
  );
  await probe({ action: "claimLegacy", dealer: stores[0].id });
  const legacy = await api("/api/proxy/v1beta/operations/legacy-veo-canary", {
    cookie: stores[0].cookie,
  });
  assert.equal(
    legacy.value.response.generateVideoResponse.generatedSamples[0].video.encodedVideo,
    mp4,
  );
  assert.equal(providerRequests.at(-1).path, "/v1beta/operations/legacy-veo-canary");
  checks.push("previously owned real Veo operation polling retains original route");
  for (const mode of ["404", "malformed"]) {
    await probe({ action: "resetRate", dealer: stores[0].id });
    nextStart = mode;
    const before = providerRequests.filter(
      (r) => r.method === "POST" && r.path === "/v1beta/interactions",
    ).length;
    const response = await api(
      "/api/proxy/v1beta/models/gemini-omni-1.1-flash:predictLongRunning",
      {
        method: "POST",
        cookie: stores[0].cookie,
        data: body(),
        task: "video_standard",
        expected: mode === "404" ? 502 : 200,
      },
    );
    if (mode === "malformed") assert.equal(response.value.done, true);
    assert.doesNotMatch(
      JSON.stringify(response.value),
      new RegExp(marker + "|v1_opaque|https://private"),
    );
    assert.equal(
      providerRequests.filter(
        (r) => r.method === "POST" && r.path === "/v1beta/interactions",
      ).length,
      before + 1,
    );
  }
  checks.push(
    "provider 404 mapped to safe 502; malformed accepted output terminal; neither replays generation",
  );
  const expired = handles[0];
  const firstRecord = db
    .prepare("SELECT provider_id FROM omni_interactions WHERE operation_name = ?")
    .get(expired);
  providerState.set(firstRecord.provider_id, "queued");
  db.prepare(
    "UPDATE provider_resources SET expires_at = '2000-01-01 00:00:00.000Z' WHERE resource_id = ?",
  ).run(expired);
  const beforeDenied = providerRequests.length;
  await api(`/api/proxy/v1beta/${expired}`, {
    cookie: stores[0].cookie,
    expected: 403,
  });
  assert.equal(providerRequests.length, beforeDenied);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM provider_resources WHERE resource_id = ?")
      .get(expired).count,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM omni_interactions WHERE operation_name = ?",
      )
      .get(expired).count,
    1,
  );
  // Accelerate only this queue row, simulating its independent 24-hour deadline.
  db.prepare(
    "UPDATE omni_interactions SET expires_at = '2000-01-01 00:00:00.000Z', cleanup_after = '2000-01-01 00:00:00.000Z' WHERE operation_name = ?",
  ).run(expired);
  failDeletes = true;
  const failedCleanup = (await probe({ action: "cleanup" })).value;
  assert.equal(failedCleanup.retried, 1);
  assert.equal(failedCleanup.deleted, 0);
  assert(
    providerRequests.some((r) => r.method === "POST" && r.path.endsWith("/cancel")),
    "Queued cleanup must use documented /cancel endpoint",
  );
  assert.equal(
    db
      .prepare(
        "SELECT cleanup_attempts FROM omni_interactions WHERE operation_name = ?",
      )
      .get(expired).cleanup_attempts,
    1,
  );
  assert(providerState.has(firstRecord.provider_id));
  db.prepare(
    "UPDATE omni_interactions SET cleanup_after = '2000-01-01 00:00:00.000Z' WHERE operation_name = ?",
  ).run(expired);
  failDeletes = false;
  const recoveredCleanup = (await probe({ action: "cleanup" })).value;
  assert.equal(recoveredCleanup.deleted, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM omni_interactions WHERE operation_name = ?",
      )
      .get(expired).count,
    0,
  );
  assert(!providerState.has(firstRecord.provider_id));
  checks.push(
    "24-hour cleanup queue survives ownership-ledger expiry, reconciles cancellation, preserves DELETE failure and retries deletion",
  );
  const missingHandle = handles[1];
  const missingRecord = db
    .prepare("SELECT provider_id FROM omni_interactions WHERE operation_name = ?")
    .get(missingHandle);
  providerState.delete(missingRecord.provider_id);
  db.prepare(
    "UPDATE omni_interactions SET cleanup_after = '2000-01-01 00:00:00.000Z' WHERE operation_name = ?",
  ).run(missingHandle);
  const rotatedCleanup = (await probe({ action: "cleanup", rotatedKey: true })).value;
  assert.deepEqual(rotatedCleanup, { deleted: 0, retried: 1 });
  assert.equal(
    db
      .prepare(
        "SELECT cleanup_attempts FROM omni_interactions WHERE operation_name = ?",
      )
      .get(missingHandle).cleanup_attempts,
    1,
  );
  db.prepare(
    "UPDATE omni_interactions SET cleanup_after = '2000-01-01 00:00:00.000Z' WHERE operation_name = ?",
  ).run(missingHandle);
  assert.deepEqual((await probe({ action: "cleanup" })).value, {
    deleted: 1,
    retried: 0,
  });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM omni_interactions WHERE operation_name = ?",
      )
      .get(missingHandle).count,
    0,
  );
  checks.push(
    "wrong-key 404 preserves cleanup mapping; original-key 404 confirms disappearance and purges mapping",
  );
  for (const [index, state] of [
    [2, "incomplete"],
    [3, "budget_exceeded"],
    [4, "requires_action"],
  ]) {
    const handle = handles[index];
    const record = db
      .prepare("SELECT provider_id FROM omni_interactions WHERE operation_name = ?")
      .get(handle);
    providerState.set(record.provider_id, state);
    db.prepare(
      "UPDATE omni_interactions SET cleanup_after = '2000-01-01 00:00:00.000Z' WHERE operation_name = ?",
    ).run(handle);
    const before = providerRequests.length;
    assert.deepEqual((await probe({ action: "cleanup" })).value, {
      deleted: 1,
      retried: 0,
    });
    const calls = providerRequests.slice(before);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "DELETE"],
    );
    assert(!providerState.has(record.provider_id));
  }
  checks.push(
    "incomplete, budget-exceeded and requires-action recovery records delete without cancellation",
  );
  assert(
    providerRequests.every(
      (r) =>
        r.path === "/v1beta/interactions" ||
        r.path.startsWith("/v1beta/interactions/") ||
        r.path === "/v1beta/operations/legacy-veo-canary",
    ),
  );
  // Offline rollback test uses the same disposable database after stopping its
  // sole server. Refusing a nonempty queue must preserve schema/history/data.
  const stop = once(child, "exit");
  child.kill("SIGTERM");
  await stop;
  const lastMigration = db
    .prepare("SELECT file FROM _migrations ORDER BY file DESC LIMIT 1")
    .get().file;
  assert.equal(
    lastMigration,
    "1791660000_omni_interactions.js",
    "Only the new last migration may be rolled back by this canary",
  );
  const rowsBeforeDown = db
    .prepare("SELECT * FROM omni_interactions ORDER BY id")
    .all();
  assert(
    rowsBeforeDown.length > 0,
    "Malformed accepted generation should still have durable recovery",
  );
  const migrationArgs = [
    "migrate",
    "down",
    "1",
    `--dir=${join(scratch, "data")}`,
    `--hooksDir=${join(scratch, "hooks")}`,
    `--migrationsDir=${join(scratch, "migrations")}`,
  ];
  // PB 0.22's survey prompt requires a terminal and cursor-position replies;
  // a piped "y" silently cancels. The stdlib PTY helper answers only this
  // disposable command's migration prompt, then propagates its exit status.
  const down = () =>
    spawnSync(
      "python3",
      [
        "-c",
        `
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
deadline = time.monotonic() + 25
prompt = False
answered = False
last_cursor = time.monotonic()
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        if b"Do you really want to revert" in chunk:
            prompt = True
        for _ in range(chunk.count(b"\\x1b[6n")):
            os.write(fd, b"\\x1b[1;1R")
            last_cursor = time.monotonic()
    if prompt and not answered and time.monotonic() - last_cursor > 0.3:
        os.write(fd, b"y\\r")
        answered = True
else:
    os.kill(pid, 9)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`,
        binary,
        ...migrationArgs,
      ],
      { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } },
    );
  const refused = down();
  // A cancelled CLI prompt exits zero; verify the actual guard refusal plus
  // unchanged durable state rather than treating the exit code as evidence.
  assert.match(
    (refused.stdout || "") + (refused.stderr || ""),
    /pending video recovery/i,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM omni_interactions ORDER BY id").all(),
    rowsBeforeDown,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM _migrations WHERE file = ?")
      .get(lastMigration).count,
    1,
  );
  db.prepare("DELETE FROM omni_interactions").run();
  const reverted = down();
  assert.equal(
    reverted.status,
    0,
    "Empty recovery queue should permit rollback: " +
      (reverted.stderr || reverted.stdout),
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'omni_interactions'",
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM _migrations WHERE file = ?")
      .get(lastMigration).count,
    0,
  );
  checks.push(
    "real PocketBase down migration refuses nonempty queue without data/schema/history loss; empty queue rollback succeeds",
  );
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  report.providerCalls = {
    starts: providerRequests.filter(
      (r) => r.method === "POST" && r.path === "/v1beta/interactions",
    ).length,
    polls: providerRequests.filter((r) => r.method === "GET").length,
    deletes: providerRequests.filter((r) => r.method === "DELETE").length,
  };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  console.error(JSON.stringify(report, null, 2));
  throw error;
} finally {
  db?.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
  if (provider?.listening) await new Promise((done) => provider.close(done));
  await rm(scratch, { recursive: true, force: true });
}
