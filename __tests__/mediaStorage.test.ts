import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type Storage = {
  MEDIA_BYTES: { creative: number; signature: number };
  storageHasRoom: (df: string, du: string, incoming: number) => boolean;
  ensureStorageRoom: (incoming: number) => void;
  withMediaWrite: (
    dao: unknown,
    dealer: string,
    incoming: number,
    write: (tx: unknown) => void,
  ) => void;
  respondIfLimited: (c: unknown, error: unknown) => boolean;
};

function load(probe?: (command: string) => string) {
  const module = { exports: {} as Storage };
  new Function(
    "module",
    "$app",
    "$os",
    "toString",
    readFileSync("pb_hooks/mediaStorage.js", "utf8"),
  )(
    module,
    { dataDir: () => "/isolated/data" },
    { cmd: (command: string) => ({ output: () => probe?.(command) ?? "unavailable" }) },
    String,
  );
  return module.exports;
}

const df = (available: number) =>
  `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 1048576 0 ${available / 1024} 0% /isolated/data`;
const buffer = 256 * 1024 * 1024;

describe("shared private-media recovery reserve", () => {
  it("covers a maximum 8 MiB creative and its backup before accepting an upload", () => {
    const storage = load();
    const existing = 100 * 1024 * 1024;
    expect(storage.MEDIA_BYTES.creative).toBe(8 * 1024 * 1024);
    expect(
      storage.storageHasRoom(
        df(existing + buffer + 12 * 1024 * 1024),
        `${existing / 1024} /isolated/data`,
        storage.MEDIA_BYTES.creative,
      ),
    ).toBe(false);
  });
  it("reserves incoming media in both live storage and the next full backup", () => {
    const storage = load();
    const existing = 100 * 1024 * 1024;
    const incoming = 8 * 1024 * 1024;
    const boundary = existing + incoming * 2 + buffer;
    expect(
      storage.storageHasRoom(
        df(boundary),
        `${existing / 1024} /isolated/data`,
        incoming,
      ),
    ).toBe(false);
    expect(
      storage.storageHasRoom(
        df(boundary + 1024),
        `${existing / 1024} /isolated/data`,
        incoming,
      ),
    ).toBe(true);
  });

  it.each([NaN, Infinity, -1, 0.5])("rejects invalid incoming size %s", (incoming) => {
    expect(
      load().storageHasRoom(df(900 * 1024 * 1024), "100 /isolated/data", incoming),
    ).toBe(false);
  });

  it("fails closed when either filesystem measurement is missing or malformed", () => {
    expect(() => load().ensureStorageRoom(512000)).toThrow("MEDIA_STORAGE_LIMITED");
    expect(load().storageHasRoom(df(900 * 1024 * 1024), "unknown", 512000)).toBe(false);
    for (const unknown of ["", " ", "\n\t", "-1 /data", "0.5 /data"])
      expect(load().storageHasRoom(df(900 * 1024 * 1024), unknown, 512000)).toBe(false);
    for (const unknown of ["", " ", "\n\t"])
      expect(load().storageHasRoom(unknown, "100 /data", 512000)).toBe(false);
  });

  it("measures under the write fence and denies a later writer after space is consumed", () => {
    let locked = false;
    let existing = 100 * 1024 * 1024;
    let available = existing + buffer + 20 * 1024 * 1024;
    const storage = load((command) => {
      expect(locked).toBe(true);
      return command === "df" ? df(available) : `${existing / 1024} /isolated/data`;
    });
    const tx = {
      db: () => ({
        newQuery: () => ({
          bind: () => ({
            execute: () => {
              locked = true;
              return { rowsAffected: () => 1 };
            },
          }),
        }),
      }),
    };
    const dao = {
      runInTransaction: (write: (tx: unknown) => void) => {
        try {
          write(tx);
        } finally {
          locked = false;
        }
      },
    };
    const persist = vi.fn(() => {
      existing += 8 * 1024 * 1024;
      available -= 8 * 1024 * 1024;
    });
    storage.withMediaWrite(dao, "dealer-a", 8 * 1024 * 1024, persist);
    expect(() =>
      storage.withMediaWrite(dao, "dealer-b", 8 * 1024 * 1024, persist),
    ).toThrow("MEDIA_STORAGE_LIMITED");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("returns an actionable storage response only for the expected capacity failure", () => {
    const json = vi.fn();
    expect(load().respondIfLimited({ json }, new Error("MEDIA_STORAGE_LIMITED"))).toBe(
      true,
    );
    expect(json).toHaveBeenCalledWith(
      507,
      expect.objectContaining({ code: "MEDIA_STORAGE_LIMITED" }),
    );
    expect(
      load().respondIfLimited({ json }, new Error("private database detail")),
    ).toBe(false);
    expect(json).toHaveBeenCalledTimes(1);
  });
});
