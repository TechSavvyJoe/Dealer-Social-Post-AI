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

    const codeField = (function(s) {
      for (let i = 0; i < s.length; i++) {
        if (s[i].name === "code") return s[i];
      }
      return null;
    })(dealers.schema);

    if (!codeField) throw new Error("dealers.code field not found");

    codeField.options = Object.assign({}, codeField.options || {}, {
      min: 6,
      max: 6,
      pattern: "^[0-9]{6}$",
    });

    return dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null; try { dealers = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealers) return;

    const codeField = (function(s) {
      for (let i = 0; i < s.length; i++) {
        if (s[i].name === "code") return s[i];
      }
      return null;
    })(dealers.schema);

    if (!codeField) return;

    codeField.options = Object.assign({}, codeField.options || {}, {
      min: 4,
      max: 4,
      pattern: "^[0-9]{4}$",
    });

    return dao.saveCollection(dealers);
  }
);
