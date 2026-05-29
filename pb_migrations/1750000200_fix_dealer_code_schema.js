/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) return;

    // Fix the code field schema to allow 6-character alphanumeric codes
    const codeField = collection.schema.getFieldByName("code");
    if (codeField) {
      codeField.options.min = 6;
      codeField.options.max = 6;
      codeField.options.pattern = "^[A-Za-z0-9]{6}$";
    }

    // Also fix admin_code if it exists, since it was also migrated to 6 chars
    const adminCodeField = collection.schema.getFieldByName("admin_code");
    if (adminCodeField) {
      adminCodeField.options.min = 6;
      adminCodeField.options.max = 12;
      adminCodeField.options.pattern = "^[A-Za-z0-9]+$";
    }

    dao.saveCollection(collection);
  },
  (db) => {
    // Revert to 4-digit codes
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
      adminCodeField.options.min = 4;
      adminCodeField.options.max = 12;
      adminCodeField.options.pattern = "";
    }

    dao.saveCollection(collection);
  }
);
