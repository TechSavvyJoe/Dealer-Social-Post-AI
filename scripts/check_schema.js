import PocketBase from "pocketbase";
import { authenticateAdmin, loadAdminConfig } from "./lib/pocketbaseAdmin.js";

const config = loadAdminConfig();
const pb = new PocketBase(config.url);

async function checkSchema() {
  await authenticateAdmin(pb, config);
  const collection = await pb.collections.getOne("dealers");

  console.log(`PocketBase target: ${config.url}`);
  console.log("Schema fields:");
  collection.schema.forEach((field) => {
    console.log(`- ${field.name} (${field.type})`);
  });
}

checkSchema().catch((error) => {
  console.error(
    "Schema check failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
