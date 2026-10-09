import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_SAVE_FIELDS, postSaveFingerprint } from "./postSaveFingerprint";

afterEach(() => vi.unstubAllGlobals());
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type Operations = {
  FIELDS: string[];
  fingerprint(body: object, file: unknown, mime: string): string;
};
const loadOperations = () => {
  const module = { exports: {} as Operations };
  new Function(
    "module",
    "$security",
    "require",
    "__hooks",
    readFileSync("pb_hooks/postSaveOperations.js", "utf8"),
  )(
    module,
    { sha256: sha },
    () => ({ base64EncodeReader: (reader: { base64: string }) => reader.base64 }),
    "pb_hooks",
  );
  return module.exports;
};
const form = (body: Record<string, string>, file: NodeFile) =>
  ({
    get: (name: string) => (name === "creative_image" ? file : body[name] || null),
  }) as unknown as FormData;
const serverFile = (bytes: Uint8Array, name: string) => ({
  originalName: name,
  size: bytes.length,
  reader: {
    open: () => ({ base64: Buffer.from(bytes).toString("base64"), close: () => {} }),
  },
});

describe("generated save fingerprint agreement", () => {
  it("uses the same canonical JSON and actual image bytes in browser and server", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("File", NodeFile);
    const bytes = Uint8Array.of(0, 255, 128, 65, 0);
    const file = new NodeFile([bytes], "generated.png", { type: "image/png" });
    const body = {
      caption: "A fresh arrival.",
      platform_captions: '{"z":"Final","A":"First","a":"Middle"}',
      website_draft: '{"body":"Details","enabled":true,"title":"A vehicle"}',
    };
    const server = loadOperations();
    expect(server.FIELDS).toEqual(POST_SAVE_FIELDS);
    const digest = await postSaveFingerprint(form(body, file));
    expect(digest).toBe(
      server.fingerprint(body, serverFile(bytes, file.name), file.type),
    );
    expect(
      await postSaveFingerprint(
        form(
          { ...body, platform_captions: '{"a":"Middle","z":"Final","A":"First"}' },
          file,
        ),
      ),
    ).toBe(digest);
    for (const changed of [
      new NodeFile([Uint8Array.of(0, 255, 129, 65, 0)], file.name, { type: file.type }),
      new NodeFile([bytes], "other.png", { type: file.type }),
      new NodeFile([bytes], file.name, { type: "image/jpeg" }),
    ]) {
      expect(await postSaveFingerprint(form(body, changed))).not.toBe(digest);
    }
    expect(
      await postSaveFingerprint(
        form({ ...body, caption: "A different vehicle." }, file),
      ),
    ).not.toBe(digest);
  });
});
