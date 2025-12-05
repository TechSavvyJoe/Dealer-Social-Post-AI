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

    const record = new Record(collection, {
      name: "Hertz Car Sales",
      code: "0001",
      logo: "https://www.hertzcarbuying.com/content/dam/hertz-car-sales/images/logos/hertz-car-sales-logo.svg",
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
