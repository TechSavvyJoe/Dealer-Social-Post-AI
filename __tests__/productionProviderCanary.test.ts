import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthenticatedClient,
  probeImageEvidence,
  probeVideoEvidence,
  validateVideoProbeMetadata,
} from "../scripts/production-provider-canary.mjs";

const scriptPath = resolve(process.cwd(), "scripts/production-provider-canary.mjs");

describe("production provider canary", () => {
  it("executes its canonical model and synthetic-media contract without credentials", () => {
    expect(
      execFileSync(process.execPath, [scriptPath, "--contract-check"], {
        encoding: "utf8",
      }),
    ).toContain("Provider canary contract is valid");
  });

  it("keeps provider query material and generated content out of evidence", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("?alt=media");
    expect(source).toContain('providerUrl.pathname.endsWith(":download")');
    expect(source).not.toContain("providerUrl.search");
    expect(source).not.toContain("RELEASE_CANARY_ADMIN_CODE");

    const evidenceStart = source.indexOf("const evidence = {");
    const evidenceEnd = source.indexOf("let primaryError", evidenceStart);
    const evidenceShape = source.slice(evidenceStart, evidenceEnd);
    for (const sensitiveField of [
      "adminCode",
      "personPin",
      "cookie",
      "prompt",
      "captionText",
      "operationName",
      "fileUri",
      "imageBase64",
    ]) {
      expect(evidenceShape).not.toContain(sensitiveField);
    }
  });

  it("gates release on both exact playable video tiers", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain('"video_standard",\n        EXACT_STANDARD_VIDEO');
    expect(source).toContain('"video_quality",\n        EXACT_QUALITY_VIDEO');
    expect(source).toContain("const headers = generationHeaders(policy, taskName)");
    expect(source).toContain("durationSeconds: 6");
    expect(source).toContain("durationSeconds: 8");
    expect(source).toContain('resolution: "720p"');
    expect(source).toContain('resolution: "1080p"');
    expect(source).toContain('"VIDEO_VALIDATOR_UNAVAILABLE"');
    expect(source).toContain('video.codec_name !== "h264"');
    expect(source).toContain('audio.codec_name !== "aac"');
    expect(source).toContain("Number(video.width) !== expected.width");
    expect(source).toContain("Number(video.height) !== expected.height");
    expect(source).toContain("videoPacketCount < 1");
    expect(source).toContain("audioPacketCount < 1");
    expect(source).toContain("schemaVersion: 3");
    expect(source).toContain("evidence.checks.standardVideo");
    expect(source).toContain("evidence.checks.qualityVideo");
  });

  it("requires a playable H.264 video stream and a readable AAC audio stream", () => {
    const expected = { width: 1920, height: 1080, durationSeconds: 8 };
    const validMetadata = {
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "8.04" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1920,
          height: 1080,
          duration: "8.04",
          nb_read_packets: "240",
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          nb_read_packets: "376",
        },
      ],
    };

    expect(validateVideoProbeMetadata(validMetadata, expected)).toMatchObject({
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
      videoPacketCount: 240,
      audioPacketCount: 376,
    });
    expect(() =>
      validateVideoProbeMetadata(
        {
          ...validMetadata,
          streams: validMetadata.streams.filter(
            (stream) => stream.codec_type !== "audio",
          ),
        },
        expected,
      ),
    ).toThrow(/exact playable MP4 delivery contract/);
    expect(() =>
      validateVideoProbeMetadata(
        {
          ...validMetadata,
          streams: validMetadata.streams.map((stream) =>
            stream.codec_type === "audio"
              ? { ...stream, nb_read_packets: "0" }
              : stream,
          ),
        },
        expected,
      ),
    ).toThrow(/exact playable MP4 delivery contract/);
  });

  it("records real image pixels and rejects the wrong provider aspect ratio", () => {
    const syntheticPng = (width: number, height: number) => {
      const bytes = Buffer.alloc(24);
      Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
      Buffer.from("IHDR", "ascii").copy(bytes, 12);
      bytes.writeUInt32BE(width, 16);
      bytes.writeUInt32BE(height, 20);
      return bytes.toString("base64");
    };

    expect(probeImageEvidence(syntheticPng(800, 1000), "image/png", "4:5")).toEqual({
      width: 800,
      height: 1000,
    });
    expect(() =>
      probeImageEvidence(syntheticPng(1000, 1000), "image/png", "4:5"),
    ).toThrow(/requested 4:5 aspect ratio/);
  });

  it("blocks with an explicit prerequisite when ffprobe is unavailable", async () => {
    const previous = process.env.RELEASE_CANARY_FFPROBE;
    process.env.RELEASE_CANARY_FFPROBE =
      "/definitely-missing/dealer-social-canary-ffprobe";
    try {
      await expect(
        probeVideoEvidence("/unused/synthetic-output.mp4", {
          width: 1920,
          height: 1080,
          durationSeconds: 8,
        }),
      ).rejects.toMatchObject({ code: "VIDEO_VALIDATOR_UNAVAILABLE" });
    } finally {
      if (previous === undefined) {
        delete process.env.RELEASE_CANARY_FFPROBE;
      } else {
        process.env.RELEASE_CANARY_FFPROBE = previous;
      }
    }
  });

  it("refuses to send the canary credential to an arbitrary HTTPS origin", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_CANARY_BASE_URL: "https://untrusted.example",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CONFIG_UNTRUSTED_ORIGIN");
  });

  it("proves logout by replaying the revoked cookie and requiring it to be cleared", async () => {
    const seen: Array<{ method?: string; cookie?: string }> = [];
    const server = createServer((request, response) => {
      seen.push({ method: request.method, cookie: request.headers.cookie });
      if (request.method === "DELETE") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"success":true}');
        return;
      }
      response.writeHead(401, {
        "content-type": "application/json",
        "set-cookie":
          "dealer_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
      });
      response.end('{"error":"Invalid session"}');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
      client.cookie = "dealer_session=opaque-canary-session";
      await client.logout();
      expect(client.cookie).toBe("");
      expect(seen).toEqual([
        { method: "DELETE", cookie: "dealer_session=opaque-canary-session" },
        { method: "GET", cookie: "dealer_session=opaque-canary-session" },
      ]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("fails revocation evidence when a 200 logout leaves the old cookie usable", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"role":"salesperson"}');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
      client.cookie = "dealer_session=opaque-canary-session";
      await expect(client.logout()).rejects.toMatchObject({
        code: "REVOCATION_PROBE_FAILED",
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });
});
