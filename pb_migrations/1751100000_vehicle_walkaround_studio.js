/// <reference path="../pb_data/types.d.ts" />
/**
 * Private, server-owned persistence for Vehicle Walkaround Studio.
 *
 * The browser never talks to these collections directly. Custom routes bind
 * every row to the continuously revalidated dealer/person session, while the
 * worker outbox is consumed through a separate server credential.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const dealers = dao.findCollectionByNameOrId("dealers");
    const people = dao.findCollectionByNameOrId("salespeople");

    const relation = (name, collection, required, cascadeDelete) => ({
      name: name,
      type: "relation",
      required: required,
      options: {
        collectionId: collection.id,
        cascadeDelete: cascadeDelete,
        maxSelect: 1,
        minSelect: required ? 1 : 0,
      },
    });
    const locked = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    const projects = new Collection({
      name: "walkaround_projects",
      type: "base",
      system: false,
      schema: [
        relation("dealer", dealers, true, true),
        relation("owner_person", people, true, false),
        {
          name: "owner_session_hash",
          type: "text",
          required: true,
          options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "audience_mode",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["customer", "inventory"] },
        },
        {
          name: "capture_mode",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["one_take", "multi_clip"] },
        },
        {
          name: "scenario_id",
          type: "text",
          required: true,
          options: { min: 1, max: 80, pattern: "^[a-z0-9][a-z0-9_-]*$" },
        },
        {
          name: "vehicle_snapshot",
          type: "text",
          required: true,
          options: { min: 2, max: 24000 },
        },
        { name: "contains_identifiable_non_employee", type: "bool", required: false },
        {
          name: "production_state",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "draft",
              "uploading",
              "uploaded",
              "queued",
              "analyzing",
              "rendering",
              "audio_polish",
              "quality_check",
              "review_ready",
              "retryable_failed",
              "terminal_failed",
              "cancelled",
              "deleting",
              "deleted",
            ],
          },
        },
        {
          name: "publication_state",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "not_requested",
              "uploading_private",
              "processing",
              "publishing",
              "published_unlisted",
              "published_public",
              "reconciliation_required",
              "failed",
            ],
          },
        },
        {
          name: "metadata_revision",
          type: "number",
          required: true,
          options: { min: 1, max: 1000000, noDecimal: true },
        },
        {
          name: "metadata_json",
          type: "text",
          required: false,
          options: { max: 64000 },
        },
        {
          name: "edit_instructions",
          type: "text",
          required: false,
          options: { max: 4000 },
        },
        {
          name: "captions_text",
          type: "text",
          required: false,
          options: { max: 30000 },
        },
        {
          name: "metadata_validated_revision",
          type: "number",
          required: false,
          options: { min: 0, max: 1000000, noDecimal: true },
        },
        { name: "qc_passed", type: "bool", required: false },
        { name: "qc_summary", type: "text", required: false, options: { max: 8000 } },
        {
          name: "master_sha256",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "approved_master_sha256",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "reviewed_master_sha256",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "reviewed_metadata_revision",
          type: "number",
          required: false,
          options: { min: 0, max: 1000000, noDecimal: true },
        },
        relation("reviewed_by", people, false, false),
        { name: "reviewed_at", type: "date", required: false },
        {
          name: "approved_metadata_revision",
          type: "number",
          required: false,
          options: { min: 0, max: 1000000, noDecimal: true },
        },
        relation("approved_by", people, false, false),
        { name: "approved_at", type: "date", required: false },
        { name: "availability_attested_at", type: "date", required: false },
        relation("availability_attested_by", people, false, false),
        {
          name: "producer_workflow_id",
          type: "text",
          required: false,
          options: { max: 160 },
        },
        {
          name: "publisher_workflow_id",
          type: "text",
          required: false,
          options: { max: 160 },
        },
        { name: "failure_code", type: "text", required: false, options: { max: 80 } },
        { name: "deleted_at", type: "date", required: false },
      ],
      indexes: [
        "CREATE INDEX `idx_walkaround_projects_dealer_created` ON `walkaround_projects` (`dealer`, `created` DESC)",
        "CREATE INDEX `idx_walkaround_projects_owner_created` ON `walkaround_projects` (`owner_person`, `created` DESC)",
        "CREATE INDEX `idx_walkaround_projects_state` ON `walkaround_projects` (`production_state`, `publication_state`)",
      ],
      ...locked,
    });
    dao.saveCollection(projects);

    const assets = new Collection({
      name: "walkaround_assets",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        {
          name: "kind",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "source",
              "proxy",
              "transcript",
              "edit_plan",
              "master",
              "teaser",
              "captions",
              "thumbnail",
            ],
          },
        },
        {
          name: "clip_order",
          type: "number",
          required: false,
          options: { min: 0, max: 12, noDecimal: true },
        },
        {
          name: "state",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "pending_upload",
              "uploading",
              "uploaded",
              "verified",
              "ready",
              "failed",
              "deleted",
            ],
          },
        },
        {
          name: "original_filename",
          type: "text",
          required: false,
          options: { max: 180 },
        },
        {
          name: "original_last_modified_ms",
          type: "number",
          required: false,
          options: { min: 0, max: 4102444800000, noDecimal: true },
        },
        {
          name: "declared_mime",
          type: "select",
          required: false,
          options: {
            maxSelect: 1,
            values: ["video/quicktime", "video/mp4", "video/webm"],
          },
        },
        {
          name: "verified_mime",
          type: "select",
          required: false,
          options: {
            maxSelect: 1,
            values: [
              "video/quicktime",
              "video/mp4",
              "video/webm",
              "application/json",
              "text/vtt",
              "image/jpeg",
              "image/png",
            ],
          },
        },
        {
          name: "size_bytes",
          type: "number",
          required: false,
          options: { min: 0, max: 10737418240, noDecimal: true },
        },
        {
          name: "duration_ms",
          type: "number",
          required: false,
          options: { min: 0, max: 1200000, noDecimal: true },
        },
        {
          name: "sha256",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        { name: "storage_key", type: "text", required: false, options: { max: 512 } },
        {
          name: "storage_generation",
          type: "text",
          required: false,
          options: { max: 80 },
        },
        {
          name: "upload_session_reference",
          type: "text",
          required: false,
          options: { max: 256, pattern: "^[A-Za-z0-9:._/-]*$" },
        },
        { name: "upload_session_expires_at", type: "date", required: false },
        {
          name: "upload_offset",
          type: "number",
          required: false,
          options: { min: 0, max: 10737418240, noDecimal: true },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_source_order` ON `walkaround_assets` (`project`, `kind`, `clip_order`) WHERE `kind` = 'source'",
        "CREATE INDEX `idx_walkaround_assets_project_kind` ON `walkaround_assets` (`project`, `kind`)",
      ],
      ...locked,
    });
    dao.saveCollection(assets);

    const releases = new Collection({
      name: "walkaround_releases",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        relation("captured_by", people, true, false),
        {
          name: "owner_session_hash",
          type: "text",
          required: true,
          options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "consent_version",
          type: "text",
          required: true,
          options: { min: 1, max: 40, pattern: "^[A-Za-z0-9._-]+$" },
        },
        {
          name: "signed_name",
          type: "text",
          required: true,
          options: { min: 1, max: 120 },
        },
        {
          name: "signature_png",
          type: "file",
          required: true,
          options: {
            maxSelect: 1,
            maxSize: 512000,
            mimeTypes: ["image/png"],
            protected: true,
          },
        },
        { name: "video_consent", type: "bool", required: true },
        { name: "voice_consent", type: "bool", required: true },
        { name: "cloud_processing_consent", type: "bool", required: true },
        { name: "youtube_consent", type: "bool", required: true },
        { name: "signed_at", type: "date", required: true },
        { name: "revoked_at", type: "date", required: false },
      ],
      indexes: [
        "CREATE INDEX `idx_walkaround_releases_project` ON `walkaround_releases` (`project`, `created` DESC)",
      ],
      ...locked,
    });
    dao.saveCollection(releases);

    const jobs = new Collection({
      name: "walkaround_provider_jobs",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        {
          name: "provider",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["gcs", "vertex", "shotstack", "auphonic", "youtube"],
          },
        },
        {
          name: "operation",
          type: "text",
          required: true,
          options: { min: 1, max: 80, pattern: "^[a-z0-9_]+$" },
        },
        {
          name: "request_key",
          type: "text",
          required: true,
          options: { min: 16, max: 160, pattern: "^[A-Za-z0-9:._-]+$" },
        },
        {
          name: "provider_job_id",
          type: "text",
          required: false,
          options: { max: 256 },
        },
        {
          name: "session_reference",
          type: "text",
          required: false,
          options: { max: 256 },
        },
        {
          name: "next_offset",
          type: "number",
          required: false,
          options: { min: 0, max: 10737418240, noDecimal: true },
        },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "reserved",
              "submitted",
              "processing",
              "succeeded",
              "retrying",
              "failed",
              "reconciliation_required",
            ],
          },
        },
        {
          name: "attempts",
          type: "number",
          required: false,
          options: { min: 0, max: 100, noDecimal: true },
        },
        {
          name: "last_error_code",
          type: "text",
          required: false,
          options: { max: 80 },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_provider_request` ON `walkaround_provider_jobs` (`request_key`)",
        "CREATE INDEX `idx_walkaround_provider_project` ON `walkaround_provider_jobs` (`project`, `created` DESC)",
      ],
      ...locked,
    });
    dao.saveCollection(jobs);

    const publications = new Collection({
      name: "walkaround_publications",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        {
          name: "channel_id",
          type: "text",
          required: true,
          options: { min: 1, max: 128 },
        },
        { name: "video_id", type: "text", required: false, options: { max: 128 } },
        {
          name: "requested_visibility",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["unlisted", "public"] },
        },
        {
          name: "actual_visibility",
          type: "select",
          required: false,
          options: { maxSelect: 1, values: ["private", "unlisted", "public"] },
        },
        { name: "made_for_kids", type: "bool", required: true },
        {
          name: "master_sha256",
          type: "text",
          required: true,
          options: { min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "metadata_revision",
          type: "number",
          required: true,
          options: { min: 1, max: 1000000, noDecimal: true },
        },
        { name: "playback_verified_at", type: "date", required: false },
        { name: "share_url", type: "text", required: false, options: { max: 512 } },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_publication_project` ON `walkaround_publications` (`project`)",
      ],
      ...locked,
    });
    dao.saveCollection(publications);

    const connections = new Collection({
      name: "walkaround_youtube_connections",
      type: "base",
      system: false,
      schema: [
        relation("dealer", dealers, true, true),
        {
          name: "channel_id",
          type: "text",
          required: true,
          options: { min: 1, max: 128 },
        },
        {
          name: "channel_title",
          type: "text",
          required: true,
          options: { min: 1, max: 180 },
        },
        {
          name: "credential_reference",
          type: "text",
          required: true,
          options: { min: 8, max: 256, pattern: "^[A-Za-z0-9:._/-]+$" },
        },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["connected", "reauthorization_required", "disconnected"],
          },
        },
        relation("connected_by", people, true, false),
        { name: "last_verified_at", type: "date", required: false },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_youtube_dealer` ON `walkaround_youtube_connections` (`dealer`)",
      ],
      ...locked,
    });
    dao.saveCollection(connections);

    const tasks = new Collection({
      name: "walkaround_worker_tasks",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        {
          name: "kind",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["produce", "validate_review", "publish_youtube", "delete_objects"],
          },
        },
        {
          name: "idempotency_key",
          type: "text",
          required: true,
          options: { min: 16, max: 180, pattern: "^[A-Za-z0-9:._-]+$" },
        },
        { name: "payload", type: "text", required: false, options: { max: 12000 } },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: [
              "queued",
              "claimed",
              "started",
              "completed",
              "retrying",
              "failed",
              "cancelled",
            ],
          },
        },
        {
          name: "attempts",
          type: "number",
          required: false,
          options: { min: 0, max: 100, noDecimal: true },
        },
        { name: "claimed_at", type: "date", required: false },
        {
          name: "lease_token_hash",
          type: "text",
          required: false,
          options: { max: 64, pattern: "^[a-f0-9]{64}$" },
        },
        {
          name: "lease_owner",
          type: "text",
          required: false,
          options: { max: 120, pattern: "^[A-Za-z0-9:._-]*$" },
        },
        {
          name: "claim_request_key",
          type: "text",
          required: false,
          options: { max: 180, pattern: "^[A-Za-z0-9:._-]*$" },
        },
        { name: "lease_expires_at", type: "date", required: false },
        {
          name: "temporal_run_id",
          type: "text",
          required: false,
          options: { max: 160 },
        },
        { name: "next_attempt_at", type: "date", required: false },
        { name: "completed_at", type: "date", required: false },
        {
          name: "last_error_code",
          type: "text",
          required: false,
          options: { max: 80 },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_task_idempotency` ON `walkaround_worker_tasks` (`idempotency_key`)",
        "CREATE UNIQUE INDEX `idx_walkaround_task_claim_request` ON `walkaround_worker_tasks` (`claim_request_key`) WHERE `claim_request_key` != ''",
        "CREATE INDEX `idx_walkaround_tasks_due` ON `walkaround_worker_tasks` (`status`, `created`)",
      ],
      ...locked,
    });
    dao.saveCollection(tasks);

    const workerEvents = new Collection({
      name: "walkaround_worker_events",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, true, true),
        relation("dealer", dealers, true, true),
        {
          name: "event_id",
          type: "text",
          required: true,
          options: { min: 16, max: 160, pattern: "^[A-Za-z0-9:._-]+$" },
        },
        {
          name: "workflow_id",
          type: "text",
          required: true,
          options: { min: 1, max: 160 },
        },
        {
          name: "lane",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["production", "publication"] },
        },
        {
          name: "state",
          type: "text",
          required: true,
          options: { min: 1, max: 80, pattern: "^[a-z0-9_]+$" },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_walkaround_worker_event_id` ON `walkaround_worker_events` (`event_id`)",
      ],
      ...locked,
    });
    dao.saveCollection(workerEvents);

    const auditEvents = new Collection({
      name: "walkaround_audit_events",
      type: "base",
      system: false,
      schema: [
        relation("project", projects, false, true),
        relation("dealer", dealers, true, true),
        relation("actor_person", people, false, false),
        {
          name: "action",
          type: "text",
          required: true,
          options: { min: 1, max: 80, pattern: "^[a-z0-9_]+$" },
        },
        {
          name: "revision",
          type: "number",
          required: false,
          options: { min: 0, max: 1000000, noDecimal: true },
        },
        {
          name: "result",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["accepted", "rejected", "completed", "failed"],
          },
        },
        {
          name: "detail_code",
          type: "text",
          required: false,
          options: { max: 80, pattern: "^[A-Z0-9_]*$" },
        },
      ],
      indexes: [
        "CREATE INDEX `idx_walkaround_audit_project_created` ON `walkaround_audit_events` (`project`, `created` DESC)",
      ],
      ...locked,
    });
    dao.saveCollection(auditEvents);
  },
  (db) => {
    const dao = new Dao(db);
    [
      "walkaround_audit_events",
      "walkaround_worker_events",
      "walkaround_worker_tasks",
      "walkaround_youtube_connections",
      "walkaround_publications",
      "walkaround_provider_jobs",
      "walkaround_releases",
      "walkaround_assets",
      "walkaround_projects",
    ].forEach((name) => {
      try {
        dao.deleteCollection(dao.findCollectionByNameOrId(name));
      } catch (_e) {}
    });
  },
);
