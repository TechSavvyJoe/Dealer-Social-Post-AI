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
migrate(
  (db) => {
    const dao = new Dao(db);
    let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!collection) throw new Error("dealers collection not found");

    const ensure = (name, field) => {
      if (!(function(s, n){ for(let i=0;i<s.length;i++){ if(s[i].name === n) return s[i]; } return null; })(collection.schema, name)) {
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
    let collection = null; try { collection = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!collection) return;
    collection.schema = Array.from(collection.schema).filter(
      (f) =>
        f.name !== "brand_voice" &&
        f.name !== "banned_phrases" &&
        f.name !== "oem_affiliation"
    );
    return dao.saveCollection(collection);
  }
);
