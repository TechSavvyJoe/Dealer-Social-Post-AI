import PocketBase from "pocketbase";

const PB_URL = "http://127.0.0.1:8090";
const pb = new PocketBase(PB_URL);

async function fixRules() {
  try {
    console.log("Authenticating as admin...");
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

    if (!authResponse.ok) {
      throw new Error(`Auth failed: ${authResponse.status}`);
    }

    const authData = await authResponse.json();
    pb.authStore.save(authData.token, authData.admin);

    console.log("Fetching 'dealers' collection...");
    const collection = await pb.collections.getOne("dealers");

    console.log("Current Rules:");
    console.log("- listRule:", collection.listRule);
    console.log("- viewRule:", collection.viewRule);

    if (collection.listRule !== "" || collection.viewRule !== "") {
      console.log("Updating rules to public...");
      await pb.collections.update(collection.id, {
        listRule: "",
        viewRule: "",
      });
      console.log("✅ Rules updated to public.");
    } else {
      console.log("✅ Rules are already public.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

fixRules();
