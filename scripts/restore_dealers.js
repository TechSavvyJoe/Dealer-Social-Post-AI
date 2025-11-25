import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const pb = new PocketBase(PB_URL);

const dealersToRestore = [
  { name: "Admin Control", code: "0000" },
  { name: "Golden Rule Car Co.", code: "1111" },
  { name: "LaFontaine Ford", code: "2222" },
  { name: "Bob Maxey Ford", code: "3333" },
  { name: "Mission Ford of Dearborn", code: "4444" },
];

async function restoreDealers() {
  try {
    console.log("Authenticating as admin...");
    // Bypass SDK auth due to version mismatch issues
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
      throw new Error(
        `Auth failed: ${authResponse.status} ${authResponse.statusText}`
      );
    }

    const authData = await authResponse.json();
    pb.authStore.save(authData.token, authData.admin);
    console.log("Authenticated.");

    console.log("Authenticated.");

    try {
      await pb.collections.getOne("dealers");
      console.log("✅ 'dealers' collection exists.");
    } catch (err) {
      if (err.status === 404) {
        console.log("⚠️ 'dealers' collection missing. Creating...");
        const createResponse = await fetch(`${PB_URL}/api/collections`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: pb.authStore.token,
          },
          body: JSON.stringify({
            name: "dealers",
            type: "base",
            schema: [
              { name: "name", type: "text", required: true },
              { name: "code", type: "text", required: true },
              {
                name: "logo",
                type: "file",
                required: false,
                options: { maxSelect: 1, maxSize: 5242880 },
              },
            ],
            listRule: "",
            viewRule: "",
          }),
        });

        if (!createResponse.ok) {
          const errData = await createResponse.json();
          console.error(
            "Create failed details:",
            JSON.stringify(errData, null, 2)
          );
          throw new Error(`Create failed: ${createResponse.status}`);
        }
        console.log("✅ Created 'dealers' collection.");
      } else {
        throw err;
      }
    }

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
