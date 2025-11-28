import fetch from "node-fetch";

const MODEL_ID = process.env.MODEL_ID || "veo-3.1-generate-preview";
const PROJECT_ID = "gen-lang-client-0994987899";
const LOCATION = "us-central1";
const PROXY_URL = `http://localhost:8090/api/proxy/vertex/v1beta1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

async function testProxy() {
  console.log("--- Testing Proxy Service Account Auth ---");
  console.log(`URL: ${PROXY_URL}`);

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

  try {
    const resp = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`Status: ${resp.status}`);

    if (resp.status === 429) {
      console.log("✅ Auth Successful! (Quota Exceeded is expected)");
      console.log("Response:", text);
    } else if (resp.ok) {
      console.log("✅ Auth Successful! (And request succeeded!)");
      console.log("Response:", text.substring(0, 200));
    } else {
      console.log("❌ Request Failed");
      console.log("Response:", text);
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

testProxy();
