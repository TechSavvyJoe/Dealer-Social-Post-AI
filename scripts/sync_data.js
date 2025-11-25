import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

const pb = new PocketBase(PB_URL);

const csvData = [
  { id: "0000", name: "Admin Control", logo: "" },
  {
    id: "1111",
    name: "Golden Rule Car Co.",
    logo: "https://i.imgur.com/C4Blr8x.png",
  },
  {
    id: "2222",
    name: "LaFontaine Ford",
    logo: "https://i.imgur.com/R0ImRxY.png",
  },
  {
    id: "3333",
    name: "Bob Maxey Ford",
    logo: "https://i.imgur.com/lkXX52C.jpeg",
  },
  {
    id: "4444",
    name: "Mission Ford of Dearborn ",
    logo: "https://i.imgur.com/QDpVYPT.png",
  },
];

async function sync() {
  try {
    console.log(`Connecting to ${PB_URL}...`);
    await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
    console.log("Authenticated.");

    // --- Check and create collection if it doesn't exist ---
    try {
      await pb.collections.getOne("dealers");
      console.log("'dealers' collection already exists.");
    } catch (error) {
      if (error.status === 404) {
        console.log("'dealers' collection not found. Creating it...");
        await pb.collections.create({
          name: "dealers",
          type: "base",
          schema: [
            { name: "name", type: "text", required: true },
            { name: "logo", type: "text" },
            {
              name: "logo",
              type: "file",
              options: {
                maxSelect: 1,
                maxSize: 5242880, // 5MB
                mimeTypes: [
                  "image/jpeg",
                  "image/png",
                  "image/svg+xml",
                  "image/webp",
                  "image/gif",
                ],
              },
            },
          ],
        });
        console.log("'dealers' collection created successfully.");
      } else {
        console.error("Error checking for 'dealers' collection:", error);
        throw error;
      }
    }
    // --- End of schema check ---

    for (const item of csvData) {
      // Clean up name
      const name = item.name.trim();

      // Check if exists by name
      const safeName = name.replace(/"/g, '""');
      const existing = await pb.collection("dealers").getList(1, 1, {
        filter: `name = "${safeName}"`,
      });

      if (existing.items.length === 0) {
        console.log(`Adding missing dealer: ${name}`);
        await pb.collection("dealers").create({
          name: name,
          logo: item.logo,
        });
      } else {
        console.log(`Verified: ${name} exists.`);
        // Optional: Update logo if changed?
        const record = existing.items[0];
        if (record.logo !== item.logo && item.logo) {
          console.log(`Updating logo for ${name}`);
          await pb.collection("dealers").update(record.id, {
            logo: item.logo,
          });
        }
      }
    }
    console.log("Sync complete.");
  } catch (err) {
    console.error("Sync failed:", err);
  }
}

sync();
