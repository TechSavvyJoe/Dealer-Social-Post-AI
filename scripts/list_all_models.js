import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (resp.ok) {
      console.log("✅ Available Models (v1beta):");
      data.models.forEach((m) => {
        console.log(`- ${m.name} (${m.supportedGenerationMethods.join(", ")})`);
      });
    } else {
      console.log(`❌ Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.log("Network Error:", e.message);
  }
}

listModels();
