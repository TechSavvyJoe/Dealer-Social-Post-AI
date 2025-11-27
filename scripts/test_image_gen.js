import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function testImageGen() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

  const payload = {
    contents: [
      {
        parts: [{ text: "Generate a cool image of a futuristic car." }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  console.log("Sending payload:", JSON.stringify(payload, null, 2));

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

testImageGen();
