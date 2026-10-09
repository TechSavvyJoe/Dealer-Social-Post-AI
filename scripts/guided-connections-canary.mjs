// Pinned backend, fresh temporary DB, synthetic accounts/secrets, loopback
// receiver only. This script cannot target a dealership or paid provider.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const binary = process.env.POCKETBASE_TEST_BINARY;
assert(
  binary &&
    /0\.22\.55\b/.test(
      spawnSync(resolve(binary), ["--version"], { encoding: "utf8" }).stdout,
    ),
);
const root = resolve(new URL("..", import.meta.url).pathname);
const scratch = await mkdtemp(join(tmpdir(), "dsp-connections-qa-"));
const key = randomBytes(24).toString("base64"),
  password = randomBytes(24).toString("hex"),
  proxy = randomBytes(24).toString("hex");
let child,
  log = "",
  redirectedRequests = 0;
const checks = [];
const receiver = createServer(async (request, response) => {
  if (request.url === "/redirected") {
    redirectedRequests++;
    response.end("must not reach");
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: "/redirected" });
    response.end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ body, authorization: request.headers.authorization }));
});
receiver.listen(0, "127.0.0.1");
await once(receiver, "listening");
const receiverPort = receiver.address().port;
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const base = `http://127.0.0.1:${port}`;
async function api(path, { cookie, method = "GET", data, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      "X-Dealer-Client-Contract": "2026-07-31.v4",
      "X-Dealer-Proxy-Secret": proxy,
      "X-Vercel-Forwarded-For": "203.0.113.254",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  assert.equal(
    response.status,
    status,
    `${path} ${response.status} ${value.code || ""}`,
  );
  return {
    value,
    cookie: response.headers.get("set-cookie")?.match(/dealer_session=([^;]+)/)?.[0],
  };
}
try {
  await cp(join(root, "pb_hooks"), join(scratch, "hooks"), { recursive: true });
  await mkdir(join(scratch, "public"));
  await mkdir(join(scratch, "empty-hooks"));
  await cp(join(root, "pb_migrations"), join(scratch, "migrations"), {
    recursive: true,
  });
  await writeFile(
    join(scratch, "hooks/connections-probe.pb.js"),
    `routerAdd("GET", "/__connections/probe", (c) => {
    if(c.request().header.get("X-Dealer-Proxy-Secret")!==$os.getenv("VERCEL_TO_FLY_PROXY_SECRET"))return c.noContent(404);
    const http=require(__hooks+"/safeHttp.js");
    const response=http.send({url:"http://127.0.0.1:${receiverPort}/echo",method:"POST",headers:{Authorization:"Bearer synthetic"},body:JSON.stringify({text:"Unicode café · quote \\\" and slash \\\\"}),timeout:3});
    let redirectBlocked=false;try{http.send({url:"http://127.0.0.1:${receiverPort}/redirect",method:"GET",timeout:3})}catch(_e){redirectBlocked=true}
    const config=require(__hooks+"/connectionConfig.js");return c.json(200,{echo:response.json,redirectBlocked,audit:config.verifyStoredEncryption(),runtimeBlocked:config.runtimeValue("GEMINI_API_KEY")===""});
  });
  routerAdd("POST", "/__connections/tamper", (c) => {
    if(c.request().header.get("X-Dealer-Proxy-Secret")!==$os.getenv("VERCEL_TO_FLY_PROXY_SECRET"))return c.noContent(404);
    const dao=$app.dao(),row=dao.findFirstRecordByFilter("managed_connections","service = 'gemini'");
    const key=$os.getenv("CONNECTIONS_ENCRYPTION_KEY");
    const envelope=JSON.parse(toString($security.decrypt(row.getString("ciphertext"),key)));
    envelope.revision+=1;
    row.set("ciphertext",$security.encrypt(JSON.stringify(envelope),key));dao.saveRecord(row);
    const config=require(__hooks+"/connectionConfig.js");return c.json(200,{audit:config.verifyStoredEncryption(),blocked:config.runtimeValue("GEMINI_API_KEY")===""});
  });`,
  );
  async function startBackend(encryptionKey) {
    child = spawn(
      resolve(binary),
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
          ADMIN_LOGIN_USERNAME: "connections.qa",
          ADMIN_LOGIN_PASSWORD: password,
          SALESPERSON_PIN_PEPPER: proxy,
          VERCEL_TO_FLY_PROXY_SECRET: proxy,
          GEMINI_API_KEY: "synthetic-provider-key",
          CONNECTIONS_ENCRYPTION_KEY: encryptionKey,
          CONNECTIONS_ALLOWED_ORIGINS: "https://synthetic-destination.example",
          SAFE_HTTP_ALLOW_LOOPBACK_TEST: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    let booted = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Pinned backend failed to boot");
      try {
        const response = await fetch(base + "/api/health", {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          booted = true;
          break;
        }
      } catch {}
      await new Promise((done) => setTimeout(done, 250));
    }
    assert(booted);
  }
  async function stopBackend() {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    child = undefined;
  }
  await startBackend(key);
  await api("/api/app/connections", { status: 401 });
  const admin = (
    await api("/api/app/session", {
      method: "POST",
      data: { authType: "admin_password", username: "connections.qa", password },
    })
  ).cookie;
  assert(admin);
  const before = (await api("/api/app/connections", { cookie: admin })).value;
  assert.equal(before.scope, "guided_setup");
  assert.equal(before.secureStorageAvailable, true);
  assert.equal(
    before.services.find((row) => row.service === "gemini").state,
    "needs_test",
  );
  const synthetic = "synthetic-new-provider-key";
  const after = (
    await api("/api/app/connections/gemini", {
      cookie: admin,
      method: "PATCH",
      data: {
        expectedRevision: 0,
        enabled: true,
        settings: {},
        credentials: { apiKey: synthetic },
        confirmApply: true,
      },
    })
  ).value;
  assert.equal(after.revision, 1);
  assert.equal(after.state, "needs_test");
  assert(!JSON.stringify(after).includes(synthetic));
  await api("/api/app/connections/gemini", {
    cookie: admin,
    method: "PATCH",
    status: 409,
    data: {
      expectedRevision: 0,
      enabled: true,
      settings: {},
      credentials: {},
      confirmApply: true,
    },
  });
  await api("/api/collections/managed_connections/records", { status: 403 });
  const dealer = (
    await api("/api/app/dealers", {
      cookie: admin,
      method: "POST",
      data: { name: "Synthetic Connections Store", requires_approval: true },
    })
  ).value;
  const secondDealer = (
    await api("/api/app/dealers", {
      cookie: admin,
      method: "POST",
      data: { name: "Synthetic Other Store", requires_approval: true },
    })
  ).value;
  const website = (
    await api("/api/app/connections/website", {
      cookie: admin,
      method: "PATCH",
      data: {
        dealerId: dealer.id,
        expectedRevision: 0,
        enabled: true,
        confirmApply: true,
        settings: {
          origin: "https://synthetic-destination.example",
          destinationId: "synthetic-store",
        },
        credentials: {
          sharedSecret: "synthetic-website-secret-at-least-32-characters",
        },
      },
    })
  ).value;
  assert.equal(website.settings.origin, "https://synthetic-destination.example");
  assert.equal(website.state, "needs_test");
  assert.equal(website.credentialConfigured.sharedSecret, true);
  assert(!JSON.stringify(website).includes("synthetic-website-secret"));
  await api("/api/app/connections/website", {
    cookie: admin,
    method: "PATCH",
    status: 400,
    data: {
      dealerId: dealer.id,
      expectedRevision: 1,
      enabled: true,
      confirmApply: true,
      settings: {
        siteUrl: "https://synthetic-destination.example",
        destinationId: "synthetic-store",
      },
      credentials: {},
    },
  });
  const scoped = (await api("/api/app/connections", { cookie: admin })).value.services;
  assert.equal(
    scoped.find((row) => row.service === "website" && row.dealerId === secondDealer.id)
      .configured,
    false,
  );
  checks.push(
    "real website setup uses canonical origin and rejects unknown fields",
    "website configuration stays isolated to selected dealership",
  );
  const probe = (await api("/__connections/probe")).value;
  assert.equal(probe.redirectBlocked, true);
  assert.equal(redirectedRequests, 0);
  assert.equal(probe.audit.ok, true);
  assert.equal(probe.audit.count, 2);
  assert.equal(probe.echo.authorization, "Bearer synthetic");
  assert.match(probe.echo.body, /café/);
  // Search the actual SQLite file, not merely the status DTO, for plaintext.
  const db = await readFile(join(scratch, "data/data.db"));
  assert(!db.includes(Buffer.from(synthetic)));
  checks.push(
    "real migration",
    "authenticated setup",
    "write-only credentials",
    "encrypted DB",
    "revision conflict",
    "locked collection",
    "restore decryption audit",
    "UTF-8 stdin transport",
    "redirect blocked",
  );
  // Copy only this synthetic scratch DB after shutdown; never migrate a running
  // database or any workspace/production pb_data. Check physical columns too,
  // because PB0.22 can print Reverted for incorrect schema-removal idioms.
  await stopBackend();
  const downData = join(scratch, "down-data");
  await cp(join(scratch, "data"), downData, { recursive: true });
  function sql(query) {
    const result = spawnSync("sqlite3", ["-json", join(downData, "data.db"), query], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, "Scratch SQLite inspection failed");
    return JSON.parse(result.stdout || "[]");
  }
  const bindings = {
    website_publications: ["config_revision", "destination_identity"],
    walkaround_projects: [
      "config_revision",
      "destination_identity",
      "youtube_identity",
    ],
    walkaround_assets: ["metadata_revision"],
  };
  for (const [table, fields] of Object.entries(bindings)) {
    const names = sql(`PRAGMA table_info("${table}")`).map((row) => row.name);
    for (const field of fields)
      assert(names.includes(field), `Up migration missing ${table}.${field}`);
  }
  // PB's confirmation widget cancels even with exit 0 when stdin is a pipe.
  // Supply a real PTY and respond to its cursor-position queries and confirm
  // key. This wrapper runs exclusively against the copied synthetic DB.
  const down = spawnSync(
    "python3",
    [
      "-c",
      `import os,pty,select,sys,time
pid,fd=pty.fork()
if pid==0:
 os.execv(sys.argv[1],sys.argv[1:])
output=b'';confirmed=False;deadline=time.monotonic()+25
while time.monotonic()<deadline:
 ready,_,_=select.select([fd],[],[],0.2)
 if ready:
  try: chunk=os.read(fd,65536)
  except OSError: break
  if not chunk: break
  output+=chunk
  for _ in range(chunk.count(b'\\x1b[6n')): os.write(fd,b'\\x1b[1;1R')
  if b'(y/N)' in output and not confirmed:
   os.write(fd,b'y\\r');confirmed=True
 done,status=os.waitpid(pid,os.WNOHANG)
 if done:
  sys.stdout.buffer.write(output);sys.exit(os.waitstatus_to_exitcode(status))
else:
 os.kill(pid,9)
 _,status=os.waitpid(pid,0)
sys.stdout.buffer.write(output)
try: _,status=os.waitpid(pid,0)
except ChildProcessError: pass
sys.exit(os.waitstatus_to_exitcode(status))`,
      resolve(binary),
      "migrate",
      "down",
      "2",
      `--dir=${downData}`,
      `--migrationsDir=${join(scratch, "migrations")}`,
      `--hooksDir=${join(scratch, "empty-hooks")}`,
    ],
    { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH } },
  );
  assert.equal(down.status, 0, "Scratch down migration failed");
  assert.equal(
    sql(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('managed_connections','connection_verifications')",
    ).length,
    0,
    "Down command did not remove guided tables: " + down.stdout.slice(-1500),
  );
  for (const [table, fields] of Object.entries(bindings)) {
    const names = sql(`PRAGMA table_info("${table}")`).map((row) => row.name);
    assert(names.length > 0, `Down migration removed existing ${table}`);
    for (const field of fields)
      assert(!names.includes(field), `Down migration retained ${table}.${field}`);
  }
  const collections = sql(
    "SELECT name,schema FROM _collections WHERE name IN ('website_publications','walkaround_projects','walkaround_assets')",
  );
  assert.equal(collections.length, 3);
  for (const collection of collections)
    for (const field of bindings[collection.name])
      assert(
        !JSON.parse(collection.schema).some((row) => row.name === field),
        `Stored schema retained ${collection.name}.${field}`,
      );
  checks.push(
    "both new down migrations on copied scratch DB",
    "physical columns and collection schemas removed",
  );
  // A wrong vault key must not recover credentials or resurrect the legacy
  // environment provider value; then restore the key and corrupt an envelope
  // binding using valid authenticated encryption, proving decryption alone is
  // insufficient for restore acceptance.
  await startBackend(randomBytes(24).toString("base64"));
  const wrongKey = (await api("/__connections/probe")).value;
  assert.deepEqual(wrongKey.audit, { ok: false, count: 2 });
  assert.equal(wrongKey.runtimeBlocked, true);
  const wrongConfig = (
    await api("/api/app/connections", { cookie: admin })
  ).value.services.find((row) => row.service === "gemini");
  assert.equal(wrongConfig.state, "attention");
  assert.equal(wrongConfig.configured, false);
  checks.push(
    "wrong encryption key rejects restore, configuration and runtime fallback",
  );
  await stopBackend();
  await startBackend(key);
  assert.deepEqual((await api("/__connections/probe")).value.audit, {
    ok: true,
    count: 2,
  });
  const tampered = (await api("/__connections/tamper", { method: "POST" })).value;
  assert.deepEqual(tampered.audit, { ok: false, count: 2 });
  assert.equal(tampered.blocked, true);
  checks.push("authenticated tampered envelope rejects restore and runtime fallback");
  console.log(JSON.stringify({ status: "passed", pocketbase: "0.22.55", checks }));
} catch (error) {
  // Probe inputs are synthetic; keep logs bounded and never save a DB copy.
  console.error(log.slice(-1800));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  await new Promise((done) => receiver.close(done));
  await rm(scratch, { recursive: true, force: true });
}
