/**
 * Convert plaintext salesperson PINs to peppered hashes INSIDE the migration
 * runner. This must not live only in onAfterBootstrap: on PocketBase 0.22 the
 * bootstrap hook is not ordered strictly after pending migrations on an
 * upgraded database, and a backfill racing the people-integrity repair
 * migration blanked and re-minted codes against each other. Migrations run
 * strictly in sequence, so by this point the pin_hash column and the repaired
 * roster both exist.
 *
 * If the pepper secret is not configured yet, rows are left untouched: the
 * schema-guarded bootstrap sweep (helpers.backfillSalespersonPinHashes)
 * converts them on a later boot, and readiness reports the missing pepper.
 * Session fingerprints are rewritten in the same pass so nobody is logged out.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    let pepper = "";
    try {
      pepper = ($os.getenv("SALESPERSON_PIN_PEPPER") || "").toString().trim();
    } catch (_e) {
      pepper = "";
    }

    let rows;
    try {
      rows = dao.findRecordsByFilter(
        "salespeople",
        "pin != ''",
        "created",
        10000,
        0,
        {},
      );
    } catch (_e) {
      return;
    }
    if (!rows || !rows.length) return;

    if (pepper.length < 32) {
      console.log(
        "[migration] pin backfill skipped: SALESPERSON_PIN_PEPPER is missing; " +
          rows.length +
          " plaintext codes remain until the bootstrap sweep runs with the secret configured.",
      );
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const person = rows[i];
      const pin = person.getString("pin");
      if (!/^[0-9]{4}$/.test(pin)) continue;
      const pinHash = (
        $security.hs256("dealer-social-post-ai:person-pin-hash:v1:" + pin, pepper) || ""
      ).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(pinHash)) {
        throw new Error("Secure access-code hashing is unavailable during migration");
      }
      person.set("pin_hash", pinHash);
      person.set("pin", "");
      dao.saveRecord(person);

      const fingerprint = (
        $security.sha256(
          "dealer-social-post-ai:person-pin:v2:" + person.id + ":" + pinHash,
        ) || ""
      ).toLowerCase();
      try {
        const sessions = dao.findRecordsByFilter(
          "sessions",
          "person = {:personId}",
          "created",
          200,
          0,
          { personId: person.id },
        );
        for (let j = 0; j < (sessions || []).length; j++) {
          sessions[j].set("person_pin_fingerprint", fingerprint);
          dao.saveRecord(sessions[j]);
        }
      } catch (_e) {
        // A missing sessions collection only means there is nothing to keep alive.
      }
    }
  },
  (_db) => {
    // Forward-only, same as 1751300000: the hashes are the only credential
    // material once the plaintext is blanked.
    throw new Error(
      "1751300001_person_pin_backfill is forward-only: hashed access codes cannot be reverted.",
    );
  },
);
