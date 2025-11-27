import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testImageGen(model, version = "v1beta") {
  console.log(`\n--- Testing ${model} (${version}) ---`);
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${API_KEY}`;

  // Try with responseModalities first, as that's how we ask for images usually
  const payload = {
    contents: [{ parts: [{ text: "Generate a drawing of a cat." }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  console.log("Payload with responseModalities: ['IMAGE']");

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (resp.ok) {
      console.log("✅ Success (200 OK)");
      const part = data.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData) {
        console.log("🎉 IMAGE RECEIVED! (inlineData present)");
      } else if (part?.text) {
        console.log(
          "⚠️ Text received instead of image:",
          part.text.substring(0, 50) + "..."
        );
      } else {
        console.log("⚠️ Unknown content received:", JSON.stringify(part));
      }
    } else {
      console.log(`❌ Error ${resp.status}: ${data.error?.message}`);
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

async function run() {
  await testImageGen("gemini-2.5-flash-preview-image", "v1beta");
  await testImageGen("gemini-3-pro-image", "v1beta");
  // Try v1alpha too
  await testImageGen("gemini-2.5-flash-preview-image", "v1alpha");
  await testImageGen("gemini-3-pro-image", "v1alpha");
}

run();
