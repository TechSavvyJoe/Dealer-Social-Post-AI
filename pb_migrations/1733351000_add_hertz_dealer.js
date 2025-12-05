/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) {
      console.log("dealers collection not found");
      return;
    }

    // Check if Hertz dealer already exists
    try {
      const existing = dao.findFirstRecordByFilter(
        collection.id,
        "code = '0001'"
      );
      if (existing) {
        console.log("Hertz Car Sales dealer already exists");
        return;
      }
    } catch (e) {
      // Not found, proceed with creation
    }

    // Note: Logo should be uploaded via Admin Dashboard since PocketBase file fields
    // require actual file uploads, not URL strings
    const record = new Record(collection, {
      name: "Hertz Car Sales",
      code: "0001",
      logo: "", // Upload logo via Admin Dashboard
    });

    dao.saveRecord(record);
    console.log("Created Hertz Car Sales dealer with code 0001");
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
        "code = '0001'"
      );
      if (record) {
        dao.deleteRecord(record);
      }
    } catch (e) {
      // Not found
    }
  }
);
