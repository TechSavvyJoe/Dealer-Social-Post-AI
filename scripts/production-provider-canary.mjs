#!/usr/bin/env node

/**
 * Authenticated release canary for the production PocketBase -> Gemini proxy.
 *
 * The canary deliberately uses a least-privilege synthetic salesperson and
 * only the checked-in PWA icon. It never writes the salesperson PIN, session
 * cookie, prompts, provider response bodies, generated
 * text, image bytes, video bytes, operation names, or provider file URIs.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = resolve(root, "config/gemini-model-policy.json");
const syntheticImagePath = resolve(root, "public/icon-512.png");
const DEFAULT_EVIDENCE_PATH = resolve(
  root,
  "test-results/production-provider-canary.json",
);
const CONFIRMATION = "caption-image-video-synthetic-only";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PRODUCTION_FLY_ORIGIN = "https://dealer-social-post-ai-production.fly.dev";
const EXACT_STANDARD_VIDEO = Object.freeze({
  aspectRatio: "9:16",
  width: 720,
  height: 1280,
  durationSeconds: 6,
  resolution: "720p",
});
const EXACT_QUALITY_VIDEO = Object.freeze({
  aspectRatio: "16:9",
  width: 1920,
  height: 1080,
  durationSeconds: 8,
  resolution: "1080p",
});
const execFileAsync = promisify(execFile);

class CanaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CanaryError";
    this.code = code;
    this.details = details;
  }
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new CanaryError("CONFIG_MISSING", `${name} is required.`);
  }
  return value;
}

function canonicalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CanaryError(
      "CONFIG_INVALID_ORIGIN",
      "RELEASE_CANARY_BASE_URL must be a valid HTTPS origin.",
    );
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const testLoopbackAllowed = process.env.RELEASE_CANARY_ALLOW_LOOPBACK === "true";
  if (
    (url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new CanaryError(
      "CONFIG_INVALID_ORIGIN",
      "RELEASE_CANARY_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  if (url.origin !== PRODUCTION_FLY_ORIGIN && !(testLoopbackAllowed && isLoopback)) {
    throw new CanaryError(
      "CONFIG_UNTRUSTED_ORIGIN",
      `RELEASE_CANARY_BASE_URL must be ${PRODUCTION_FLY_ORIGIN}; loopback is available only with the explicit test flag.`,
    );
  }
  return url.origin;
}

function isFullCommitSha(value) {
  return /^[a-f0-9]{40}$/i.test(value);
}

function attemptId() {
  return randomBytes(20).toString("hex");
}

function decodedBase64Bytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function isRecognizedImage(data, mimeType) {
  const head = Buffer.from(data.slice(0, 64), "base64");
  if (mimeType === "image/png") {
    return head.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimeType === "image/jpeg") {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      head.subarray(0, 4).toString("ascii") === "RIFF" &&
      head.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function jpegDimensions(buffer) {
  let offset = 2;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && buffer[20] === 0x2f && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (
    chunk === "VP8 " &&
    buffer.length >= 30 &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

export function probeImageEvidence(data, mimeType, expectedAspectRatio) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  if (!isRecognizedImage(data, normalizedMimeType)) {
    throw new CanaryError(
      "IMAGE_OUTPUT_INVALID",
      "Image provider output was not a supported image.",
    );
  }
  const buffer = Buffer.from(data, "base64");
  let dimensions = null;
  if (normalizedMimeType === "image/png" && buffer.length >= 24) {
    dimensions = {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } else if (normalizedMimeType === "image/jpeg") {
    dimensions = jpegDimensions(buffer);
  } else if (normalizedMimeType === "image/webp") {
    dimensions = webpDimensions(buffer);
  }

  const ratioParts = /^(\d+):(\d+)$/.exec(expectedAspectRatio);
  if (
    !dimensions ||
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    !ratioParts
  ) {
    throw new CanaryError(
      "IMAGE_OUTPUT_INVALID",
      "Image provider output did not expose valid pixel dimensions.",
    );
  }
  const expectedWidthRatio = Number(ratioParts[1]);
  const expectedHeightRatio = Number(ratioParts[2]);
  const ratioError =
    Math.abs(
      dimensions.width * expectedHeightRatio - dimensions.height * expectedWidthRatio,
    ) /
    Math.max(
      dimensions.width * expectedHeightRatio,
      dimensions.height * expectedWidthRatio,
    );
  if (ratioError > 0.005) {
    throw new CanaryError(
      "IMAGE_OUTPUT_INVALID",
      `Generated image did not satisfy the requested ${expectedAspectRatio} aspect ratio.`,
    );
  }
  return dimensions;
}

function providerVideoUri(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return "";
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      ["uri", "fileUri", "file_uri", "videoUri", "video_uri"].includes(key)
    ) {
      try {
        const parsed = new URL(child);
        if (
          parsed.protocol === "https:" &&
          parsed.hostname === "generativelanguage.googleapis.com" &&
          /^\/v1beta\/files\/[A-Za-z0-9._~-]+(?::download)?$/.test(parsed.pathname)
        ) {
          return parsed.toString();
        }
      } catch {
        // Non-URL strings are not provider media references.
      }
    }
    if (child && typeof child === "object") {
      const found = providerVideoUri(child, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function operationPollPath(name) {
  let clean = (name || "").trim().replace(/^\/+/, "");
  clean = clean.replace(/^v1beta\//i, "");
  if (/^operations\/[A-Za-z0-9._~-]+$/.test(clean)) {
    return `v1beta/${clean}`;
  }
  if (/^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._~-]+$/.test(clean)) {
    return `v1beta/${clean}`;
  }
  throw new CanaryError(
    "VIDEO_OPERATION_INVALID",
    "Veo returned an invalid operation identifier.",
  );
}

function failureEvidence(error) {
  if (error instanceof CanaryError) {
    return {
      code: error.code,
      message: error.message,
      ...(Number.isInteger(error.details.status)
        ? { httpStatus: error.details.status }
        : {}),
    };
  }
  return {
    code: "UNEXPECTED_FAILURE",
    message: "The provider canary failed unexpectedly.",
  };
}

async function loadPolicy() {
  return JSON.parse(await readFile(policyPath, "utf8"));
}

async function contractCheck() {
  const policy = await loadPolicy();
  const requiredTasks = [
    "caption",
    "image_standard",
    "video_standard",
    "video_quality",
  ];
  for (const task of requiredTasks) {
    if (!policy.tasks?.[task]?.models?.[0]) {
      throw new CanaryError(
        "POLICY_INVALID",
        `Canonical model policy is missing ${task}.`,
      );
    }
  }
  if (policy.tasks.caption.maxOutputTokens !== 2048) {
    throw new CanaryError(
      "POLICY_INVALID",
      "Caption canary must use the canonical 2048-token contract.",
    );
  }
  if (policy.tasks.image_standard.maxOutputTokens !== 4096) {
    throw new CanaryError(
      "POLICY_INVALID",
      "Image canary must use the canonical 4096-token contract.",
    );
  }
  if (policy.tasks.video_standard.resolution !== "720p") {
    throw new CanaryError(
      "POLICY_INVALID",
      "Video canary must use the canonical 720p standard tier.",
    );
  }
  if (policy.tasks.video_quality.resolution !== EXACT_QUALITY_VIDEO.resolution) {
    throw new CanaryError(
      "POLICY_INVALID",
      "Exact delivery video canary must use the canonical 1080p quality tier.",
    );
  }
  const image = await readFile(syntheticImagePath);
  if (
    image.length < 1024 ||
    !image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    throw new CanaryError(
      "SYNTHETIC_ASSET_INVALID",
      "The checked-in synthetic canary image is not a meaningful PNG.",
    );
  }
  console.log("Provider canary contract is valid.");
}

export class AuthenticatedClient {
  constructor(origin) {
    this.origin = origin;
    this.cookie = "";
    this.apiContractVersion = "";
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookie) headers.set("Cookie", this.cookie);
    if (this.apiContractVersion) {
      headers.set("X-Dealer-Client-Contract", this.apiContractVersion);
    }
    return fetch(`${this.origin}${path}`, {
      ...options,
      headers,
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(310_000),
    });
  }

  captureCookie(response) {
    const values =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    const session = values
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith("dealer_session="));
    if (!session || session === "dealer_session=") {
      throw new CanaryError(
        "AUTH_COOKIE_MISSING",
        "Authentication did not issue an opaque session cookie.",
      );
    }
    this.cookie = session;
  }

  async logout() {
    if (!this.cookie) return;
    const previousCookie = this.cookie;
    const response = await this.request("/api/app/session", {
      method: "DELETE",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new CanaryError(
        "LOGOUT_FAILED",
        `Canary session revocation failed with HTTP ${response.status}.`,
        { status: response.status },
      );
    }
    const probeHeaders = new Headers({ Cookie: previousCookie });
    if (this.apiContractVersion) {
      probeHeaders.set("X-Dealer-Client-Contract", this.apiContractVersion);
    }
    const probe = await fetch(`${this.origin}/api/app/session`, {
      method: "GET",
      headers: probeHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const clearCookieHeaders =
      typeof probe.headers.getSetCookie === "function"
        ? probe.headers.getSetCookie()
        : [probe.headers.get("set-cookie")].filter(Boolean);
    const cookieWasCleared = clearCookieHeaders.some(
      (value) =>
        value.startsWith("dealer_session=") &&
        (/max-age=0/i.test(value) || /expires=Thu, 01 Jan 1970/i.test(value)),
    );
    this.cookie = "";
    if (probe.status !== 401 || !cookieWasCleared) {
      throw new CanaryError(
        "REVOCATION_PROBE_FAILED",
        "The revoked canary session remained usable or its cookie was not cleared.",
        { status: probe.status },
      );
    }
  }
}

async function jsonOrFail(response, code, label) {
  if (!response.ok) {
    throw new CanaryError(code, `${label} failed with HTTP ${response.status}.`, {
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new CanaryError(code, `${label} returned invalid JSON.`);
  }
}

function generationHeaders(policy, task) {
  return {
    "Content-Type": "application/json",
    "X-Generation-Task": task,
    "X-Model-Policy-Version": String(policy.version),
    "X-Generation-Attempt-ID": attemptId(),
  };
}

async function runCaption(client, policy) {
  const task = policy.tasks.caption;
  const model = task.models[0];
  const response = await client.request(
    `/api/proxy/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: generationHeaders(policy, "caption"),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Write one upbeat, factual social caption announcing that Dealer Social Post AI passed a synthetic release canary. Use no customer names, claims, prices, inventory details, or personal data.",
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: task.maxOutputTokens },
      }),
    },
  );
  const payload = await jsonOrFail(response, "CAPTION_HTTP_FAILED", "Caption canary");
  const text = (payload.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (text.length < 20 || words < 4) {
    throw new CanaryError(
      "CAPTION_OUTPUT_INVALID",
      "Caption provider output was not meaningful.",
    );
  }
  return { model, characterCount: text.length, wordCount: words };
}

async function runImage(client, policy, imageBase64) {
  const task = policy.tasks.image_standard;
  const model = task.models[0];
  const imageSize = task.imageSizes[model];
  const response = await client.request(
    `/api/proxy/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: generationHeaders(policy, "image_standard"),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Create a polished, brand-neutral release-canary graphic derived only from this synthetic application icon. Preserve the icon as a clearly recognizable central element. Do not add people, names, vehicles, prices, license plates, VINs, contact details, or other customer data.",
              },
              {
                inlineData: { mimeType: "image/png", data: imageBase64 },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { imageSize, aspectRatio: "4:5" },
          maxOutputTokens: task.maxOutputTokens,
        },
      }),
    },
  );
  const payload = await jsonOrFail(response, "IMAGE_HTTP_FAILED", "Image canary");
  const image = (payload.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.inlineData)
    .find(
      (part) => typeof part?.data === "string" && typeof part?.mimeType === "string",
    );
  const byteCount = image?.data ? decodedBase64Bytes(image.data) : 0;
  if (byteCount < 1024) {
    throw new CanaryError(
      "IMAGE_OUTPUT_INVALID",
      "Image provider output was not a meaningful supported image.",
    );
  }
  const dimensions = probeImageEvidence(image.data, image.mimeType, "4:5");
  return {
    model,
    mimeType: image.mimeType.toLowerCase(),
    byteCount,
    imageSize,
    aspectRatio: "4:5",
    ...dimensions,
  };
}

export function validateVideoProbeMetadata(metadata, expected) {
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  const formatNames = String(metadata.format?.format_name || "").split(",");
  const durationSeconds = Number(video?.duration || metadata.format?.duration);
  const videoPacketCount = Number(video?.nb_read_packets);
  const audioPacketCount = Number(audio?.nb_read_packets);
  const durationToleranceSeconds = 0.75;

  if (
    !video ||
    !audio ||
    !formatNames.includes("mp4") ||
    video.codec_name !== "h264" ||
    audio.codec_name !== "aac" ||
    !["yuv420p", "yuvj420p"].includes(video.pix_fmt) ||
    Number(video.width) !== expected.width ||
    Number(video.height) !== expected.height ||
    !Number.isFinite(durationSeconds) ||
    Math.abs(durationSeconds - expected.durationSeconds) > durationToleranceSeconds ||
    !Number.isFinite(videoPacketCount) ||
    videoPacketCount < 1 ||
    !Number.isFinite(audioPacketCount) ||
    audioPacketCount < 1
  ) {
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "Generated video did not satisfy the exact playable MP4 delivery contract.",
    );
  }

  return {
    width: Number(video.width),
    height: Number(video.height),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    pixelFormat: video.pix_fmt,
    videoPacketCount,
    audioPacketCount,
  };
}

export async function probeVideoEvidence(path, expected) {
  const ffprobe = (process.env.RELEASE_CANARY_FFPROBE || "ffprobe").trim();
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-count_packets",
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,pix_fmt,width,height,duration,nb_read_packets",
        "-of",
        "json",
        path,
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    ));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new CanaryError(
        "VIDEO_VALIDATOR_UNAVAILABLE",
        "ffprobe is required for the authenticated release canary. Install FFmpeg or set RELEASE_CANARY_FFPROBE to its executable.",
      );
    }
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "ffprobe could not read the generated video to completion.",
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "ffprobe returned invalid video metadata.",
    );
  }
  return validateVideoProbeMetadata(metadata, expected);
}

async function readVideoEvidence(response, expected) {
  if (!response.ok) {
    throw new CanaryError(
      "VIDEO_DOWNLOAD_FAILED",
      `Video download failed with HTTP ${response.status}.`,
      { status: response.status },
    );
  }
  if (!response.body) {
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "Video provider output had no media body.",
    );
  }
  const mimeType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!mimeType.startsWith("video/") && mimeType !== "application/octet-stream") {
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "Video provider output had an unsupported media type.",
    );
  }

  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "dealer-social-video-canary-"),
  );
  const videoPath = resolve(temporaryDirectory, "synthetic-output.mp4");
  let handle = null;
  try {
    handle = await open(videoPath, "wx", 0o600);
    const reader = response.body.getReader();
    let byteCount = 0;
    let head = Buffer.alloc(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new CanaryError(
          "VIDEO_OUTPUT_INVALID",
          "Video provider output exceeded the release-canary size limit.",
        );
      }
      await handle.writeFile(value);
      if (head.length < 32) {
        head = Buffer.concat([head, Buffer.from(value)]).subarray(0, 32);
      }
    }
    await handle.close();
    handle = null;
    if (
      byteCount < 4096 ||
      head.length < 12 ||
      head.subarray(4, 8).toString("ascii") !== "ftyp"
    ) {
      throw new CanaryError(
        "VIDEO_OUTPUT_INVALID",
        "Video provider output was not a meaningful MP4.",
      );
    }
    const probe = await probeVideoEvidence(videoPath, expected);
    return { mimeType, byteCount, container: "mp4", ...probe };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function runVideo(client, policy, imageBase64, taskName, expected) {
  const task = policy.tasks[taskName];
  const model = task.models[0];
  const headers = generationHeaders(policy, taskName);
  const response = await client.request(
    `/api/proxy/v1beta/models/${model}:predictLongRunning`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [
          {
            prompt:
              "Animate only this synthetic application icon with subtle light movement and a slow premium push-in. Keep the same single graphic throughout. Do not add people, vehicles, names, prices, plates, VINs, text, or customer data.",
            image: {
              bytesBase64Encoded: imageBase64,
              mimeType: "image/png",
            },
          },
        ],
        parameters: {
          aspectRatio: expected.aspectRatio,
          personGeneration: "allow_adult",
          durationSeconds: expected.durationSeconds,
          resolution: task.resolution,
        },
      }),
    },
  );
  const start = await jsonOrFail(response, "VIDEO_START_FAILED", "Video canary");
  const pollPath = operationPollPath(start.name);
  const timeoutMs = Number(process.env.RELEASE_CANARY_VIDEO_TIMEOUT_MS || 720_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 900_000) {
    throw new CanaryError(
      "CONFIG_INVALID_TIMEOUT",
      "RELEASE_CANARY_VIDEO_TIMEOUT_MS must be between 60000 and 900000.",
    );
  }
  const deadline = Date.now() + timeoutMs;
  let delayMs = 5_000;
  let pollCount = 0;
  let completed = null;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    pollCount += 1;
    const poll = await client.request(`/api/proxy/${pollPath}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(60_000),
    });
    const operation = await jsonOrFail(poll, "VIDEO_POLL_FAILED", "Video poll");
    if (operation.done === true) {
      if (operation.error) {
        throw new CanaryError(
          "VIDEO_PROVIDER_FAILED",
          "Veo reported a terminal generation failure.",
        );
      }
      completed = operation.response;
      break;
    }
    delayMs = Math.min(Math.round(delayMs * 1.5), 30_000);
  }
  if (!completed) {
    throw new CanaryError(
      "VIDEO_TIMEOUT",
      "Veo did not complete before the release-canary deadline.",
    );
  }
  const uri = providerVideoUri(completed);
  if (!uri) {
    throw new CanaryError(
      "VIDEO_OUTPUT_INVALID",
      "Completed Veo operation did not include an authorized media reference.",
    );
  }
  const providerUrl = new URL(uri);
  const mediaPath = providerUrl.pathname.endsWith(":download")
    ? providerUrl.pathname
    : `${providerUrl.pathname}:download`;
  const media = await client.request(
    // Never relay provider-returned query material. The same-origin proxy owns
    // authentication and requires only the allowlisted path plus alt=media.
    `/api/proxy${mediaPath}?alt=media`,
    {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(310_000),
    },
  );
  const mediaEvidence = await readVideoEvidence(media, expected);
  return {
    model,
    tier: task.tier,
    requestedAspectRatio: expected.aspectRatio,
    requestedDurationSeconds: expected.durationSeconds,
    resolution: task.resolution,
    pollCount,
    ...mediaEvidence,
  };
}

async function writeEvidence(path, evidence) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, absolute);
  return absolute;
}

async function run() {
  if (process.argv.includes("--contract-check")) {
    await contractCheck();
    return;
  }

  const origin = canonicalOrigin(requireEnv("RELEASE_CANARY_BASE_URL"));
  const expectedReleaseSha = requireEnv("RELEASE_CANARY_EXPECTED_SHA");
  if (!isFullCommitSha(expectedReleaseSha)) {
    throw new CanaryError(
      "CONFIG_INVALID_SHA",
      "RELEASE_CANARY_EXPECTED_SHA must be a full 40-character commit SHA.",
    );
  }
  const personPin = requireEnv("RELEASE_CANARY_PERSON_PIN");
  if (!/^\d{4}$/.test(personPin)) {
    throw new CanaryError(
      "CONFIG_INVALID_PERSON_PIN",
      "RELEASE_CANARY_PERSON_PIN must be exactly four digits.",
    );
  }
  if (requireEnv("RELEASE_CANARY_CONFIRM") !== CONFIRMATION) {
    throw new CanaryError(
      "CONFIG_CONFIRMATION_REQUIRED",
      `RELEASE_CANARY_CONFIRM must equal ${CONFIRMATION}.`,
    );
  }

  const evidencePath =
    process.env.RELEASE_CANARY_EVIDENCE_PATH || DEFAULT_EVIDENCE_PATH;
  const policy = await loadPolicy();
  await contractCheck();
  const syntheticImage = await readFile(syntheticImagePath);
  const imageBase64 = syntheticImage.toString("base64");
  const startedAt = new Date().toISOString();
  const client = new AuthenticatedClient(origin);
  const evidence = {
    schemaVersion: 3,
    canary: "production-provider-proxy",
    syntheticAsset: "public/icon-512.png",
    targetOrigin: origin,
    expectedReleaseSha,
    startedAt,
    completedAt: null,
    outcome: "running",
    apiContractVersion: null,
    modelPolicyVersion: String(policy.version),
    checks: {},
  };
  let primaryError = null;

  try {
    console.log("Authenticating release canary (credential remains hidden)...");
    const loginResponse = await client.request("/api/app/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerCode: personPin }),
      signal: AbortSignal.timeout(30_000),
    });
    const login = await jsonOrFail(
      loginResponse,
      "AUTH_FAILED",
      "Canary authentication",
    );
    // Capture first so even an incorrectly privileged session is revoked in
    // the finally block before the canary fails its least-privilege check.
    client.captureCookie(loginResponse);
    if (login.role !== "salesperson") {
      throw new CanaryError(
        "AUTH_ROLE_INVALID",
        "Canary credential did not resolve to least-privilege salesperson access.",
      );
    }
    evidence.checks.authentication = { passed: true, role: "salesperson" };

    const healthResponse = await client.request("/api/app/health", {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });
    const health = await jsonOrFail(
      healthResponse,
      "HEALTH_FAILED",
      "Authenticated health gate",
    );
    if (health.ok !== true || health.releaseSha !== expectedReleaseSha) {
      throw new CanaryError(
        "HEALTH_RELEASE_MISMATCH",
        "Authenticated health did not report the exact expected healthy release.",
      );
    }
    if (String(health.modelPolicyVersion) !== String(policy.version)) {
      throw new CanaryError(
        "HEALTH_POLICY_MISMATCH",
        "Authenticated health reported a different model-policy version.",
      );
    }
    client.apiContractVersion = String(health.apiContractVersion || "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(client.apiContractVersion)) {
      throw new CanaryError(
        "HEALTH_CONTRACT_INVALID",
        "Authenticated health did not report a valid API-contract version.",
      );
    }
    evidence.apiContractVersion = client.apiContractVersion;
    evidence.checks.health = {
      passed: true,
      releaseSha: health.releaseSha,
      backupStatus: health.backup?.status || "unknown",
    };

    console.log("Running caption provider canary...");
    evidence.checks.caption = {
      passed: true,
      ...(await runCaption(client, policy)),
    };
    console.log("Caption provider canary passed.");

    console.log("Running standard-image provider canary...");
    evidence.checks.standardImage = {
      passed: true,
      ...(await runImage(client, policy, imageBase64)),
    };
    console.log("Standard-image provider canary passed.");

    console.log(
      "Running exact 720p/6-second standard-video provider canary (this can take minutes)...",
    );
    evidence.checks.standardVideo = {
      passed: true,
      ...(await runVideo(
        client,
        policy,
        imageBase64,
        "video_standard",
        EXACT_STANDARD_VIDEO,
      )),
    };
    console.log("Exact standard-video provider canary passed.");

    console.log(
      "Running exact 1080p/8-second quality-video provider canary (this can take minutes)...",
    );
    evidence.checks.qualityVideo = {
      passed: true,
      ...(await runVideo(
        client,
        policy,
        imageBase64,
        "video_quality",
        EXACT_QUALITY_VIDEO,
      )),
    };
    console.log("Exact quality-video provider canary passed.");

    evidence.outcome = "passed";
  } catch (error) {
    primaryError = error;
    evidence.outcome = "failed";
    evidence.failure = failureEvidence(error);
  } finally {
    try {
      await client.logout();
      evidence.checks.sessionRevocation = { passed: true };
    } catch (logoutError) {
      evidence.checks.sessionRevocation = { passed: false };
      if (!primaryError) {
        primaryError = logoutError;
        evidence.outcome = "failed";
        evidence.failure = failureEvidence(logoutError);
      }
    }
    evidence.completedAt = new Date().toISOString();
    const written = await writeEvidence(evidencePath, evidence);
    console.log(`Redacted canary evidence written to ${written}`);
  }

  if (primaryError) throw primaryError;
  console.log("Authenticated production provider canary passed.");
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  run().catch(async (error) => {
    // A stale temp evidence file is not useful and could confuse automation.
    const evidencePath =
      process.env.RELEASE_CANARY_EVIDENCE_PATH || DEFAULT_EVIDENCE_PATH;
    await rm(`${resolve(evidencePath)}.tmp-${process.pid}`, { force: true }).catch(
      () => {},
    );
    const safe = failureEvidence(error);
    console.error(`Provider canary failed [${safe.code}]: ${safe.message}`);
    process.exitCode = 1;
  });
}
