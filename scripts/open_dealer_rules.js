import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function openRules() {
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

    console.log("Fetching 'dealers' collection...");
    const collection = await pb.collections.getOne("dealers");

    console.log("Updating rules to public...");
    await pb.collections.update(collection.id, {
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
    });

    console.log("✅ Rules updated. 'dealers' collection is now fully public.");
  } catch (error) {
    console.error("Error:", error);
  }
}

openRules();
