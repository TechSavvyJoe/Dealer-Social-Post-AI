import fetch from "node-fetch";

async function testProxy() {
  const url =
    "http://localhost:8090/api/proxy/v1beta/models/gemini-3-pro-preview:generateContent";

  const payload = {
    contents: [{ parts: [{ text: "Write a short poem about coding." }] }],
    // No generationConfig for text model, as per current geminiService.ts
  };

  console.log(`\n--- Testing Local Proxy: ${url} ---`);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`Status: ${resp.status}`);
    console.log("Response Body:", text);

    if (resp.ok) {
      console.log("✅ Proxy Success!");
    } else {
      console.log("❌ Proxy Failed!");
    }
  } catch (e) {
    console.error("Network error:", e);
  }
}

testProxy();
