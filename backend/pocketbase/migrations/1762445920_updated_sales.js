/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("hqokgi13d5mxijs")

  collection.listRule = "@request.auth.id != \"\""
  collection.viewRule = "@request.auth.id != \"\""
  collection.updateRule = "@request.auth.id != \"\""
  collection.deleteRule = "@request.auth.id != \"\""

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("hqokgi13d5mxijs")

  collection.listRule = "@request.auth.id != \"\" && (@request.auth.role = \"manager\" || salesperson = @request.auth.id)"
  collection.viewRule = "@request.auth.id != \"\" && (@request.auth.role = \"manager\" || salesperson = @request.auth.id)"
  collection.updateRule = "@request.auth.role = \"manager\""
  collection.deleteRule = "@request.auth.role = \"manager\""

  return dao.saveCollection(collection)
})
