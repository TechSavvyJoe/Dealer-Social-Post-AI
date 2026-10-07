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
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

type JsonResult = { status: number; payload: Record<string, unknown> };

const hookSource = readFileSync(resolve("pb_hooks/main.pb.js"), "utf8");
const routeSource = (marker: string): string => {
  const start = hookSource.indexOf(marker);
  expect(start, `route ${marker} exists`).toBeGreaterThan(-1);
  const end = hookSource.indexOf("routerAdd(", start + marker.length);
  expect(end).toBeGreaterThan(start);
  return hookSource.slice(start, end);
};

const connectionRoute = routeSource('routerAdd("GET", "/api/app/connections"');

const runConnections = (
  role: "salesperson" | "dealer_admin" | "super_admin" | null,
  environment: Record<string, string> = {},
): JsonResult => {
  let handler: ((context: unknown) => JsonResult) | undefined;
  const headers = new Map<string, string>();
  const context = role
    ? { role, dealer: { id: role === "super_admin" ? "system" : "dealer-1" } }
    : null;
  const helpers = {
    sessionContext: () => context,
    API_CONTRACT_VERSION: "contract-v1",
    PROXY_CAPABILITIES: { optionalField: true },
  };
  const policies = {
    geminiModelPolicySnapshot: () => ({ version: "policy-v1" }),
  };
  const website = {
    destinationConfiguration: (dealerId: string) => ({
      enabled:
        dealerId === "configured-dealer" &&
        environment.CUSTOMER_HUB_URL === "https://example.test" &&
        (environment.CUSTOMER_HUB_SECRET || "").length >= 32,
    }),
  };

  runInNewContext(connectionRoute, {
    __hooks: "/hooks",
    routerAdd: (_method: string, _path: string, callback: typeof handler) => {
      handler = callback;
    },
    require: (path: string) => {
      if (path.endsWith("/helpers.js")) return helpers;
      if (path.endsWith("/requestPolicies.js")) return policies;
      if (path.endsWith("/websitePublications.js")) return website;
      throw new Error(`Unexpected module ${path}`);
    },
    $os: { getenv: (name: string) => environment[name] || "" },
  });

  expect(handler).toBeTypeOf("function");
  return handler!({
    response: () => ({
      header: () => ({
        set: (name: string, value: string) => headers.set(name, value),
      }),
    }),
    json: (status: number, payload: Record<string, unknown>) => ({
      status,
      payload,
    }),
  });
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

describe("system connection inventory", () => {
  it("requires a session and rejects both salesperson and dealer-manager roles", () => {
    expect(runConnections(null).status).toBe(401);
    expect(runConnections("salesperson").status).toBe(403);
    expect(runConnections("dealer_admin").status).toBe(403);
  });

  it("returns configuration-only booleans without secret values or a tested claim", () => {
    const secret = "s".repeat(48);
    const token = "t".repeat(48);
    const result = runConnections("super_admin", {
      GEMINI_API_KEY: "gemini-private-value",
      ANTHROPIC_API_KEY: "anthropic-private-value",
      OPENAI_API_KEY: "openai-private-value",
      ENABLE_CLAUDE_FALLBACK: "true",
      ENABLE_OPENAI_FALLBACK: "false",
      CUSTOMER_HUB_URL: "https://example.test",
      CUSTOMER_HUB_SECRET: secret,
      CUSTOMER_HUB_DEALER_ID: "configured-dealer",
      WALKAROUND_STUDIO_ENABLED: "true",
      WALKAROUND_GCS_BUCKET: "dealer-media-private",
      WALKAROUND_UPLOAD_BROKER_URL: "https://uploads.example.test",
      WALKAROUND_UPLOAD_BROKER_TOKEN: token,
      WALKAROUND_YOUTUBE_BROKER_URL: "https://youtube.example.test",
      WALKAROUND_YOUTUBE_BROKER_TOKEN: token,
      WALKAROUND_WORKER_TOKEN: token,
      WALKAROUND_WORKER_SIGNING_SECRET: secret,
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({
      scope: "configuration_only",
      providers: {
        gemini: { configured: true, enabled: true, verification: "not_tested" },
        anthropic: {
          configured: true,
          enabled: true,
          verification: "not_tested",
        },
        openai: {
          configured: true,
          enabled: false,
          verification: "not_tested",
        },
      },
      automation: {
        customer_hub: {
          configured: true,
          enabled: true,
          verification: "not_tested",
          dealerId: "configured-dealer",
        },
        walkaround: {
          configured: true,
          enabled: true,
          verification: "not_tested",
        },
      },
      apiContractVersion: "contract-v1",
      capabilities: { optionalField: true },
      modelPolicyVersion: "policy-v1",
    });
    const serialized = JSON.stringify(result.payload);
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toMatch(/success|healthy|verified/i);
  });

  it("does not mark an enabled automation as usable when its config is incomplete", () => {
    const result = runConnections("super_admin", {
      WALKAROUND_STUDIO_ENABLED: "true",
      WALKAROUND_GCS_BUCKET: "dealer-media-private",
    });
    expect(result.payload).toMatchObject({
      automation: {
        walkaround: {
          configured: false,
          enabled: false,
          verification: "not_tested",
        },
      },
    });
  });

  it("names the dealership the customer website is mapped to, even before it is usable", () => {
    const mapped = runConnections("super_admin", {
      CUSTOMER_HUB_DEALER_ID: "  dealer-7  ",
    });
    expect(mapped.payload).toMatchObject({
      automation: {
        customer_hub: {
          configured: false,
          enabled: false,
          verification: "not_tested",
          dealerId: "dealer-7",
        },
      },
    });
    const unmapped = runConnections("super_admin", {});
    expect(unmapped.payload).toMatchObject({
      automation: { customer_hub: { configured: false, dealerId: "" } },
    });
  });

  it("does not report the documented Gemini placeholder as configured", () => {
    const result = runConnections("super_admin", {
      GEMINI_API_KEY: "your-api-key-here",
    });
    expect(result.payload).toMatchObject({
      providers: {
        gemini: {
          configured: false,
          enabled: false,
          verification: "not_tested",
        },
      },
    });
  });
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
