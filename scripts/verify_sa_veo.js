import { GoogleAuth } from "google-auth-library";
import fetch from "node-fetch";
import fs from "fs";

const PROJECT_ID = "gen-lang-client-0994987899";
const LOCATION = "us-central1";
const MODEL_ID = "imagen-3.0-generate-001"; // Using the model with 50 quota
const KEY_FILE = "./key.json";

async function testServiceAccount() {
  console.log(`--- Testing Service Account Access for ${MODEL_ID} ---`);

  try {
    const auth = new GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = accessToken.token;

    console.log("Got Access Token via Service Account");

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    const payload = {
      instances: [
        {
          prompt: "A cinematic drone shot of a futuristic city at sunset.",
        },
      ],
      parameters: {
        sampleCount: 1,
        videoLength: "5s",
        aspectRatio: "16:9",
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`Status: ${resp.status}`);

    if (resp.ok) {
      console.log("✅ Service Account Access Confirmed!");
      console.log("Response Preview:", text.substring(0, 200));
    } else {
      console.log("❌ Service Account Access Failed");
      console.log("Response:", text);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

testServiceAccount();
