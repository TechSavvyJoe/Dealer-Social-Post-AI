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
          required: true,
          options: {
            maxSelect: 1,
            values: ["salesperson", "manager"],
          },
        }),
      );
    }

    const pinField = salespeople.schema.getFieldByName("pin");
    if (pinField) {
      pinField.options = pinField.options || {};
      pinField.options.min = 4;
      pinField.options.max = 4;
      pinField.options.pattern = "^[0-9]{4}$";
    }

    const indexes = Array.from(salespeople.indexes || []);
    if (!indexes.some((i) => String(i).indexOf("idx_salespeople_pin") !== -1)) {
      indexes.push(
        "CREATE UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != '' AND `active` = true",
      );
    }
    salespeople.indexes = indexes;
    dao.saveCollection(salespeople);

    // Backfill role for existing rows (SQLite default for new column via PB may be empty).
    try {
      db.newQuery(
        "UPDATE salespeople SET role = 'salesperson' WHERE role IS NULL OR role = ''",
      ).execute();
    } catch (_e) {
      /* ignore if already set */
    }

    // Migrate dealer admin_code → manager person when pin free.
    try {
      const rows = db
        .newQuery(
          "SELECT id, name, admin_code FROM dealers WHERE admin_code IS NOT NULL AND admin_code != ''",
        )
        .all();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const adminCode = String(row.admin_code || "").trim();
        if (!/^[0-9]{4}$/.test(adminCode)) continue;
        let exists = null;
        try {
          exists = db
            .newQuery(
              "SELECT id FROM salespeople WHERE pin = {:pin} LIMIT 1",
            )
            .bind({ pin: adminCode })
            .one();
        } catch (_e) {
          exists = null;
        }
        if (exists && exists.id) continue;

        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let id = "";
        for (let k = 0; k < 15; k++) {
          id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const now = new Date().toISOString();
        try {
          db.newQuery(
            "INSERT INTO salespeople (id, dealer, name, pin, role, active, created_at, created, updated) VALUES ({:id}, {:dealer}, {:name}, {:pin}, 'manager', true, {:now}, {:now}, {:now})",
          )
            .bind({
              id: id,
              dealer: row.id,
              name: String(row.name || "Manager") + " Manager",
              pin: adminCode,
              now: now,
            })
            .execute();
        } catch (_e) {
          /* skip duplicate / schema drift */
        }
      }
    } catch (_e) {
      /* non-fatal */
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
