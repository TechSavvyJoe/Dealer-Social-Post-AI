import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_SAVE_FIELDS, postSaveFingerprint } from "./postSaveFingerprint";

afterEach(() => vi.unstubAllGlobals());
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type Operations = {
  FIELDS: string[];
  fingerprint(body: object, file: unknown, mime: string): string;
  matchFingerprint(
    body: object,
    file: unknown,
    mime: string,
    submittedDigest: string,
  ): string;
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
const legacyDigest = (
  body: Record<string, string>,
  file: NodeFile,
  bytes: Uint8Array,
) => {
  const fields = POST_SAVE_FIELDS.map((name) => {
    let value = body[name] || "";
    if (
      ["platform_ids", "platform_captions", "website_draft"].includes(name) &&
      value
    ) {
      try {
        const sort = (input: unknown): unknown =>
          Array.isArray(input)
            ? input.map(sort)
            : input && typeof input === "object"
              ? Object.fromEntries(
                  Object.entries(input)
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([key, child]) => [key, sort(child)]),
                )
              : input;
        value = JSON.stringify(sort(JSON.parse(value)));
      } catch {
        /* preserve the legacy raw value */
      }
    }
    return [name, value];
  });
  const base64 = Buffer.from(bytes).toString("base64");
  return sha(
    JSON.stringify([fields, sha(base64), [file.name, file.type.toLowerCase()]]),
  );
};
const nativeMultipartRoundTrip = (
  fields: Record<string, string>,
  file: NodeFile,
  bytes: Uint8Array,
) => {
  const source = `
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const data = JSON.parse(input);
    const form = new FormData();
    for (const [name, value] of Object.entries(data.fields)) form.set(name, value);
    form.set("creative_image", new Blob([Buffer.from(data.bytes, "base64")], { type: data.mime }), data.name);
    const request = new Request("http://localhost/save", { method: "POST", body: form });
    const parsed = await request.formData();
    const image = parsed.get("creative_image");
    const bytes = Buffer.from(await image.arrayBuffer()).toString("base64");
    console.log(JSON.stringify({
      fields: Object.fromEntries(${JSON.stringify(POST_SAVE_FIELDS)}.map(name => [name, String(parsed.get(name) || "")])),
      bytes, name: image.name, mime: image.type,
    }));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["-e", source], {
      input: JSON.stringify({
        fields,
        bytes: Buffer.from(bytes).toString("base64"),
        name: file.name,
        mime: file.type,
      }),
      encoding: "utf8",
    }),
  ) as { fields: Record<string, string>; bytes: string; name: string; mime: string };
};

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

  it("agrees with PocketBase after native multipart serialization and parsing", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("File", NodeFile);
    const server = loadOperations();
    const bytes = Uint8Array.of(0, 255, 128, 65, 0);
    const file = new NodeFile([bytes], "generated-é.png", { type: "image/png" });
    const rawBody = {
      caption: "Arrived — ready.\r\n\r\nSecond line\rThird line",
      disclosures: "Disclosure one\r\n\r\nDisclosure two\rDisclosure three — café",
      platform_captions: '{"instagram":"Line one\\r\\n\\r\\nLine two — café"}',
    };
    const sourceDigest = await postSaveFingerprint(form(rawBody, file));
    const roundTrip = nativeMultipartRoundTrip(rawBody, file, bytes);
    const parsedBody = roundTrip.fields;
    const parsedBytes = Buffer.from(roundTrip.bytes, "base64");
    const parsedFile = new NodeFile([parsedBytes], roundTrip.name, {
      type: roundTrip.mime,
    });
    expect(parsedBody.caption.replace(/\r\n?/g, "\n")).toBe(
      "Arrived — ready.\n\nSecond line\nThird line",
    );
    expect(parsedBody.disclosures.replace(/\r\n?/g, "\n")).toBe(
      "Disclosure one\n\nDisclosure two\nDisclosure three — café",
    );
    const digest = await postSaveFingerprint(form(parsedBody, parsedFile));
    expect(digest).toBe(sourceDigest);
    expect(digest).toBe(
      server.fingerprint(
        parsedBody,
        serverFile(parsedBytes, parsedFile.name),
        parsedFile.type,
      ),
    );

    const rawWireDigest = legacyDigest(parsedBody, parsedFile, parsedBytes);
    expect(
      server.matchFingerprint(
        parsedBody,
        serverFile(parsedBytes, parsedFile.name),
        parsedFile.type,
        rawWireDigest,
      ),
    ).toBe(rawWireDigest);
    expect(
      server.matchFingerprint(
        parsedBody,
        serverFile(parsedBytes, parsedFile.name),
        parsedFile.type,
        "malformed-digest",
      ),
    ).toBe("");

    for (const changed of [
      {
        body: { ...parsedBody, caption: `${parsedBody.caption} changed` },
        bytes: parsedBytes,
        name: parsedFile.name,
        mime: parsedFile.type,
      },
      {
        body: parsedBody,
        bytes: Uint8Array.of(1, 2, 3),
        name: parsedFile.name,
        mime: parsedFile.type,
      },
      {
        body: parsedBody,
        bytes: parsedBytes,
        name: "other.png",
        mime: parsedFile.type,
      },
      {
        body: parsedBody,
        bytes: parsedBytes,
        name: parsedFile.name,
        mime: "image/jpeg",
      },
    ]) {
      const changedFile = new NodeFile([changed.bytes], changed.name, {
        type: changed.mime,
      });
      expect(
        await postSaveFingerprint(
          form(changed.body as Record<string, string>, changedFile),
        ),
      ).not.toBe(digest);
      expect(
        server.matchFingerprint(
          changed.body,
          serverFile(changed.bytes, changed.name),
          changed.mime,
          digest,
        ),
      ).toBe("");
      expect(
        server.matchFingerprint(
          changed.body,
          serverFile(changed.bytes, changed.name),
          changed.mime,
          rawWireDigest,
        ),
      ).toBe("");
    }
  });
});
