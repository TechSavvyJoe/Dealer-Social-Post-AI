/// <reference path="../pb_data/types.d.ts" />
/**
 * Link photo_releases to the post they belong to. Before this fix the
 * release was saved when the customer signed; if the salesperson then closed
 * the app without generating, the dealer ended up with an orphan release in
 * the audit trail. We now defer save until generation succeeds AND store
 * the resulting post_id on the release record.
 */
const RELEASE_POST_LINK_FIELDS = ["post_id"];

migrate(
  (db) => {
    const dao = new Dao(db);
    let releases = null;
    try {
      releases = dao.findCollectionByNameOrId("photo_releases");
    } catch (e) {}
    if (!releases) return;

    const exists = (function (s, n) {
      for (let i = 0; i < s.length; i++) {
        if (s[i].name === n) return s[i];
      }
      return null;
    })(releases.schema, "post_id");
    if (!exists) {
      releases.schema.addField(
        new SchemaField({
          name: "post_id",
          type: "text",
          required: false,
          options: { max: 64 },
        }),
      );
      dao.saveCollection(releases);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let releases = null;
    try {
      releases = dao.findCollectionByNameOrId("photo_releases");
    } catch (e) {}
    if (!releases) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the column stays. `removeField`
    // takes the field id, not its name.
    RELEASE_POST_LINK_FIELDS.forEach((name) => {
      const field = releases.schema.getFieldByName(name);
      if (field) releases.schema.removeField(field.id);
    });
    dao.saveCollection(releases);
  },
);
