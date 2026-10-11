// Real pinned JSVM, isolated empty DB, synthetic loopback transport only.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function runSafeHttpCanary() {
  const image = process.env.SAFE_HTTP_TEST_IMAGE;
  if (image) {
    assert.equal(
      process.platform,
      "linux",
      "container loopback requires Linux host networking",
    );
    assert.match(image, /^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]{0,255}$/);
  } else
    assert(
      process.env.POCKETBASE_TEST_BINARY,
      "Set POCKETBASE_TEST_BINARY or SAFE_HTTP_TEST_IMAGE.",
    );
  const binary = image ? "/pb/pocketbase" : resolve(process.env.POCKETBASE_TEST_BINARY);
  const version = image
    ? execFileSync(
        "docker",
        ["run", "--rm", "--entrypoint", binary, image, "--version"],
        { encoding: "utf8" },
      )
    : execFileSync(binary, ["--version"], { encoding: "utf8" });
  assert.match(version, /0\.22\.55\b/);
  const curl = image
    ? "/usr/bin/curl"
    : execFileSync("which", ["curl"], { encoding: "utf8" }).trim();
  if (image)
    console.log(
      execFileSync(
        "docker",
        ["run", "--rm", "--entrypoint", curl, image, "--version"],
        { encoding: "utf8" },
      ).split("\n")[0],
    );
  const scratch = await mkdtemp(join(tmpdir(), "dsp-safe-http-qa-"));
  const runtimeRoot = image ? "/qa" : scratch;
  const containerName = `dsp-safe-http-qa-${process.pid}-${scratch.split("-").at(-1)}`;
  let child;
  let redirected = 0;
  const containerProofs = [];
  const receiver = createServer(async (req, res) => {
    if (image) {
      const directories = await readdir(join(scratch, "temporary"));
      assert.equal(directories.length, 1);
      const directory = join(scratch, "temporary", directories[0]);
      containerProofs.push({
        dirMode: (await stat(directory)).mode & 0o777,
        bodyMode: (await stat(join(directory, "body"))).mode & 0o777,
        bodyHasNoHeader: !(await readFile(join(directory, "body"), "utf8")).includes(
          "synthetic-header-canary",
        ),
      });
    }
    if (req.url === "/redirected") redirected++;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/redirected" });
      res.end();
      return;
    }
    if (req.url === "/failure") {
      req.socket.destroy();
      return;
    }
    if (req.url === "/timeout") {
      req.resume();
      return;
    }
    const hash = createHash("sha256");
    let count = 0;
    for await (const chunk of req) {
      count += chunk.length;
      hash.update(chunk);
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ count, hash: hash.digest("hex") }));
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const portReservation = createServer();
  portReservation.listen(0, "127.0.0.1");
  await once(portReservation, "listening");
  const port = portReservation.address().port;
  await new Promise((done) => portReservation.close(done));
  try {
    for (const name of ["hooks", "data", "migrations", "public", "bin", "temporary"])
      await mkdir(join(scratch, name));
    await cp(
      new URL("../pb_hooks/safeHttp.js", import.meta.url),
      join(scratch, "hooks/safeHttp.js"),
    );
    // Enforce curl 7.81's config-line cap even on newer developer curl versions.
    // Forward the real curl's output/status; record only sanitized assertions.
    await writeFile(
      join(scratch, "bin/curl"),
      `#!/usr/bin/env node
import {readFileSync,statSync,appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const input=readFileSync(0,'utf8'),args=process.argv.slice(2);
const line=input.split('\\n').find(x=>x.startsWith('data-binary = '));
const bodyPath=line ? JSON.parse(line.slice('data-binary = '.length)).slice(1) : '';
const parent=bodyPath.slice(0,bodyPath.lastIndexOf('/'));
const proof={maxLine:Math.max(...input.split('\\n').map(x=>Buffer.byteLength(x))),
 argvClean:!args.join(' ').includes('synthetic-header-canary')&&!args.join(' ').includes('synthetic-private-body'),
 configHasNoBody:!input.includes('synthetic-private-body'),
 bodyMode:bodyPath?statSync(bodyPath).mode&0o777:null,dirMode:parent?statSync(parent).mode&0o777:null,
 bodyInsideTemporary:bodyPath.startsWith(process.env.TMPDIR+'/dealer-social-http-body-'),
 bodyHasNoHeader:!bodyPath||!readFileSync(bodyPath,'utf8').includes('synthetic-header-canary')};
appendFileSync(process.env.SAFE_HTTP_QA_TRACE,JSON.stringify(proof)+'\\n');
if(proof.maxLine>100*1024)process.exit(1);
const result=spawnSync(process.env.SAFE_HTTP_QA_CURL,args,{input,maxBuffer:3*1024*1024});
if(result.stdout)process.stdout.write(result.stdout);
process.exit(result.status??1);
`,
      { mode: 0o700 },
    );
    const sizes = { tiny: 32, boundary: 110_000, medium: 3_200_000, large: 5_000_000 };
    const privateText = 'synthetic-private-body café 漢字 😀 \r\n quote " slash \\';
    await writeFile(
      join(scratch, "hooks/probe.pb.js"),
      `routerAdd("GET","/probe",c=>{
      const name=c.queryParam("name"),sizes=${JSON.stringify(sizes)};
      const n=sizes[name]||32;
      const body=JSON.stringify({private:${JSON.stringify(privateText)},data:"A".repeat(n)});
      const endpoint=["redirect","failure","timeout"].includes(name)?name:"echo";
      try{const r=require(__hooks+"/safeHttp.js").send({url:"http://127.0.0.1:${receiver.address().port}/"+endpoint,
        method:"POST",headers:{Authorization:"Bearer synthetic-header-canary","Content-Type":"application/json"},body,timeout:name==="timeout"?1:10});
        return c.json(200,{status:r.statusCode,echo:r.json});
      }catch(e){return c.json(200,{error:String(e.message||e)})}
    });`,
    );
    const backendArguments = [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${join(runtimeRoot, "data")}`,
      `--hooksDir=${join(runtimeRoot, "hooks")}`,
      `--migrationsDir=${join(runtimeRoot, "migrations")}`,
      `--publicDir=${join(runtimeRoot, "public")}`,
      "--hooksWatch=false",
    ];
    const dockerArguments = image
      ? [
          "run",
          "--rm",
          "--name",
          containerName,
          "--network",
          "host",
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
          "--env",
          "SAFE_HTTP_ALLOW_LOOPBACK_TEST=true",
          "--entrypoint",
          binary,
          image,
          ...backendArguments,
        ]
      : [];
    child = spawn(
      image ? "docker" : binary,
      image ? dockerArguments : backendArguments,
      {
        cwd: scratch,
        stdio: "ignore",
        env: {
          PATH: `${join(scratch, "bin")}:${dirname(process.execPath)}:${process.env.PATH}`,
          TMPDIR: join(scratch, "temporary"),
          SAFE_HTTP_ALLOW_LOOPBACK_TEST: "true",
          SAFE_HTTP_QA_CURL: curl,
          SAFE_HTTP_QA_TRACE: join(scratch, "trace.jsonl"),
        },
      },
    );
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, "isolated PocketBase stopped");
      try {
        ready = (
          await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })
        ).ok;
      } catch {}
      if (ready) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert(ready, "isolated PocketBase did not start");
    for (const [name, n] of Object.entries(sizes)) {
      const body = JSON.stringify({ private: privateText, data: "A".repeat(n) });
      const result = await (
        await fetch(base + "/probe?name=" + name, {
          signal: AbortSignal.timeout(30_000),
        })
      ).json();
      assert.equal(result.status, 200);
      assert.equal(result.echo.count, Buffer.byteLength(body));
      assert.equal(result.echo.hash, createHash("sha256").update(body).digest("hex"));
      assert.deepEqual(await readdir(join(scratch, "temporary")), []);
    }
    for (const name of ["redirect", "failure", "timeout"]) {
      const result = await (
        await fetch(base + "/probe?name=" + name, {
          signal: AbortSignal.timeout(30_000),
        })
      ).json();
      assert.equal(result.error, "CONNECTION_TRANSPORT_FAILED");
      assert.deepEqual(await readdir(join(scratch, "temporary")), []);
    }
    assert.equal(redirected, 0);
    const trace = image
      ? containerProofs
      : (await readFile(join(scratch, "trace.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map(JSON.parse);
    assert.equal(trace.length, 7);
    for (const proof of trace) {
      if (!image) {
        assert(proof.maxLine < 100 * 1024);
        for (const field of [
          "argvClean",
          "configHasNoBody",
          "bodyInsideTemporary",
          "bodyHasNoHeader",
        ])
          assert.equal(proof[field], true);
      }
      assert.equal(proof.bodyHasNoHeader, true);
      assert.equal(proof.bodyMode, 0o600);
      assert.equal(proof.dirMode, 0o700);
    }
    console.log(
      `Pinned safe HTTP canary passed (${image ? "production-image curl" : "100KiB config-cap shim + host curl"}): exact UTF-8 tiny/110KiB+/3.2MB/5MB bodies, private modes, redirect/failure/timeout cleanup.`,
    );
  } finally {
    if (image) {
      try {
        execFileSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
      } catch {}
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await new Promise((done) => receiver.close(done));
    await rm(scratch, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runSafeHttpCanary();
