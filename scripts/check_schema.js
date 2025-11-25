import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function checkSchema() {
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

    console.log("Schema Fields:");
    collection.schema.forEach((field) => {
      console.log(`- ${field.name} (${field.type})`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

checkSchema();
