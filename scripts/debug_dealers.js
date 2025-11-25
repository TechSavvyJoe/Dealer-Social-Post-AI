import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function debugDealers() {
  try {
    console.log("--- Checking Collection Rules ---");
    // We need admin auth to see collection settings usually, but we can try to infer from behavior
    // or just try to list as guest.

    console.log("Attempting to list dealers as GUEST (no auth)...");
    try {
      const records = await pb.collection("dealers").getList(1, 10);
      console.log(`✅ Guest list success. Found ${records.totalItems} items.`);
      records.items.forEach((d) => console.log(`   - ${d.name} (${d.code})`));
    } catch (e) {
      console.error("❌ Guest list failed:", e.message);
    }

    console.log("\n--- Testing findDealer logic for '1111' ---");
    try {
      const record = await pb
        .collection("dealers")
        .getFirstListItem('code="1111"');
      console.log(`✅ Found dealer 1111: ${record.name} (${record.id})`);
    } catch (e) {
      console.error("❌ Find dealer 1111 failed:", e.message);
    }

    console.log("\n--- Testing findDealer logic for '0000' ---");
    try {
      const record = await pb
        .collection("dealers")
        .getFirstListItem('code="0000"');
      console.log(`✅ Found dealer 0000: ${record.name} (${record.id})`);
    } catch (e) {
      console.error("❌ Find dealer 0000 failed:", e.message);
    }
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

debugDealers();
