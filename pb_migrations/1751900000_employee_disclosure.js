/// <reference path="../pb_data/types.d.ts" />
/**
 * FTC 16 CFR 255 employee / material-connection disclosure.
 *
 * A salesperson posting about their own employer's vehicles has a material
 * connection to the dealership, and the FTC Endorsement Guides require that
 * connection to be disclosed clearly and conspicuously in the post itself.
 * Nothing in the caption pipeline carried such a disclosure before this
 * migration.
 *
 * POLARITY IS DELIBERATE. The column is `employee_disclosure_disabled`, an
 * opt-OUT, not an `..._enabled` opt-in. PocketBase reports an unset bool as
 * false, so an "enabled" flag would read false for every dealership that
 * existed before this deploy and would silently turn the disclosure OFF for
 * all of them. For a compliance control the unset side must be the compliant
 * side, so unset/false means the disclosure is applied.
 *
 * `employee_disclosure_text` is an optional per-dealer override of the default
 * wording. Empty or unset means the product default is used.
 */
const DEALER_DISCLOSURE_FIELDS = [
  "employee_disclosure_text",
  "employee_disclosure_disabled",
];

migrate(
  (db) => {
    const dao = new Dao(db);

    const ensureField = (collection, field) => {
      if (collection.schema.getFieldByName(field.name)) return;
      collection.schema.addField(new SchemaField(field));
    };

    const dealers = dao.findCollectionByNameOrId("dealers");
    ensureField(dealers, {
      name: "employee_disclosure_text",
      type: "text",
      required: false,
      options: { max: 280 },
    });
    ensureField(dealers, {
      name: "employee_disclosure_disabled",
      type: "bool",
      required: false,
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
    // `schema = Array.from(schema).filter(...)` — the idiom used by the older
    // down-migrations in this repo — is a SILENT NO-OP on PocketBase 0.22: the
    // migration reports "Applied" and the column is still there. Verified
    // against 0.22.55 on a copy of real data. `removeField` takes the field id,
    // not its name.
    DEALER_DISCLOSURE_FIELDS.forEach((name) => {
      const field = dealers.schema.getFieldByName(name);
      if (field) dealers.schema.removeField(field.id);
    });
    dao.saveCollection(dealers);
  },
);
