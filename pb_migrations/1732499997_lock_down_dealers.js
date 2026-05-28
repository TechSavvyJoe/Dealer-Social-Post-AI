/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!collection) {
        console.log("dealers collection not found, skipping rule lock-down");
        return;
      }
      // Keep read-only access for login lookups, but disable public writes.
      collection.listRule = collection.listRule ?? "";
      collection.viewRule = collection.viewRule ?? "";
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;
      dao.saveCollection(collection);
    } catch (e) {
      console.log("Error tightening dealers rules:", e);
    }
  },
  (db) => {
    const dao = new Dao(db);
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!collection) return;
      // Avoid restoring the open write rules; keep writes disabled on rollback.
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;
      dao.saveCollection(collection);
    } catch (e) {
      console.log("Error reverting dealers rules:", e);
    }
  }
);
