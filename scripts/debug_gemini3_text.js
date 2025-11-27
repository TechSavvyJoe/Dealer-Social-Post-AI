import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testTextGen(model, config = {}) {
  console.log(
    `\n--- Testing ${model} with config: ${JSON.stringify(config)} ---`
  );
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: "Write a short poem about coding." }] }],
    generationConfig: config,
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (resp.ok) {
      console.log("✅ Success!");
      console.log(
        data.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 50) +
          "..."
      );
    } else {
      console.log(`❌ Error ${resp.status}:`);
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

async function run() {
  // 1. Standard (Current implementation)
  await testTextGen("gemini-3-pro-preview", {});

  // 2. With responseModalities: ["TEXT"]
  await testTextGen("gemini-3-pro-preview", {
    responseModalities: ["TEXT"],
  });

  // 3. With responseModalities: ["TEXT", "IMAGE"] (Just in case)
  await testTextGen("gemini-3-pro-preview", {
    responseModalities: ["TEXT", "IMAGE"],
  });
}

run();
