import PocketBase from "pocketbase";

const pb = new PocketBase("https://dealer-social-post-ai-production.fly.dev");

const dealersToRestore = [
  { name: "Golden Rule Car Co.", code: "1111" },
  { name: "LaFontaine Ford", code: "2222" },
  { name: "Bob Maxey Ford", code: "3333" },
  { name: "Mission Ford of Dearborn", code: "4444" },
];

async function restoreDealers() {
  try {
    console.log("Authenticating as admin...");
    await pb.admins.authWithPassword("joejgallant@gmail.com", "Babymia78$");
    console.log("Authenticated.");

    for (const dealer of dealersToRestore) {
      console.log(`Checking ${dealer.name}...`);
      try {
        // Try to find by code
        const existing = await pb
          .collection("dealers")
          .getFirstListItem(`code="${dealer.code}"`);
        console.log(`✅ Found ${dealer.name} (ID: ${existing.id})`);
      } catch (err) {
        if (err.status === 404) {
          console.log(`⚠️  ${dealer.name} not found. Creating...`);
          try {
            const record = await pb.collection("dealers").create({
              name: dealer.name,
              code: dealer.code,
            });
            console.log(`✅ Created ${dealer.name} (ID: ${record.id})`);
          } catch (createErr) {
            console.error(`❌ Failed to create ${dealer.name}:`, createErr);
          }
        } else {
          console.error(`❌ Error checking ${dealer.name}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

restoreDealers();
