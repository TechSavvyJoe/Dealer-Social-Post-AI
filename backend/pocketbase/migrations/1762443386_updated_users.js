/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_")

  collection.listRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""
  collection.viewRule = "@request.auth.id != \"\" && (@request.auth.id = id || @request.auth.role = \"manager\")"
  collection.createRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""
  collection.updateRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""
  collection.deleteRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_")

  collection.listRule = "id = @request.auth.id"
  collection.viewRule = "id = @request.auth.id"
  collection.createRule = ""
  collection.updateRule = "id = @request.auth.id"
  collection.deleteRule = "id = @request.auth.id"

  return dao.saveCollection(collection)
})
