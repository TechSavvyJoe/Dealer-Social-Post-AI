/// <reference path="../pb_data/types.d.ts" />
/**
 * Extends `dealers` with the rest of the per-dealership profile fields the
 * GSM can manage from the settings panel. None are required so existing
 * dealers continue to work — every new field defaults to empty.
 *
 *  Contact + identity
 *    - website        text  (URL)
 *    - phone          text
 *    - address        text  (one-line — street + city + state + zip)
 *    - hours          text  (free-form, e.g. "Mon–Fri 9–8, Sat 9–6, Sun closed")
 *    - tagline        text  (one-liner used in posts)
 *
 *  Social presence (used for share-target deep links + post CTAs)
 *    - facebook_url       text
 *    - instagram_handle   text (with or without leading @)
 *    - tiktok_handle      text
 *    - x_handle           text
 *    - gbp_url            text  (Google Business Profile listing URL)
 *
 *  Generation defaults
 *    - default_hashtags  text  (newline- or comma-separated, e.g. "#JoeFord\n#DetroitFord\n#NewRide")
 *    - default_footer    text  (boilerplate that gets appended to captions, e.g. "Stop by 123 Main St — open until 9pm")
 *
 *  Image-overlay preferences (let the GSM curate which overlay styles their
 *  team can choose from)
 *    - enabled_styles      text  (comma-separated StyleOption IDs; empty = all)
 *    - default_style       text  (single StyleOption ID; empty = first enabled)
 *    - enabled_fun_styles  text  (comma-separated funStyle IDs; empty = all)
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) return;
    const ensure = (name, field) => {
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

    // Contact + identity
    ensure("website", {
      name: "website",
      type: "text",
      required: false,
      options: { max: 500 },
    });
    ensure("phone", {
      name: "phone",
      type: "text",
      required: false,
      options: { max: 40 },
    });
    ensure("address", {
      name: "address",
      type: "text",
      required: false,
      options: { max: 500 },
    });
    ensure("hours", {
      name: "hours",
      type: "text",
      required: false,
      options: { max: 500 },
    });
    ensure("tagline", {
      name: "tagline",
      type: "text",
      required: false,
      options: { max: 200 },
    });

    // Social handles
    ensure("facebook_url", {
      name: "facebook_url",
      type: "text",
      required: false,
      options: { max: 500 },
    });
    ensure("instagram_handle", {
      name: "instagram_handle",
      type: "text",
      required: false,
      options: { max: 100 },
    });
    ensure("tiktok_handle", {
      name: "tiktok_handle",
      type: "text",
      required: false,
      options: { max: 100 },
    });
    ensure("x_handle", {
      name: "x_handle",
      type: "text",
      required: false,
      options: { max: 100 },
    });
    ensure("gbp_url", {
      name: "gbp_url",
      type: "text",
      required: false,
      options: { max: 500 },
    });

    // Generation defaults
    ensure("default_hashtags", {
      name: "default_hashtags",
      type: "text",
      required: false,
      options: { max: 1500 },
    });
    ensure("default_footer", {
      name: "default_footer",
      type: "text",
      required: false,
      options: { max: 500 },
    });

    // Overlay preferences
    ensure("enabled_styles", {
      name: "enabled_styles",
      type: "text",
      required: false,
      options: { max: 500 },
    });
    ensure("default_style", {
      name: "default_style",
      type: "text",
      required: false,
      options: { max: 60 },
    });
    ensure("enabled_fun_styles", {
      name: "enabled_fun_styles",
      type: "text",
      required: false,
      options: { max: 2000 },
    });

    dao.saveCollection(dealers);
  },
  (db) => {
    const dao = new Dao(db);
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (e) {}
    if (!dealers) return;
    const drop = [
      "website",
      "phone",
      "address",
      "hours",
      "tagline",
      "facebook_url",
      "instagram_handle",
      "tiktok_handle",
      "x_handle",
      "gbp_url",
      "default_hashtags",
      "default_footer",
      "enabled_styles",
      "default_style",
      "enabled_fun_styles",
    ];
    // `schema = Array.from(schema).filter(...)` is a SILENT NO-OP on PocketBase
    // 0.22 — the migration reports "Applied" and the columns stay. `removeField`
    // takes the field id, not its name.
    drop.forEach((name) => {
      const field = dealers.schema.getFieldByName(name);
      if (field) dealers.schema.removeField(field.id);
    });
    dao.saveCollection(dealers);
  },
);
