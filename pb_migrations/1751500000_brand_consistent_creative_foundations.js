/// <reference path="../pb_data/types.d.ts" />
/**
 * Brand-consistent creative system, phase 1 (foundations; ships dark).
 *
 * `dealers` gains the Signature Look, brand-voice, destination, and policy
 * fields from docs/superpowers/specs/2026-09-02-brand-consistent-creative-system.md
 * §6; `salespeople` gains the sales-manager scope flag and the personal
 * defaults from §5. Every field is optional and nothing reads them yet, so
 * the previous binary keeps serving during the deploy window.
 *
 * Structured values are PocketBase json fields. PB 0.22 requires an explicit
 * `maxSize` (bytes) on json fields; the caps here are mirrored by
 * DEALER_JSON_FIELD_LIMITS in pb_hooks/helpers.js, which validates the shape
 * of every value before it reaches the record.
 *
 * Schema-only: no existing column holds a value a Look, policy, or destination
 * set can be derived from, so the brand-settings UI seeds them on first save.
 */
const DEALER_BRAND_FIELDS = [
  "signature_look",
  "alternate_look",
  "default_tone",
  "playful_style",
  "motion_signature",
  "logo_placement",
  "brand_voice_do",
  "brand_voice_dont",
  "required_hashtags_locked",
  "category_destinations",
  "approval_policy",
  "feature_permissions",
  "image_quality_tier",
];
const PERSON_PROFILE_FIELDS = [
  "manager_scope",
  "signature_line",
  "default_category",
  "playful_default",
];

migrate(
  (db) => {
    const dao = new Dao(db);

    const ensureField = (collection, field) => {
      if (collection.schema.getFieldByName(field.name)) return;
      collection.schema.addField(new SchemaField(field));
    };
    const select = (name, values) => ({
      name,
      type: "select",
      required: false,
      options: { maxSelect: 1, values },
    });
    const text = (name, max) => ({
      name,
      type: "text",
      required: false,
      options: { max },
    });
    const bool = (name) => ({ name, type: "bool", required: false });
    const json = (name, maxSize) => ({
      name,
      type: "json",
      required: false,
      options: { maxSize },
    });
    const looks = ["showroom", "hometown", "turbo"];

    const dealers = dao.findCollectionByNameOrId("dealers");
    [
      select("signature_look", looks),
      select("alternate_look", looks),
      text("default_tone", 40),
      text("playful_style", 80),
      json("motion_signature", 2000),
      json("logo_placement", 1000),
      json("brand_voice_do", 1000),
      json("brand_voice_dont", 1000),
      bool("required_hashtags_locked"),
      json("category_destinations", 8000),
      json("approval_policy", 2000),
      json("feature_permissions", 8000),
      select("image_quality_tier", ["standard", "studio"]),
    ].forEach((field) => ensureField(dealers, field));
    dao.saveCollection(dealers);

    const people = dao.findCollectionByNameOrId("salespeople");
    [
      bool("manager_scope"),
      text("signature_line", 140),
      text("default_category", 40),
      bool("playful_default"),
    ].forEach((field) => ensureField(people, field));
    dao.saveCollection(people);
  },
  (db) => {
    const dao = new Dao(db);
    const removeFields = (collectionName, names) => {
      let collection = null;
      try {
        collection = dao.findCollectionByNameOrId(collectionName);
      } catch (_error) {}
      if (!collection) return;
      collection.schema = Array.from(collection.schema).filter(
        (field) => names.indexOf(field.name) === -1,
      );
      dao.saveCollection(collection);
    };
    removeFields("dealers", DEALER_BRAND_FIELDS);
    removeFields("salespeople", PERSON_PROFILE_FIELDS);
  },
);
