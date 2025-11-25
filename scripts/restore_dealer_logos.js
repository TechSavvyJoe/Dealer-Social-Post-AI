import PocketBase from "pocketbase";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);

const dealersToRestore = [
  {
    code: "1111",
    name: "Golden Rule Car Co.",
    logoUrl: "https://i.imgur.com/C4Blr8x.png",
  },
  {
    code: "2222",
    name: "LaFontaine Ford",
    logoUrl: "https://i.imgur.com/R0ImRxY.png",
  },
  {
    code: "3333",
    name: "Bob Maxey Ford",
    logoUrl: "https://i.imgur.com/lkXX52C.jpeg",
  },
  {
    code: "4444",
    name: "Mission Ford of Dearborn",
    logoUrl: "https://i.imgur.com/QDpVYPT.png",
  },
];

async function restoreLogos() {
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

    if (!authResponse.ok) {
      throw new Error(`Auth failed: ${authResponse.status}`);
    }

    const authData = await authResponse.json();
    pb.authStore.save(authData.token, authData.admin);
    console.log("Authenticated.");

    for (const dealer of dealersToRestore) {
      console.log(`Processing ${dealer.name} (${dealer.code})...`);

      try {
        // 1. Find the dealer record
        const record = await pb
          .collection("dealers")
          .getFirstListItem(`code="${dealer.code}"`);
        console.log(`- Found record ID: ${record.id}`);

        // 2. Fetch the image from Imgur
        console.log(`- Fetching image from: ${dealer.logoUrl}`);
        const imgRes = await fetch(dealer.logoUrl);
        if (!imgRes.ok)
          throw new Error(`Failed to fetch image: ${imgRes.status}`);
        const imgBlob = await imgRes.blob();

        // 3. Prepare FormData
        const formData = new FormData();
        // Extract filename from URL
        const filename = dealer.logoUrl.split("/").pop();
        formData.append("logo", imgBlob, filename);

        // 4. Upload to PocketBase
        console.log(`- Uploading to PocketBase...`);
        const updateResponse = await fetch(
          `${PB_URL}/api/collections/dealers/records/${record.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: pb.authStore.token,
            },
            body: formData,
          }
        );

        if (!updateResponse.ok) {
          const err = await updateResponse.json();
          throw new Error(`Upload failed: ${JSON.stringify(err)}`);
        }

        console.log(`✅ Successfully restored logo for ${dealer.name}`);
      } catch (err) {
        console.error(`❌ Error processing ${dealer.name}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

restoreLogos();
