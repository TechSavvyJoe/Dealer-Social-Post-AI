/// <reference path="../pb_data/types.d.ts" />
/**
 * Makes approval records reviewable and ties status reads to the browser
 * session that submitted the creative.
 *
 * The image field is protected because generated delivery photos can contain
 * customers. Managers and the submitting session receive it only through the
 * session-authorized hook route; PocketBase's public file route stays closed.
 */
const POST_APPROVAL_CREATIVE_FIELDS = [
  "caption",
  "disclosures",
  "creative_image",
  "owner_session_hash",
];

migrate(
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) throw new Error("posts collection not found");

    // The original posts migration assigned collectionId through a nested
    // options getter, which PocketBase 0.22 serializes as an empty relation on
    // fresh installs. Reassign the full options object so posts can actually be
    // connected to dealers. This is intentionally retained on rollback because
    // it repairs the original schema contract rather than belonging to approval.
    const dealers = dao.findCollectionByNameOrId("dealers");
    const dealerField = posts.schema.getFieldByName("dealer");
    if (!dealerField) throw new Error("posts.dealer field not found");
    const dealerOptions = dealerField.options || {};
    dealerOptions.collectionId = dealers.id;
    dealerField.options = dealerOptions;

    const ensure = (name, field) => {
      if (!posts.schema.getFieldByName(name)) {
        posts.schema.addField(new SchemaField(field));
      }
    };

    ensure("caption", {
      name: "caption",
      type: "text",
      required: false,
      options: { max: 12000 },
    });
    ensure("disclosures", {
      name: "disclosures",
      type: "text",
      required: false,
      options: { max: 12000 },
    });
    ensure("creative_image", {
      name: "creative_image",
      type: "file",
      required: false,
      options: {
        maxSelect: 1,
        maxSize: 20 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        protected: true,
      },
    });
    ensure("owner_session_hash", {
      name: "owner_session_hash",
      type: "text",
      required: false,
      options: { max: 64 },
    });

    dao.saveCollection(posts);
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;

    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22: the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    POST_APPROVAL_CREATIVE_FIELDS.forEach((name) => {
      const field = posts.schema.getFieldByName(name);
      if (field) posts.schema.removeField(field.id);
    });
    dao.saveCollection(posts);
  },
);
