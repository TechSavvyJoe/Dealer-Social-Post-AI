/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "b1xlqqnxgp1eq1e",
    "created": "2025-11-06 13:51:11.577Z",
    "updated": "2025-11-06 13:51:11.577Z",
    "name": "live_sales",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "lvsey1av",
        "name": "sale",
        "type": "relation",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "hqokgi13d5mxijs",
          "cascadeDelete": false,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      }
    ],
    "indexes": [],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("b1xlqqnxgp1eq1e");

  return dao.deleteCollection(collection);
})
