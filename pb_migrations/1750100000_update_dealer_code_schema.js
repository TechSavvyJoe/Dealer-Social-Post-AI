/// <reference path="../pb_data/types.d.ts" />
/**
 * Tightens dealer login codes to the 6-digit format used by the admin UI and
 * existing data migration.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) throw new Error("dealers collection not found");

    const codeField = dealers.schema.getFieldByName("code");

    if (!codeField) throw new Error("dealers.code field not found");

    codeField.options.min = 6;
    codeField.options.max = 6;
    codeField.options.pattern = "^[0-9]{6}$";

    return dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;

    const codeField = dealers.schema.getFieldByName("code");

    if (!codeField) return;

    codeField.options.min = 4;
    codeField.options.max = 4;
    codeField.options.pattern = "^[0-9]{4}$";

    return dao.saveCollection(dealers);
  }
);
