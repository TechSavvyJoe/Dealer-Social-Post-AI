import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
const MODELS_TO_TEST = [
  "veo-3.1-generate-preview",
  "veo-2.0-generate-001",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
];

if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testModel(model) {
  // Gemini API Endpoint (Generative Language API)
  // Note: Video generation might use a different method than generateContent?
  // But usually it's models/{model}:predict or :generateContent
  // For Veo on Gemini API, it might not be supported yet, but let's try.

  const url = `https://generativelanguage.googleapis.com/v1alpha/models/${model}:predict?key=${API_KEY}`;

  console.log(`\n--- Testing Gemini API: ${model} ---`);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`Status: ${resp.status}`);

    if (resp.ok) {
      console.log("✅ Access Confirmed!");
      console.log("Response:", text.substring(0, 200) + "...");
      return true;
    } else {
      console.log("❌ Access Failed");
      console.log("Response:", text);
      return false;
    }
  } catch (e) {
    console.error("Network error:", e);
    return false;
  }
}

async function run() {
  for (const model of MODELS_TO_TEST) {
    await testModel(model);
  }
}

run();
