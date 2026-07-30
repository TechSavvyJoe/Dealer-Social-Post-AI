/// <reference path="../pb_data/types.d.ts" />
/**
 * Personal-code people model + impersonation session fields.
 *
 * - salespeople.role: manager | salesperson (login via unique 4-digit pin)
 * - sessions.person / is_impersonation / impersonator_session for Open-as
 * - dealers.code no longer required for store login (optional legacy field)
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    // ---- salespeople.role ----
    let salespeople = null;
    try {
      salespeople = dao.findCollectionByNameOrId("salespeople");
    } catch (_e) {}
    if (!salespeople) throw new Error("salespeople collection not found");

    if (!salespeople.schema.getFieldByName("role")) {
      salespeople.schema.addField(
        new SchemaField({
          name: "role",
          type: "select",
          required: false,
          options: {
            maxSelect: 1,
            values: ["salesperson", "manager"],
          },
        }),
      );
    }
    // Do not tighten or index PINs yet. Existing installations can contain
    // blank, malformed, or duplicate legacy values; the forward integrity
    // migration repairs every row before installing the four-digit contract.
    dao.saveCollection(salespeople);

    // Backfill role for existing rows (SQLite default for new column via PB may be empty).
    db.newQuery(
      "UPDATE salespeople SET role = 'salesperson' WHERE role IS NULL OR role = ''",
    ).execute();
    salespeople = dao.findCollectionByNameOrId("salespeople");
    const roleField = salespeople.schema.getFieldByName("role");
    if (!roleField) throw new Error("salespeople.role field not found");
    roleField.required = true;
    dao.saveCollection(salespeople);

    // Migrate each legacy dealer admin credential to a manager person. Keep
    // the raw value temporarily (when schema-compatible); the next migration
    // preserves valid unique values and securely replaces every other one.
    const rows = dao.findRecordsByFilter(
      "dealers",
      "admin_code != ''",
      "created",
      10000,
      0,
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let existingManager = null;
      try {
        existingManager = dao.findFirstRecordByFilter(
          "salespeople",
          "dealer = {:dealer} && role = 'manager'",
          { dealer: row.id },
        );
      } catch (_e) {}
      if (existingManager && existingManager.id) continue;

      const adminCode = row.getString("admin_code").trim();
      const temporaryPin = adminCode.length <= 12 ? adminCode : "";
      const now = new Date().toISOString();
      const manager = new Record(salespeople);
      manager.set("dealer", row.id);
      manager.set("name", (row.getString("name") || "Manager") + " Manager");
      manager.set("pin", temporaryPin);
      manager.set("role", "manager");
      manager.set("active", true);
      manager.set("created_at", now);
      dao.saveRecord(manager);
    }

    // ---- sessions impersonation fields ----
    let sessions = null;
    try {
      sessions = dao.findCollectionByNameOrId("sessions");
    } catch (_e) {}
    if (!sessions) throw new Error("sessions collection not found");

    if (!sessions.schema.getFieldByName("person")) {
      sessions.schema.addField(
        new SchemaField({
          name: "person",
          type: "relation",
          required: false,
          options: {
            collectionId: salespeople.id,
            cascadeDelete: false,
            maxSelect: 1,
            minSelect: 0,
          },
        }),
      );
    }
    if (!sessions.schema.getFieldByName("is_impersonation")) {
      sessions.schema.addField(
        new SchemaField({
          name: "is_impersonation",
          type: "bool",
          required: false,
        }),
      );
    }
    if (!sessions.schema.getFieldByName("impersonator_session")) {
      sessions.schema.addField(
        new SchemaField({
          name: "impersonator_session",
          type: "text",
          required: false,
          options: { max: 64 },
        }),
      );
    }
    dao.saveCollection(sessions);

    // ---- dealers.code optional (login no longer uses it for stores) ----
    let dealers = null;
    try {
      dealers = dao.findCollectionByNameOrId("dealers");
    } catch (_e) {}
    if (dealers) {
      const codeField = dealers.schema.getFieldByName("code");
      if (codeField) {
        codeField.required = false;
        codeField.options = codeField.options || {};
        codeField.options.min = null;
        codeField.options.max = 12;
        codeField.options.pattern = "";
      }
      dao.saveCollection(dealers);
    }
  },
  (db) => {
    const dao = new Dao(db);
    let sessions = null;
    try {
      sessions = dao.findCollectionByNameOrId("sessions");
    } catch (_e) {}
    if (sessions) {
      sessions.schema = Array.from(sessions.schema).filter(
        (f) =>
          f.name !== "person" &&
          f.name !== "is_impersonation" &&
          f.name !== "impersonator_session",
      );
      dao.saveCollection(sessions);
    }

    let salespeople = null;
    try {
      salespeople = dao.findCollectionByNameOrId("salespeople");
    } catch (_e) {}
    if (salespeople) {
      salespeople.schema = Array.from(salespeople.schema).filter(
        (f) => f.name !== "role",
      );
      salespeople.indexes = Array.from(salespeople.indexes || []).filter(
        (i) => String(i).indexOf("idx_salespeople_pin") === -1,
      );
      const pinField = salespeople.schema.getFieldByName("pin");
      if (pinField) {
        pinField.options = pinField.options || {};
        pinField.options.min = null;
        pinField.options.max = 12;
        pinField.options.pattern = "";
      }
      dao.saveCollection(salespeople);
    }
  },
);
