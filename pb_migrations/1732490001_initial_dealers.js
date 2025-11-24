/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("dealers");

  // Create admin dealer with code 0000
  const adminRecord = new Record(collection, {
    "name": "Admin",
    "code": "0000",
    "logo": "https://via.placeholder.com/150?text=Admin"
  });

  dao.saveRecord(adminRecord);

  return null;
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("dealers");

  // Find and delete admin record
  try {
    const record = dao.findFirstRecordByFilter(collection.id, "code = '0000'");
    dao.deleteRecord(record);
  } catch (e) {
    // Ignore if not found
  }

  return null;
})
