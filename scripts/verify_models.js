import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const models = [
  "veo-3.1-generate-001",
  "veo-3.1-generate-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
];

async function testModel(model) {
  // Try v1beta as that's where we found things before
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  // Payload with TEXT and IMAGE modalities as per guide
  const payload = {
    contents: [{ parts: [{ text: "Generate a drawing of a cat." }] }],
    generationConfig: {
      // Note: REST API usually uses generationConfig, SDK might map 'config' to this
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  console.log(`\n--- Testing ${model} (v1beta) ---`);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log("✅ Success!");
    } else {
      console.log(`❌ Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.log("Network Error:", e.message);
  }
}

async function run() {
  console.log("Testing Model Availability...");
  for (const model of models) {
    await testModel(model);
  }
}

run();
