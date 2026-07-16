import PocketBase from "pocketbase";
import {
  authenticateAdmin,
  loadAdminConfig,
  requireEnv,
  requireMutationApproval,
} from "./lib/pocketbaseAdmin.js";

const prod = loadAdminConfig("PB_PROD");
const local = loadAdminConfig("PB_LOCAL");

if (prod.url === local.url) {
  throw new Error("PB_PROD_URL and PB_LOCAL_URL must be different targets.");
}

requireMutationApproval(local.url, {
  targetEnv: "PB_SYNC_TARGET",
  confirmationEnv: "PB_SYNC_CONFIRMATION",
});

if (requireEnv("PB_SYNC_SOURCE") !== prod.url) {
  throw new Error(`PB_SYNC_SOURCE must exactly equal ${prod.url}.`);
}

const prodClient = new PocketBase(prod.url);
const localClient = new PocketBase(local.url);

async function sync() {
  await Promise.all([
    authenticateAdmin(prodClient, prod),
    authenticateAdmin(localClient, local),
  ]);

  console.log(`Sync source: ${prod.url}`);
  console.log(`Sync target: ${local.url}`);

  const [prodDealers, localDealers] = await Promise.all([
    prodClient.collection("dealers").getFullList(),
    localClient.collection("dealers").getFullList(),
  ]);

  console.log(`Found ${prodDealers.length} source dealers.`);

  for (const prodDealer of prodDealers) {
    const existing = localDealers.find(
      (dealer) => dealer.code === prodDealer.code,
    );
    const payload = new FormData();
    payload.append("name", prodDealer.name);
    payload.append("code", prodDealer.code);

    if (prodDealer.logo) {
      const logoUrl = prodClient.files.getUrl(prodDealer, prodDealer.logo);
      const logoResponse = await fetch(logoUrl);
      if (!logoResponse.ok) {
        throw new Error(
          `Logo download failed for source record ${prodDealer.id} (${logoResponse.status}).`,
        );
      }
      const contentType = logoResponse.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Source logo for ${prodDealer.id} is not an image.`);
      }
      payload.append("logo", await logoResponse.blob(), prodDealer.logo);
    }

    if (existing) {
      await localClient.collection("dealers").update(existing.id, payload);
      console.log(`Updated local dealer ${existing.id}.`);
    } else {
      const created = await localClient.collection("dealers").create(payload);
      console.log(`Created local dealer ${created.id}.`);
    }
  }

  console.log("Production-to-local sync complete.");
}

sync().catch((error) => {
  console.error(
    "Production-to-local sync failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
