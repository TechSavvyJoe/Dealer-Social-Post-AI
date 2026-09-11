/// <reference path="../pb_data/types.d.ts" />
/**
 * Manager approval gate.
 *
 * - dealers.requires_approval (bool): when ON, every post defaults to pending.
 * - posts.approval_status (text: 'pending' | 'approved' | 'rejected' | 'n_a'):
 *   default 'n_a' for posts at dealerships that don't require approval, so the
 *   leaderboard can still count them.
 * - posts.approved_by (text): manager name who approved (free text, same
 *   pattern as salesperson_name).
 * - posts.approved_at (date): approval timestamp.
 */
const DEALER_APPROVAL_FIELDS = ["requires_approval", "brand_color"];
const POST_APPROVAL_FIELDS = ["approval_status", "approved_by", "approved_at"];

migrate(
  (db) => {
    const dao = new Dao(db);

    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (dealers) {
      const ensureDealer = (name, field) => {
        if (
          !(function (s, n) {
            for (let i = 0; i < s.length; i++) {
              if (s[i].name === n) return s[i];
            }
            return null;
          })(dealers.schema, name)
        ) {
          dealers.schema.addField(new SchemaField(field));
        }
      };
      ensureDealer("requires_approval", {
        name: "requires_approval",
        type: "bool",
        required: false,
      });
      // White-label brand color — hex string like "#1d4ed8". Loaded into
      // CSS custom properties on login so the app chrome tints to match.
      ensureDealer("brand_color", {
        name: "brand_color",
        type: "text",
        required: false,
        options: { max: 12 },
      });
      dao.saveCollection(dealers);
    }

    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (e) {}
    if (posts) {
      const ensure = (name, field) => {
        if (
          !(function (s, n) {
            for (let i = 0; i < s.length; i++) {
              if (s[i].name === n) return s[i];
            }
            return null;
          })(posts.schema, name)
        ) {
          posts.schema.addField(new SchemaField(field));
        }
      };
      ensure("approval_status", {
        name: "approval_status",
        type: "select",
        required: false,
        options: {
          maxSelect: 1,
          values: ["n_a", "pending", "approved", "rejected"],
        },
      });
      ensure("approved_by", {
        name: "approved_by",
        type: "text",
        required: false,
        options: { max: 120 },
      });
      ensure("approved_at", {
        name: "approved_at",
        type: "date",
        required: false,
      });
      dao.saveCollection(posts);
    }
  },
  (db) => {
    const dao = new Dao(db);

    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (dealers) {
      // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on
      // PocketBase 0.22 — the CLI prints "Applied" and the column stays.
      // `removeField` takes the field id, not its name.
      DEALER_APPROVAL_FIELDS.forEach((name) => {
        const field = dealers.schema.getFieldByName(name);
        if (field) dealers.schema.removeField(field.id);
      });
      dao.saveCollection(dealers);
    }
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (e) {}
    if (posts) {
      // Same 0.22 silent no-op trap as above — remove by field id.
      POST_APPROVAL_FIELDS.forEach((name) => {
        const field = posts.schema.getFieldByName(name);
        if (field) posts.schema.removeField(field.id);
      });
      dao.saveCollection(posts);
    }
  },
);
