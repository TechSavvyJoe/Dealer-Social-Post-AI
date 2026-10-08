import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthenticatedClient,
  canonicalOrigin,
  finalInlineImage,
  probeImageEvidence,
  probeVideoEvidence,
  validateVideoProbeMetadata,
} from "../scripts/production-provider-canary.mjs";
import { acquireReleaseLock } from "../scripts/vercel-staged-qa.mjs";

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
    const evidenceEnd = source.indexOf("\n  };", evidenceStart) + "\n  };".length;
    const evidenceShape = source.slice(evidenceStart, evidenceEnd);
    for (const sensitiveField of [
      "adminCode",
      "personPin",
      "invitationToken",
      "invitationCookie",
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

  it("uses the private invitation with sign-in and proves revocation with both cookies", async () => {
    const token = "a".repeat(64);
    const seen: Array<{ path?: string; cookie?: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      seen.push({ path: request.url, cookie: request.headers.cookie, body });
      if (request.url === "/api/app/dealership-invitation") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            "dealer_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
            `dealer_invitation=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict`,
          ],
        });
        response.end('{"id":"testdealer00001","name":"Synthetic store"}');
      } else if (request.method === "POST") {
        response.writeHead(200, {
          "set-cookie": "dealer_session=opaque-session; Path=/; HttpOnly; Secure",
        });
        response.end('{"role":"salesperson"}');
      } else if (request.method === "DELETE") {
        response.writeHead(200);
        response.end('{"success":true}');
      } else {
        response.writeHead(401, {
          "set-cookie": "dealer_session=; Path=/; HttpOnly; Secure; Max-Age=0",
        });
        response.end('{"error":"Invalid session"}');
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
      expect(await client.acceptInvitation(token)).toBe("testdealer00001");
      const login = await client.request("/api/app/session", {
        method: "POST",
        body: '{"dealerCode":"1234"}',
      });
      client.captureCookie(login);
      await expect(client.acceptInvitation(token)).rejects.toMatchObject({
        code: "INVITATION_ORDER_INVALID",
      });
      await client.logout();
      expect(client.cookie).toBe("");
      expect(client.invitationCookie).toBe("");
      expect(seen).toEqual([
        {
          path: "/api/app/dealership-invitation",
          cookie: undefined,
          body: JSON.stringify({ token }),
        },
        {
          path: "/api/app/session",
          cookie: `dealer_invitation=${token}`,
          body: '{"dealerCode":"1234"}',
        },
        {
          path: "/api/app/session",
          cookie: `dealer_invitation=${token}; dealer_session=opaque-session`,
          body: "",
        },
        {
          path: "/api/app/session",
          cookie: `dealer_invitation=${token}; dealer_session=opaque-session`,
          body: "",
        },
      ]);
    } finally {
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    }
  });

  it.each([
    "",
    "a".repeat(63),
    "A".repeat(64),
    "https://example.com/join#token",
    "a".repeat(64) + "; other=value",
  ])(
    "rejects malformed invitation credentials before making a request",
    async (token) => {
      const client = new AuthenticatedClient("http://127.0.0.1:1");
      await expect(client.acceptInvitation(token)).rejects.toMatchObject({
        code: "CONFIG_INVALID_INVITATION",
      });
      expect(client.invitationCookie).toBe("");
    },
  );

  it.each([
    { status: 404, context: { error: "Unavailable" }, cookie: "" },
    {
      status: 200,
      context: { id: "testdealer00001" },
      cookie: `dealer_invitation=${"b".repeat(64)}`,
    },
    {
      status: 200,
      context: { id: "invalid" },
      cookie: `dealer_invitation=${"a".repeat(64)}`,
    },
    {
      status: 200,
      context: { id: "testdealer00001" },
      cookie: "dealer_session=unexpected",
    },
  ])(
    "refuses failed or mismatched invitation context without accepting a cookie",
    async ({ status, context, cookie }) => {
      const server = createServer((_request, response) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "set-cookie": cookie,
        });
        response.end(JSON.stringify(context));
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("missing test port");
        const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
        await expect(client.acceptInvitation("a".repeat(64))).rejects.toMatchObject({
          code: status === 404 ? "INVITATION_FAILED" : "INVITATION_CONTEXT_INVALID",
        });
        expect(client.invitationCookie).toBe("");
        expect(client.cookie).toBe("");
      } finally {
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    },
  );

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
    expect(
      probeImageEvidence(syntheticPng(1856, 2304), "image/png", "4:5", {
        width: 1856,
        height: 2304,
      }),
    ).toEqual({
      width: 1856,
      height: 2304,
    });
    expect(() =>
      probeImageEvidence(syntheticPng(1000, 1000), "image/png", "4:5"),
    ).toThrow(/requested 4:5 aspect ratio/);
    expect(() =>
      probeImageEvidence(syntheticPng(1856, 2240), "image/png", "4:5"),
    ).toThrow(/dimensions 1856x2240/);
    expect(() =>
      probeImageEvidence(syntheticPng(928, 1152), "image/png", "4:5", {
        width: 1856,
        height: 2304,
      }),
    ).toThrow(/exact 1856x2304 delivery contract/);
  });

  it("selects the final provider image instead of an interim thought image", () => {
    expect(
      finalInlineImage([
        {
          thought: true,
          inlineData: { mimeType: "image/png", data: "interim-image" },
        },
        {
          inlineData: { mimeType: "image/jpeg", data: "final-image" },
        },
      ]),
    ).toEqual({ mimeType: "image/jpeg", data: "final-image" });
    expect(
      finalInlineImage([
        {
          thought: true,
          inlineData: { mimeType: "image/png", data: "interim-only" },
        },
      ]),
    ).toBeNull();
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
    expect(() => canonicalOrigin("https://untrusted.example")).toThrow(
      expect.objectContaining({ code: "CONFIG_UNTRUSTED_ORIGIN" }),
    );
  });

  it("refuses a canary while another release command owns the shared lock", () => {
    const releaseLockCleanup = acquireReleaseLock();
    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          RELEASE_CANARY_CONFIRM: "caption-image-video-synthetic-only",
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "another staged release command owns the release lock",
      );
    } finally {
      releaseLockCleanup();
    }
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
