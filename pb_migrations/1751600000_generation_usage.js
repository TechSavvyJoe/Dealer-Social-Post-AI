/// <reference path="../pb_data/types.d.ts" />
/**
 * Generation usage accounting (Gemini integration upgrade plan, P0-1).
 *
 * `generation_events` gains the provider's `usageMetadata` token counters,
 * the first candidate's `finishReason`, the proxy-measured upstream latency,
 * the client-declared purpose (so a vision-QC review or caption pack is no
 * longer counted as a caption), and the billable image size / video duration
 * of the sanitized request. Every field is optional: rows recorded before
 * this migration keep zero/empty values, and the admin health aggregate is
 * the only reader.
 *
 * Prompts, captions, customer details, and image bytes never enter this
 * collection; the ledger stores counters and short enum-like tokens only.
 */
const USAGE_FIELDS = [
  "prompt_tokens",
  "candidate_tokens",
  "thoughts_tokens",
  "cached_tokens",
  "finish_reason",
  "latency_ms",
  "purpose",
  "image_size",
  "video_seconds",
];

migrate(
  (db) => {
    const dao = new Dao(db);

    const ensureField = (collection, field) => {
      if (collection.schema.getFieldByName(field.name)) return;
      collection.schema.addField(new SchemaField(field));
    };
    const counter = (name) => ({
      name,
      type: "number",
      required: false,
      options: { min: 0, noDecimal: true },
    });
    const text = (name, max) => ({
      name,
      type: "text",
      required: false,
      options: { max },
    });

    const events = dao.findCollectionByNameOrId("generation_events");
    [
      counter("prompt_tokens"),
      counter("candidate_tokens"),
      counter("thoughts_tokens"),
      counter("cached_tokens"),
      text("finish_reason", 40),
      counter("latency_ms"),
      text("purpose", 40),
      text("image_size", 8),
      counter("video_seconds"),
    ].forEach((field) => ensureField(events, field));
    dao.saveCollection(events);
  },
  (db) => {
    const dao = new Dao(db);
    let events = null;
    try {
      events = dao.findCollectionByNameOrId("generation_events");
    } catch (_error) {}
    if (!events) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    USAGE_FIELDS.forEach((name) => {
      const field = events.schema.getFieldByName(name);
      if (field) events.schema.removeField(field.id);
    });
    dao.saveCollection(events);
  },
);
