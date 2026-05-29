/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) return;

    const codeField = collection.schema.getFieldByName("code");
    if (codeField) {
      codeField.options.min = null;
      codeField.options.max = 6;
      codeField.options.pattern = "";
    }

    const adminCodeField = collection.schema.getFieldByName("admin_code");
    if (adminCodeField) {
      adminCodeField.options.min = null;
      adminCodeField.options.max = 20;
      adminCodeField.options.pattern = "";
    }

    dao.saveCollection(collection);
  },
  (db) => {
    // Revert
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) return;

    const codeField = collection.schema.getFieldByName("code");
    if (codeField) {
      codeField.options.min = 4;
      codeField.options.max = 4;
      codeField.options.pattern = "^[0-9]{4}$";
    }

    const adminCodeField = collection.schema.getFieldByName("admin_code");
    if (adminCodeField) {
      adminCodeField.options.min = null;
      adminCodeField.options.max = 12;
      adminCodeField.options.pattern = "";
    }

    dao.saveCollection(collection);
  }
);
