// Isolated physical-space guard canary for PocketBase 0.22.55.
// All fake capacity tools are private to this child process and temporary tree.
import assert from "node:assert/strict";
import { accessSync, constants } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  cp,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = process.env.POCKETBASE_TEST_BINARY || join(root, "pocketbase");
assert(binary, "Set POCKETBASE_TEST_BINARY to a local PocketBase 0.22.55 executable.");
assert.match(
  spawnSync(resolve(binary), ["--version"], { encoding: "utf8" }).stdout || "",
  /0\.22\.55\b/,
  "Media-storage canary requires the verified PocketBase 0.22.55 binary.",
);

const scratch = await mkdtemp(join(tmpdir(), "dsp-media-storage-"));
const wrappers = join(scratch, "fake-bin");
const hooks = join(scratch, "hooks");
const dataDir = join(scratch, "data");
const publicDir = join(scratch, "public");
const capacityFile = join(scratch, "capacity.tsv");
const probeModeFile = join(scratch, "probe-mode");
const probeSecret = randomBytes(32).toString("hex");
const adminName = "media.qa";
const adminPassword = randomBytes(32).toString("hex");
const checks = [];
const POST_FIELDS = [
  "salesperson_name",
  "salesperson_id",
  "style",
  "tone",
  "customer_name",
  "scenario_id",
  "vin",
  "has_release",
  "has_video",
  "caption_source",
  "generation_tier",
  "generation_model",
  "generation_fallback_count",
  "generation_last_success_at",
  "model_policy_version",
  "caption_attempt_id",
  "image_attempt_id",
  "platform_ids",
  "media_output_mode",
  "platform_captions",
  "primary_format_id",
  "image_aspect_ratio",
  "scheduled_for",
  "website_draft",
  "caption",
  "disclosures",
];
const reserveBufferKiB = 256 * 1024;
const liveMediaFloorKiB = reserveBufferKiB + 1000 + 2;
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((done) => server.close(done));
const base = `http://127.0.0.1:${port}`;
const checksRecord = { status: "running", binaryVersion: "0.22.55", checks };
let child;
const serverLogs = [];
let exitResolve;
const childExit = new Promise((resolveExit) => (exitResolve = resolveExit));
let stopping = false;

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const duPath = (process.env.PATH || "")
  .split(":")
  .map((dir) => join(dir, "du"))
  .find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
assert(duPath, "Could not locate the host du utility.");

async function usedKiB() {
  const result = spawnSync(duPath, ["-sk", dataDir], { encoding: "utf8" });
  assert.equal(result.status, 0, `du failed: ${result.stderr || result.stdout}`);
  const parsed = Number(result.stdout.trim().split(/\s+/)[0]);
  assert(
    Number.isSafeInteger(parsed) && parsed >= 0,
    "du returned an invalid data size.",
  );
  return parsed;
}

async function setCapacity(reserveKiB) {
  assert(Number.isSafeInteger(reserveKiB) && reserveKiB >= 0);
  const anchor = await usedKiB();
  await writeFile(capacityFile, `${anchor}\t${reserveKiB}\n`);
  await writeFile(probeModeFile, "available\n");
}

async function api(path, { cookie = "", data, method = "GET", expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(45_000),
    headers: {
      "X-Dealer-Client-Contract": "2026-07-31.v4",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data && !(data instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const json = (response.headers.get("content-type") || "").includes(
    "application/json",
  );
  const value = json ? await response.json() : await response.arrayBuffer();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, received ${response.status} (${value?.code || value?.error || "no code"})`,
  );
  return {
    value,
    status: response.status,
    headers: response.headers,
    cookie: response.headers.get("set-cookie")?.match(/dealer_session=([^;]+)/)?.[0],
  };
}

async function provisionDealer(admin, name, approval) {
  const dealer = (
    await api("/api/app/dealers", {
      method: "POST",
      cookie: admin,
      data: { name, requires_approval: approval },
    })
  ).value;
  const makePerson = async (personName, role) =>
    (
      await api("/api/app/salespeople", {
        method: "POST",
        cookie: admin,
        data: { dealer: dealer.id, name: personName, role },
      })
    ).value;
  const manager = await makePerson(`${name} manager`, "manager");
  const seller = await makePerson(`${name} seller`, "salesperson");
  const impersonate = async (person) => {
    const freshAdmin = (
      await api("/api/app/session", {
        method: "POST",
        data: {
          authType: "admin_password",
          username: adminName,
          password: adminPassword,
        },
      })
    ).cookie;
    return (
      await api("/api/app/session/impersonate", {
        method: "POST",
        cookie: freshAdmin,
        data: { personId: person.id },
      })
    ).cookie;
  };
  return {
    dealer,
    manager,
    seller,
    managerCookie: await impersonate(manager),
    sellerCookie: await impersonate(seller),
  };
}

function makePng() {
  // A small, deterministic, valid 1x1 RGB PNG. It contains no personal data.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pWQAAAAASUVORK5CYII=",
    "base64",
  );
}

function makeOperationForm({
  person,
  operation,
  caption,
  png,
  filename = "post-creative.png",
  mime = "image/png",
}) {
  const values = {
    salesperson_name: person.name,
    salesperson_id: person.id,
    style: "Modern",
    tone: "Excited",
    has_release: "false",
    has_video: "false",
    platform_ids: '["facebook_feed"]',
    media_output_mode: "photo",
    primary_format_id: "feed_portrait",
    image_aspect_ratio: "4:5",
    caption,
  };
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return value;
  };
  const fields = POST_FIELDS.map((name) => {
    // Deliberately mirror an already-open legacy client: LF is hashed before
    // native FormData converts it to CRLF, and legacy CRLF hashes stay intact.
    let value = String(values[name] || "");
    if (
      ["platform_ids", "platform_captions", "website_draft"].includes(name) &&
      value
    ) {
      try {
        value = JSON.stringify(canonical(JSON.parse(value)));
      } catch {}
    }
    return [name, value];
  });
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        fields,
        createHash("sha256").update(Buffer.from(png).toString("base64")).digest("hex"),
        [filename, mime.toLowerCase()],
      ]),
    )
    .digest("hex");
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value !== "") form.append(name, value);
  }
  form.append("save_operation_id", operation);
  form.append("save_payload_digest", digest);
  form.append("creative_image", new Blob([png], { type: mime }), filename);
  return { form, digest };
}

async function submitOperation(request, cookie, endpoint = base) {
  const response = await fetch(`${endpoint}/api/app/posts`, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: { Cookie: cookie, "X-Dealer-Client-Contract": "2026-07-31.v4" },
    body: request.form,
  });
  return {
    status: response.status,
    value: (response.headers.get("content-type") || "").includes("application/json")
      ? await response.json()
      : await response.arrayBuffer(),
  };
}

function makePostForm(png, withImage) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    style: "Modern",
    tone: "Excited",
    caption: "Synthetic local storage check.",
    platform_ids: JSON.stringify(["facebook_feed"]),
    media_output_mode: "photo",
    primary_format_id: "feed_portrait",
    image_aspect_ratio: "4:5",
  }))
    form.append(key, value);
  if (withImage)
    form.append(
      "creative_image",
      new Blob([png], { type: "image/png" }),
      "storage-check.png",
    );
  return form;
}

function makeSpinMetadata() {
  return {
    vehicle: {
      title: "2025 Synthetic Storage Test Vehicle",
      vin: "",
      stock: "QA",
      mileage: "1200",
      highlights: ["Synthetic local QA"],
      caption: "Storage guard canary.",
    },
    frameCount: 24,
    background: "original",
    reviewedAllAngles: true,
    vehicleOnly: true,
  };
}

async function addSpinFrame(spinId, cookie, angle, jpeg) {
  const form = new FormData();
  form.append("image", new Blob([jpeg], { type: "image/jpeg" }), `angle-${angle}.jpg`);
  const response = await fetch(
    `${base}/api/app/vehicle-spins/${spinId}/frames/${angle}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Cookie: cookie,
        "X-Dealer-Client-Contract": "2026-07-31.v4",
      },
      body: form,
    },
  );
  const value = await response.json();
  return { status: response.status, value };
}

async function countRecords() {
  const db = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
  try {
    const counts = {};
    for (const table of [
      "posts",
      "photo_releases",
      "vehicle_spins",
      "vehicle_spin_frames",
    ]) {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    }
    return counts;
  } finally {
    db.close();
  }
}

async function mediaRecordIds() {
  const db = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
  try {
    const ids = [];
    for (const query of [
      "SELECT id FROM posts WHERE creative_image != ''",
      "SELECT id FROM photo_releases WHERE signature_png != ''",
      "SELECT id FROM vehicle_spin_frames WHERE image != ''",
    ]) {
      ids.push(
        ...db
          .prepare(query)
          .all()
          .map((row) => row.id),
      );
    }
    return ids;
  } finally {
    db.close();
  }
}

async function filesUnder(directory) {
  let items;
  try {
    items = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const item of items) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...(await filesUnder(path)));
    else if (item.isFile()) files.push({ path, size: (await stat(path)).size });
  }
  return files;
}

async function mediaFiles() {
  return filesUnder(join(dataDir, "storage"));
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  stopping = true;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    childExit.then(() => true),
    new Promise((done) => setTimeout(() => done(false), 3000)),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await childExit;
  }
}

try {
  await Promise.all([
    mkdir(wrappers, { recursive: true }),
    mkdir(hooks, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(publicDir, { recursive: true }),
  ]);
  await cp(join(root, "pb_hooks"), hooks, { recursive: true });
  await writeFile(
    join(hooks, "media-storage-probe.pb.js"),
    `
routerAdd("POST", "/__media-storage/probe", (c) => {
  if (c.request().header.get("X-Probe-Secret") !== $os.getenv("MEDIA_PROBE_SECRET")) return c.noContent(404);
  const storage = require(__hooks + "/mediaStorage.js");
  try {
    storage.ensureStorageRoom(storage.MEDIA_BYTES.signature);
    return c.json(200, {available: true});
  } catch (error) {
    if (storage.respondIfLimited(c, error)) return;
    return c.json(500, {error: "probe failed"});
  }
});
`,
  );

  const dfWrapper = `#!/bin/sh
for path do :; done
case "$(cat ${shellQuote(probeModeFile)})" in
  unavailable) printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\ninvalid data\\n'; exit 0 ;;
esac
set -- $(${shellQuote(duPath)} -sk "$path")
used="$1"
IFS="$(printf '\\t')" read -r anchor reserve < ${shellQuote(capacityFile)}
available=$((anchor + reserve - (used - anchor)))
[ "$available" -lt 0 ] && available=0
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/synthetic 999999999 %s %s 0%% %s\\n' "$used" "$available" "$path"
`;
  const duWrapper = `#!/bin/sh
exec ${shellQuote(duPath)} "$@"
`;
  await writeFile(join(wrappers, "df"), dfWrapper, { mode: 0o755 });
  await writeFile(join(wrappers, "du"), duWrapper, { mode: 0o755 });
  await setCapacity(2 * 1024 * 1024);

  child = spawn(
    resolve(binary),
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--hooksDir=${hooks}`,
      `--migrationsDir=${join(root, "pb_migrations")}`,
      `--publicDir=${publicDir}`,
    ],
    {
      env: {
        PATH: `${wrappers}:${process.env.PATH || ""}`,
        ADMIN_LOGIN_USERNAME: adminName,
        ADMIN_LOGIN_PASSWORD: adminPassword,
        SALESPERSON_PIN_PEPPER: randomBytes(32).toString("hex"),
        GEMINI_API_KEY: "synthetic-never-used",
        MEDIA_PROBE_SECRET: probeSecret,
        VERCEL_TO_FLY_PROXY_SECRET: randomBytes(32).toString("hex"),
        TMPDIR: scratch,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    let partial = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() || "";
      serverLogs.push(...lines.slice(-30));
      if (serverLogs.length > 40) serverLogs.splice(0, serverLogs.length - 40);
    });
  }
  child.once("exit", (code, signal) => {
    if (!stopping && code !== 0)
      exitResolve(new Error(`PocketBase exited (${code ?? signal}).`));
    else exitResolve(null);
  });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("Isolated PocketBase failed to boot.");
    try {
      const response = await fetch(base + "/api/health", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  assert(ready, "Isolated PocketBase 0.22.55 did not become healthy in time.");

  const schemaDb = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
  try {
    const row = schemaDb
      .prepare("SELECT schema FROM _collections WHERE name = 'posts'")
      .get();
    const creative = JSON.parse(String(row.schema)).find(
      (field) => field.name === "creative_image",
    );
    assert.equal(
      creative?.options?.maxSize,
      8 * 1024 * 1024,
      "The mounted creative schema must match the reviewed storage reserve.",
    );
    checks.push("The mounted 8 MiB creative limit matches the storage reserve.");
  } finally {
    schemaDb.close();
  }

  const admin = (
    await api("/api/app/session", {
      method: "POST",
      data: {
        authType: "admin_password",
        username: adminName,
        password: adminPassword,
      },
    })
  ).cookie;
  assert(admin, "Synthetic system-admin session missing.");
  const a = await provisionDealer(admin, "Synthetic Storage A", true);
  const b = await provisionDealer(admin, "Synthetic Storage B", false);
  const png = makePng();
  const jpeg = await readFile(join(root, "e2e/fixtures/spin-angle.jpg"));

  const fullSpin = (
    await api("/api/app/vehicle-spins", {
      method: "POST",
      cookie: a.sellerCookie,
      data: makeSpinMetadata(),
      expected: 201,
    })
  ).value;
  for (let angle = 0; angle < 24; angle++) {
    const result = await addSpinFrame(fullSpin.id, a.sellerCookie, angle, jpeg);
    assert.equal(
      result.status,
      200,
      `Initial spin frame ${angle} failed: ${result.value.error || ""}`,
    );
  }
  checks.push(
    "Created one synthetic 24-frame spin and two dealer identities at ample isolated capacity.",
  );

  const nearSpinA = (
    await api("/api/app/vehicle-spins", {
      method: "POST",
      cookie: a.sellerCookie,
      data: makeSpinMetadata(),
      expected: 201,
    })
  ).value;
  const nearSpinB = (
    await api("/api/app/vehicle-spins", {
      method: "POST",
      cookie: b.sellerCookie,
      data: makeSpinMetadata(),
      expected: 201,
    })
  ).value;

  const metadataPost = await api("/api/app/posts", {
    method: "POST",
    cookie: b.sellerCookie,
    data: makePostForm(png, false),
    expected: 200,
  });
  assert(
    metadataPost.value.id && metadataPost.value.updated,
    "Baseline metadata draft missing its revision.",
  );

  const operationId = "mediaStorageSameOperation20261009";
  const operationCaption = "Concurrent local result recovery fixture.\n\n#Synthetic";
  const operationRequest = makeOperationForm({
    person: b.seller,
    operation: operationId,
    caption: operationCaption,
    png,
  });
  const beforeLedgerCounts = await countRecords();
  const beforeLedgerFiles = await mediaFiles();
  const beforeLedgerMediaIds = new Set(await mediaRecordIds());
  const concurrentSaves = await Promise.all([
    submitOperation(operationRequest, b.sellerCookie),
    submitOperation(
      makeOperationForm({
        person: b.seller,
        operation: operationId,
        caption: operationCaption,
        png,
      }),
      b.sellerCookie,
    ),
  ]);
  assert.deepEqual(
    concurrentSaves.map((item) => item.status),
    [200, 200],
  );
  assert(concurrentSaves[0].value.id);
  assert.equal(concurrentSaves[1].value.id, concurrentSaves[0].value.id);
  const afterConcurrentSaves = await countRecords();
  const filesAfterConcurrentSaves = await mediaFiles();
  const mediaIdsAfterConcurrentSaves = new Set(await mediaRecordIds());
  assert.equal(
    afterConcurrentSaves.posts - beforeLedgerCounts.posts,
    1,
    "Concurrent same-operation saves created more than one post.",
  );
  const previousLedgerPaths = new Set(beforeLedgerFiles.map((file) => file.path));
  const concurrentNewFiles = filesAfterConcurrentSaves.filter(
    (file) => !previousLedgerPaths.has(file.path),
  );
  const concurrentFileOwners = new Set(
    concurrentNewFiles.map((file) => file.path.split("/").at(-2)),
  );
  const concurrentNewMediaIds = [...mediaIdsAfterConcurrentSaves].filter(
    (id) => !beforeLedgerMediaIds.has(id),
  );
  assert.deepEqual(concurrentNewMediaIds, [concurrentSaves[0].value.id]);
  assert.deepEqual(
    [...concurrentFileOwners],
    [concurrentSaves[0].value.id],
    "Concurrent replay left duplicate or missing creative file ownership.",
  );
  checks.push(
    "Concurrent identical operation requests resolved to one post and one media file set.",
  );

  const otherDealerLookup = await api(
    `/api/app/post-operations/${operationId}?payload_digest=${operationRequest.digest}`,
    { cookie: a.sellerCookie, expected: 404 },
  );
  assert.equal(otherDealerLookup.value.code, "POST_SAVE_NOT_FOUND");
  checks.push("Another dealership could not discover a same-ID saved operation.");

  for (const variant of [
    { caption: "Changed caption." },
    { png: Buffer.from([...png, 0]) },
    { filename: "renamed-creative.png" },
    { mime: "image/jpeg" },
  ]) {
    const altered = makeOperationForm({
      person: b.seller,
      operation: operationId,
      caption: variant.caption || operationCaption,
      png: variant.png || png,
      filename: variant.filename || "post-creative.png",
      mime: variant.mime || "image/png",
    });
    const conflict = await submitOperation(altered, b.sellerCookie);
    assert.equal(
      conflict.status,
      409,
      "A changed save payload reused an existing operation.",
    );
    assert.equal(conflict.value.code, "POST_SAVE_PAYLOAD_CONFLICT");
  }
  checks.push(
    "Changed text, image bytes, filename, and MIME were bound to the original operation digest.",
  );

  await setCapacity(0);
  const fullSpaceReplay = await submitOperation(operationRequest, b.sellerCookie);
  assert.equal(
    fullSpaceReplay.status,
    200,
    "An exact replay should succeed before checking the full-storage gate.",
  );
  assert.equal(fullSpaceReplay.value.id, concurrentSaves[0].value.id);
  const afterFullReplay = await countRecords();
  const filesAfterFullReplay = await mediaFiles();
  assert.equal(afterFullReplay.posts, afterConcurrentSaves.posts);
  assert.equal(filesAfterFullReplay.length, filesAfterConcurrentSaves.length);
  checks.push(
    "An exact operation replay recovered the existing post while the fake capacity was full without new assets.",
  );
  await setCapacity(2 * 1024 * 1024);

  const legacyOperationId = "mediaStorageLegacyCrlfOperation20261010";
  const legacyRequest = makeOperationForm({
    person: b.seller,
    operation: legacyOperationId,
    caption: "Legacy multiline recovery fixture.\r\n\r\n#Synthetic",
    png,
  });
  const beforeLegacy = await countRecords();
  const legacySaved = await submitOperation(legacyRequest, b.sellerCookie);
  assert.equal(legacySaved.status, 200);
  const legacyRetry = await submitOperation(legacyRequest, b.sellerCookie);
  assert.equal(legacyRetry.status, 200);
  assert.equal(legacyRetry.value.id, legacySaved.value.id);
  const legacyLookup = await api(
    `/api/app/post-operations/${legacyOperationId}?payload_digest=${legacyRequest.digest}`,
    { cookie: b.sellerCookie },
  );
  assert.equal(legacyLookup.value.id, legacySaved.value.id);
  assert.equal((await countRecords()).posts - beforeLegacy.posts, 1);
  const legacyDb = new DatabaseSync(join(dataDir, "data.db"));
  try {
    assert.equal(
      legacyDb
        .prepare(
          "SELECT payload_digest FROM _post_save_operations WHERE operation_id = ?",
        )
        .get(legacyOperationId).payload_digest,
      legacyRequest.digest,
      "Legacy recovery must retain the verified original operation digest.",
    );
  } finally {
    legacyDb.close();
  }
  const invalidDigestRequest = makeOperationForm({
    person: b.seller,
    operation: legacyOperationId,
    caption: "Legacy multiline recovery fixture.\r\n\r\n#Synthetic",
    png,
  });
  invalidDigestRequest.form.set("save_payload_digest", "0".repeat(64));
  const invalidDigestSave = await submitOperation(invalidDigestRequest, b.sellerCookie);
  assert.equal(invalidDigestSave.status, 400);
  assert.equal(invalidDigestSave.value.code, "POST_SAVE_PAYLOAD_INVALID");
  assert.equal((await countRecords()).posts - beforeLegacy.posts, 1);
  checks.push(
    "Native multipart LF and legacy CRLF saves/retries preserved one post, its exact operation digest, and rejected a forged digest.",
  );

  let relay;
  const unknownOperationId = "mediaStorageLostResponse20261009";
  const unknownRequest = makeOperationForm({
    person: b.seller,
    operation: unknownOperationId,
    caption: "Lost-response recovery fixture.",
    png,
  });
  const beforeUnknown = await countRecords();
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const relayPort = portProbe.address().port;
  await new Promise((done) => portProbe.close(done));
  relay = createHttpServer((incoming, outgoing) => {
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        response.resume();
        response.on("end", () => outgoing.destroy());
      },
    );
    upstream.on("error", () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  relay.listen(relayPort, "127.0.0.1");
  await once(relay, "listening");
  let responseWasLost = false;
  try {
    await submitOperation(
      unknownRequest,
      b.sellerCookie,
      `http://127.0.0.1:${relayPort}`,
    );
  } catch {
    responseWasLost = true;
  } finally {
    await new Promise((done) => relay.close(done));
    relay = null;
  }
  assert(
    responseWasLost,
    "The loopback response-drop proxy did not interrupt the save response.",
  );
  const reconciled = await api(
    `/api/app/post-operations/${unknownOperationId}?payload_digest=${unknownRequest.digest}`,
    { cookie: b.sellerCookie },
  );
  assert(reconciled.value.id);
  assert.equal(
    reconciled.value.id !== concurrentSaves[0].value.id,
    true,
    "Different operation ids unexpectedly resolved to one post.",
  );
  const afterUnknown = await countRecords();
  assert.equal(
    afterUnknown.posts - beforeUnknown.posts,
    1,
    "The interrupted response did not correspond to one committed post.",
  );
  checks.push(
    "An intentionally dropped loopback response was reconciled to the one committed post.",
  );

  await api(`/api/app/posts/${reconciled.value.id}/draft`, {
    method: "PATCH",
    cookie: b.sellerCookie,
    data: {
      expected_post_revision: reconciled.value.updated,
      caption: "Changed after the save result committed.",
      disclosures: "",
    },
    expected: 200,
  });
  const changedResult = await api(
    `/api/app/post-operations/${unknownOperationId}?payload_digest=${unknownRequest.digest}`,
    { cookie: b.sellerCookie, expected: 409 },
  );
  assert.equal(changedResult.value.code, "POST_SAVE_RESULT_CHANGED");
  checks.push(
    "An edited committed result was not adopted by later ledger reconciliation.",
  );

  const countsBeforeBoundary = await countRecords();
  const filesBeforeBoundary = await mediaFiles();
  const mediaIdsBeforeBoundary = new Set(await mediaRecordIds());
  await setCapacity(liveMediaFloorKiB);

  const boundaryRequests = [
    fetch(base + "/api/app/posts", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Cookie: b.sellerCookie, "X-Dealer-Client-Contract": "2026-07-31.v4" },
      body: makePostForm(png, true),
    }),
    fetch(base + "/api/app/photo_releases", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Cookie: a.sellerCookie, "X-Dealer-Client-Contract": "2026-07-31.v4" },
      body: (() => {
        const form = new FormData();
        form.append("customer_name", "Synthetic Customer");
        form.append("vin", "");
        form.append(
          "signature_png",
          new Blob([png], { type: "image/png" }),
          "signature.png",
        );
        return form;
      })(),
    }),
    addSpinFrame(nearSpinA.id, a.sellerCookie, 0, jpeg),
    addSpinFrame(nearSpinB.id, b.sellerCookie, 0, jpeg),
    addSpinFrame(nearSpinB.id, b.sellerCookie, 1, jpeg),
  ];
  const rawBoundary = await Promise.all(boundaryRequests);
  const boundaryResults = await Promise.all(
    rawBoundary.map(async (item) => {
      if (item instanceof Response) {
        return {
          status: item.status,
          value: (item.headers.get("content-type") || "").includes("application/json")
            ? await item.json()
            : await item.arrayBuffer(),
        };
      }
      return item;
    }),
  );
  const [postWrite, signatureWrite, ...frameWrites] = boundaryResults;
  assert(
    [200, 507].includes(postWrite.status),
    `Concurrent post returned ${postWrite.status}: ${postWrite.value.error || ""}`,
  );
  assert(
    [200, 507].includes(signatureWrite.status),
    `Concurrent signature returned ${signatureWrite.status}: ${signatureWrite.value.error || ""}`,
  );
  for (const result of frameWrites)
    assert(
      [200, 507].includes(result.status),
      `Concurrent frame returned ${result.status}: ${result.value.error || ""}`,
    );

  const statuses = [
    postWrite.status,
    signatureWrite.status,
    ...frameWrites.map((result) => result.status),
  ];
  assert(
    statuses.includes(507),
    "The concurrent cross-dealer media burst never reached the storage boundary.",
  );
  assert(
    statuses.some((status) => status === 200),
    "No near-boundary media write was accepted.",
  );

  const afterRace = await countRecords();
  const afterRaceFiles = await mediaFiles();
  const validMediaIdsAfterRace = new Set(await mediaRecordIds());
  const acceptedFrames = frameWrites.filter((result) => result.status === 200).length;
  assert.equal(
    afterRace.vehicle_spin_frames - countsBeforeBoundary.vehicle_spin_frames,
    acceptedFrames,
    "A rejected frame request left a frame record behind.",
  );
  assert.equal(
    afterRace.posts - countsBeforeBoundary.posts,
    postWrite.status === 200 ? 1 : 0,
    "A rejected creative post left a database record.",
  );
  assert.equal(
    afterRace.photo_releases - countsBeforeBoundary.photo_releases,
    signatureWrite.status === 200 ? 1 : 0,
    "Rejected signature left a release record or accepted signature was not persisted.",
  );
  const previousPaths = new Set(filesBeforeBoundary.map((file) => file.path));
  const newFiles = afterRaceFiles.filter((file) => !previousPaths.has(file.path));
  const newFileRecordIds = newFiles.map((file) => file.path.split("/").at(-2));
  assert(
    newFiles.length > 0,
    "Accepted concurrent media writes persisted no actual files.",
  );
  assert(
    newFileRecordIds.every((id) => validMediaIdsAfterRace.has(id)),
    "A rejected media request left an orphaned file.",
  );
  const newLogicalMediaIds = [...validMediaIdsAfterRace].filter(
    (id) => !mediaIdsBeforeBoundary.has(id),
  );
  assert.equal(
    newLogicalMediaIds.length,
    statuses.filter((status) => status === 200).length,
    "An accepted media request did not persist its matching file record.",
  );
  checks.push(
    `Concurrent writes across two dealerships serialized at the shared disk boundary (${statuses.filter((status) => status === 200).length} accepted, ${statuses.filter((status) => status === 507).length} returned 507; rejected records/assets absent).`,
  );

  // Leave only a small verified margin: zero-byte metadata writes remain safe,
  // while every actual media class and the explicit safe probe are rejected.
  await setCapacity(reserveBufferKiB + 64);
  const mediaProbe = await fetch(base + "/__media-storage/probe", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "X-Probe-Secret": probeSecret },
  });
  const mediaProbeBody = await mediaProbe.json();
  assert.equal(
    mediaProbe.status,
    507,
    `Signature-sized safe probe should return 507, got ${mediaProbe.status}.`,
  );
  assert.equal(mediaProbeBody.code, "MEDIA_STORAGE_LIMITED");

  await api(`/api/app/posts/${metadataPost.value.id}/draft`, {
    method: "PATCH",
    cookie: b.sellerCookie,
    data: {
      expected_post_revision: metadataPost.value.updated,
      caption: "Metadata-only draft remains available at low space.",
      disclosures: "",
    },
    expected: 200,
  });
  checks.push(
    "A metadata-only draft save succeeded while media writes were storage-limited.",
  );

  const logoCountsBefore = await countRecords();
  const logoFilesBefore = await mediaFiles();
  const logoForm = new FormData();
  logoForm.append("name", b.dealer.name);
  logoForm.append("logo", new Blob([png], { type: "image/png" }), "synthetic-logo.png");
  const rejectedLogo = await fetch(`${base}/api/app/dealers/${b.dealer.id}`, {
    method: "PATCH",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Cookie: b.managerCookie,
      "X-Dealer-Client-Contract": "2026-07-31.v4",
    },
    body: logoForm,
  });
  const rejectedLogoBody = await rejectedLogo.json();
  assert.equal(rejectedLogo.status, 507);
  assert.equal(rejectedLogoBody.code, "MEDIA_STORAGE_LIMITED");
  assert.deepEqual(await countRecords(), logoCountsBefore);
  assert.deepEqual(
    (await mediaFiles()).map((file) => file.path).sort(),
    logoFilesBefore.map((file) => file.path).sort(),
    "The rejected logo upload left a record or file behind.",
  );
  checks.push(
    "A logo-image upload returned 507 at low space and left no files behind.",
  );

  await api(`/api/app/dealers/${b.dealer.id}`, {
    method: "PATCH",
    cookie: b.managerCookie,
    data: { logo_placement: { corner: "bottom_right", scale: 0.2 } },
    expected: 200,
  });
  checks.push("The saved logo-placement setting remained editable at low space.");

  const submitted = (
    await api(`/api/app/vehicle-spins/${fullSpin.id}/finish`, {
      method: "POST",
      cookie: a.sellerCookie,
    })
  ).value;
  assert.equal(submitted.state, "pending");
  const approved = (
    await api(`/api/app/vehicle-spins/${fullSpin.id}/review`, {
      method: "POST",
      cookie: a.managerCookie,
      data: { decision: "approved", reviewedAllAngles: true },
    })
  ).value;
  assert.equal(approved.state, "approved");
  const readBack = (
    await api(`/api/app/vehicle-spins/${fullSpin.id}`, { cookie: a.sellerCookie })
  ).value;
  assert.equal(readBack.state, "approved");
  assert.equal(readBack.uploadedAngles.length, 24);
  const image = await fetch(`${base}/api/app/vehicle-spins/${fullSpin.id}/frames/0`, {
    signal: AbortSignal.timeout(20_000),
    headers: { Cookie: a.sellerCookie, "X-Dealer-Client-Contract": "2026-07-31.v4" },
  });
  assert.equal(
    image.status,
    200,
    "Previously completed frame was unreadable at low storage.",
  );
  assert.match(image.headers.get("content-type") || "", /^image\/jpeg/);
  checks.push(
    "The existing full spin remained finishable, reviewable, and readable at low space.",
  );

  await writeFile(probeModeFile, "unavailable\n");
  const unavailableProbe = await fetch(base + "/__media-storage/probe", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "X-Probe-Secret": probeSecret },
  });
  const unavailableBody = await unavailableProbe.json();
  assert.equal(
    unavailableProbe.status,
    507,
    "An unavailable capacity measurement must fail closed with 507.",
  );
  assert.equal(unavailableBody.code, "MEDIA_STORAGE_LIMITED");
  checks.push("An unknown/unavailable capacity reading failed closed as 507.");

  await setCapacity(2 * 1024 * 1024);
  const rollbackOperationId = "mediaStorageCompletionRollback20261009";
  const rollbackOperation = makeOperationForm({
    person: b.seller,
    operation: rollbackOperationId,
    caption: "Synthetic completion-rollback fixture.",
    png,
  });
  const beforeRollbackCounts = await countRecords();
  const beforeRollbackMedia = await mediaFiles();
  const rollbackTrigger = `media_storage_rollback_${randomBytes(6).toString("hex")}`;
  const triggerDb = new DatabaseSync(join(dataDir, "data.db"));
  try {
    triggerDb.exec(
      `CREATE TRIGGER ${rollbackTrigger} BEFORE UPDATE OF result_digest ` +
        "ON _post_save_operations BEGIN SELECT RAISE(ABORT, 'synthetic completion abort'); END;",
    );
  } finally {
    triggerDb.close();
  }
  let abortedCompletion;
  try {
    abortedCompletion = await submitOperation(rollbackOperation, b.sellerCookie);
  } finally {
    const dropTriggerDb = new DatabaseSync(join(dataDir, "data.db"));
    try {
      dropTriggerDb.exec(`DROP TRIGGER IF EXISTS ${rollbackTrigger}`);
    } finally {
      dropTriggerDb.close();
    }
  }
  assert.equal(abortedCompletion.status, 400);
  const afterRollbackCounts = await countRecords();
  const afterRollbackMedia = await mediaFiles();
  assert.equal(afterRollbackCounts.posts, beforeRollbackCounts.posts);
  assert.deepEqual(
    afterRollbackMedia.map((file) => file.path).sort(),
    beforeRollbackMedia.map((file) => file.path).sort(),
    "A rolled-back completion left a newly uploaded creative behind.",
  );
  const missingRollbackOperation = await api(
    `/api/app/post-operations/${rollbackOperationId}?payload_digest=${rollbackOperation.digest}`,
    { cookie: b.sellerCookie, expected: 404 },
  );
  assert.equal(missingRollbackOperation.value.code, "POST_SAVE_NOT_FOUND");
  checks.push(
    "A forced final ledger-update error rolled back the post/ledger and removed its uncommitted creative.",
  );

  checksRecord.status = "passed";
  checksRecord.completedAt = new Date().toISOString();
  checksRecord.policyModel = {
    reserveBufferMiB: 256,
    mediaIncomingBytes: {
      creative: 8 * 1024 * 1024,
      signature: 512000,
      spinFrame: 500000,
    },
    fakeCapacity:
      "available = anchored actual du + configured reserve - actual du growth",
  };
  console.log(JSON.stringify(checksRecord, null, 2));
} catch (error) {
  checksRecord.status = "failed";
  checksRecord.error = error.message;
  if (serverLogs.length) checksRecord.recentPocketBaseLogs = serverLogs.slice(-20);
  console.error(JSON.stringify(checksRecord, null, 2));
  throw error;
} finally {
  await stopChild();
  await rm(scratch, { recursive: true, force: true });
  // Retain only fixed check descriptions and numeric policy facts. Failed
  // backend logs, requests, temporary credentials and scratch paths stay out.
  const evidenceDirectory = join(root, ".release-evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    join(evidenceDirectory, "media-storage-canary.json"),
    JSON.stringify(
      {
        status: checksRecord.status,
        binaryVersion: checksRecord.binaryVersion,
        checks,
        completedAt: checksRecord.completedAt || new Date().toISOString(),
        revision: process.env.GITHUB_SHA || "local-working-tree",
        environment: "isolated loopback; synthetic data and child-only capacity tools",
        policyModel: checksRecord.policyModel || null,
      },
      null,
      2,
    ),
  );
}
