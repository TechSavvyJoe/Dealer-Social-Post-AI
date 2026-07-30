/// <reference path="../pb_data/types.d.ts" />
/**
 * Adds explicit dealership Page/company mention fields. These are presentation
 * metadata only: they help a salesperson tag the dealership from a personal
 * post and do not grant or imply publishing access to the business account.
 */
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
    dealers.schema = Array.from(dealers.schema).filter(
      (field) =>
        field.name !== "facebook_page_tag" && field.name !== "linkedin_company_tag",
    );
    dao.saveCollection(dealers);
  },
);
