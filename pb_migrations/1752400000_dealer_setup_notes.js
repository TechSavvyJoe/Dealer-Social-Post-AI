/// <reference path="../pb_data/types.d.ts" />
/**
 * System administrator's setup notes for a dealership.
 *
 * `dealers.setup_notes` is optional free text, at most 4,000 characters, that
 * the system administrator keeps about setting a store up. Only a system
 * administrator reads or writes it:
 *  - PATCH /api/app/dealers/:id drops the field for every other role, and
 *    POST /api/app/dealers is system-admin only;
 *  - the only response that returns it is the system administrator's dealer
 *    list, GET /api/app/dealers. serializeDealer, which builds every login,
 *    session and impersonation payload, never includes it.
 *
 * The column is a note about store setup and holds no customer data: nothing
 * in the app writes a customer name, release, signature or photo to it.
 *
 * The max must match DEALER_ADMIN_TEXT_FIELD_LIMITS in pb_hooks/helpers.js.
 */
const DEALER_SETUP_NOTES_FIELDS = ["setup_notes"];

migrate(
  (db) => {
    const dao = new Dao(db);

    const ensureField = (collection, field) => {
      if (collection.schema.getFieldByName(field.name)) return;
      collection.schema.addField(new SchemaField(field));
    };

    const dealers = dao.findCollectionByNameOrId("dealers");
    ensureField(dealers, {
      name: "setup_notes",
      type: "text",
      required: false,
      options: { max: 4000 },
    });
    dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (_error) {}
    if (!dealers) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Reverted" and the column is still there.
    // `removeField` takes the field id, not its name.
    DEALER_SETUP_NOTES_FIELDS.forEach((name) => {
      const field = dealers.schema.getFieldByName(name);
      if (field) dealers.schema.removeField(field.id);
    });
    dao.saveCollection(dealers);
  },
);
