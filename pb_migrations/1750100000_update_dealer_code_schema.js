/// <reference path="../pb_data/types.d.ts" />
/**
 * Tightens dealer login codes to the 6-digit format used by the admin UI and
 * existing data migration.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) throw new Error("dealers collection not found");

    // PocketBase 0.22 exposes Collection.schema as a Schema object, not an
    // array. Iterating schema.length silently finds nothing and aborts startup.
    const codeField = dealers.schema.getFieldByName("code");

    if (!codeField) throw new Error("dealers.code field not found");

    codeField.options.min = 6;
    codeField.options.max = 6;
    codeField.options.pattern = "^[0-9]{6}$";

    return dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) return;

    const codeField = dealers.schema.getFieldByName("code");

    if (!codeField) return;

    // Rolling this migration back must not invalidate the six-character codes
    // written by 1748200000_migrate_to_6_digit_codes.js. Relax only the strict
    // digits-only rule; the earlier data migration owns the 6 -> 4 conversion.
    codeField.options.min = null;
    codeField.options.max = 6;
    codeField.options.pattern = "";

    return dao.saveCollection(dealers);
  },
);
