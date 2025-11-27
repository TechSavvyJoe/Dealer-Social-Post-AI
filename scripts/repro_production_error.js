import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testModel(model, version, payload) {
  console.log(`\n--- Testing ${model} (${version}) ---`);
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${API_KEY}`;

  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (resp.ok) {
      console.log("✅ Success!");
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`❌ Error ${resp.status}:`);
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

async function run() {
  // Test Imagen 4.0 (Image Generation)
  await testModel("imagen-4.0-generate", "v1beta", {
    contents: [{ parts: [{ text: "Generate a futuristic car." }] }],
  });

  // Test Gemini 3 Pro (Text Generation)
  await testModel("gemini-3-pro", "v1beta", {
    contents: [
      { parts: [{ text: "Write a social media post about this car." }] },
    ],
  });

  // Test with v1alpha as fallback
  await testModel("imagen-4.0-generate", "v1alpha", {
    contents: [{ parts: [{ text: "Generate a futuristic car." }] }],
  });

  await testModel("gemini-3-pro", "v1alpha", {
    contents: [
      { parts: [{ text: "Write a social media post about this car." }] },
    ],
  });
}

run();
