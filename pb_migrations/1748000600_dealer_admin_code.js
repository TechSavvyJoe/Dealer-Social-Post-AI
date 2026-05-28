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
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;
    if (!(function(s, n){ for(let i=0;i<s.length;i++){ if(s[i].name === n) return s[i]; } return null; })(dealers.schema, "admin_code")) {
      dealers.schema.addField(new SchemaField({
        name: "admin_code",
        type: "text",
        required: false,
        options: { max: 12 },
      }));
      // Add a uniqueness index so two dealers can't share the same admin code.
      const existingIndexes = dealers.indexes || [];
      const indexName = "idx_dealers_admin_code";
      if (!(function(arr, target){ for(let i=0;i<arr.length;i++){ if(arr[i].indexOf(target) >= 0) return arr[i]; } return null; })(existingIndexes, indexName)) {
        dealers.indexes = existingIndexes.concat([
          `CREATE UNIQUE INDEX \`${indexName}\` ON \`dealers\` (\`admin_code\`) WHERE \`admin_code\` != ''`,
        ]);
      }
      dao.saveCollection(dealers);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;
    dealers.schema = Array.from(dealers.schema).filter((f) => f.name !== "admin_code");
    dealers.indexes = Array.from(dealers.indexes || []).filter(
      (i) => !i.includes("idx_dealers_admin_code")
    );
    dao.saveCollection(dealers);
  }
);
