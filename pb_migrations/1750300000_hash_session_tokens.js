/// <reference path="../pb_data/types.d.ts" />
/**
 * Replace plaintext session-token storage with SHA-256 verifiers.
 *
 * Existing browser cookies remain valid: the cookie still carries the random
 * 256-bit token, while lookups hash it before querying `token_hash`. The old
 * column is removed only after every existing row has a valid verifier.
 *
 * The down migration is intentionally a no-op. A one-way verifier cannot be
 * converted back into a bearer token, and rollback must never recreate
 * plaintext credential storage.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let sessions = null;
    try {
      sessions = dao.findCollectionByNameOrId("sessions");
    } catch (_e) {}
    if (!sessions) return;

    let hashField = sessions.schema.getFieldByName("token_hash");
    if (!hashField) {
      sessions.schema.addField(
        new SchemaField({
          name: "token_hash",
          type: "text",
          required: false,
          options: {
            min: 64,
            max: 64,
            pattern: "^[a-f0-9]{64}$",
          },
        }),
      );
    }

    // Make the legacy field temporarily optional so each row can be scrubbed
    // after its verifier has been persisted.
    const legacyField = sessions.schema.getFieldByName("token");
    if (legacyField) {
      legacyField.required = false;
      legacyField.options.min = null;
    }
    // Empty legacy values would collide under the old unique index while rows
    // are scrubbed one at a time. The replacement hash index is added only
    // after every verifier has been populated.
    sessions.indexes = (sessions.indexes || []).filter(
      (index) => index.indexOf("`idx_sessions_token`") === -1,
    );
    dao.saveCollection(sessions);

    let offset = 0;
    const batchSize = 500;
    while (true) {
      const records = dao.findRecordsByFilter(
        "sessions",
        "1=1",
        "id",
        batchSize,
        offset,
      );
      for (const record of records) {
        let tokenHash = record.getString("token_hash");
        if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
          const token = record.getString("token");
          if (!token) {
            throw new Error(
              "sessions record " + record.id + " has no token to migrate",
            );
          }
          tokenHash = $security.sha256(token).toLowerCase();
          if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
            throw new Error("PocketBase SHA-256 returned an invalid verifier");
          }
          record.set("token_hash", tokenHash);
        }
        if (legacyField) record.set("token", "");
        dao.saveRecord(record);
      }

      offset += records.length;
      if (records.length < batchSize) break;
    }

    // Drop the plaintext column and its index after all records are migrated.
    sessions = dao.findCollectionByNameOrId("sessions");
    const finalLegacyField = sessions.schema.getFieldByName("token");
    if (finalLegacyField) {
      sessions.schema.removeField(finalLegacyField.id);
    }
    hashField = sessions.schema.getFieldByName("token_hash");
    if (!hashField) throw new Error("sessions.token_hash field not found");
    hashField.required = true;

    sessions.indexes = (sessions.indexes || []).filter(
      (index) => index.indexOf("`idx_sessions_token`") === -1,
    );
    if (
      !sessions.indexes.some(
        (index) => index.indexOf("idx_sessions_token_hash") !== -1,
      )
    ) {
      sessions.indexes.push(
        "CREATE UNIQUE INDEX `idx_sessions_token_hash` ON `sessions` (`token_hash`)",
      );
    }

    dao.saveCollection(sessions);
  },
  (_db) => {
    // Security invariant: never restore plaintext bearer-token storage.
  },
);
