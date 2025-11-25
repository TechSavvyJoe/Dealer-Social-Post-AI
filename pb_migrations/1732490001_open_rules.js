migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    collection.listRule = "";
    collection.viewRule = "";
    collection.createRule = "";
    collection.updateRule = "";
    collection.deleteRule = "";

    dao.saveCollection(collection);
  },
  (db) => {
    // revert changes (optional, usually set back to null or previous state)
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;

    dao.saveCollection(collection);
  }
);
