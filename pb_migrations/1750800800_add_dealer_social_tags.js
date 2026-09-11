/// <reference path="../pb_data/types.d.ts" />
/**
 * Adds explicit dealership Page/company mention fields. These are presentation
 * metadata only: they help a salesperson tag the dealership from a personal
 * post and do not grant or imply publishing access to the business account.
 */
const DEALER_SOCIAL_TAG_FIELDS = ["facebook_page_tag", "linkedin_company_tag"];

migrate(
  (db) => {
    const dao = new Dao(db);
    const dealers = dao.findCollectionByNameOrId("dealers");
    const ensureText = (name) => {
      if (dealers.schema.getFieldByName(name)) return;
      dealers.schema.addField(
        new SchemaField({
          name,
          type: "text",
          required: false,
          options: { max: 100 },
        }),
      );
    };

    ensureText("facebook_page_tag");
    ensureText("linkedin_company_tag");
    dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (_error) {}
    if (!dealers) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    DEALER_SOCIAL_TAG_FIELDS.forEach((name) => {
      const field = dealers.schema.getFieldByName(name);
      if (field) dealers.schema.removeField(field.id);
    });
    dao.saveCollection(dealers);
  },
);
