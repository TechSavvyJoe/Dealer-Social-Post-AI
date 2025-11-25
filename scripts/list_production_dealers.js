import PocketBase from "pocketbase";

// Use the production URL
const pb = new PocketBase("https://dealer-social-post-ai-production.fly.dev");

async function listDealers() {
  try {
    // Try without auth first (public read)
    // await pb.admins.authWithPassword('joejgallant@gmail.com', 'Babymia78$');
    console.log("Attempting public read...");

    const records = await pb.collection("dealers").getFullList({
      sort: "name",
    });

    console.log(`Found ${records.length} dealers:`);
    records.forEach((r) => {
      console.log(
        `- Name: ${r.name}, ID: ${r.id}, Code: ${r.code}, Logo: ${r.logo}`
      );
    });
  } catch (error) {
    console.error("Error listing dealers:", error);
  }
}

listDealers();
