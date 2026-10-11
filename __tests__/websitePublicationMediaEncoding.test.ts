import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Reader = {
  read(target: Uint8Array): number;
  close(): void;
  consumed: number;
  closes: number;
};

function loadEncoder() {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/websitePublications.js"),
    "utf8",
  );
  const module = {
    exports: {} as { base64EncodeReader: (reader: unknown, size: number) => string },
  };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports.base64EncodeReader;
}

function makeReader(bytes: Uint8Array): Reader {
  const state = { offset: 0, closes: 0 };
  return {
    read(target) {
      const count = Math.min(target.length, bytes.length - state.offset);
      for (let i = 0; i < count; i++) target[i] = bytes[state.offset + i];
      state.offset += count;
      return count;
    },
    close() {
      state.closes++;
    },
    get consumed() {
      return state.offset;
    },
    get closes() {
      return state.closes;
    },
  };
}

function installFallbackOs(options: { missing?: boolean; missingError?: string } = {}) {
  const calls = { opens: 0, writes: 0, reads: 0, removes: 0, commands: 0 };
  vi.stubGlobal("$os", {
    dirFS(path: string) {
      expect(path).toBe("/usr/bin");
      return {
        open(name: string) {
          calls.opens++;
          if (options.missing)
            throw new Error(options.missingError ?? "no such file or directory");
          return {
            stat: () => ({ isDir: () => false, mode: () => 0o755 }),
            close() {},
          };
        },
      };
    },
    tempDir: () => "/tmp",
    writeFile: () => calls.writes++,
    truncate: () => {},
    readFile: () => new Uint8Array(49152),
    remove: () => calls.removes++,
    cmd: () => {
      calls.commands++;
      throw new Error("unexpected native command");
    },
  });
  vi.stubGlobal("$security", {
    randomStringWithAlphabet: () => "synthetic-buffer",
  });
  return calls;
}

function installNativeOs(options: {
  output?: string;
  waitFails?: boolean;
  statFails?: boolean;
  startFails?: boolean;
  reader?: Reader;
}): { calls: string[]; fallbackWrites: { count: number } } {
  const calls: string[] = [];
  const fallbackWrites = { count: 0 };
  if (options.reader) {
    const close = options.reader.close.bind(options.reader);
    options.reader.close = () => {
      calls.push("reader.close");
      close();
    };
  }
  let outputText = options.output ?? "";
  vi.stubGlobal("$os", {
    dirFS: () => ({
      open() {
        calls.push("open");
        if (options.statFails) throw new Error("permission denied");
        return {
          stat: () => ({ isDir: () => false, mode: () => 0o755 }),
          close() {},
        };
      },
    }),
    tempDir: () => "/tmp",
    writeFile: () => {
      fallbackWrites.count++;
    },
    truncate: () => {},
    readFile: () => new Uint8Array(49152),
    remove: () => {},
    cmd(...args: string[]) {
      calls.push("cmd");
      expect(args).toEqual([
        "/usr/bin/timeout",
        "--foreground",
        "--signal=KILL",
        "10s",
        "/usr/bin/base64",
        "--wrap=0",
      ]);
      return {
        env: [],
        stdin: null,
        waitDelay: 0,
        stdoutPipe: () => ({
          close: () => calls.push("stdout.close"),
          toString: () => outputText,
        }),
        start() {
          calls.push("start");
          expect(this.env).toEqual(["PATH=/usr/bin:/bin", "LC_ALL=C"]);
          if (options.startFails) throw new Error("start failed");
          const stdin = this.stdin as Reader | null;
          if (stdin && options.output === undefined) {
            const chunks: number[] = [];
            const buffer = new Uint8Array(4096);
            let count = 0;
            while ((count = stdin.read(buffer)) > 0) {
              for (let i = 0; i < count; i++) chunks.push(buffer[i]);
            }
            outputText = Buffer.from(chunks).toString("base64");
          }
        },
        wait() {
          calls.push("wait");
          expect((this as unknown as { waitDelay: number }).waitDelay).toBe(1000000000);
          if (options.waitFails) throw new Error("timeout");
        },
      };
    },
  });
  vi.stubGlobal("toString", (value: unknown) => {
    calls.push("capture");
    return value === null ? "" : (value as { toString(): string }).toString();
  });
  return { calls, fallbackWrites };
}

afterEach(() => vi.unstubAllGlobals());

describe("website media base64 reader", () => {
  const encode = loadEncoder();

  it.each([1, 2, 3, 4, 49151, 49152, 49153])(
    "fallback preserves every byte and padding for %i bytes",
    (length) => {
      const bytes = Uint8Array.from({ length }, (_, index) => index & 255);
      const reader = makeReader(bytes);
      const calls = installFallbackOs({ missing: true });
      const actual = encode(reader, bytes.length);
      expect(actual).toBe(Buffer.from(bytes).toString("base64"));
      expect(Buffer.from(actual, "base64")).toEqual(Buffer.from(bytes));
      expect(reader.consumed).toBe(bytes.length);
      expect(calls.commands).toBe(0);
      expect(calls.writes).toBe(1);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 8 * 1024 * 1024 + 1])(
    "rejects invalid or over-cap size %s before consuming or preparing a reader",
    (size) => {
      const reader = makeReader(new Uint8Array(0));
      const calls = installFallbackOs({
        missing: true,
        missingError: "The system cannot find the path specified",
      });
      expect(() => encode(reader, size)).toThrow();
      expect(reader.consumed).toBe(0);
      expect(calls.opens).toBe(0);
      expect(calls.writes).toBe(0);
      expect(calls.commands).toBe(0);
    },
  );

  it("uses native output only when canonical length, alphabet and pad bits match", () => {
    const bytes = Uint8Array.from([0, 255, 128, 65]);
    const reader = makeReader(bytes);
    const native = installNativeOs({ reader });
    expect(encode(reader, bytes.length)).toBe(Buffer.from(bytes).toString("base64"));
    expect(reader.consumed).toBe(bytes.length); // native process reads the original bytes
    expect(reader.closes).toBe(1);
    expect(native.calls.indexOf("reader.close")).toBeGreaterThanOrEqual(0);
    expect(native.calls.indexOf("stdout.close")).toBeGreaterThanOrEqual(0);
    expect(native.calls.indexOf("wait")).toBeGreaterThanOrEqual(0);
    expect(native.calls.indexOf("reader.close")).toBeLessThan(
      native.calls.indexOf("wait"),
    );
    expect(native.calls.indexOf("stdout.close")).toBeLessThan(
      native.calls.indexOf("wait"),
    );
    expect(native.calls).toContain("capture");
  });

  it.each([false, true])(
    "fingerprints native uploads despite repeated close (encoder failure: %s)",
    (waitFails) => {
      const bytes = Uint8Array.from([0, 255, 128, 65]);
      const reader = makeReader(bytes);
      const close = reader.close.bind(reader);
      reader.close = () => {
        close();
        if (reader.closes > 1) throw new Error("file already closed");
      };
      installNativeOs({ reader, waitFails });
      vi.stubGlobal("$security", { sha256: (value: string) => value });
      const source = readFileSync(
        resolve(process.cwd(), "pb_hooks/postSaveOperations.js"),
        "utf8",
      );
      const module = {
        exports: {} as {
          fingerprint: (body: object, file: unknown, mime: string) => string;
        },
      };
      new Function("module", "exports", "require", "__hooks", source)(
        module,
        module.exports,
        () => ({ base64EncodeReader: encode }),
        "/hooks",
      );
      const fingerprint = () =>
        module.exports.fingerprint(
          {},
          {
            reader: { open: () => reader },
            size: bytes.length,
            originalName: "creative.png",
          },
          "image/png",
        );
      if (waitFails) expect(fingerprint).toThrow("creative_media_read_failed");
      else expect(fingerprint()).toContain(Buffer.from(bytes).toString("base64"));
      expect(reader.closes).toBe(2);
    },
  );

  it("uses portable fallback when fixed native binaries are absent on Windows", () => {
    const bytes = Uint8Array.from([17, 34, 51]);
    const reader = makeReader(bytes);
    const calls = installFallbackOs({
      missing: true,
      missingError: "The system cannot find the path specified",
    });
    expect(encode(reader, bytes.length)).toBe(Buffer.from(bytes).toString("base64"));
    expect(reader.consumed).toBe(bytes.length);
    expect(calls.opens).toBe(1);
    expect(calls.writes).toBe(1);
    expect(calls.commands).toBe(0);
  });

  it.each(["!!!!", "AQI", "AR==", "AQ==\t"])(
    "fails closed on malformed native output %j without portable retry",
    (output) => {
      const reader = makeReader(Uint8Array.from([1]));
      const native = installNativeOs({ output });
      expect(() => encode(reader, 1)).toThrow("creative_media_read_failed");
      expect(native.calls).toContain("start");
      expect(native.calls).toContain("wait");
      expect(reader.consumed).toBe(0);
      expect(native.calls.filter((call) => call === "cmd")).toHaveLength(1);
      expect(native.fallbackWrites.count).toBe(0);
    },
  );

  it("normalizes native LF/CRLF wrapping without changing the digest bytes", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const expected = Buffer.from(bytes).toString("base64");
    const reader = makeReader(bytes);
    installNativeOs({
      output: expected.slice(0, 4) + "\r\n" + expected.slice(4),
      reader,
    });
    expect(encode(reader, bytes.length)).toBe(expected);
  });

  it("does not fall back after native timeout or binary permission failure", () => {
    const timedReader = makeReader(Uint8Array.from([1]));
    const timedNative = installNativeOs({ output: "AQ==", waitFails: true });
    expect(() => encode(timedReader, 1)).toThrow("creative_media_read_failed");
    expect(timedReader.consumed).toBe(0);
    expect(timedNative.calls.filter((call) => call === "cmd")).toHaveLength(1);
    expect(timedNative.fallbackWrites.count).toBe(0);

    const permissionReader = makeReader(Uint8Array.from([1]));
    const permissionCalls = { writes: 0, commands: 0 };
    // Probe errors other than a missing executable are deliberately fatal.
    vi.stubGlobal("$os", {
      dirFS: () => ({
        open: () => {
          throw new Error("permission denied");
        },
      }),
      writeFile: () => {
        permissionCalls.writes++;
      },
      cmd: () => {
        permissionCalls.commands++;
        throw new Error("must not launch");
      },
    });
    expect(() => encode(permissionReader, 1)).toThrow(
      "creative_media_encoder_unavailable",
    );
    expect(permissionReader.consumed).toBe(0);
    expect(permissionCalls).toEqual({ writes: 0, commands: 0 });
  });

  it("rejects portable readers that are short, overlong, or throw", () => {
    const cases = [
      { bytes: Uint8Array.from([1]), expected: 2 },
      { bytes: Uint8Array.from([1, 2]), expected: 1 },
    ];
    for (const item of cases) {
      const reader = makeReader(item.bytes);
      installFallbackOs({ missing: true });
      expect(() => encode(reader, item.expected)).toThrow();
    }

    const reader = makeReader(Uint8Array.from([1]));
    reader.read = () => {
      throw new Error("read failed");
    };
    installFallbackOs({ missing: true });
    expect(() => encode(reader, 1)).toThrow();
  });

  it("closes input on native startup failure without retrying fallback", () => {
    const reader = makeReader(Uint8Array.from([1]));
    const native = installNativeOs({ reader, startFails: true });
    expect(() => encode(reader, 1)).toThrow("creative_media_read_failed");
    expect(reader.consumed).toBe(0);
    expect(reader.closes).toBe(1);
    expect(native.calls).toContain("stdout.close");
    expect(native.calls).not.toContain("wait");
  });
});
