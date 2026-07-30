/// <reference path="../pb_data/types.d.ts" />
/**
 * Authoritative people/session integrity repair.
 *
 * This migration is intentionally forward-only. It repairs legacy PIN data
 * before installing the new constraints, scrubs obsolete shared credentials,
 * establishes a canonical system-dealer marker, and revokes sessions that
 * cannot satisfy the new continuously validated authority contract.
 */
migrate(
  (db) => {
    const dao = new Dao(db);

    // ---------------------------------------------------------------------
    // People: repair first, constrain second.
    // ---------------------------------------------------------------------
    let people = dao.findCollectionByNameOrId("salespeople");
    if (!people.schema.getFieldByName("pin_needs_distribution")) {
      people.schema.addField(
        new SchemaField({
          name: "pin_needs_distribution",
          type: "bool",
          required: false,
        }),
      );
    }
    people.indexes = Array.from(people.indexes || []).filter(
      (index) => String(index).indexOf("idx_salespeople_pin") === -1,
    );
    dao.saveCollection(people);

    // Dirty installations may already have recorded the original 1750400000
    // migration. That version skipped dealer admin codes that were not unique
    // four-digit PINs, so editing the earlier migration only fixes fresh
    // databases. Recover every still-unmigrated non-system dealer credential
    // before the legacy dealer columns are scrubbed below. Invalid values are
    // represented by an empty temporary PIN; the repair pass immediately below
    // allocates a secure replacement and marks it for distribution.
    const legacyDealerRows = dao.findRecordsByFilter(
      "dealers",
      "admin_code != '' && name != {:systemName}",
      "created",
      10001,
      0,
      { systemName: "SYSTEM ADMIN" },
    );
    if (legacyDealerRows.length > 10000) {
      throw new Error("Cannot migrate more than 10,000 legacy dealer managers");
    }
    for (let i = 0; i < legacyDealerRows.length; i++) {
      const dealer = legacyDealerRows[i];
      let existingManager = null;
      try {
        existingManager = dao.findFirstRecordByFilter(
          "salespeople",
          "dealer = {:dealer} && role = 'manager'",
          { dealer: dealer.id },
        );
      } catch (_e) {}
      if (existingManager && existingManager.id) continue;

      const legacyCode = dealer.getString("admin_code").trim();
      const temporaryPin = /^[0-9]{4}$/.test(legacyCode) ? legacyCode : "";
      const dealerName = dealer.getString("name").trim() || "Dealer";
      const manager = new Record(people);
      manager.set("dealer", dealer.id);
      manager.set("name", (dealerName + " Manager").slice(0, 120));
      manager.set("pin", temporaryPin);
      manager.set("pin_needs_distribution", false);
      manager.set("role", "manager");
      manager.set("active", true);
      manager.set("created_at", new Date().toISOString());
      dao.saveRecord(manager);
    }

    const records = dao.findRecordsByFilter("salespeople", "1=1", "id", 10001, 0);
    if (records.length > 10000) {
      throw new Error(
        "Cannot allocate unique four-digit access codes for more than 10,000 people",
      );
    }

    const used = {};
    const needsRepair = [];
    for (let i = 0; i < records.length; i++) {
      const pin = records[i].getString("pin");
      const key = "pin:" + pin;
      if (/^[0-9]{4}$/.test(pin) && !used[key]) {
        used[key] = true;
      } else {
        needsRepair.push(records[i]);
      }
    }

    const allocatePin = function () {
      const seed = $security.randomStringWithAlphabet(4, "0123456789");
      if (!/^[0-9]{4}$/.test(seed || "")) {
        throw new Error("Secure PIN generation is unavailable");
      }
      const start = parseInt(seed, 10);
      for (let offset = 0; offset < 10000; offset++) {
        const value = (start + offset) % 10000;
        const candidate = String(10000 + value).slice(1);
        const key = "pin:" + candidate;
        if (!used[key]) {
          used[key] = true;
          return candidate;
        }
      }
      throw new Error("The four-digit access-code space is exhausted");
    };

    for (let i = 0; i < needsRepair.length; i++) {
      const record = needsRepair[i];
      record.set("pin", allocatePin());
      record.set("pin_needs_distribution", true);
      dao.saveRecord(record);
    }

    people = dao.findCollectionByNameOrId("salespeople");
    const pinField = people.schema.getFieldByName("pin");
    if (!pinField) throw new Error("salespeople.pin field not found");
    pinField.required = true;
    pinField.options = pinField.options || {};
    pinField.options.min = 4;
    pinField.options.max = 4;
    pinField.options.pattern = "^[0-9]{4}$";
    people.indexes = Array.from(people.indexes || []).filter(
      (index) => String(index).indexOf("idx_salespeople_pin") === -1,
    );
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != ''",
    );
    dao.saveCollection(people);

    // ---------------------------------------------------------------------
    // Dealers: stable system marker; legacy shared credentials are obsolete.
    // ---------------------------------------------------------------------
    let dealers = dao.findCollectionByNameOrId("dealers");
    if (!dealers.schema.getFieldByName("is_system")) {
      dealers.schema.addField(
        new SchemaField({
          name: "is_system",
          type: "bool",
          required: false,
        }),
      );
    }
    dealers.indexes = Array.from(dealers.indexes || []).filter((index) => {
      const value = String(index);
      return (
        value.indexOf("idx_code") === -1 &&
        value.indexOf("idx_dealers_admin_code") === -1 &&
        value.indexOf("idx_dealers_one_system") === -1
      );
    });
    dao.saveCollection(dealers);

    const systemRows = dao.findRecordsByFilter(
      "dealers",
      "name = {:name}",
      "created",
      100,
      0,
      { name: "SYSTEM ADMIN" },
    );
    db.newQuery(
      "UPDATE dealers SET is_system = 0, code = '', admin_code = ''",
    ).execute();
    if (systemRows.length > 0) {
      db.newQuery("UPDATE dealers SET is_system = 1 WHERE id = {:id}")
        .bind({ id: systemRows[0].id })
        .execute();
    }

    dealers = dao.findCollectionByNameOrId("dealers");
    dealers.indexes = Array.from(dealers.indexes || []).filter(
      (index) => String(index).indexOf("idx_dealers_one_system") === -1,
    );
    dealers.indexes.push(
      "CREATE UNIQUE INDEX `idx_dealers_one_system` ON `dealers` (`is_system`) WHERE `is_system` = true",
    );
    dao.saveCollection(dealers);

    // ---------------------------------------------------------------------
    // Sessions: bind admin authority to the current deployment secret.
    // ---------------------------------------------------------------------
    let sessions = dao.findCollectionByNameOrId("sessions");
    if (!sessions.schema.getFieldByName("admin_secret_fingerprint")) {
      sessions.schema.addField(
        new SchemaField({
          name: "admin_secret_fingerprint",
          type: "text",
          required: false,
          options: {
            min: 64,
            max: 64,
            pattern: "^[a-f0-9]{64}$",
          },
        }),
      );
    }
    if (!sessions.schema.getFieldByName("person_pin_fingerprint")) {
      sessions.schema.addField(
        new SchemaField({
          name: "person_pin_fingerprint",
          type: "text",
          required: false,
          options: {
            min: 64,
            max: 64,
            pattern: "^[a-f0-9]{64}$",
          },
        }),
      );
    }
    const sessionIndexes = Array.from(sessions.indexes || []);
    if (
      !sessionIndexes.some(
        (index) => String(index).indexOf("idx_sessions_person") !== -1,
      )
    ) {
      sessionIndexes.push(
        "CREATE INDEX `idx_sessions_person` ON `sessions` (`person`)",
      );
    }
    sessions.indexes = sessionIndexes;
    dao.saveCollection(sessions);

    // Existing rows predate the credential fingerprints now checked on every
    // request. Revoke once rather than guessing provenance or allowing a
    // pre-migration bearer to survive a credential rotation.
    db.newQuery("DELETE FROM sessions").execute();

    // ---------------------------------------------------------------------
    // Audit log: every security-sensitive action must be persistable.
    // ---------------------------------------------------------------------
    let events = null;
    try {
      events = dao.findCollectionByNameOrId("auth_events");
    } catch (_e) {}
    if (events) {
      const kind = events.schema.getFieldByName("kind");
      if (kind) {
        kind.options = kind.options || {};
        kind.options.maxSelect = 1;
        kind.options.values = [
          "login_success",
          "login_fail",
          "login_locked",
          "turnstile_fail",
          "session_revoked",
          "role_escalation_attempt",
          "proxy_unauthorized",
          "proxy_rate_limited",
          "impersonate_start",
          "impersonate_exit",
          "person_pin_issued",
          "person_pin_rotated",
          "person_pin_revealed",
          "person_pin_acknowledged",
          "person_deactivated",
          "person_reactivated",
          "person_role_changed",
        ];
        dao.saveCollection(events);
      }
    }
  },
  (_db) => {
    // Forward-only security migration. Restoring duplicate credentials or
    // pre-fingerprint admin sessions would violate the release invariants.
  },
);
