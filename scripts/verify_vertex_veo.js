import fetch from "node-fetch";

const API_KEY = process.env.VERTEX_API_KEY;
const PROJECT_ID = "gen-lang-client-0994987899";
const LOCATION = "us-central1";
const MODEL_ID = "veo-2.0-generate-001";

if (!API_KEY) {
  console.error("Error: VERTEX_API_KEY is not set.");
  console.error("Please set VERTEX_API_KEY in your .env.local file");
  process.exit(1);
}

async function testVertexVeo() {
  // Vertex AI Endpoint for Prediction
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict?key=${API_KEY}`;

  console.log(`\n--- Testing Vertex AI: ${MODEL_ID} ---`);
  console.log(`URL: ${url.replace(API_KEY, "HIDDEN")}`);

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
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`Status: ${resp.status}`);
    console.log("Response:", text);

    if (resp.ok) {
      console.log("✅ Vertex AI Access Confirmed!");
    } else {
      console.log("❌ Vertex AI Access Failed");
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

testVertexVeo();
