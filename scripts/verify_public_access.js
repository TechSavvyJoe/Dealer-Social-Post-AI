import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function verifyPublicAccess() {
  try {
    console.log("Attempting to find dealer '1111' without auth...");
    // Ensure we are not authenticated
    pb.authStore.clear();

    const record = await pb
      .collection("dealers")
      .getFirstListItem('code="1111"');
    console.log(`✅ Success! Found dealer: ${record.name} (${record.id})`);
  } catch (error) {
    console.error("❌ Failed to find dealer as guest:", error.message);
  }
}

verifyPublicAccess();
