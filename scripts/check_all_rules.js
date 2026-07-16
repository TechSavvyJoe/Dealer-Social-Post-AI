import PocketBase from "pocketbase";
import { authenticateAdmin, loadAdminConfig } from "./lib/pocketbaseAdmin.js";

const config = loadAdminConfig();
const pb = new PocketBase(config.url);

async function checkRules() {
  await authenticateAdmin(pb, config);
  const collection = await pb.collections.getOne("dealers");

  console.log(`PocketBase target: ${config.url}`);
  console.log("Current dealers rules:");
  console.log("- listRule:", collection.listRule);
  console.log("- viewRule:", collection.viewRule);
  console.log("- createRule:", collection.createRule);
  console.log("- updateRule:", collection.updateRule);
  console.log("- deleteRule:", collection.deleteRule);
}

checkRules().catch((error) => {
  console.error(
    "Rule check failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
