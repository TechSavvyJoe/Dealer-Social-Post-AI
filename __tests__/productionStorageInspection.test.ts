import { describe, expect, it } from "vitest";
import { parseStorage, selectMachine } from "../scripts/inspect-fly-storage.mjs";

const disk =
  "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vdb 1048576 102400 900000 11% /pb/pb_data\n";

describe("production storage receipts", () => {
  it("records byte measurements and the current upload guard result", () => {
    const receipt = parseStorage(disk, "102400 /pb/pb_data\n");
    expect(receipt.filesystemTotalBytes).toBe(1073741824);
    expect(receipt.filesystemAvailableBytes).toBe(921600000);
    expect(receipt.dataDirectoryBytes).toBe(104857600);
    expect(receipt.nextMaximumSpinFitsWithBackup).toBe(true);
  });

  it("reports insufficient backup headroom without claiming a launch pass", () => {
    expect(parseStorage(disk, "900000 /pb/pb_data").nextMaximumSpinFitsWithBackup).toBe(
      false,
    );
  });

  it.each([
    ["unavailable", "0 /pb/pb_data"],
    [disk, "0 /private/other-data"],
    [disk, "-1 /pb/pb_data"],
    [disk.replace(" /pb/pb_data", " /"), "0 /pb/pb_data"],
    [disk.replace("900000", "2000000"), "0 /pb/pb_data"],
    [disk.replace("1048576", "9007199254740991"), "0 /pb/pb_data"],
    [disk + "another filesystem\n", "0 /pb/pb_data"],
  ])("rejects unknown, wrong-path or impossible measurements", (df, du) => {
    expect(() => parseStorage(df, du)).toThrow();
  });
});

describe("production storage machine identity", () => {
  const sha = "a".repeat(40);
  const writer = {
    id: "148e417ad05728",
    state: "started",
    image_ref: { labels: { GH_SHA: sha } },
  };

  it("pins both measurements to the one started release", () => {
    expect(selectMachine([writer, { state: "stopped" }], sha)).toBe(writer.id);
  });

  it.each([
    { machines: [] },
    { machines: [writer, writer] },
    { machines: [{ ...writer, id: "invalid" }] },
  ])("rejects absent or ambiguous writers", ({ machines }) => {
    expect(() => selectMachine(machines, sha)).toThrow();
  });

  it("rejects a machine from another release", () => {
    expect(() => selectMachine([writer], "b".repeat(40))).toThrow();
  });
});
