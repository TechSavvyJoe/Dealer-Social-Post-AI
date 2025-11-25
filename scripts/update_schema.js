import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error(
    "Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables."
  );
  process.exit(1);
}

const pb = new PocketBase(PB_URL);

async function updateSchema() {
  try {
    console.log(`Connecting to ${PB_URL}...`);
    await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
    console.log("Authenticated.");

    const collection = await pb.collections.getOne("dealers");
    console.log("Found 'dealers' collection.");

    // Check if logo_file already exists
    const hasLogoFile = collection.schema.some(
      (field) => field.name === "logo"
    );

    if (hasLogoFile) {
      console.log("'logo' field already exists.");
      return;
    }

    console.log("Adding 'logo' field...");

    // Add the new field
    collection.schema.push({
      name: "logo",
      type: "file",
      options: {
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: [
          "image/jpeg",
          "image/png",
          "image/svg+xml",
          "image/webp",
          "image/gif",
        ],
      },
    });

    await pb.collections.update(collection.id, collection);
    console.log("Schema updated successfully!");
  } catch (err) {
    console.error("Schema update failed:", err);
    // print detailed error if available
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

updateSchema();
