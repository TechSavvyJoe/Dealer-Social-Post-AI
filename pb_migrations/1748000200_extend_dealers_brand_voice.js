/// <reference path="../pb_data/types.d.ts" />
/**
 * Extends the `dealers` collection with per-dealer prompt customization so
 * each dealership can tune voice / banned-phrases / OEM affiliation without
 * a code change.
 *
 *  - brand_voice:      free-form text describing tone, vibe, do's and don'ts
 *                      (e.g. "Confident, no exclamation points, never call us
 *                       'family-owned' — we're enterprise-owned")
 *  - banned_phrases:   newline- or comma-separated list of phrases the model
 *                      must avoid (e.g. "lowest price guaranteed\nguaranteed
 *                       approval\nno credit check")
 *  - oem_affiliation:  primary franchise OEM (e.g. "Ford", "GM", "Stellantis",
 *                      "Independent"). Used to enforce OEM brand-guideline
 *                      defaults.
 */
const DEALER_BRAND_VOICE_FIELDS = ["brand_voice", "banned_phrases", "oem_affiliation"];

migrate(
  (db) => {
    const dao = new Dao(db);
    let collection = null;
    try {
      collection = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!collection) throw new Error("dealers collection not found");

    const ensure = (name, field) => {
      if (
        !(function (s, n) {
          for (let i = 0; i < s.length; i++) {
            if (s[i].name === n) return s[i];
          }
          return null;
        })(collection.schema, name)
      ) {
        collection.schema.addField(new SchemaField(field));
      }
    };

    ensure("brand_voice", {
      name: "brand_voice",
      type: "text",
      required: false,
      options: { max: 1500 },
    });
    ensure("banned_phrases", {
      name: "banned_phrases",
      type: "text",
      required: false,
      options: { max: 1500 },
    });
    ensure("oem_affiliation", {
      name: "oem_affiliation",
      type: "text",
      required: false,
      options: { max: 120 },
    });

    return dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    let collection = null;
    try {
      collection = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!collection) return;
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22 — the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    DEALER_BRAND_VOICE_FIELDS.forEach((name) => {
      const field = collection.schema.getFieldByName(name);
      if (field) collection.schema.removeField(field.id);
    });
    return dao.saveCollection(collection);
  },
);
