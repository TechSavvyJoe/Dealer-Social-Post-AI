import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

async function verifyUrls() {
  try {
    console.log("Fetching dealers...");
    const records = await pb.collection("dealers").getFullList();

    for (const record of records) {
      console.log(`Checking ${record.name}...`);
      console.log(`- Raw logo field: '${record.logo}'`);

      const logoUrl =
        record.logo && !record.logo.startsWith("http")
          ? pb.files.getUrl(record, record.logo)
          : record.logo;

      console.log(`- Generated URL: ${logoUrl}`);

      if (logoUrl) {
        const res = await fetch(logoUrl);
        if (res.ok) {
          console.log(`✅ URL is accessible (HTTP ${res.status})`);
        } else {
          console.error(`❌ URL failed: HTTP ${res.status}`);
        }
      } else {
        console.log("⚠️ No logo URL generated.");
      }
      console.log("---");
    }
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

verifyUrls();
