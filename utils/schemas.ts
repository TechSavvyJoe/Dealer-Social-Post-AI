/**
 * Runtime-validated schemas (zod). Used at every API boundary that returns
 * data we don't fully trust — PocketBase records, Gemini API responses, etc.
 *
 * Keeping schemas centralized here avoids the "phantom field" bug where one
 * caller assumes a field exists and the next one doesn't.
 */
import { z } from "zod";

// ---------- Dealer ----------
// Extended 2026-05-27 to include the per-dealer prompt customization fields.
export const DealerRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().optional().default(""),
    logo: z.string().optional().default(""),
    // Optional brand-voice / compliance fields. Default to empty string so
    // the consumer can do `.length` checks without null-guards.
    brand_voice: z.string().optional().default(""),
    banned_phrases: z.string().optional().default(""),
    oem_affiliation: z.string().optional().default(""),
    requires_approval: z.boolean().optional().default(false),
    brand_color: z.string().optional().default(""),
    admin_code: z.string().optional().default(""),
    // Contact + identity
    website: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    address: z.string().optional().default(""),
    hours: z.string().optional().default(""),
    tagline: z.string().optional().default(""),
    // Social
    facebook_url: z.string().optional().default(""),
    instagram_handle: z.string().optional().default(""),
    tiktok_handle: z.string().optional().default(""),
    x_handle: z.string().optional().default(""),
    gbp_url: z.string().optional().default(""),
    // Generation defaults
    default_hashtags: z.string().optional().default(""),
    default_footer: z.string().optional().default(""),
    // Overlay preferences
    enabled_styles: z.string().optional().default(""),
    default_style: z.string().optional().default(""),
    enabled_fun_styles: z.string().optional().default(""),
    custom_scenarios: z.string().optional().default(""),
  })
  // PocketBase returns many extra fields (created, updated, collectionId,
  // collectionName, expand, etc.) — we don't care about most of them.
  .passthrough();

export type DealerRecord = z.infer<typeof DealerRecordSchema>;

// ---------- Gemini video operation ----------
//
// Veo returns a long-running operation that we poll. The completed shape is
// documented and stable on the Gemini Developer API endpoint this app calls
// (generativelanguage.googleapis.com `:predictLongRunning`), and is mirrored by
// both official Google SDKs' mldev converters:
//
//   { name, done, error?, response: { generateVideoResponse: {
//       generatedSamples: [ { video: { uri | encodedVideo, encoding? } } ],
//       raiMediaFilteredCount?, raiMediaFilteredReasons? } } }
//
// Previously `response` was `z.any()` and four call sites probed seven key
// spellings between them, so a provider shape change degraded silently into
// "no video found". These schemas type the documented shape instead; anything
// they cannot classify becomes a loud, named failure at the one call site that
// resolves the outcome.
//
// Unknown *extra* keys are stripped rather than rejected: Google adding a field
// must not take the video lane down. What is strict is the structure we read.

/** `generatedSamples[].video`: a proxy-fetchable URI or inline base64 bytes. */
const VeoVideoSchema = z.object({
  uri: z.string().trim().min(1).optional(),
  encodedVideo: z.string().trim().min(1).optional(),
  encoding: z.string().optional(),
});

const VeoGeneratedSampleSchema = z.object({
  video: VeoVideoSchema.optional(),
});

/**
 * The `GenerateVideoResponse` body. `raiMediaFilteredReasons` is the provider's
 * content-filter verdict: it arrives on a successful, done operation that
 * carries no sample, which is exactly the case that used to surface as the
 * generic "no video found".
 */
const VeoGenerateVideoResponseSchema = z.object({
  generatedSamples: z.array(VeoGeneratedSampleSchema).optional(),
  raiMediaFilteredCount: z.number().optional(),
  raiMediaFilteredReasons: z.array(z.string()).optional(),
});

/**
 * `operation.response`. The documented envelope is `generateVideoResponse`; the
 * single retained alternate is that same body hoisted to the top level, which
 * the previous implementation carried with the comment "Alternative format:
 * direct generatedSamples". Every other probe (candidates/parts, generatedVideos,
 * videos, predictions, byteStream/byteContent/videoBytes/bytesBase64Encoded) was
 * speculative and is gone.
 */
export const VeoOperationResponseSchema = z.object({
  generateVideoResponse: VeoGenerateVideoResponseSchema.optional(),
  generatedSamples: z.array(VeoGeneratedSampleSchema).optional(),
  raiMediaFilteredCount: z.number().optional(),
  raiMediaFilteredReasons: z.array(z.string()).optional(),
});

export const GeminiVideoOperationSchema = z
  .object({
    name: z.string(),
    done: z.boolean().optional().default(false),
    // Carried through unvalidated on purpose: `resolveVeoVideoOutcome` is the
    // single place that classifies it. Validating here instead would turn a
    // malformed payload into a ZodError thrown inside the poll loop, which
    // reads as a transient blip and spins until the six-minute timeout rather
    // than failing immediately with a named shape.
    response: z.unknown().optional(),
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
        status: z.string().optional(),
      })
      .partial()
      .optional(),
    metadata: z.any().optional(),
  })
  .passthrough();

export type GeminiVideoOperation = z.infer<typeof GeminiVideoOperationSchema>;

/**
 * What a completed Veo operation actually delivered. `blocked` is a terminal
 * content refusal (no other model can change the verdict); `unrecognized`
 * carries a key-name-only summary of what arrived, for diagnostics — never for
 * a user-facing toast.
 */
export type VeoVideoOutcome =
  | { kind: "uri"; uri: string }
  | { kind: "inline"; data: string }
  | { kind: "blocked"; reasons: string[] }
  | { kind: "unrecognized"; received: string };

/** Key names only — no URIs, prompts, or media bytes. */
const describeShape = (value: unknown, depth = 0): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length ? `[${describeShape(value[0], depth + 1)}]` : "[]";
  }
  if (typeof value !== "object") return typeof value;
  if (depth >= 3) return "{…}";
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
  if (!keys.length) return "{}";
  return `{${keys
    .map(
      (key) =>
        `${key}:${describeShape((value as Record<string, unknown>)[key], depth + 1)}`,
    )
    .join(",")}}`;
};

/**
 * Classify a completed operation's `response` exactly once, with no probing.
 * The caller turns `blocked` into a typed terminal error and `unrecognized`
 * into a named validation error.
 */
export const resolveVeoVideoOutcome = (response: unknown): VeoVideoOutcome => {
  const parsed = VeoOperationResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { kind: "unrecognized", received: describeShape(response) };
  }

  const body = parsed.data.generateVideoResponse ?? parsed.data;
  const video = body.generatedSamples?.[0]?.video;
  if (video?.uri) return { kind: "uri", uri: video.uri.trim() };
  if (video?.encodedVideo) return { kind: "inline", data: video.encodedVideo.trim() };

  // A content refusal is reported on the successful operation, not as an error,
  // so it is only distinguishable from an empty result by these fields.
  const reasons = body.raiMediaFilteredReasons ?? [];
  if (reasons.length || (body.raiMediaFilteredCount ?? 0) > 0) {
    return {
      kind: "blocked",
      reasons: reasons.length ? reasons : ["RAI media filter"],
    };
  }

  return { kind: "unrecognized", received: describeShape(response) };
};
