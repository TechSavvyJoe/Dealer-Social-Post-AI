/// <reference path="../pb_data/types.d.ts" />

migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("dealers");

    if (!collection) {
      console.log("Dealers collection not found, skipping mock data creation");
      return;
    }

    // SECURITY: these are well-known, trivially-guessable login codes. Seeding
    // them in production re-creates the very backdoor that
    // 1732499996_remove_admin_backdoor.js removed. Only seed when explicitly
    // opted in via SEED_DEV_DEALERS=1 (never set in prod). See the companion
    // cleanup migration 1750000100_remove_dev_dealers.js which deletes any rows
    // a prior run of this migration already created.
    if (($os.getenv("SEED_DEV_DEALERS") || "").trim() !== "1") {
      console.log("SEED_DEV_DEALERS != 1 — skipping dev/backdoor dealer seed");
      return;
    }

    // Insert mock dealers
    const mockDealers = [
      { name: "Demo Dealer", code: "0000" },
      { name: "Test Dealership 1", code: "1111" },
      { name: "Test Dealership 2", code: "2222" }
    ];

    for (const data of mockDealers) {
      try {
        const record = new Record(collection);
        record.set("name", data.name);
        record.set("code", data.code);
        dao.saveRecord(record);
      } catch (err) {
        console.log("Failed to insert mock dealer", data.code, err);
      }
    }
    console.log("Successfully inserted mock dealers: 0000, 1111, 2222");
  },
  (db) => {
    // optional down logic
    const dao = new Dao(db);
    const records = dao.findRecordsByExpr("dealers", $dbx.exp("code IN ({:codes})", { codes: ["0000", "1111", "2222"] }));
    for (const record of records) {
        dao.deleteRecord(record);
    }
  }
);
