import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function checkLogos() {
  try {
    console.log("Fetching dealers...");
    const records = await pb.collection("dealers").getFullList();
    console.log(`Found ${records.length} dealers:`);
    records.forEach((d) => {
      console.log(`- ${d.name}: Logo field = '${d.logo}'`);
    });
  } catch (error) {
    console.error("Error fetching dealers:", error);
  }
}

checkLogos();
