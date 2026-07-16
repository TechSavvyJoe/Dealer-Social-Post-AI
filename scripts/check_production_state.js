import PocketBase from "pocketbase";
import { authenticateAdmin, loadAdminConfig } from "./lib/pocketbaseAdmin.js";

const config = loadAdminConfig();
const pb = new PocketBase(config.url);

async function checkState() {
  await authenticateAdmin(pb, config);

  console.log(`PocketBase target: ${config.url}`);
  console.log("--- Checking Rules ---");
  const collection = await pb.collections.getOne("dealers");
  console.log(`createRule: ${collection.createRule}`);
  console.log(`updateRule: ${collection.updateRule}`);
  console.log(`deleteRule: ${collection.deleteRule}`);
  console.log(`listRule: ${collection.listRule}`);
  console.log(`viewRule: ${collection.viewRule}`);

  console.log("\n--- Checking Data ---");
  const records = await pb.collection("dealers").getFullList();
  console.log(`Found ${records.length} dealers.`);
  records.forEach((record) => {
    console.log(
      `- ${record.name} (${record.id}): ${record.logo ? "logo set" : "no logo"}`,
    );
  });
}

checkState().catch((error) => {
  console.error(
    "State check failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
