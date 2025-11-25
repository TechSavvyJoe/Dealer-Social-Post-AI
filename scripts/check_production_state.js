import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function checkState() {
  try {
    console.log("Authenticating as admin...");
    // Bypass SDK auth due to version mismatch
    const authResponse = await fetch(
      `${PB_URL}/api/admins/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: "joejgallant@gmail.com",
          password: "Babymia78$",
        }),
      }
    );

    if (!authResponse.ok) throw new Error("Auth failed");
    const authData = await authResponse.json();
    pb.authStore.save(authData.token, authData.admin);

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
    records.forEach((r) => {
      console.log(`- ${r.name} (${r.code}): Logo='${r.logo}'`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

checkState();
