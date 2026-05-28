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
// Veo returns a long-running operation that we poll. The structure is
// "operation has a name, done flag, optional response or error." Veo's
// `response` shape varies across versions (v1beta, v1alpha, Vertex predict)
// so we model it as a permissive record — downstream code probes the keys it
// expects (generateVideoResponse, generatedSamples, candidates, generatedVideos).
export const GeminiVideoOperationSchema = z
  .object({
    name: z.string(),
    done: z.boolean().optional().default(false),
    response: z.any().optional(),
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
