import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testVideoGen(model, version, method) {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:${method}?key=${API_KEY}`;
  console.log(`\n--- Testing ${version}/${model}:${method} ---`);

  const payload = {
    prompt: "A cat jumping over a fence",
    config: {
      numberOfVideos: 1,
      resolution: "720p",
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
    console.log("Raw Response:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("Response is not JSON");
    }

    if (resp.ok) {
      console.log("✅ Success!");
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`❌ Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

async function run() {
  // Test Veo 3.0 (Standard)
  await testVideoGen("veo-3.0-generate-001", "v1beta", "generateVideos");
  await testVideoGen("veo-3.0-generate-001", "v1alpha", "generateVideos");

  // Test Veo 3.0 (Fast)
  await testVideoGen("veo-3.0-fast-generate-001", "v1beta", "generateVideos");
  await testVideoGen("veo-3.0-fast-generate-001", "v1alpha", "generateVideos");

  // Test Veo 3.0 (Preview naming?)
  await testVideoGen("veo-3.0-generate-preview", "v1beta", "generateVideos");
}

run();
