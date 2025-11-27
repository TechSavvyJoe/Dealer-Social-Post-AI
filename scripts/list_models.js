import fetch from "node-fetch";
import fs from "fs";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function listModels(version) {
  const url = `https://generativelanguage.googleapis.com/${version}/models?key=${API_KEY}`;
  console.log(`\n--- Listing Models (${version}) ---`);
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (resp.ok) {
      if (data.models) {
        data.models.forEach((m) => {
          console.log(
            `- ${m.name} [${m.supportedGenerationMethods?.join(", ")}]`
          );
        });
      } else {
        console.log("No models found.");
      }
    } else {
      console.log(`Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

async function run() {
  await listModels("v1beta");
  await listModels("v1alpha");
}

run();
