#!/usr/bin/env node

/**
 * Opt-in provider diagnostic. This performs one small paid Gemini request
 * without printing credential material. Node 22's built-in fetch keeps the
 * script aligned with the production runtime.
 */

const GEMINI_MODEL =
  process.env.GEMINI_SMOKE_MODEL?.trim() || "gemini-3.6-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();

const testGemini = async () => {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(GEMINI_MODEL)) {
    throw new Error("GEMINI_SMOKE_MODEL is invalid.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with exactly OK." }] }],
      generationConfig: { maxOutputTokens: 64 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = payload?.error?.message;
    throw new Error(
      `Gemini ${GEMINI_MODEL} returned ${response.status}${
        providerMessage ? `: ${String(providerMessage).slice(0, 300)}` : ""
      }`,
    );
  }

  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (!text) {
    throw new Error(`Gemini ${GEMINI_MODEL} returned no text.`);
  }

  console.log(`Gemini ${GEMINI_MODEL} responded successfully.`);
};

try {
  await testGemini();
  console.log("Provider diagnostic passed.");
} catch (error) {
  console.error(
    "Provider diagnostic failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
