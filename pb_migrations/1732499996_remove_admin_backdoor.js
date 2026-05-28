/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
      if (!collection) return;
      try {
        const record = dao.findFirstRecordByFilter(collection.id, "code = '0000'");
        if (record) {
          dao.deleteRecord(record);
          console.log("Removed seeded admin dealer with code 0000");
        }
      } catch (_) {
        // Not found; nothing to remove
      }
    } catch (e) {
      console.log("Error removing admin backdoor dealer:", e);
    }
  },
  (db) => {
    // No down migration; intentionally do not recreate backdoor.
    return null;
  }
);
