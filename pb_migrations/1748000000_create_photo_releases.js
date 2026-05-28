/// <reference path="../pb_data/types.d.ts" />
/**
 * Creates the `photo_releases` collection. One record per signed consent.
 *
 * Fields:
 *  - dealer:        relation → dealers (cascade on delete)
 *  - customer_name: string, required
 *  - signature_png: file (PNG data), required
 *  - signed_at:     datetime
 *  - vin:           string (optional — populated when a VIN was scanned)
 *  - notes:         text (optional)
 *  - ip_hash:       string (optional, sha256 of client IP for audit without storing PII)
 *  - user_agent:    string (optional)
 *
 * Rules: only the dealer's session can create/read their own releases.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealersCol = null; try { dealersCol = dao.findCollectionByNameOrId("dealers"); } catch(e) {}
    if (!dealersCol) {
      throw new Error("dealers collection not found — run earlier migrations first");
    }

    const collection = new Collection({
      name: "photo_releases",
      type: "base",
      system: false,
      schema: [
        {
          name: "dealer",
          type: "relation",
          required: true,
          options: {
            collectionId: dealersCol.id,
            cascadeDelete: false,
            maxSelect: 1,
            minSelect: 1,
          },
        },
        {
          name: "customer_name",
          type: "text",
          required: true,
          options: { min: 1, max: 120 },
        },
        {
          name: "signature_png",
          type: "file",
          required: true,
          options: {
            maxSelect: 1,
            maxSize: 512000, // 500 KB ceiling for a small PNG signature
            mimeTypes: ["image/png"],
          },
        },
        {
          name: "signed_at",
          type: "date",
          required: true,
        },
        {
          name: "vin",
          type: "text",
          required: false,
          options: { max: 17 },
        },
        {
          name: "notes",
          type: "text",
          required: false,
          options: { max: 1000 },
        },
        {
          name: "ip_hash",
          type: "text",
          required: false,
          options: { max: 64 },
        },
        {
          name: "user_agent",
          type: "text",
          required: false,
          options: { max: 500 },
        },
      ],
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: null,
      deleteRule: null,
    });

    return dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      let collection = null; try { collection = dao.findCollectionByNameOrId("photo_releases"); } catch(e) {}
      if (collection) {
        return dao.deleteCollection(collection);
      }
    } catch (e) {
      // already gone
    }
  }
);
