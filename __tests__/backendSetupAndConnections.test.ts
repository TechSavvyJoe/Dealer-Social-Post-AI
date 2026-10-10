import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const hookSource = readFileSync(resolve("pb_hooks/main.pb.js"), "utf8");
const routeSource = (marker: string): string => {
  const start = hookSource.indexOf(marker);
  expect(start, `route ${marker} exists`).toBeGreaterThan(-1);
  const end = hookSource.indexOf("routerAdd(", start + marker.length);
  expect(end).toBeGreaterThan(start);
  return hookSource.slice(start, end);
};

const tempDirectories: string[] = [];
const tempDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "dsp-backend-test-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirectories.length) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("local backend startup", () => {
  const writeEnvironment = (directory: string) => {
    writeFileSync(
      join(directory, ".env.local"),
      [
        "GEMINI_API_KEY=test-key",
        "ADMIN_LOGIN_USERNAME=admin",
        "ADMIN_LOGIN_PASSWORD=test-password",
        "SALESPERSON_PIN_PEPPER=0123456789abcdef0123456789abcdef",
        "",
      ].join("\n"),
    );
  };

  it("rejects an environment attempt to bypass the PocketBase 0.22.55 pin", () => {
    const directory = tempDirectory();
    writeEnvironment(directory);
    const result = spawnSync("bash", [resolve("start-pocketbase.sh")], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PB_VERSION: "0.22.37" },
      timeout: 5_000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("PocketBase is pinned to 0.22.55");
  });

  it("does not start Vite and preserves the backend failure status", () => {
    const directory = tempDirectory();
    const bin = join(directory, "bin");
    mkdirSync(bin);
    mkdirSync(join(directory, "node_modules"));
    copyFileSync(resolve("start-dev.sh"), join(directory, "start-dev.sh"));
    writeEnvironment(directory);
    writeFileSync(join(directory, "start-pocketbase.sh"), "#!/bin/bash\nexit 23\n");
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/bash\necho started > "${join(directory, "vite-started")}"\nexit 0\n`,
    );
    chmodSync(join(directory, "start-dev.sh"), 0o755);
    chmodSync(join(directory, "start-pocketbase.sh"), 0o755);
    chmodSync(join(bin, "npm"), 0o755);

    const result = spawnSync("bash", ["./start-dev.sh"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 5_000,
    });
    expect(result.status).toBe(23);
    expect(result.stdout).toContain(
      "PocketBase exited before it became ready (status 23)",
    );
    expect(() => readFileSync(join(directory, "vite-started"))).toThrow();
  });

  it("treats a clean backend exit before readiness as startup failure", () => {
    const directory = tempDirectory();
    const bin = join(directory, "bin");
    mkdirSync(bin);
    mkdirSync(join(directory, "node_modules"));
    copyFileSync(resolve("start-dev.sh"), join(directory, "start-dev.sh"));
    writeEnvironment(directory);
    writeFileSync(join(directory, "start-pocketbase.sh"), "#!/bin/bash\nexit 0\n");
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/bash\necho started > "${join(directory, "vite-started")}"\nexit 0\n`,
    );
    chmodSync(join(directory, "start-dev.sh"), 0o755);
    chmodSync(join(directory, "start-pocketbase.sh"), 0o755);
    chmodSync(join(bin, "npm"), 0o755);

    const result = spawnSync("bash", ["./start-dev.sh"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "PocketBase exited before it became ready (status 0)",
    );
    expect(() => readFileSync(join(directory, "vite-started"))).toThrow();
  });

  it("bounds every readiness probe so a hung socket cannot hang startup", () => {
    const source = readFileSync(resolve("start-dev.sh"), "utf8");
    expect(source).toContain("curl -sS --connect-timeout 1 --max-time 2");
  });

  it("preserves a frontend failure after backend readiness", () => {
    const directory = tempDirectory();
    const bin = join(directory, "bin");
    mkdirSync(bin);
    mkdirSync(join(directory, "node_modules"));
    copyFileSync(resolve("start-dev.sh"), join(directory, "start-dev.sh"));
    writeEnvironment(directory);
    writeFileSync(join(directory, "start-pocketbase.sh"), "#!/bin/bash\nsleep 30\n");
    writeFileSync(join(bin, "curl"), "#!/bin/bash\nprintf 200\n");
    writeFileSync(join(bin, "npm"), "#!/bin/bash\nexit 17\n");
    chmodSync(join(directory, "start-dev.sh"), 0o755);
    chmodSync(join(directory, "start-pocketbase.sh"), 0o755);
    chmodSync(join(bin, "curl"), 0o755);
    chmodSync(join(bin, "npm"), 0o755);

    const result = spawnSync("bash", ["./start-dev.sh"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 5_000,
    });
    expect(result.status).toBe(17);
  });
});

describe("share request parsing", () => {
  it("accepts only string channel and method fields instead of coercing JSON values", () => {
    const source = routeSource('routerAdd("POST", "/api/app/posts/:id/shared"');
    expect(source).toContain('typeof body.channel === "string"');
    expect(source).toContain('typeof body.via === "string"');
    expect(source).not.toContain('(body.channel || "").toString()');
    expect(source).not.toContain('(body.via || "").toString()');
  });
});
