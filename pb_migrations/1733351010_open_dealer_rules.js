/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    try {
      const collection = dao.findCollectionByNameOrId("dealers");
      if (!collection) {
        console.log("dealers collection not found");
        return;
      }
      
      // Open up rules to allow admin dashboard to manage dealers
      // Empty string means anyone can perform these actions
      // In production, you'd want to add proper authentication rules
      collection.listRule = "";
      collection.viewRule = "";
      collection.createRule = "";
      collection.updateRule = "";
      collection.deleteRule = "";
      
      dao.saveCollection(collection);
      console.log("Opened dealer collection rules for admin dashboard access");
    } catch (e) {
      console.log("Error opening dealer rules:", e);
    }
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const collection = dao.findCollectionByNameOrId("dealers");
      if (!collection) return;
      
      // Rollback: lock down again
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;
      dao.saveCollection(collection);
    } catch (e) {
      console.log("Error reverting dealer rules:", e);
    }
  }
);
