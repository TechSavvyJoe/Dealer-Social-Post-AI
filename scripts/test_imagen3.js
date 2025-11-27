import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testImagen3(modelName, version = "v1beta") {
  console.log(`\n--- Testing ${modelName} (${version}) ---`);
  const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${API_KEY}`;

  const payload1 = {
    contents: [{ parts: [{ text: "Generate a cute robot dog." }] }],
  };

  console.log("Trying Payload...");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload1),
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log("✅ Success!");
      console.log(JSON.stringify(data, null, 2)); // Log full response to see if image is there
    } else {
      console.log(`❌ Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.log("Network Error:", e.message);
  }
}

async function run() {
  // Only test the one that "worked" to see output
  await testImagen3("gemini-2.0-flash-exp", "v1beta");
}

run();
