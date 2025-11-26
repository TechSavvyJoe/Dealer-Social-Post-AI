const apiKey = process.env.GEMINI_API_KEY; // This won't work in client-side script, but I'll run this via pb_hooks or just use curl with the key if I had it.
// Wait, I don't have the key. It's on the server.
// I must use the proxy.

async function checkModels(version) {
  try {
    const response = await fetch(
      `https://dealer-social-post-ai-production.fly.dev/api/proxy/${version}/models`,
      {
        method: "GET",
      }
    );
    const text = await response.text();
    console.log(`--- ${version} MODELS ---`);
    console.log(text);
  } catch (e) {
    console.error(`Error fetching ${version}:`, e);
  }
}

checkModels("v1alpha");
checkModels("v1beta");
