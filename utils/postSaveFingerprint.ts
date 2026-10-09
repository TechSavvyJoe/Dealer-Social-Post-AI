// The same allowlisted multipart values are hashed by PocketBase. Image bytes
// are represented as canonical base64, not a filename or client-only digest.
export const POST_SAVE_FIELDS = [
  "salesperson_name",
  "salesperson_id",
  "style",
  "tone",
  "customer_name",
  "scenario_id",
  "vin",
  "has_release",
  "has_video",
  "caption_source",
  "generation_tier",
  "generation_model",
  "generation_fallback_count",
  "generation_last_success_at",
  "model_policy_version",
  "caption_attempt_id",
  "image_attempt_id",
  "platform_ids",
  "media_output_mode",
  "platform_captions",
  "primary_format_id",
  "image_aspect_ratio",
  "scheduled_for",
  "website_draft",
  "caption",
  "disclosures",
];
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
};
const sha256 = async (text: string): Promise<string> => {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Secure saved-result recovery is unavailable. Keep this post open.",
    );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};
export const postSaveFingerprint = async (form: FormData): Promise<string> => {
  const fields = POST_SAVE_FIELDS.map((name) => {
    let value = String(form.get(name) || "");
    if (
      ["platform_ids", "platform_captions", "website_draft"].includes(name) &&
      value
    ) {
      try {
        value = JSON.stringify(canonical(JSON.parse(value)));
      } catch {
        /* invalid input is still bound to its exact text */
      }
    }
    return [name, value];
  });
  const file = form.get("creative_image");
  let base64 = "";
  if (file instanceof Blob) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    base64 = btoa(chunks.join(""));
  }
  return sha256(
    JSON.stringify([
      fields,
      await sha256(base64),
      file instanceof File ? [file.name, file.type.toLowerCase()] : null,
    ]),
  );
};
