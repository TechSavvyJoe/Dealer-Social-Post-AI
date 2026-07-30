/// <reference path="../pb_data/types.d.ts" />
/**
 * Persist server-derived consent requirement separately from the successful
 * release link. This is intentionally a forward migration because the output
 * profile migration was already applied in local/staging databases.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const posts = dao.findCollectionByNameOrId("posts");
    const ensure = (name, field) => {
      if (!posts.schema.getFieldByName(name)) {
        posts.schema.addField(new SchemaField(field));
      }
    };

    ensure("scenario_id", {
      name: "scenario_id",
      type: "text",
      required: false,
      options: { max: 80 },
    });
    ensure("release_required", {
      name: "release_required",
      type: "bool",
      required: false,
      options: {},
    });
    ensure("release_status", {
      name: "release_status",
      type: "select",
      required: false,
      options: {
        maxSelect: 1,
        values: ["not_required", "pending", "saved"],
      },
    });
    ensure("platform_captions", {
      name: "platform_captions",
      type: "text",
      required: false,
      options: { max: 60000 },
    });
    dao.saveCollection(posts);

    // Repair every legacy row in one transactionally applied SQL statement.
    // Positive links are authoritative. Customer-named, default-scenario, and
    // pending-review rows are conservatively treated as release-required so a
    // schema default cannot turn old queue items into consent-free approvals.
    // This deliberately avoids a capped DAO page that could skip row 10,001.
    db.newQuery(
      "UPDATE posts SET " +
        "release_required = 1, " +
        "release_status = CASE WHEN has_release = 1 THEN 'saved' ELSE 'pending' END " +
        "WHERE has_release = 1 " +
        "OR TRIM(COALESCE(customer_name, '')) != '' " +
        "OR TRIM(COALESCE(scenario_id, '')) = '' " +
        "OR approval_status = 'pending' " +
        "OR scenario_id IN ('customer_delivery', 'recall_complete', 'customer_testimonial', 'sold_by_salesperson')",
    ).execute();
  },
  (db) => {
    const dao = new Dao(db);
    let posts = null;
    try {
      posts = dao.findCollectionByNameOrId("posts");
    } catch (_e) {}
    if (!posts) return;

    posts.schema = Array.from(posts.schema).filter(
      (field) =>
        field.name !== "scenario_id" &&
        field.name !== "release_required" &&
        field.name !== "release_status" &&
        field.name !== "platform_captions",
    );
    dao.saveCollection(posts);
  },
);
