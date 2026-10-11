// Isolated pinned JSVM and synthetic files only; never calls a provider or Hub.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function runWebsiteMediaEncodingCanary() {
  const image = process.env.MEDIA_ENCODER_TEST_IMAGE;
  if (image) {
    assert.equal(process.platform, "linux", "container networking requires Linux");
    assert.match(image, /^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]{0,255}$/);
  } else assert(process.env.POCKETBASE_TEST_BINARY, "Set POCKETBASE_TEST_BINARY.");
  const binary = image ? "/pb/pocketbase" : resolve(process.env.POCKETBASE_TEST_BINARY);
  const version = image
    ? execFileSync(
        "docker",
        ["run", "--rm", "--entrypoint", binary, image, "--version"],
        { encoding: "utf8", timeout: 15000 },
      )
    : execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 15000 });
  assert.match(version, /0\.22\.55\b/);
  const scratch = await mkdtemp(join(tmpdir(), "dsp-media-encoder-qa-"));
  const runtimeRoot = image ? "/qa" : scratch;
  const containerName = `dsp-media-encoder-${process.pid}-${scratch.split("-").at(-1)}`;
  const sizes = [1, 2, 3, 4, 49151, 49152, 49153, 49154, 2200003, 8 * 1024 * 1024];
  let child, hardStop;
  let logs = "";
  const proofs = [];
  let pendingProbe = null;
  try {
    for (const name of [
      "hooks",
      "data/storage/synthetic",
      "migrations",
      "public",
      "temporary",
    ])
      await mkdir(join(scratch, name), { recursive: true });
    await cp(
      new URL("../pb_hooks/websitePublications.js", import.meta.url),
      join(scratch, "hooks/websitePublications.js"),
    );
    const source = await readFile(
      join(scratch, "hooks/websitePublications.js"),
      "utf8",
    );
    // Expose the real caller only in this scratch copy, to exercise double-close.
    await writeFile(
      join(scratch, "hooks/websitePublications.js"),
      source + "\nmodule.exports.readPostCreative = readPostCreative;\n",
    );
    await cp(
      new URL("../pb_hooks/postSaveOperations.js", import.meta.url),
      join(scratch, "hooks/postSaveOperations.js"),
    );
    const operationsSource = await readFile(
      join(scratch, "hooks/postSaveOperations.js"),
      "utf8",
    );
    const nodeOperations = { exports: {} };
    new Function(
      "module",
      "exports",
      "require",
      "__hooks",
      "$security",
      operationsSource,
    )(
      nodeOperations,
      nodeOperations.exports,
      () => ({ base64EncodeReader: (reader) => reader.base64 }),
      "/synthetic-hooks",
      { sha256: (value) => createHash("sha256").update(value).digest("hex") },
    );
    const hashes = {},
      fingerprintHashes = {};
    for (const size of sizes) {
      const bytes = Buffer.alloc(size);
      for (let index = 0; index < size; index++) bytes[index] = (index * 73 + 19) & 255;
      await writeFile(join(scratch, `data/storage/synthetic/${size}.jpg`), bytes, {
        mode: 0o600,
      });
      hashes[size] = createHash("sha256")
        .update(bytes.toString("base64"))
        .digest("hex");
      fingerprintHashes[size] = nodeOperations.exports.fingerprint(
        {},
        {
          reader: { open: () => ({ base64: bytes.toString("base64"), close() {} }) },
          originalName: `${size}.jpg`,
          size,
        },
        "image/jpeg",
      );
    }
    await writeFile(join(scratch, "hang-marker"), "", { mode: 0o600 });
    await writeFile(
      join(scratch, "hooks/probe.pb.js"),
      `routerAdd("GET", "/probe", c => {
      const module = require(__hooks + "/websitePublications.js");
      const mode = c.queryParam("mode"), size = Number(c.queryParam("size")) || 1;
      const originalCmd = $os.cmd, originalDirFS = $os.dirFS, originalToString = toString;
      const calls = [], startedAt = Date.now();
      let native = false, fsys = null, reader = null;
      try {
        try { const file=$os.dirFS("/usr/bin").open("timeout"); file.close(); native=true; } catch (_error) {}
        if(mode === "fallback" || mode === "fingerprint_fallback") $os.dirFS = undefined;
        $os.cmd = function() {
          const args=Array.prototype.slice.call(arguments); calls.push(args);
          if(JSON.stringify(args) !== JSON.stringify(["/usr/bin/timeout","--foreground","--signal=KILL","10s","/usr/bin/base64","--wrap=0"])) throw new Error("unexpected_encoder_arguments");
          const actual=args.slice();
          if(mode === "nonzero") { actual[4]="/usr/bin/false"; actual.length=5; }
          if(mode === "overflow") { actual[4]="/usr/bin/yes"; actual[5]="A"; }
          if(mode === "timeout") { actual[4]="/usr/bin/tail"; actual[5]="-f"; actual.push(${JSON.stringify(runtimeRoot + "/hang-marker")}); }
          if(mode === "malformed") { actual[4]="/usr/bin/printf"; actual[5]="AB=="; }
          return originalCmd.apply($os,actual);
        };
        if(mode === "output_read_failure") toString = () => { throw new Error("synthetic_output_read_failure"); };
        if(mode === "empty" || mode === "too_large") {
          let consumed=false; try { module.base64EncodeReader({read:()=>{consumed=true;return 0},close:()=>{}}, mode === "empty" ? 0 : 8388609); }
          catch(_error) { return c.json(200,{rejected:true,consumed:consumed,calls:calls.length}); }
          throw new Error("invalid_size_accepted");
        }
        if(mode === "fingerprint_native" || mode === "fingerprint_fallback") {
          const operations=require(__hooks + "/postSaveOperations.js");
          const file=$filesystem.fileFromPath(${JSON.stringify(runtimeRoot + "/data/storage/synthetic/")} + String(size) + ".jpg");
          const probe=file.reader.open(); probe.close();
          let repeatedCloseRejected=false;
          try { probe.close(); } catch(_error) { repeatedCloseRejected=true; }
          const hash=operations.fingerprint({},file,"image/jpeg");
          return c.json(200,{hash:hash,ms:Date.now()-startedAt,calls:calls.length,repeatedCloseRejected:repeatedCloseRejected});
        }
        if(mode === "success") {
          const post={id:"synthetic",getString:field=>field === "creative_image" ? String(size)+".jpg" : "",baseFilesPath:()=>"synthetic"};
          const media=module.readPostCreative(post);
          return c.json(200,{hash:$security.sha256(media.base64),length:media.base64.length,ms:Date.now()-startedAt,native:native,calls:calls});
        }
        fsys=$app.newFilesystem(); reader=fsys.getFile("synthetic/"+String(size)+".jpg");
        if(mode === "input_read_failure") reader.close();
        const expected=mode === "short" ? size+1 : mode === "extra" ? size-1 : size;
        try {
          const encoded=module.base64EncodeReader(reader,expected);
          if(mode !== "fallback") throw new Error("failure_was_accepted");
          return c.json(200,{hash:$security.sha256(encoded),length:encoded.length,ms:Date.now()-startedAt,calls:calls});
        } catch(error) {
          if(mode === "fallback") throw error;
          if(String(error.message||error) !== "creative_media_read_failed") throw error;
          // A native timeout child has no descendants. Ensure its unique tail
          // command is gone after the supervisor has reaped it.
          let orphan=false;
          if(mode === "timeout") {
            for(const entry of $os.readDir("/proc")) {
              const name=entry.name(); if(!/^[0-9]+$/.test(name)) continue;
              try { const args=originalToString($os.readFile("/proc/"+name+"/cmdline")); if(args.indexOf(${JSON.stringify(runtimeRoot + "/hang-marker")}) !== -1 && args.indexOf("tail") !== -1) orphan=true; } catch(_error) {}
            }
          }
          return c.json(200,{rejected:true,ms:Date.now()-startedAt,calls:calls.length,orphan:orphan});
        }
      } finally {
        $os.cmd=originalCmd; $os.dirFS=originalDirFS; toString=originalToString;
        if(reader) { try { reader.close(); } catch(_error) {} }
        if(fsys) fsys.close();
      }
    });`,
    );
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const args = [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${runtimeRoot}/data`,
      `--hooksDir=${runtimeRoot}/hooks`,
      `--migrationsDir=${runtimeRoot}/migrations`,
      `--publicDir=${runtimeRoot}/public`,
      "--hooksWatch=false",
    ];
    const dockerArgs = image
      ? [
          "run",
          "--rm",
          "--name",
          containerName,
          "--network",
          "host",
          "--cpus=0.25",
          "--user",
          `${process.getuid()}:${process.getgid()}`,
          "--mount",
          `type=bind,source=${scratch},target=/qa`,
          "--workdir",
          "/qa",
          "--env",
          "PATH=/usr/bin:/bin",
          "--env",
          "TMPDIR=/qa/temporary",
          "--entrypoint",
          binary,
          image,
          ...args,
        ]
      : [];
    child = spawn(image ? "docker" : binary, image ? dockerArgs : args, {
      env: { PATH: "/usr/bin:/bin", TMPDIR: join(scratch, "temporary") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      logs += chunk;
    });
    child.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    hardStop = setTimeout(() => {
      if (image) {
        try {
          execFileSync("docker", ["rm", "--force", containerName], {
            stdio: "ignore",
            timeout: 5000,
          });
        } catch {}
      }
      child.kill("SIGKILL");
    }, 120_000);
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, "scratch PocketBase exited");
      try {
        ready = (
          await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })
        ).ok;
      } catch {}
      if (ready) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert(ready, "scratch PocketBase did not start");
    async function probe(mode, size = 1) {
      pendingProbe = { mode, size };
      const response = await fetch(`${base}/probe?mode=${mode}&size=${size}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const value = await response.json();
      assert.equal(response.status, 200, `${mode}: ${JSON.stringify(value)}`);
      proofs.push({ mode, size, ...value });
      pendingProbe = null;
      return value;
    }
    let native;
    for (const size of sizes) {
      const result = await probe("success", size);
      native = result.native;
      assert.equal(result.hash, hashes[size]);
      assert.equal(result.length, 4 * Math.ceil(size / 3));
      assert(result.ms < 30_000, "encoder exceeded the status request budget");
      assert.equal(result.calls.length, native ? 1 : 0);
    }
    if (image)
      assert.equal(native, true, "production image must contain GNU timeout/base64");
    for (const mode of ["empty", "too_large"]) {
      const result = await probe(mode);
      assert.equal(result.rejected, true);
      assert.equal(result.consumed, false);
      assert.equal(result.calls, 0);
    }
    for (const mode of ["fingerprint_native", "fingerprint_fallback"]) {
      const fingerprint = await probe(mode, 49154);
      assert.equal(fingerprint.hash, fingerprintHashes[49154]);
      assert.equal(
        fingerprint.calls,
        mode === "fingerprint_fallback" ? 0 : native ? 1 : 0,
      );
      assert.equal(
        fingerprint.repeatedCloseRejected,
        true,
        "file-backed reader must exercise repeated-close failure",
      );
    }
    const fallback = await probe("fallback", 49154);
    assert.equal(fallback.hash, hashes[49154]);
    assert.equal(fallback.calls.length, 0);
    for (const [mode, size] of [
      ["short", 1],
      ["extra", 4],
      ...(native
        ? [
            ["input_read_failure", 1],
            ["output_read_failure", 1],
            ["nonzero", 1],
            ["overflow", 1],
            ["malformed", 1],
            ["timeout", 1],
          ]
        : []),
    ]) {
      const result = await probe(mode, size);
      assert.equal(result.rejected, true);
      assert.equal(
        result.calls,
        native ? 1 : 0,
        "failed native operation must not retry",
      );
      assert.equal(result.orphan, false);
      if (mode === "timeout")
        assert(
          result.ms >= 9_000 && result.ms < 14_000,
          "native deadline/cleanup failed",
        );
    }
    console.log(
      JSON.stringify({
        passed: true,
        runtime: "PocketBase 0.22.55",
        native,
        cases: proofs.length,
        representativeMs: proofs.find((p) => p.mode === "success" && p.size === 2200003)
          .ms,
        maximumMs: proofs.find((p) => p.mode === "success" && p.size === 8388608).ms,
        limitedCpu: !!image,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        pendingProbe,
        completed: proofs.map(({ mode, size, ms }) => ({ mode, size, ms })),
      }),
    );
    console.error(logs.slice(-4000));
    throw error;
  } finally {
    clearTimeout(hardStop);
    if (image) {
      try {
        execFileSync("docker", ["rm", "--force", containerName], {
          stdio: "ignore",
          timeout: 5000,
        });
      } catch {}
    }
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 1000);
      await exited;
      clearTimeout(killer);
    }
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runWebsiteMediaEncodingCanary();
