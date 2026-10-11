import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

function harness(failure?: "mkdir" | "write" | "start" | "wait" | "short") {
  const files = new Map<string, Buffer>();
  const directories = new Set<string>();
  const removed: string[] = [];
  const config: string[] = [];
  const args: string[][] = [];
  const command = {
    stdinPipe: () => ({
      write: (value: number[]) => config.push(Buffer.from(value).toString("utf8")),
      close: vi.fn(),
    }),
    stdoutPipe: () => ({}),
    start: () => {
      if (failure === "start") throw new Error("synthetic-header-secret");
    },
    wait: () => {
      if (failure === "wait") throw new Error("synthetic-header-secret");
    },
    process: { kill: vi.fn() },
  };
  const os = {
    getenv: () => "",
    tempDir: () => "/synthetic-temporary",
    mkdir: vi.fn((path: string, mode: number) => {
      expect(mode).toBe(0o700);
      if (failure === "mkdir") throw new Error("already exists");
      directories.add(path);
    }),
    writeFile: vi.fn((path: string, value: number[], mode: number) => {
      expect(mode).toBe(0o600);
      if (failure === "write") throw new Error("synthetic-header-secret");
      files.set(path, Buffer.from(value));
    }),
    remove: vi.fn((path: string) => {
      removed.push(path);
      files.delete(path);
      directories.delete(path);
    }),
    cmd: vi.fn((...value: string[]) => {
      args.push(value);
      return command;
    }),
  };
  const module = { exports: {} as { send: (request: unknown) => unknown } };
  new Function(
    "module",
    "$os",
    "$security",
    "toString",
    readFileSync(resolve(process.cwd(), "pb_hooks/safeHttp.js"), "utf8"),
  )(module, os, { randomStringWithAlphabet: () => "a".repeat(32) }, () =>
    failure === "short" ? "invalid response" : "{}\n200",
  );
  return { send: module.exports.send, os, args, config, files, directories, removed };
}

const request = {
  url: "https://synthetic.example/receiver",
  method: "POST",
  headers: { Authorization: "Bearer synthetic-header-secret" },
  body: "synthetic-private-body café 漢字 😀\r\n",
};

describe("safe HTTP private request body transport", () => {
  it("keeps exact UTF-8 body bytes in a private generated file and secrets out of argv/config body", () => {
    const h = harness();
    let captured: Buffer | undefined;
    h.os.cmd.mockImplementation((...args: string[]) => {
      captured = [...h.files.values()][0];
      h.args.push(args);
      return {
        stdinPipe: () => ({
          write: (bytes: number[]) => h.config.push(Buffer.from(bytes).toString()),
          close: vi.fn(),
        }),
        stdoutPipe: () => ({}),
        start: vi.fn(),
        wait: vi.fn(),
        process: { kill: vi.fn() },
      };
    });
    expect(h.send(request)).toMatchObject({ statusCode: 200, json: {} });
    expect(captured).toEqual(Buffer.from(request.body));
    expect(h.args.flat().join(" ")).not.toMatch(
      /synthetic-header-secret|synthetic-private-body|Bearer/,
    );
    expect(h.args.flat()).not.toContain("--location");
    expect(h.config[0]).toContain(
      'data-binary = "@/synthetic-temporary/dealer-social-http-body-',
    );
    expect(h.config[0]).not.toContain(request.body);
    expect(h.files.size).toBe(0);
    expect(h.directories.size).toBe(0);
  });

  it.each(["write", "start", "wait", "short"] as const)(
    "cleans private files after %s failure without exposing the underlying error",
    (failure) => {
      const h = harness(failure);
      expect(() => h.send(request)).toThrow(/^CONNECTION_TRANSPORT_FAILED$/);
      expect(h.files.size).toBe(0);
      expect(h.directories.size).toBe(0);
      expect(h.removed).toHaveLength(2);
    },
  );

  it("fails an existing-directory collision without writing or deleting that path", () => {
    const h = harness("mkdir");
    expect(() => h.send(request)).toThrow(/^CONNECTION_TRANSPORT_FAILED$/);
    expect(h.os.writeFile).not.toHaveBeenCalled();
    expect(h.os.remove).not.toHaveBeenCalled();
    expect(h.os.cmd).not.toHaveBeenCalled();
  });

  it.each([
    { ...request, url: "http://synthetic.example/receiver" },
    { ...request, url: "https://synthetic.example/receiver?secret=value" },
    { ...request, headers: { Authorization: "bad\r\nheader" } },
    { ...request, body: "A".repeat(12 * 1024 * 1024 + 1) },
  ])("rejects unsafe input before creating files", (input) => {
    const h = harness();
    expect(() => h.send(input)).toThrow(/^CONNECTION_TRANSPORT_FAILED$/);
    expect(h.os.mkdir).not.toHaveBeenCalled();
    expect(h.os.cmd).not.toHaveBeenCalled();
  });
});
