#!/usr/bin/env node

/**
 * Authenticated production canary for the private Dealer Social -> Customer
 * Hub handoff. The live mode is intentionally write-gated and uses only a
 * reviewed, checked-in synthetic source for one app-generated image. It never
 * uses customer media, publishes a Hub draft, or records the PIN or cookie.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  AuthenticatedClient,
  canonicalOrigin,
  generateStandardCanaryImage,
} from "./production-provider-canary.mjs";
import { acquireReleaseLock } from "./vercel-staged-qa.mjs";
import {
  HUB_CANARY_DRAFT_ID,
  validHubCanaryIdentity,
  hubCanaryIdentityMatches,
  validHubPurgeResult,
} from "./lib/website-handoff-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const syntheticImagePath = resolve(
  root,
  "docs/marketing/demo/synthetic-delivery-photo.jpg",
);
const backendContractPath = resolve(root, "pb_hooks/main.pb.js");
const DEFAULT_EVIDENCE_PATH = resolve(
  root,
  ".release-evidence/production-website-handoff-canary.json",
);
const SYNTHETIC_ASSET = "docs/marketing/demo/synthetic-delivery-photo.jpg";
const SYNTHETIC_ASSET_SHA256 =
  "828593892b475286726555359248bc2e47bd2a59239e8c750ca2cb885c6b1139";
const PRODUCTION_FLY_ORIGIN = "https://dealer-social-post-ai-production.fly.dev";
const CUSTOMER_HUB_ORIGIN = "https://joegallant.me";
const CONFIRMATION = "website-private-draft-synthetic-only";
const IMAGE_CONFIRMATION = "one-paid-image-from-reviewed-synthetic-source";
const policyPath = resolve(root, "config/gemini-model-policy.json");
const CLEANUP_CONFIRMATION = "private-synthetic-draft-purged";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const POLL_TIMEOUT_MS = 180_000;
const REVISION_CONFLICT_CODE = "WEBSITE_POST_REVISION_CONFLICT";

export class WebsiteHandoffCanaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WebsiteHandoffCanaryError";
    this.code = code;
    this.details = details;
  }
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new WebsiteHandoffCanaryError("CONFIG_MISSING", `${name} is required.`);
  }
  return value;
}

function isFullCommitSha(value) {
  return /^[a-f0-9]{40}$/i.test(value || "");
}

function isSafeOpaqueRevision(value) {
  return (
    (typeof value === "string" || Number.isSafeInteger(value)) &&
    String(value).length >= 1 &&
    String(value).length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(String(value))
  );
}

export function canonicalProductionOrigin(value) {
  const origin = canonicalOrigin(value);
  if (origin !== PRODUCTION_FLY_ORIGIN) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_UNTRUSTED_PRODUCTION_ORIGIN",
      `The production website canary must target ${PRODUCTION_FLY_ORIGIN}.`,
    );
  }
  return origin;
}

export function canonicalHubOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_INVALID_HUB_ORIGIN",
      "Customer Hub must be a valid HTTPS origin.",
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
    throw new WebsiteHandoffCanaryError(
      "CONFIG_INVALID_HUB_ORIGIN",
      "Customer Hub must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  if (url.origin !== CUSTOMER_HUB_ORIGIN && !(testLoopbackAllowed && isLoopback)) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_UNTRUSTED_HUB_ORIGIN",
      `Customer Hub must be ${CUSTOMER_HUB_ORIGIN}; loopback is available only with the explicit test flag.`,
    );
  }
  return url.origin;
}

/** Add valid EXIF-without-Orientation and Photoshop APP13 segments in memory. */
export function injectSyntheticJpegMetadata(source) {
  if (
    !Buffer.isBuffer(source) ||
    source.length < 4 ||
    source[0] !== 0xff ||
    source[1] !== 0xd8 ||
    source[2] !== 0xff
  ) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_ASSET_INVALID",
      "The website canary asset must be a JPEG.",
    );
  }

  // Exif\0\0 + little-endian TIFF header + an empty IFD. The empty IFD
  // deliberately reproduces the missing-Orientation metadata edge case.
  const exifWithoutOrientation = Buffer.from([
    0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const photoshopPayload = Buffer.from("Photoshop 3.0\0", "ascii");
  const photoshopApp13 = Buffer.alloc(4 + photoshopPayload.length);
  photoshopApp13[0] = 0xff;
  photoshopApp13[1] = 0xed;
  photoshopApp13.writeUInt16BE(photoshopPayload.length + 2, 2);
  photoshopPayload.copy(photoshopApp13, 4);

  const wrapped = Buffer.concat([
    source.subarray(0, 2),
    exifWithoutOrientation,
    photoshopApp13,
    source.subarray(2),
  ]);
  if (wrapped.length > MAX_IMAGE_BYTES) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_ASSET_TOO_LARGE",
      "The synthetic website canary image exceeds the destination limit.",
    );
  }
  return wrapped;
}

/** Return application marker bytes encountered before JPEG scan data. */
export function jpegApplicationMarkers(source) {
  if (
    !Buffer.isBuffer(source) ||
    source.length < 4 ||
    source[0] !== 0xff ||
    source[1] !== 0xd8
  ) {
    return [];
  }
  const markers = [];
  let offset = 2;
  while (offset + 4 <= source.length) {
    if (source[offset] !== 0xff) break;
    while (source[offset] === 0xff) offset += 1;
    const marker = source[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > source.length) break;
    const segmentLength = source.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > source.length) break;
    if (marker >= 0xe0 && marker <= 0xef) markers.push(marker);
    offset += segmentLength;
  }
  return markers;
}

export function buildSyntheticDrafts(marker) {
  if (!/^QA-[a-f0-9]{8}-[a-f0-9]{4}$/i.test(marker || "")) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_MARKER_INVALID",
      "The synthetic canary marker is invalid.",
    );
  }
  const shared = {
    schemaVersion: 1,
    enabled: true,
    kind: "site_update",
    category: "community",
    altText:
      "Synthetic release image with AI-generated dealership figures and a vehicle.",
    privacyFlags: ["faces_visible", "review_visual_privacy"],
  };
  return {
    initial: {
      ...shared,
      title: `Synthetic handoff setup ${marker}`,
      body: "Synthetic setup copy. This must not reach Customer Hub before final Send. Never publish.",
    },
    final: {
      ...shared,
      title: `Synthetic handoff final ${marker}`,
      body: "Synthetic final copy for private handoff verification. No customer data. Never publish.",
    },
  };
}

export function extractHubDraftId(reviewUrl, hubOrigin = CUSTOMER_HUB_ORIGIN) {
  let url;
  try {
    url = new URL(reviewUrl);
  } catch {
    throw new WebsiteHandoffCanaryError(
      "HUB_REVIEW_URL_INVALID",
      "Customer Hub returned an invalid private review URL.",
    );
  }
  const canonical = canonicalHubOrigin(hubOrigin);
  const match = /^#inbox-(dspc_[a-f0-9]{32})$/.exec(url.hash);
  if (
    url.origin !== canonical ||
    url.pathname !== "/backend/" ||
    url.search ||
    !match ||
    reviewUrl !== `${canonical}/backend/#inbox-${match[1]}`
  ) {
    throw new WebsiteHandoffCanaryError(
      "HUB_REVIEW_URL_INVALID",
      "Customer Hub returned a review URL outside the expected private draft route.",
    );
  }
  return match[1];
}

export function nextMinuteBoundaryWaitMs(now = new Date(), graceMs = 8_000) {
  const elapsed = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return 60_000 - elapsed + graceMs;
}

function routeSlice(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const next = source.indexOf('\nrouterAdd("', start + signature.length);
  return source.slice(start, next < 0 ? source.length : next);
}

/**
 * Static fail-closed check against the backend revision/explicit-send
 * contract. Live mode applies it to the exact commit reported by production.
 */
export function validateRevisionContractSource(source) {
  const create = routeSlice(source, 'routerAdd("POST", "/api/app/posts",');
  const patch = routeSlice(source, 'routerAdd("PATCH", "/api/app/posts/:id/draft",');
  const send = routeSlice(
    source,
    'routerAdd("POST", "/api/app/posts/:id/website-publication",',
  );
  if (!create || !patch || !send) {
    throw new WebsiteHandoffCanaryError(
      "BACKEND_CONTRACT_MISSING",
      "The website handoff routes are missing from the release source.",
    );
  }
  if (
    !patch.includes("expected_post_revision") ||
    !patch.includes("POST_DRAFT_REVISION_REQUIRED") ||
    !patch.includes("POST_DRAFT_REVISION_CONFLICT") ||
    !patch.includes("post_revision") ||
    !send.includes("expected_post_revision") ||
    !send.includes("WEBSITE_POST_REVISION_REQUIRED") ||
    !send.includes(REVISION_CONFLICT_CODE)
  ) {
    throw new WebsiteHandoffCanaryError(
      "BACKEND_REVISION_GUARD_MISSING",
      "The exact post-revision guard is missing from the website handoff contract.",
    );
  }
  if (
    create.includes("createPublicationForPost") ||
    create.includes("claimPublicationForPost")
  ) {
    throw new WebsiteHandoffCanaryError(
      "BACKEND_PREMATURE_DELIVERY",
      "Initial post creation must not enqueue a Customer Hub draft.",
    );
  }
  const expectedRevisionIndex = send.indexOf("expected_post_revision");
  const enqueueIndex = send.indexOf("claimPublicationForPost");
  if (
    enqueueIndex < 0 ||
    expectedRevisionIndex < 0 ||
    expectedRevisionIndex > enqueueIndex
  ) {
    throw new WebsiteHandoffCanaryError(
      "BACKEND_REVISION_GUARD_ORDER_INVALID",
      "The revision guard must run before website delivery is enqueued.",
    );
  }
  return true;
}

function backendSourceForRelease(releaseSha) {
  try {
    return execFileSync("git", ["show", `${releaseSha}:pb_hooks/main.pb.js`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new WebsiteHandoffCanaryError(
      "RELEASE_SOURCE_UNAVAILABLE",
      "The exact production release source is not available in this repository.",
    );
  }
}

async function contractCheck(source = null) {
  const image = await readFile(syntheticImagePath);
  const digest = createHash("sha256").update(image).digest("hex");
  if (digest !== SYNTHETIC_ASSET_SHA256) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_ASSET_CHANGED",
      "The reviewed synthetic website canary asset has changed.",
    );
  }
  const wrapped = injectSyntheticJpegMetadata(image);
  const markers = jpegApplicationMarkers(wrapped);
  if (!markers.includes(0xe1) || !markers.includes(0xed)) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_METADATA_INVALID",
      "The canary did not reproduce both EXIF and Photoshop metadata segments.",
    );
  }
  buildSyntheticDrafts("QA-01234567-89ab");
  validateRevisionContractSource(
    source === null ? await readFile(backendContractPath, "utf8") : source,
  );
  console.log("Website handoff canary contract is valid.");
}

async function writeEvidence(path, evidence) {
  const absolute = resolve(path);
  const directory = dirname(absolute);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new WebsiteHandoffCanaryError(
      "EVIDENCE_PATH_UNSAFE",
      "The release evidence path is not a private directory.",
    );
  }
  if (basename(directory) === ".release-evidence") await chmod(directory, 0o700);
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, absolute);
  return absolute;
}

async function jsonOrFail(response, code, label) {
  if (!response.ok) {
    throw new WebsiteHandoffCanaryError(
      code,
      `${label} failed with HTTP ${response.status}.`,
      { status: response.status },
    );
  }
  try {
    return await response.json();
  } catch {
    throw new WebsiteHandoffCanaryError(code, `${label} returned invalid JSON.`);
  }
}

async function expectedJsonResponse(response, status, code, label) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new WebsiteHandoffCanaryError(
      "EXPECTED_RESPONSE_INVALID",
      `${label} returned invalid JSON.`,
      { status: response.status },
    );
  }
  if (response.status !== status || payload?.code !== code) {
    throw new WebsiteHandoffCanaryError(
      "EXPECTED_RESPONSE_MISMATCH",
      `${label} did not return the expected guarded response.`,
      { status: response.status },
    );
  }
  return payload;
}

export function assertNotRequested(publication, label) {
  // Status reads may overlay a documented review hold without enqueueing a
  // publication. Only the matching image-review flag explains that error;
  // flags do not relax the undelivered state, attempts, or private URL checks.
  const lastError = publication?.lastError;
  const permittedReviewError =
    lastError === "image_review_required" &&
    publication?.image_review_required === true;
  const validReviewFlags = ["image_review_required", "identity_review_required"].every(
    (key) =>
      publication?.[key] === undefined ||
      publication?.[key] === null ||
      typeof publication[key] === "boolean",
  );
  if (
    publication?.status !== "not_requested" ||
    publication?.attempts !== 0 ||
    publication?.reviewUrl !== "" ||
    !validReviewFlags ||
    (lastError !== "" && !permittedReviewError)
  ) {
    throw new WebsiteHandoffCanaryError(
      "PREMATURE_WEBSITE_DELIVERY",
      `${label} did not remain an undelivered private website draft.`,
    );
  }
}

export function validateReadyPublication(publication) {
  if (
    publication?.status !== "draft_ready" ||
    Number(publication?.attempts) !== 0 ||
    (publication?.lastError || "") !== ""
  ) {
    throw new WebsiteHandoffCanaryError(
      "WEBSITE_READY_CONTRACT_INVALID",
      "Customer Hub draft readiness did not have a clean delivery receipt.",
    );
  }
  return publication;
}

function assertSafeRevision(value, label) {
  if (!isSafeOpaqueRevision(value)) {
    throw new WebsiteHandoffCanaryError(
      "POST_REVISION_INVALID",
      `${label} did not return a safe opaque post revision.`,
    );
  }
  return value;
}

export function assertCurrentImageProvenance(publication, label) {
  // PocketBase 0.22 serializes the routes' false || undefined flags as null.
  // Only these documented clear values are compatible with that wire contract.
  const clearReviewFlags = ["image_review_required", "identity_review_required"].every(
    (key) =>
      publication?.[key] === undefined ||
      publication?.[key] === null ||
      publication?.[key] === false,
  );
  if (!clearReviewFlags || publication?.lastError === "image_review_required") {
    throw new WebsiteHandoffCanaryError(
      "IMAGE_PROVENANCE_NOT_READY",
      `${label} did not clear the current server image and identity review gates.`,
    );
  }
}

export async function recordCreatedPostIdentity(
  created,
  dealerId,
  evidence,
  evidencePath,
) {
  if (
    typeof created?.id !== "string" ||
    !/^[A-Za-z0-9_-]{10,40}$/.test(created?.id || "") ||
    typeof dealerId !== "string" ||
    !/^[A-Za-z0-9_-]{10,40}$/.test(dealerId || "")
  ) {
    throw new WebsiteHandoffCanaryError(
      "POST_CREATE_CONTRACT_INVALID",
      "Synthetic post save did not return a safe audit identity.",
    );
  }
  evidence.resources.postId = created.id;
  evidence.resources.sourceDealerId = dealerId;
  evidence.cleanup.required = true;
  evidence.cleanup.status = "dealer_post_created";
  await writeEvidence(evidencePath, evidence);
}

export function assertNoUncertainImageRequest(previousEvidence) {
  if (
    ["request_in_flight", "uncertain"].includes(
      previousEvidence?.checks?.imageGeneration?.status,
    )
  ) {
    throw new WebsiteHandoffCanaryError(
      "IMAGE_REQUEST_UNCERTAIN_BLOCKED",
      "A prior paid image request has no confirmed outcome. Resolve that attempt before starting another canary.",
    );
  }
}

export async function generateWebsiteCanaryImage(
  client,
  policy,
  source,
  imageAttemptId,
  confirmation,
) {
  if (confirmation !== IMAGE_CONFIRMATION)
    throw new WebsiteHandoffCanaryError(
      "IMAGE_CONFIRMATION_REQUIRED",
      `WEBSITE_HANDOFF_CANARY_IMAGE_CONFIRM must equal ${IMAGE_CONFIRMATION}.`,
    );
  if (
    !Buffer.isBuffer(source) ||
    createHash("sha256").update(source).digest("hex") !== SYNTHETIC_ASSET_SHA256
  ) {
    throw new WebsiteHandoffCanaryError(
      "SYNTHETIC_ASSET_CHANGED",
      "The reviewed synthetic source image has changed.",
    );
  }
  return generateStandardCanaryImage(client, policy, source.toString("base64"), {
    sourceMimeType: "image/jpeg",
    imageAttemptId,
    prompt:
      "Create one polished synthetic dealership release-test image using only the attached synthetic source. Preserve the two AI-generated figures and vehicle. Use no real customer data. Add no names, lettering, logos, VINs, license plates, contact details, prices, financial details, or paperwork. This is only for a private synthetic draft and must never be published.",
  });
}

export function createPostForm(image, websiteDraft, imageMimeType, imageAttemptId) {
  if (
    !Buffer.isBuffer(image) ||
    image.length < 1024 ||
    image.length > MAX_IMAGE_BYTES ||
    !["image/png", "image/jpeg", "image/webp"].includes(imageMimeType) ||
    !/^[a-f0-9]{40}$/.test(imageAttemptId || "")
  ) {
    throw new WebsiteHandoffCanaryError(
      "GENERATED_IMAGE_SAVE_INVALID",
      "Post save requires the actual app-generated image and attempt ID.",
    );
  }
  const form = new FormData();
  form.append("style", "friendly");
  form.append("tone", "family");
  form.append("customer_name", "");
  form.append("scenario_id", "community_event");
  form.append("vin", "");
  form.append("caption_source", "custom");
  form.append("image_attempt_id", imageAttemptId);
  form.append("caption", "Synthetic setup caption. Never publish.");
  form.append("disclosures", "");
  form.append("platform_ids", "[]");
  form.append("platform_captions", "{}");
  form.append("media_output_mode", "photo");
  form.append("website_draft", JSON.stringify(websiteDraft));
  const extension =
    imageMimeType === "image/png"
      ? "png"
      : imageMimeType === "image/webp"
        ? "webp"
        : "jpg";
  form.append(
    "creative_image",
    new Blob([image], { type: imageMimeType }),
    `qa.${extension}`,
  );
  return form;
}

export function createDraftForm(caption, expectedPostRevision) {
  const revision = assertSafeRevision(expectedPostRevision, "Draft update input");
  const form = new FormData();
  form.append("expected_post_revision", String(revision));
  form.append("caption", caption);
  form.append("disclosures", "");
  form.append("platform_captions", "{}");
  return form;
}

async function waitInVisibleChunks(waitMs, label) {
  let remaining = waitMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 45_000);
    console.log(`${label} (${Math.ceil(remaining / 1000)}s remaining)...`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, chunk));
    remaining -= chunk;
  }
}

async function publicationStatus(client, postId) {
  const response = await client.request(
    `/api/app/posts/${encodeURIComponent(postId)}/website-publication`,
    { method: "GET", signal: AbortSignal.timeout(30_000) },
  );
  return jsonOrFail(response, "WEBSITE_STATUS_FAILED", "Website draft status");
}

async function pollForDraftReady(client, postId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    const publication = await publicationStatus(client, postId);
    lastStatus = publication?.status || "invalid";
    if (lastStatus === "draft_ready") return publication;
    if (["failed", "published", "withdrawn"].includes(lastStatus)) {
      throw new WebsiteHandoffCanaryError(
        "WEBSITE_DELIVERY_TERMINAL",
        `Synthetic website delivery reached unexpected terminal state ${lastStatus}.`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new WebsiteHandoffCanaryError(
    "WEBSITE_DELIVERY_TIMEOUT",
    `Synthetic website delivery remained ${lastStatus} past the canary deadline.`,
  );
}

function failureEvidence(error) {
  return {
    code: error && typeof error.code === "string" ? error.code : "CANARY_UNEXPECTED",
    message:
      error instanceof Error ? error.message : "Unexpected website canary failure.",
    ...(error?.details?.status ? { status: error.details.status } : {}),
  };
}

export async function preflightSyntheticCanaryDestination(
  client,
  dealerId,
  hubOrigin = CUSTOMER_HUB_ORIGIN,
) {
  const destinations = await jsonOrFail(
    await client.request("/api/app/website-destinations", {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    }),
    "DESTINATION_FAILED",
    "Website destination check",
  );
  const destination =
    Array.isArray(destinations.items) && destinations.items.length === 1
      ? destinations.items[0]
      : null;
  if (
    !destination ||
    destination.enabled !== true ||
    destination.id !== "joe_customer_hub" ||
    destination.mode !== "private_draft" ||
    destination.siteUrl !== hubOrigin ||
    destination.namespace !== "synthetic_canary" ||
    destination.dealerId !== dealerId
  ) {
    throw new WebsiteHandoffCanaryError(
      "DESTINATION_UNAVAILABLE",
      "The canary salesperson is not in the exact isolated Customer Hub canary dealership.",
    );
  }
  return destination;
}

async function runLockedCanary() {
  const evidencePath = resolve(
    process.env.WEBSITE_HANDOFF_CANARY_EVIDENCE_PATH || DEFAULT_EVIDENCE_PATH,
  );
  if (evidencePath !== DEFAULT_EVIDENCE_PATH) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_INVALID_EVIDENCE_PATH",
      "WEBSITE_HANDOFF_CANARY_EVIDENCE_PATH must be the canonical private release-evidence path.",
    );
  }
  if (requireEnv("WEBSITE_HANDOFF_CANARY_CONFIRM") !== CONFIRMATION) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_CONFIRMATION_REQUIRED",
      `WEBSITE_HANDOFF_CANARY_CONFIRM must equal ${CONFIRMATION}.`,
    );
  }

  const imageConfirmation = requireEnv("WEBSITE_HANDOFF_CANARY_IMAGE_CONFIRM");
  if (imageConfirmation !== IMAGE_CONFIRMATION)
    throw new WebsiteHandoffCanaryError(
      "IMAGE_CONFIRMATION_REQUIRED",
      `WEBSITE_HANDOFF_CANARY_IMAGE_CONFIRM must equal ${IMAGE_CONFIRMATION}.`,
    );
  try {
    const previousStat = await lstat(evidencePath);
    if (!previousStat.isFile() || previousStat.isSymbolicLink())
      throw new WebsiteHandoffCanaryError(
        "EVIDENCE_PATH_UNSAFE",
        "The prior canary receipt must be a private regular file.",
      );
    assertNoUncertainImageRequest(JSON.parse(await readFile(evidencePath, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // Finish every local/configuration preflight before invalidating the prior
  // receipt. Once a running receipt exists, all live work is inside the
  // evidence try/finally below.
  const origin = canonicalProductionOrigin(requireEnv("RELEASE_CANARY_BASE_URL"));
  const hubOrigin = canonicalHubOrigin(CUSTOMER_HUB_ORIGIN);
  const expectedReleaseSha = requireEnv("RELEASE_CANARY_EXPECTED_SHA");
  if (!isFullCommitSha(expectedReleaseSha)) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_INVALID_SHA",
      "RELEASE_CANARY_EXPECTED_SHA must be a full 40-character commit SHA.",
    );
  }
  const personPin = requireEnv("RELEASE_CANARY_PERSON_PIN");
  if (!/^\d{4}$/.test(personPin)) {
    throw new WebsiteHandoffCanaryError(
      "CONFIG_INVALID_PERSON_PIN",
      "RELEASE_CANARY_PERSON_PIN must be exactly four digits.",
    );
  }
  const invitationToken = requireEnv("RELEASE_CANARY_INVITATION_TOKEN");
  await contractCheck(backendSourceForRelease(expectedReleaseSha));

  const marker = `QA-${expectedReleaseSha.slice(0, 8)}-${expectedReleaseSha.slice(8, 12)}`;
  const drafts = buildSyntheticDrafts(marker);
  const sourceImage = await readFile(syntheticImagePath);
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const client = new AuthenticatedClient(origin);
  const startedAt = new Date().toISOString();
  const evidence = {
    schemaVersion: 3,
    canary: "production-website-private-draft",
    syntheticAsset: SYNTHETIC_ASSET,
    syntheticSourceSha256: SYNTHETIC_ASSET_SHA256,
    syntheticMetadataCase:
      "offline-contract-only-exif-without-orientation-plus-photoshop-app13",
    generatedOutputHandling: "unchanged-provider-bytes",
    modelPolicyVersion: String(policy.version),
    targetOrigin: origin,
    customerHubOrigin: hubOrigin,
    expectedReleaseSha,
    apiContractVersion: null,
    startedAt,
    completedAt: null,
    outcome: "running",
    checks: {},
    resources: { syntheticMarker: marker },
    cleanup: {
      required: false,
      status: "not_created",
      instruction:
        "Retain the labeled synthetic Dealer Social post as private release audit evidence. Purge only this run's exact isolated Customer Hub draft. After all tests, optionally deactivate the synthetic person; never delete the dealer.",
    },
  };
  await writeEvidence(evidencePath, evidence);
  let primaryError = null;

  try {
    console.log("Authenticating synthetic website handoff canary...");
    const invitedDealerId = await client.acceptInvitation(invitationToken);
    const loginResponse = await client.request("/api/app/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerCode: personPin }),
      signal: AbortSignal.timeout(30_000),
    });
    // Capture a successful response's bearer before parsing its JSON so even
    // a malformed success body remains revocable in finally.
    if (loginResponse.ok) client.captureCookie(loginResponse);
    const login = await jsonOrFail(
      loginResponse,
      "AUTH_FAILED",
      "Website canary authentication",
    );
    if (
      login.role !== "salesperson" ||
      login.person?.name !== "Release Canary" ||
      login.dealer?.id !== invitedDealerId
    ) {
      throw new WebsiteHandoffCanaryError(
        "AUTH_ROLE_INVALID",
        "Website canary credential did not resolve to the dedicated least-privilege Release Canary salesperson.",
      );
    }
    if (login.dealer?.requires_approval !== false) {
      throw new WebsiteHandoffCanaryError(
        "AUTH_DEALER_APPROVAL_UNSUITABLE",
        "Website canary dealer must allow an approval-free synthetic post.",
      );
    }
    evidence.checks.authentication = {
      passed: true,
      role: "salesperson",
      privateInvitationConfirmed: true,
    };

    const health = await jsonOrFail(
      await client.request("/api/app/health", {
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      }),
      "HEALTH_FAILED",
      "Authenticated health gate",
    );
    if (
      health.ok !== true ||
      health.releaseSha !== expectedReleaseSha ||
      health.backup?.status !== "verified" ||
      String(health.modelPolicyVersion) !== String(policy.version)
    ) {
      throw new WebsiteHandoffCanaryError(
        "HEALTH_RELEASE_MISMATCH",
        "Authenticated health did not prove the exact backed-up healthy release.",
      );
    }
    client.apiContractVersion = String(health.apiContractVersion || "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(client.apiContractVersion)) {
      throw new WebsiteHandoffCanaryError(
        "HEALTH_CONTRACT_INVALID",
        "Authenticated health did not report a valid API-contract version.",
      );
    }
    evidence.apiContractVersion = client.apiContractVersion;
    evidence.checks.health = {
      passed: true,
      releaseSha: health.releaseSha,
      backupStatus: health.backup.status,
      modelPolicyVersion: String(health.modelPolicyVersion),
    };

    const destination = await preflightSyntheticCanaryDestination(
      client,
      login.dealer.id,
      hubOrigin,
    );
    evidence.checks.destination = {
      passed: true,
      id: destination.id,
      mode: "private_draft",
      namespace: destination.namespace,
      dealerId: destination.dealerId,
    };

    const imageAttemptId = randomBytes(20).toString("hex");
    evidence.checks.imageGeneration = {
      passed: false,
      status: "request_in_flight",
      attempts: 1,
      task: "image_standard",
      sameSession: true,
      imageAttemptId,
      modelPolicyVersion: String(policy.version),
    };
    await writeEvidence(evidencePath, evidence);
    console.log("Generating one app image from the reviewed synthetic source...");
    let generated;
    try {
      generated = await generateWebsiteCanaryImage(
        client,
        policy,
        sourceImage,
        imageAttemptId,
        imageConfirmation,
      );
    } catch (error) {
      evidence.checks.imageGeneration.status =
        error?.code === "IMAGE_REQUEST_UNCERTAIN" ? "uncertain" : "failed";
      throw error;
    }
    const image = generated.imageBytes;
    evidence.checks.imageGeneration = {
      ...evidence.checks.imageGeneration,
      passed: true,
      status: "completed",
      ...generated.evidence,
    };
    await writeEvidence(evidencePath, evidence);

    console.log("Saving a website-only synthetic post without sending it...");
    // A lost/malformed create response can still leave a synthetic post. Mark
    // cleanup before the write so the durable marker remains actionable even
    // when no post ID is recoverable from the response.
    evidence.cleanup.required = true;
    evidence.cleanup.status = "dealer_post_create_in_flight";
    await writeEvidence(evidencePath, evidence);
    const created = await jsonOrFail(
      await client.request("/api/app/posts", {
        method: "POST",
        body: createPostForm(
          image,
          drafts.initial,
          generated.imageMimeType,
          generated.imageAttemptId,
        ),
        signal: AbortSignal.timeout(60_000),
      }),
      "POST_CREATE_FAILED",
      "Synthetic post save",
    );
    // Preserve the confirmed write's audit identity even when a later contract
    // or review assertion fails. This does not mark the canary checks passed.
    await recordCreatedPostIdentity(created, login.dealer.id, evidence, evidencePath);
    if (
      created.approval_status !== "n_a" ||
      created.release_required !== false ||
      !Array.isArray(created.platform_ids) ||
      created.platform_ids.length !== 0 ||
      created.website_draft?.schemaVersion !== drafts.initial.schemaVersion ||
      created.website_draft?.enabled !== true ||
      created.website_draft?.kind !== drafts.initial.kind ||
      created.website_draft?.category !== drafts.initial.category ||
      created.website_draft?.title !== drafts.initial.title ||
      created.website_draft?.body !== drafts.initial.body ||
      created.website_draft?.altText !== drafts.initial.altText ||
      JSON.stringify(created.website_draft?.privacyFlags) !==
        JSON.stringify(drafts.initial.privacyFlags)
    ) {
      throw new WebsiteHandoffCanaryError(
        "POST_CREATE_CONTRACT_INVALID",
        "Synthetic post did not remain website-only and approval-free.",
      );
    }
    assertNotRequested(created.website_publication, "Initial post save");
    assertCurrentImageProvenance(created, "Initial post save");
    const createdRevision = assertSafeRevision(created.updated, "Initial post save");
    evidence.checks.initialPrivateDraft = {
      passed: true,
      websiteOnly: true,
      status: "not_requested",
      imageReviewCleared: true,
      imageAttemptId: generated.imageAttemptId,
      uploadedOutputSha256: createHash("sha256").update(image).digest("hex"),
    };
    await writeEvidence(evidencePath, evidence);

    await waitInVisibleChunks(
      nextMinuteBoundaryWaitMs(),
      "Waiting through a website worker boundary before explicit Send",
    );
    const presendStatus = await publicationStatus(client, created.id);
    assertNotRequested(presendStatus, "Pre-Send worker check");
    assertCurrentImageProvenance(presendStatus, "Pre-Send worker check");
    evidence.checks.noPrematureDelivery = { passed: true, imageReviewCleared: true };

    const savedSetup = await jsonOrFail(
      await client.request(`/api/app/posts/${encodeURIComponent(created.id)}/draft`, {
        method: "PATCH",
        body: createDraftForm(
          "Synthetic saved setup caption. Never publish.",
          createdRevision,
        ),
        signal: AbortSignal.timeout(60_000),
      }),
      "POST_UPDATE_FAILED",
      "Synthetic setup revision save",
    );
    const initialRevision = assertSafeRevision(
      savedSetup.post_revision,
      "Setup draft update",
    );
    const updated = await jsonOrFail(
      await client.request(`/api/app/posts/${encodeURIComponent(created.id)}/draft`, {
        method: "PATCH",
        body: createDraftForm(
          "Synthetic final caption. Never publish.",
          initialRevision,
        ),
        signal: AbortSignal.timeout(60_000),
      }),
      "POST_UPDATE_FAILED",
      "Synthetic final revision save",
    );
    const finalRevision = assertSafeRevision(
      updated.post_revision,
      "Final draft update",
    );
    if (String(finalRevision) === String(initialRevision)) {
      throw new WebsiteHandoffCanaryError(
        "POST_REVISION_NOT_ADVANCED",
        "Editing the synthetic post did not advance its revision.",
      );
    }

    const sendPath = `/api/app/posts/${encodeURIComponent(created.id)}/website-publication`;
    await expectedJsonResponse(
      await client.request(sendPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_draft: drafts.final }),
        signal: AbortSignal.timeout(30_000),
      }),
      409,
      "WEBSITE_POST_REVISION_REQUIRED",
      "Unversioned website Send",
    );
    await expectedJsonResponse(
      await client.request(sendPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_draft: drafts.final,
          expected_post_revision: initialRevision,
        }),
        signal: AbortSignal.timeout(30_000),
      }),
      409,
      REVISION_CONFLICT_CODE,
      "Stale website Send",
    );
    const staleStatus = await publicationStatus(client, created.id);
    assertNotRequested(staleStatus, "Stale revision check");
    assertCurrentImageProvenance(staleStatus, "Stale revision check");

    const queued = await jsonOrFail(
      await client.request(sendPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_draft: drafts.final,
          expected_post_revision: finalRevision,
        }),
        signal: AbortSignal.timeout(30_000),
      }),
      "WEBSITE_SEND_FAILED",
      "Final website Send",
    );
    const queuedRevision = assertSafeRevision(
      queued.post_revision,
      "Final website Send",
    );
    if (
      queued.status !== "queued" ||
      Number(queued.attempts || 0) !== 0 ||
      queued.idempotent_replay !== false
    ) {
      throw new WebsiteHandoffCanaryError(
        "WEBSITE_QUEUE_CONTRACT_INVALID",
        "Final Send did not create one fresh private website queue item.",
      );
    }
    evidence.cleanup.status = "customer_hub_draft_pending";
    await writeEvidence(evidencePath, evidence);

    const replay = await jsonOrFail(
      await client.request(sendPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_draft: drafts.final,
          expected_post_revision: finalRevision,
        }),
        signal: AbortSignal.timeout(30_000),
      }),
      "WEBSITE_REPLAY_FAILED",
      "Idempotent website Send replay",
    );
    if (
      !["queued", "delivering", "draft_ready"].includes(replay.status) ||
      replay.idempotent_replay !== true ||
      String(replay.post_revision) !== String(queuedRevision)
    ) {
      throw new WebsiteHandoffCanaryError(
        "WEBSITE_REPLAY_CONTRACT_INVALID",
        "An identical final Send was not idempotent.",
      );
    }
    await expectedJsonResponse(
      await client.request(sendPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_draft: {
            ...drafts.final,
            title: `Synthetic rejected revision ${marker}`,
          },
          expected_post_revision: finalRevision,
        }),
        signal: AbortSignal.timeout(30_000),
      }),
      409,
      "WEBSITE_DRAFT_ALREADY_SENT",
      "Changed website Send replay",
    );
    evidence.checks.revisionGuard = {
      passed: true,
      missingBlocked: true,
      staleBlocked: true,
      exactReplayIdempotent: true,
      changedReplayBlocked: true,
    };

    console.log("Waiting for Customer Hub to accept the private synthetic draft...");
    const ready = validateReadyPublication(await pollForDraftReady(client, created.id));
    const hubDraftId = extractHubDraftId(ready.reviewUrl, hubOrigin);
    evidence.resources.hubDraftId = hubDraftId;
    evidence.resources.reviewUrl = ready.reviewUrl;
    evidence.checks.privateDelivery = {
      passed: true,
      status: "draft_ready",
      attempts: Number(ready.attempts),
    };
    await writeEvidence(evidencePath, evidence);

    const identity = {
      draftId: hubDraftId,
      eventId: ready.canaryIdentity?.eventId,
      payloadHash: ready.canaryIdentity?.payloadHash,
      sourceDealerId: ready.canaryIdentity?.sourceDealerId,
      sourcePostId: ready.canaryIdentity?.sourcePostId,
      sourceRevision: ready.canaryIdentity?.sourceRevision,
    };
    if (
      !validHubCanaryIdentity(identity) ||
      identity.sourceDealerId !== login.dealer.id ||
      identity.sourcePostId !== created.id ||
      !/^[a-f0-9]{64}$/.test(ready.canaryMediaBase64Sha256 || "")
    ) {
      throw new WebsiteHandoffCanaryError(
        "HUB_CANARY_IDENTITY_INVALID",
        "The server did not bind the delivered canary to this synthetic post and dealer.",
      );
    }
    evidence.resources.canaryIdentity = identity;
    evidence.resources.mediaHashes = [
      SYNTHETIC_ASSET_SHA256,
      generated.evidence.outputSha256,
    ];
    evidence.resources.canaryMediaBase64Sha256 = ready.canaryMediaBase64Sha256;
    evidence.checks.publicBoundary = await verifyHubPrivacyBoundary(
      hubOrigin,
      evidence.resources,
      [image, sourceImage],
    );
    evidence.cleanup.status = "owner_action_required";
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
    console.log(`Redacted website canary evidence written to ${written}`);
  }

  if (primaryError) throw primaryError;
  console.log("Authenticated production website handoff canary passed.");
  console.log(
    `Private synthetic draft for owner cleanup: ${evidence.resources.reviewUrl}`,
  );
}

export async function verifyHubPrivacyBoundary(
  hubOrigin,
  resources,
  imageBuffers = [],
  fetcher = fetch,
) {
  const origin = canonicalHubOrigin(hubOrigin);
  const draftId = resources?.hubDraftId;
  if (
    !HUB_CANARY_DRAFT_ID.test(draftId || "") ||
    !validHubCanaryIdentity(resources?.canaryIdentity) ||
    resources.canaryIdentity.draftId !== draftId ||
    !/^[a-f0-9]{64}$/.test(resources?.canaryMediaBase64Sha256 || "")
  ) {
    throw new WebsiteHandoffCanaryError(
      "HUB_CANARY_IDENTITY_INVALID",
      "Privacy checks require this-run canary identity.",
    );
  }
  const mediaPath = `/backend/draft-media?draftId=${encodeURIComponent(draftId)}`;
  const paths = [mediaPath, "/", "/api/hub-data/deliveries", "/api/hub-data/inventory"];
  const responses = await Promise.all(
    paths.map((path) =>
      fetcher(`${origin}${path}`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }),
    ),
  );
  const forbidden = [
    resources.syntheticMarker,
    draftId,
    resources.postId,
    resources.canaryIdentity.eventId,
    resources.canaryIdentity.payloadHash,
    resources.canaryMediaBase64Sha256,
    mediaPath,
    `${origin}${mediaPath}`,
    ...(resources.mediaHashes || []),
  ].filter(Boolean);
  const publicStatuses = {};
  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    const cache = response.headers.get("cache-control") || "";
    // Bind the exact sanitized outbound media, including binary responses and
    // base64 embedded in a public JSON feed. JSON decoding catches escaped '/'.
    const mediaHash = resources.canaryMediaBase64Sha256;
    const strings = [text];
    try {
      const stack = [JSON.parse(text)];
      while (stack.length) {
        const value = stack.pop();
        if (typeof value === "string") strings.push(value);
        else if (value && typeof value === "object")
          stack.push(...Object.values(value));
      }
    } catch {
      /* Homepage HTML and denied responses need not be JSON. */
    }
    const imageHashPresent =
      (resources.mediaHashes || []).includes(
        createHash("sha256").update(bytes).digest("hex"),
      ) ||
      createHash("sha256").update(bytes.toString("base64")).digest("hex") ===
        mediaHash ||
      strings.some((value) =>
        (value.match(/[A-Za-z0-9+/]{128,}={0,2}/g) || []).some(
          (candidate) =>
            createHash("sha256").update(candidate).digest("hex") === mediaHash ||
            (resources.mediaHashes || []).includes(
              createHash("sha256")
                .update(Buffer.from(candidate, "base64"))
                .digest("hex"),
            ),
        ),
      );
    if (
      (index === 0 &&
        (response.status !== 401 ||
          !/\bprivate\b/i.test(cache) ||
          !/\bno-store\b/i.test(cache))) ||
      (index > 0 && response.status !== 200) ||
      strings.some((value) => forbidden.some((token) => value.includes(token))) ||
      imageHashPresent ||
      imageBuffers.some(
        (buffer) => bytes.includes(buffer) || text.includes(buffer.toString("base64")),
      )
    ) {
      throw new WebsiteHandoffCanaryError(
        "HUB_PUBLIC_BOUNDARY_FAILED",
        "The Hub did not prove private media authorization and clean successful public feeds.",
        { status: response.status },
      );
    }
    if (index > 0) publicStatuses[paths[index]] = response.status;
  }
  return {
    passed: true,
    privateMediaStatus: 401,
    privateMediaCacheControl: "private, no-store",
    publicStatuses,
    markerAbsent: true,
    identityAbsent: true,
    mediaAbsent: true,
    mediaHashChecked: true,
  };
}

export async function verifyOwnerPurgeReceipt(receipt, evidence, fetcher = fetch) {
  const identity = evidence?.resources?.canaryIdentity;
  const completedAt = Date.parse(receipt?.completedAt || "");
  const earliest = Date.parse(evidence?.completedAt || "");
  const allowedKeys = [
    "schemaVersion",
    "status",
    "draftId",
    "eventId",
    "payloadHash",
    "sourceDealerId",
    "sourcePostId",
    "sourceRevision",
    "completedAt",
    "capability",
  ];
  if (
    !hubCanaryIdentityMatches(receipt, identity) ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== "purged" ||
    !/^[a-f0-9]{64}$/.test(receipt.capability || "") ||
    Object.keys(receipt).some((key) => !allowedKeys.includes(key)) ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(earliest) ||
    completedAt < earliest ||
    completedAt > Date.now() + 300_000
  ) {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_RECEIPT_INVALID",
      "The owner purge receipt does not match this-run canary.",
    );
  }
  const response = await fetcher(
    `${CUSTOMER_HUB_ORIGIN}/api/integrations/dealer-social/canary-cleanup/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const verification = await jsonOrFail(
    response,
    "CLEANUP_VERIFICATION_FAILED",
    "Hub purge verification",
  );
  if (
    response.status !== 200 ||
    !/\bno-store\b/i.test(response.headers.get("cache-control") || "") ||
    !validHubPurgeResult(verification, identity, evidence.completedAt) ||
    verification.completedAt !== receipt.completedAt ||
    Object.keys(verification).some(
      (key) =>
        ![
          ...allowedKeys.filter((key) => key !== "capability"),
          "contentAbsent",
          "mediaAbsent",
          "replayBlocked",
        ].includes(key),
    )
  ) {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_VERIFICATION_INVALID",
      "Hub did not verify exact content/media removal and replay blocking.",
    );
  }
  return verification;
}

async function confirmOwnerCleanup() {
  if (requireEnv("WEBSITE_HANDOFF_CANARY_CLEANUP_CONFIRM") !== CLEANUP_CONFIRMATION) {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_CONFIRMATION_REQUIRED",
      `WEBSITE_HANDOFF_CANARY_CLEANUP_CONFIRM must equal ${CLEANUP_CONFIRMATION}.`,
    );
  }
  const stat = await lstat(DEFAULT_EVIDENCE_PATH);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new WebsiteHandoffCanaryError(
      "EVIDENCE_PATH_UNSAFE",
      "The website canary receipt must be a regular private file.",
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(DEFAULT_EVIDENCE_PATH, "utf8"));
  } catch {
    throw new WebsiteHandoffCanaryError(
      "EVIDENCE_INVALID",
      "The website canary receipt is invalid.",
    );
  }
  const draftId = evidence?.resources?.hubDraftId;
  if (
    evidence?.schemaVersion !== 3 ||
    evidence.canary !== "production-website-private-draft" ||
    evidence.customerHubOrigin !== CUSTOMER_HUB_ORIGIN ||
    evidence.targetOrigin !== PRODUCTION_FLY_ORIGIN ||
    !isFullCommitSha(evidence.expectedReleaseSha) ||
    evidence.resources?.syntheticMarker !==
      `QA-${evidence.expectedReleaseSha.slice(0, 8)}-${evidence.expectedReleaseSha.slice(8, 12)}` ||
    evidence.outcome !== "passed" ||
    evidence.cleanup?.required !== true ||
    evidence.cleanup?.status !== "owner_action_required" ||
    !HUB_CANARY_DRAFT_ID.test(draftId || "") ||
    extractHubDraftId(evidence?.resources?.reviewUrl, CUSTOMER_HUB_ORIGIN) !==
      draftId ||
    !validHubCanaryIdentity(evidence?.resources?.canaryIdentity) ||
    evidence.resources.canaryIdentity.draftId !== draftId ||
    evidence.resources.canaryIdentity.sourcePostId !== evidence.resources.postId ||
    evidence.resources.canaryIdentity.sourceDealerId !==
      evidence.resources.sourceDealerId
  ) {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_RECEIPT_INVALID",
      "The website canary receipt is not eligible for cleanup confirmation.",
    );
  }
  const receiptPath = resolve(requireEnv("WEBSITE_HANDOFF_CANARY_PURGE_RECEIPT_PATH"));
  const receiptStat = await lstat(receiptPath);
  if (
    !receiptStat.isFile() ||
    receiptStat.isSymbolicLink() ||
    receiptStat.size > 16_384 ||
    (receiptStat.mode & 0o077) !== 0
  ) {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_RECEIPT_UNSAFE",
      "The owner purge receipt must be a private regular file no larger than 16 KiB.",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    throw new WebsiteHandoffCanaryError(
      "CLEANUP_RECEIPT_INVALID",
      "The owner purge receipt is invalid JSON.",
    );
  }
  const verification = await verifyOwnerPurgeReceipt(receipt, evidence);
  // An anonymous 401 proves authorization is required, never deletion. Purge
  // proof comes exclusively from the capability-bound remote verifier above.
  const source = await readFile(syntheticImagePath);
  const boundary = await verifyHubPrivacyBoundary(
    CUSTOMER_HUB_ORIGIN,
    evidence.resources,
    [source, injectSyntheticJpegMetadata(source)],
  );
  evidence.cleanup = {
    required: false,
    status: "complete",
    completedAt: new Date().toISOString(),
    verification,
    publicBoundary: boundary,
    instruction:
      "Owner permanently purged the exact isolated Hub draft; Hub verified content/media removal and replay blocking. Retain the labeled synthetic Dealer Social audit post; optionally deactivate the synthetic person after all tests, never delete the dealer.",
  };
  const written = await writeEvidence(DEFAULT_EVIDENCE_PATH, evidence);
  console.log(`Website handoff canary cleanup confirmed: ${written}`);
}

async function run() {
  if (process.argv.includes("--contract-check")) {
    await contractCheck();
    return;
  }
  const releaseLockCleanup = acquireReleaseLock();
  try {
    if (process.argv.includes("--confirm-cleanup")) {
      await confirmOwnerCleanup();
    } else {
      await runLockedCanary();
    }
  } finally {
    releaseLockCleanup();
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  run().catch(async (error) => {
    await rm(`${DEFAULT_EVIDENCE_PATH}.tmp-${process.pid}`, { force: true }).catch(
      () => {},
    );
    const safe = failureEvidence(error);
    console.error(`Website handoff canary failed [${safe.code}]: ${safe.message}`);
    process.exitCode = 1;
  });
}
