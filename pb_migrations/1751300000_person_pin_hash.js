/**
 * Salesperson access codes move from plaintext storage to peppered hashes.
 *
 * Schema-only migration (PB 0.22 JSVM):
 *   - salespeople.pin becomes optional so the bootstrap backfill can blank it
 *     after hashing (the field previously required exactly four digits).
 *   - salespeople.pin_hash stores hs256(pin, SALESPERSON_PIN_PEPPER) as lowercase
 *     hex. The pepper lives only in deployment secrets, so a copied database
 *     cannot be brute-forced across the 10^4 code space.
 *   - The global unique index moves from plaintext pin to pin_hash and stays
 *     GLOBAL for the whole compatibility bridge: while stale client bundles may
 *     still sign in with a PIN alone, a database-level global constraint is the
 *     only race-proof guarantee that one code resolves to one person (the
 *     application-level check-then-insert is not). Per-dealer reuse arrives in
 *     the release that requires dealer context at login, which swaps this index
 *     for a (dealer, pin_hash) one.
 *
 * The data conversion runs in migration 1751300001 (strictly ordered after
 * this schema change and the people-integrity repair — the bootstrap hook is
 * NOT ordered after pending migrations on PB 0.22, which raced). The
 * schema-guarded bootstrap sweep only catches stragglers written by an old
 * process during the deploy window.
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
        value.indexOf("idx_salespeople_pin_hash") === -1
      );
    });
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_pin_hash` ON `salespeople` (`pin_hash`) WHERE `pin_hash` != ''",
    );
    // The plaintext partial index stays for the whole bridge: the old binary
    // (still serving during the deploy window) enforces uniqueness only via a
    // raceable check-then-insert on `pin`, and this index is its DB backstop.
    // It costs nothing afterwards (converted rows have pin = '') and leaves
    // with the pin column in the release that ends the bridge.
    people.indexes.push(
      "CREATE UNIQUE INDEX `idx_salespeople_pin` ON `salespeople` (`pin`) WHERE `pin` != ''",
    );
    dao.saveCollection(people);
  },
  (_db) => {
    // Forward-only. After the bootstrap backfill the hash is the ONLY
    // credential material — dropping pin_hash to restore the old schema would
    // permanently lock out every converted manager and salesperson.
    throw new Error(
      "1751300000_person_pin_hash is forward-only: peppered hashes cannot be reverted to plaintext PINs.",
    );
  },
);
