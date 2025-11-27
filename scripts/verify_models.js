import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const models = [
  "gemini-2.0-flash-exp",
  "gemini-3-pro-preview",
  "gemini-3-pro-image-preview",
  "veo-2.0-generate-preview",
  "veo-2.0-generate-001",
];

async function testModel(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${API_KEY}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (resp.ok) {
      console.log(`✅ ${model}: AVAILABLE`);
      // console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(
        `❌ ${model}: ${resp.status} - ${
          data.error?.message || resp.statusText
        }`
      );
    }
  } catch (e) {
    console.log(`❌ ${model}: Network Error - ${e.message}`);
  }
}

async function run() {
  console.log("Testing Model Availability...");
  for (const model of models) {
    await testModel(model);
  }
}

run();
