/**
 * Salesperson access codes move from plaintext storage to peppered hashes.
 *
 * Schema-only migration (PB 0.22 JSVM):
 *   - salespeople.pin becomes optional so the bootstrap backfill can blank it
 *     after hashing (the field previously required exactly four digits).
 *   - salespeople.pin_hash stores hs256(pin, SALESPERSON_PIN_PEPPER) as lowercase
 *     hex. The pepper lives only in deployment secrets, so a copied database
 *     cannot be brute-forced across the 10^4 code space.
 *   - The global unique index on pin is replaced by a dealer-scoped unique index
 *     on (dealer, pin_hash). During the compatibility bridge, PIN generation
 *     still enforces global uniqueness in code (see
 *     assertPersonPinAvailableWithDao), so PIN-only login from a stale client
 *     bundle stays unambiguous. Per-dealer reuse unlocks when the bridge is
 *     retired.
 *
 * The data backfill deliberately lives in onAfterBootstrap (pb_hooks/main.pb.js)
 * rather than here: it needs the runtime pepper secret and must also sweep any
 * straggler rows written by an old process during the deploy window.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const people = dao.findCollectionByNameOrId("salespeople");

    const pinField = people.schema.getFieldByName("pin");
    if (!pinField) throw new Error("salespeople.pin field not found");
    pinField.required = false;
    pinField.options = pinField.options || {};
    pinField.options.min = null;
    pinField.options.max = 4;
    pinField.options.pattern = "^([0-9]{4})?$";

    if (!people.schema.getFieldByName("pin_hash")) {
      people.schema.addField(
        new SchemaField({
          name: "pin_hash",
          type: "text",
          required: false,
          options: { min: null, max: 64, pattern: "^([a-f0-9]{64})?$" },
        }),
      );
    }

    people.indexes = Array.from(people.indexes || []).filter((index) => {
      const value = String(index);
      return (
        value.indexOf("idx_salespeople_pin`") === -1 &&
        value.indexOf("idx_salespeople_pin ") === -1 &&
        value.indexOf("idx_salespeople_dealer_pin_hash") === -1
      );
    });
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_dealer_pin_hash` ON `salespeople` (`dealer`, `pin_hash`) WHERE `pin_hash` != ''",
    );
    dao.saveCollection(people);
  },
  (db) => {
    const dao = new Dao(db);
    const people = dao.findCollectionByNameOrId("salespeople");

    const pinField = people.schema.getFieldByName("pin");
    if (pinField) {
      pinField.required = true;
      pinField.options = pinField.options || {};
      pinField.options.min = 4;
      pinField.options.max = 4;
      pinField.options.pattern = "^[0-9]{4}$";
    }

    people.schema = Array.from(people.schema).filter(
      (field) => field.name !== "pin_hash",
    );
    people.indexes = Array.from(people.indexes || []).filter(
      (index) => String(index).indexOf("idx_salespeople_dealer_pin_hash") === -1,
    );
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != ''",
    );
    dao.saveCollection(people);
  },
);
