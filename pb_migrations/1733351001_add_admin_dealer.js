/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) {
      console.log("dealers collection not found");
      return;
    }

    // Check if Admin dealer already exists
    try {
      const existing = dao.findFirstRecordByFilter(
        collection.id,
        "code = '0000'"
      );
      if (existing) {
        console.log("Admin dealer already exists");
        return;
      }
    } catch (e) {
      // Not found, proceed with creation
    }

    const record = new Record(collection, {
      name: "Admin",
      code: "0000",
      logo: "https://via.placeholder.com/150?text=Admin",
    });

    dao.saveRecord(record);
    console.log("Created Admin dealer with code 0000");
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
        "code = '0000'"
      );
      if (record) {
        dao.deleteRecord(record);
      }
    } catch (e) {
      // Not found
    }
  }
);
