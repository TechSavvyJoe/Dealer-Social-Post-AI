/// <reference path="../pb_data/types.d.ts" />
/**
 * Adds a per-dealership manager code (`admin_code`) separate from the
 * regular `code`. Lets a GSM/GM log in with their own 4-digit code and land
 * on a dashboard scoped to their dealership only — without giving them the
 * cross-tenant super-admin code.
 *
 * Schema additions:
 *   - admin_code (text, optional, 4-12 chars) — UNIQUE across dealers if set.
 */
const DEALER_ADMIN_CODE_FIELDS = ["admin_code"];

migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) return;
    if (!dealers.schema.getFieldByName("admin_code")) {
      dealers.schema.addField(
        new SchemaField({
          name: "admin_code",
          type: "text",
          required: false,
          options: { max: 12 },
        }),
      );
      // Add a uniqueness index so two dealers can't share the same admin code.
      const existingIndexes = dealers.indexes || [];
      const indexName = "idx_dealers_admin_code";
      if (
        !(function (arr, target) {
          for (let i = 0; i < arr.length; i++) {
            if (arr[i].indexOf(target) >= 0) return arr[i];
          }
          return null;
        })(existingIndexes, indexName)
      ) {
        dealers.indexes = existingIndexes.concat([
          `CREATE UNIQUE INDEX \`${indexName}\` ON \`dealers\` (\`admin_code\`) WHERE \`admin_code\` != ''`,
        ]);
      }
      dao.saveCollection(dealers);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the column stays. `removeField`
    // takes the field id, not its name.
    DEALER_ADMIN_CODE_FIELDS.forEach((name) => {
      const field = dealers.schema.getFieldByName(name);
      if (field) dealers.schema.removeField(field.id);
    });
    dealers.indexes = Array.from(dealers.indexes || []).filter(
      (i) => !i.includes("idx_dealers_admin_code"),
    );
    dao.saveCollection(dealers);
  },
);
