/// <reference path="../pb_data/types.d.ts" />
/**
 * Brand-consistent creative system, phase 2 (resolver flag; ships dark).
 *
 * `dealers.creative_system_v2` is the per-dealership kill switch described in
 * docs/superpowers/specs/2026-09-02-brand-consistent-creative-system.md §9.
 * While it is false or unset, services/creativeSystem.ts reproduces today's
 * style/tone precedence exactly and no Look, destination set, or feature gate
 * is applied — so this migration is additive and changes nothing on its own.
 *
 * The column is a plain optional bool: PocketBase reports an unset bool as
 * false, which is the safe (legacy) side of the flag for every dealership that
 * existed before the deploy.
 */
const DEALER_FLAG_FIELDS = ["creative_system_v2"];

migrate(
  (db) => {
    const dao = new Dao(db);

    const ensureField = (collection, field) => {
      if (collection.schema.getFieldByName(field.name)) return;
      collection.schema.addField(new SchemaField(field));
    };
    const bool = (name) => ({ name, type: "bool", required: false });

    const dealers = dao.findCollectionByNameOrId("dealers");
    [bool("creative_system_v2")].forEach((field) => ensureField(dealers, field));
    dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (_error) {}
    if (!dealers) return;
    dealers.schema = Array.from(dealers.schema).filter(
      (field) => DEALER_FLAG_FIELDS.indexOf(field.name) === -1,
    );
    dao.saveCollection(dealers);
  },
);
