migrate(
  (db) => {
    const dao = new Dao(db);
    
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!collection) {
        console.log("dealers collection not found, skipping rules update");
        return;
      }

      collection.listRule = "";
      collection.viewRule = "";
      collection.createRule = "";
      collection.updateRule = "";
      collection.deleteRule = "";

      dao.saveCollection(collection);
    } catch (e) {
      console.log("Error updating dealers rules:", e);
    }
  },
  (db) => {
    // revert changes (optional, usually set back to null or previous state)
    const dao = new Dao(db);
    
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!collection) {
        return;
      }

      collection.listRule = null;
      collection.viewRule = null;
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;

      dao.saveCollection(collection);
    } catch (e) {
      // Collection doesn't exist, nothing to revert
    }
  }
);
