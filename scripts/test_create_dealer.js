import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function testCreate() {
  try {
    console.log("Ensuring no auth...");
    pb.authStore.clear();

    console.log("Attempting to create test dealer...");
    const record = await pb.collection("dealers").create({
      name: "Test Dealer Public",
      code: "9999",
    });

    console.log(`✅ Success! Created dealer: ${record.name} (${record.id})`);

    // Cleanup
    console.log("Cleaning up...");
    await pb.collection("dealers").delete(record.id);
    console.log("✅ Cleanup successful.");
  } catch (error) {
    console.error("❌ Creation failed:", error.message);
    if (error.data)
      console.error("Details:", JSON.stringify(error.data, null, 2));
  }
}

testCreate();
