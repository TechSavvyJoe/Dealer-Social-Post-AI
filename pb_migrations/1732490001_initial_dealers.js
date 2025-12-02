/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  
  try {
    const collection = dao.findCollectionByNameOrId("dealers");
    if (!collection) {
      console.log("dealers collection not found, skipping initial data");
      return null;
    }

    // Check if admin dealer already exists
    try {
      const existing = dao.findFirstRecordByFilter(collection.id, "code = '0000'");
      if (existing) {
        console.log("Admin dealer already exists, skipping creation");
        return null;
      }
    } catch (e) {
      // Record doesn't exist, proceed with creation
    }

    // Create admin dealer with code 0000
    const adminRecord = new Record(collection, {
      "name": "Admin",
      "code": "0000",
      "logo": "https://via.placeholder.com/150?text=Admin"
    });

    dao.saveRecord(adminRecord);
  } catch (e) {
    console.log("Error creating initial dealers:", e);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);
  
  try {
    const collection = dao.findCollectionByNameOrId("dealers");
    if (!collection) {
      return null;
    }

    // Find and delete admin record
    const record = dao.findFirstRecordByFilter(collection.id, "code = '0000'");
    if (record) {
      dao.deleteRecord(record);
    }
  } catch (e) {
    // Ignore if not found
  }

  return null;
})
