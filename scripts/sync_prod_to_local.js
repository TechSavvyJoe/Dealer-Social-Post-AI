import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import FormData from "form-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PROD_URL = "https://dealer-social-post-ai-production.fly.dev";
const LOCAL_URL = "http://127.0.0.1:8090";
const ADMIN_EMAIL = "joejgallant@gmail.com";
const ADMIN_PASS = "Babymia78$";

async function authenticate(url, email, password) {
  const resp = await fetch(`${url}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password: password }),
  });

  if (!resp.ok) {
    throw new Error(
      `Auth failed for ${url}: ${resp.status} ${resp.statusText}`
    );
  }

  const data = await resp.json();
  return data.token;
}

async function getDealers(url, token) {
  const resp = await fetch(
    `${url}/api/collections/dealers/records?perPage=100`,
    {
      headers: { Authorization: token },
    }
  );
  if (!resp.ok) throw new Error(`Failed to fetch dealers from ${url}`);
  const data = await resp.json();
  return data.items;
}

async function sync() {
  console.log("🚀 Starting Production -> Local Sync...");

  try {
    // 1. Authenticate
    console.log("🔑 Authenticating...");
    const prodToken = await authenticate(PROD_URL, ADMIN_EMAIL, ADMIN_PASS);
    const localToken = await authenticate(LOCAL_URL, ADMIN_EMAIL, ADMIN_PASS);
    console.log("✅ Authenticated with both environments");

    // 2. Fetch Production Dealers
    console.log("📥 Fetching dealers from Production...");
    const prodDealers = await getDealers(PROD_URL, prodToken);
    console.log(`✅ Found ${prodDealers.length} dealers in Production`);

    // 3. Fetch Local Dealers
    const localDealers = await getDealers(LOCAL_URL, localToken);

    // 4. Sync Process
    for (const prodDealer of prodDealers) {
      console.log(`\nProcessing: ${prodDealer.name} (${prodDealer.code})`);

      const existing = localDealers.find((d) => d.code === prodDealer.code);

      // Download logo if exists
      let logoPath = null;
      let logoBuffer = null;

      if (prodDealer.logo) {
        const logoUrl = `${PROD_URL}/api/files/${prodDealer.collectionId}/${prodDealer.id}/${prodDealer.logo}`;
        console.log(`   Downloading logo: ${logoUrl}`);
        try {
          const resp = await fetch(logoUrl);
          if (resp.ok) {
            logoBuffer = await resp.buffer();
            logoPath = path.join(__dirname, `temp_${prodDealer.logo}`);
            fs.writeFileSync(logoPath, logoBuffer);
          }
        } catch (e) {
          console.error(`   ❌ Failed to download logo: ${e.message}`);
        }
      }

      const formData = new FormData();
      formData.append("name", prodDealer.name);
      formData.append("code", prodDealer.code);
      if (logoPath) {
        formData.append("logo", fs.createReadStream(logoPath));
      }

      try {
        let url, method;
        if (existing) {
          console.log(`   Updating existing local record...`);
          url = `${LOCAL_URL}/api/collections/dealers/records/${existing.id}`;
          method = "PATCH";
        } else {
          console.log(`   Creating new local record...`);
          url = `${LOCAL_URL}/api/collections/dealers/records`;
          method = "POST";
        }

        const updateResp = await fetch(url, {
          method: method,
          headers: {
            Authorization: localToken,
            ...formData.getHeaders(),
          },
          body: formData,
        });

        if (!updateResp.ok) {
          const err = await updateResp.text();
          throw new Error(`Failed to update: ${err}`);
        }
        console.log(`   ✅ Synced`);
      } catch (e) {
        console.error(`   ❌ Sync failed: ${e.message}`);
      }

      // Cleanup
      if (logoPath && fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }
    }

    console.log(
      "\n✨ Sync Complete! Please refresh your local admin dashboard."
    );
  } catch (e) {
    console.error("\n❌ Fatal Error:", e);
  }
}

sync();
