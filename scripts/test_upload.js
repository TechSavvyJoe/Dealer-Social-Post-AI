import PocketBase from "pocketbase";
import fs from "fs/promises";
import { Blob } from "buffer";

const PB_URL = "https://dealer-social-post-ai-production.fly.dev";
const pb = new PocketBase(PB_URL);
const IMAGE_PATH =
  "/Users/missionford/.gemini/antigravity/brain/7b1ba4f2-5dec-4b66-b6b4-69da25370f32/uploaded_image_1764081605984.png";

async function testUpload() {
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

    console.log("Reading image file...");
    const imageBuffer = await fs.readFile(IMAGE_PATH);
    const file = new File([imageBuffer], "test_logo.png", {
      type: "image/png",
    });

    console.log("Finding 'Admin Control' dealer...");
    const dealer = await pb
      .collection("dealers")
      .getFirstListItem('code="0000"');
    console.log(`Found dealer: ${dealer.id}`);

    console.log("Uploading logo...");
    // Using SDK for update since we have the token in store now
    // SDK handles FormData internally if we pass a plain object with File
    // But since we are in Node, let's use raw fetch to be safe and consistent with previous scripts

    const formData = new FormData();
    formData.append("logo", file);

    const updateResponse = await fetch(
      `${PB_URL}/api/collections/dealers/records/${dealer.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: pb.authStore.token,
          // Content-Type is set automatically by fetch for FormData
        },
        body: formData,
      }
    );

    if (!updateResponse.ok) {
      const err = await updateResponse.json();
      console.error("Update failed:", JSON.stringify(err, null, 2));
      throw new Error(`Update failed: ${updateResponse.status}`);
    }

    const updatedRecord = await updateResponse.json();
    console.log(`✅ Upload success! Logo filename: ${updatedRecord.logo}`);

    const fileUrl = `${PB_URL}/api/files/dealers/${updatedRecord.id}/${updatedRecord.logo}`;
    console.log(`Verifying file access at: ${fileUrl}`);

    const fileCheck = await fetch(fileUrl);
    if (fileCheck.ok) {
      console.log("✅ File is accessible (HTTP 200)");
    } else {
      console.error(`❌ File access failed: ${fileCheck.status}`);
    }
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

testUpload();
