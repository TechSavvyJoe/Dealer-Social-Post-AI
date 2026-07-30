/// <reference path="../pb_data/types.d.ts" />
/**
 * Bind unlinked signatures to the exact browser session that captured them
 * and give abandoned captures a short retention window. Linked releases are
 * legal/audit records and remain governed by the dealership's retention
 * policy; only never-linked signatures expire automatically.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const releases = dao.findCollectionByNameOrId("photo_releases");
    const ensure = (name, field) => {
      if (!releases.schema.getFieldByName(name)) {
        releases.schema.addField(new SchemaField(field));
      }
    };

    ensure("owner_session_hash", {
      name: "owner_session_hash",
      type: "text",
      required: false,
      options: { max: 128 },
    });
    ensure("expires_at", {
      name: "expires_at",
      type: "date",
      required: false,
      options: {},
    });
    releases.indexes = Array.from(releases.indexes || []).filter(
      (index) => String(index).indexOf("idx_photo_releases_unlinked_expiry") === -1,
    );
    releases.indexes.push(
      "CREATE INDEX `idx_photo_releases_unlinked_expiry` ON `photo_releases` (`post_id`, `expires_at`)",
    );
    dao.saveCollection(releases);

    // Legacy unlinked rows cannot be assigned to a trustworthy session. Mark
    // them expired so the hourly record-level cleanup removes both DB rows and
    // protected signature files.
    const now = new Date().toISOString();
    db.newQuery(
      "UPDATE photo_releases " +
        "SET owner_session_hash = '', expires_at = {:now} " +
        "WHERE post_id = '' OR post_id IS NULL",
    )
      .bind({ now: now })
      .execute();
  },
  (db) => {
    const dao = new Dao(db);
    let releases = null;
    try {
      releases = dao.findCollectionByNameOrId("photo_releases");
    } catch (_e) {}
    if (!releases) return;

    releases.indexes = Array.from(releases.indexes || []).filter(
      (index) => String(index).indexOf("idx_photo_releases_unlinked_expiry") === -1,
    );
    releases.schema = Array.from(releases.schema).filter(
      (field) => field.name !== "owner_session_hash" && field.name !== "expires_at",
    );
    dao.saveCollection(releases);
  },
);
