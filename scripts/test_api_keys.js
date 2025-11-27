#!/usr/bin/env node
import fetch from "node-fetch";

console.log("\n🔍 Testing API Key Configuration\n");

// Load from .env.local if running directly
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERTEX_API_KEY = process.env.VERTEX_API_KEY;

console.log("Environment Variables:");
console.log(`✓ GEMINI_API_KEY: ${GEMINI_API_KEY ? "Set (" + GEMINI_API_KEY.substring(0, 10) + "...)" : "❌ NOT SET"}`);
console.log(`✓ VERTEX_API_KEY: ${VERTEX_API_KEY ? "Set (" + VERTEX_API_KEY.substring(0, 10) + "...)" : "❌ NOT SET"}`);
console.log();

// Test Gemini API
async function testGeminiAPI() {
  if (!GEMINI_API_KEY) {
    console.log("⏭️  Skipping Gemini API test (no key configured)");
    return;
  }

  console.log("Testing Gemini API...");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say 'API works!' in exactly those words" }] }],
      }),
    });

    const data = await resp.json();

    if (resp.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log("✅ Gemini API: Working!");
      console.log(`   Response: ${data.candidates[0].content.parts[0].text.trim()}`);
    } else {
      console.log(`⚠️  Gemini API: Status ${resp.status}`);
      console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
  } catch (err) {
    console.log("❌ Gemini API: Error -", err.message);
  }
  console.log();
}

// Test Vertex AI
async function testVertexAI() {
  if (!VERTEX_API_KEY) {
    console.log("⏭️  Skipping Vertex AI test (no key configured)");
    return;
  }

  console.log("Testing Vertex AI...");
  const PROJECT_ID = "gen-lang-client-0994987899";
  const LOCATION = "us-central1";

  // Try with Gemini model first (lower quota requirements)
  const MODEL = "gemini-2.0-flash-exp";
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent?key=${VERTEX_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: "Say 'Vertex works!' in exactly those words" }]
        }],
      }),
    });

    const data = await resp.json();

    if (resp.ok) {
      console.log("✅ Vertex AI: Working!");
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.log(`   Response: ${data.candidates[0].content.parts[0].text.trim()}`);
      }
    } else if (resp.status === 429) {
      console.log("⚠️  Vertex AI: Quota exceeded (but authentication works!)");
      console.log("   Your API key is valid, but you've hit quota limits");
    } else if (resp.status === 401 || resp.status === 403) {
      console.log("❌ Vertex AI: Authentication failed");
      console.log(`   ${JSON.stringify(data, null, 2)}`);
    } else {
      console.log(`⚠️  Vertex AI: Status ${resp.status}`);
      console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
  } catch (err) {
    console.log("❌ Vertex AI: Error -", err.message);
  }
  console.log();
}

async function runTests() {
  await testGeminiAPI();
  await testVertexAI();

  console.log("Test complete!\n");
  console.log("📝 Note: If you see quota errors, your API key is working correctly.");
  console.log("   You just need to wait for quotas to reset or request an increase.\n");
}

runTests();
