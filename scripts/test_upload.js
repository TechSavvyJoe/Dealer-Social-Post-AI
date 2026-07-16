import PocketBase from "pocketbase";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { File } from "node:buffer";
import {
  authenticateAdmin,
  loadAdminConfig,
  requireEnv,
  requireMutationApproval,
} from "./lib/pocketbaseAdmin.js";

const config = loadAdminConfig();
requireMutationApproval(config.url);

const imagePath = requireEnv("PB_UPLOAD_IMAGE_PATH");
const dealerId = requireEnv("PB_UPLOAD_DEALER_ID");
if (!/^[a-z0-9]{15}$/i.test(dealerId)) {
  throw new Error("PB_UPLOAD_DEALER_ID must be a 15-character PocketBase id.");
}

const pb = new PocketBase(config.url);

async function testUpload() {
  await authenticateAdmin(pb, config);

  const imageBuffer = await readFile(imagePath);
  const extension = basename(imagePath).toLowerCase();
  const mimeType = extension.endsWith(".png")
    ? "image/png"
    : extension.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  const file = new File([imageBuffer], basename(imagePath), { type: mimeType });

  const dealer = await pb.collection("dealers").getOne(dealerId);
  const updated = await pb.collection("dealers").update(dealer.id, {
    logo: file,
  });

  if (!updated.logo) {
    throw new Error(
      "PocketBase accepted the update but returned no logo file.",
    );
  }

  const response = await fetch(pb.files.getUrl(updated, updated.logo));
  if (!response.ok) {
    throw new Error(`Uploaded logo verification failed (${response.status}).`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Uploaded logo did not return an image content type.");
  }

  console.log(`Logo upload verified for dealer ${dealer.id}.`);
}

testUpload().catch((error) => {
  console.error(
    "Logo upload check failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
