/// <reference path="../pb_data/types.d.ts" />
/**
 * PocketBase serves unprotected files without applying collection view rules.
 * Customer signatures therefore need field-level protection in addition to
 * the locked photo_releases collection rules.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let releases = null;
    try {
      releases = dao.findCollectionByNameOrId("photo_releases");
    } catch (_e) {}
    if (!releases) return;

    const signatureField = releases.schema.getFieldByName("signature_png");
    if (!signatureField) {
      throw new Error("photo_releases.signature_png field not found");
    }

    signatureField.options.protected = true;
    dao.saveCollection(releases);
  },
  (_db) => {
    // Security invariant: never make stored customer signatures public again.
  },
);
