migrate(
  (db) => {
    const dao = new Dao(db);
    
    try {
      const collection = dao.findCollectionByNameOrId("dealers");
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
      const collection = dao.findCollectionByNameOrId("dealers");
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
