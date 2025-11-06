/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("hqokgi13d5mxijs")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rqxcn3ua",
    "name": "transcript",
    "type": "json",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "cdw7gq7l",
    "name": "recording_url",
    "type": "url",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "exceptDomains": [],
      "onlyDomains": []
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "9wdon4il",
    "name": "analysis",
    "type": "json",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "vkeebn2z",
    "name": "performance_report",
    "type": "json",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "q91vwqf7",
    "name": "success_probability",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": 0,
      "max": 100,
      "noDecimal": false
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "22ebjts6",
    "name": "duration",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": 0,
      "max": null,
      "noDecimal": false
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "ec04znq1",
    "name": "notes",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("hqokgi13d5mxijs")

  // remove
  collection.schema.removeField("rqxcn3ua")

  // remove
  collection.schema.removeField("cdw7gq7l")

  // remove
  collection.schema.removeField("9wdon4il")

  // remove
  collection.schema.removeField("vkeebn2z")

  // remove
  collection.schema.removeField("q91vwqf7")

  // remove
  collection.schema.removeField("22ebjts6")

  // remove
  collection.schema.removeField("ec04znq1")

  return dao.saveCollection(collection)
})
