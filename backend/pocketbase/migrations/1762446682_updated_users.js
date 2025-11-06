/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_")

  collection.viewRule = "@request.auth.id != \"\""
  collection.createRule = "@request.auth.role = \"manager\""
  collection.updateRule = "@request.auth.role = \"manager\""
  collection.deleteRule = "@request.auth.role = \"manager\""

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_")

  collection.viewRule = "@request.auth.id != \"\" && (@request.auth.id = id || @request.auth.role = \"manager\")"
  collection.createRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""
  collection.updateRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""
  collection.deleteRule = "@request.auth.id != \"\" && @request.auth.role = \"manager\""

  return dao.saveCollection(collection)
})
