/// <reference path="../pb_data/types.d.ts" />
/**
 * Redacted production diagnostics.
 *
 * Client error payloads are private and server-only. Generated posts retain a
 * small, prompt-free provenance summary so health diagnostics can distinguish
 * provider success from the safe local-caption fallback.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const ensure = (collection, name, field) => {
      if (!collection.schema.getFieldByName(name)) {
        collection.schema.addField(new SchemaField(field));
      }
    };

    const posts = dao.findCollectionByNameOrId("posts");
    ensure(posts, "caption_source", {
      name: "caption_source",
      type: "select",
      required: false,
      options: {
        maxSelect: 1,
        values: ["ai", "custom", "basic_fallback"],
      },
    });
    ensure(posts, "generation_tier", {
      name: "generation_tier",
      type: "select",
      required: false,
      options: { maxSelect: 1, values: ["standard", "studio"] },
    });
    ensure(posts, "generation_model", {
      name: "generation_model",
      type: "text",
      required: false,
      options: { max: 120 },
    });
    ensure(posts, "generation_fallback_count", {
      name: "generation_fallback_count",
      type: "number",
      required: false,
      options: { min: 0, max: 20, noDecimal: true },
    });
    ensure(posts, "generation_last_success_at", {
      name: "generation_last_success_at",
      type: "date",
      required: false,
    });
    ensure(posts, "model_policy_version", {
      name: "model_policy_version",
      type: "text",
      required: false,
      options: { max: 40 },
    });
    dao.saveCollection(posts);

    let existing = null;
    try {
      existing = dao.findCollectionByNameOrId("client_error_events");
    } catch (_e) {}
    if (!existing) {
      const errors = new Collection({
        name: "client_error_events",
        type: "base",
        system: false,
        schema: [
          {
            name: "name",
            type: "text",
            required: true,
            options: { min: 1, max: 120 },
          },
          {
            name: "payload",
            type: "text",
            required: false,
            options: { max: 2000 },
          },
          {
            name: "release_sha",
            type: "text",
            required: false,
            options: { max: 64 },
          },
          {
            name: "api_contract_version",
            type: "text",
            required: false,
            options: { max: 64 },
          },
          {
            name: "occurred_at",
            type: "date",
            required: true,
          },
        ],
        indexes: [
          "CREATE INDEX `idx_client_error_events_time` ON `client_error_events` (`occurred_at`)",
          "CREATE INDEX `idx_client_error_events_name_time` ON `client_error_events` (`name`, `occurred_at`)",
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
      });
      dao.saveCollection(errors);
    }

    let generationEvents = null;
    try {
      generationEvents = dao.findCollectionByNameOrId("generation_events");
    } catch (_e) {}
    if (!generationEvents) {
      generationEvents = new Collection({
        name: "generation_events",
        type: "base",
        system: false,
        schema: [
          {
            name: "dealer",
            type: "text",
            required: true,
            options: { min: 1, max: 64 },
          },
          {
            name: "owner_session_hash",
            type: "text",
            required: true,
            options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
          },
          {
            name: "attempt_id",
            type: "text",
            required: true,
            options: {
              min: 16,
              max: 80,
              pattern: "^[A-Za-z0-9_-]{16,80}$",
            },
          },
          {
            name: "task",
            type: "select",
            required: true,
            options: {
              maxSelect: 1,
              values: [
                "caption",
                "caption_regenerate",
                "caption_edit",
                "image_standard",
                "image_studio",
                "video_standard",
                "video_quality",
              ],
            },
          },
          {
            name: "tier",
            type: "select",
            required: true,
            options: {
              maxSelect: 1,
              values: ["fast", "quality", "standard", "studio"],
            },
          },
          {
            name: "provider",
            type: "select",
            required: true,
            options: {
              maxSelect: 1,
              values: ["gemini", "anthropic", "openai"],
            },
          },
          {
            name: "model",
            type: "text",
            required: true,
            options: { min: 1, max: 120 },
          },
          {
            name: "succeeded",
            type: "bool",
            required: false,
          },
          {
            name: "status_code",
            type: "number",
            required: false,
            options: { min: 0, max: 599, noDecimal: true },
          },
          {
            name: "model_policy_version",
            type: "text",
            required: true,
            options: { min: 1, max: 40 },
          },
          {
            name: "occurred_at",
            type: "date",
            required: true,
          },
          {
            name: "consumed_post",
            type: "text",
            required: false,
            options: { max: 64 },
          },
        ],
        indexes: [
          "CREATE INDEX `idx_generation_events_session_time` ON `generation_events` (`owner_session_hash`, `occurred_at`)",
          "CREATE INDEX `idx_generation_events_dealer_time` ON `generation_events` (`dealer`, `occurred_at`)",
          "CREATE INDEX `idx_generation_events_attempt_session` ON `generation_events` (`attempt_id`, `owner_session_hash`)",
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
      });
      dao.saveCollection(generationEvents);
    }
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const errors = dao.findCollectionByNameOrId("client_error_events");
      if (errors) dao.deleteCollection(errors);
    } catch (_e) {}
    try {
      const generationEvents = dao.findCollectionByNameOrId("generation_events");
      if (generationEvents) dao.deleteCollection(generationEvents);
    } catch (_e) {}

    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;
    const fields = {
      caption_source: true,
      generation_tier: true,
      generation_model: true,
      generation_fallback_count: true,
      generation_last_success_at: true,
      model_policy_version: true,
    };
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    Object.keys(fields).forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
