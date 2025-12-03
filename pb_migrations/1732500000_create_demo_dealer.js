/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) {
      return;
    }

    // Check if demo dealer already exists
    try {
      const existing = dao.findFirstRecordByFilter(
        collection.id,
        "code = '1234'"
      );
      if (existing) {
        return;
      }
    } catch (e) {
      // Not found
    }

    const record = new Record(collection, {
      name: "Demo Dealer",
      code: "1234",
      logo: "https://via.placeholder.com/150?text=Demo",
    });

    dao.saveRecord(record);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) {
      return;
    }

    try {
      const record = dao.findFirstRecordByFilter(
        collection.id,
        "code = '1234'"
      );
      if (record) {
        dao.deleteRecord(record);
      }
    } catch (e) {
      // Not found
    }
  }
);
