// One explicit, bounded text-only test. No image/video generation, customer
// content, caller-chosen model, URL, fallback chain or automatic test retries.
const EXPECTED = "DS_CONNECTION_OK";
function connectionConfig() {
  return require(__hooks + "/connectionConfig.js");
}
function policies() {
  return require(__hooks + "/requestPolicies.js");
}
function requestFor(service, snapshot) {
  const prompt = "Reply with exactly DS_CONNECTION_OK and nothing else.";
  if (service === "gemini") {
    const policy = policies().geminiModelPolicySnapshot();
    const model = policy && policy.models && policy.models.textFast;
    if (!/^gemini-[a-z0-9.-]+$/.test(model))
      throw new Error("CONNECTION_MODEL_POLICY_INVALID");
    return {
      url:
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": snapshot.values.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 128,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
        safetySettings: policy.safetySettings,
      }),
      timeout: 15,
    };
  }
  if (service === "anthropic") {
    // Reuse the existing server-owned model policy. Narrow this test's output
    // budget after the builder pins the supported text model and API shape.
    const body = policies().buildAnthropicMessageRequest({
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    if (!body) throw new Error("CONNECTION_MODEL_POLICY_INVALID");
    body.max_tokens = 32;
    body.temperature = 0;
    return {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": snapshot.values.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      timeout: 15,
    };
  }
  if (service === "openai") {
    // A small supported text model proves credential access only. It does not
    // verify GPT Image access or the existing image fallback capability.
    return {
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + snapshot.values.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        temperature: 0,
      }),
      timeout: 15,
    };
  }
  throw new Error("CONNECTION_PROVIDER_INVALID");
}
function exactResponse(service, response) {
  if (
    !response ||
    response.statusCode !== 200 ||
    (typeof response.raw === "string" && response.raw.length > 32768)
  )
    return false;
  const body = response.json;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  let text = "";
  if (service === "gemini") {
    if (
      !Array.isArray(body.candidates) ||
      body.candidates.length !== 1 ||
      !body.candidates[0] ||
      body.candidates[0].finishReason !== "STOP"
    )
      return false;
    const content = body.candidates[0].content;
    if (
      !content ||
      !Array.isArray(content.parts) ||
      !content.parts.length ||
      content.parts.some(function (part) {
        return (
          !part ||
          typeof part.text !== "string" ||
          part.thought === true ||
          Object.keys(part).some(function (key) {
            return key !== "text";
          })
        );
      })
    )
      return false;
    text = content.parts
      .map(function (part) {
        return part.text;
      })
      .join("");
  } else if (service === "anthropic") {
    if (
      body.stop_reason !== "end_turn" ||
      !Array.isArray(body.content) ||
      !body.content.length ||
      body.content.some(function (part) {
        return (
          !part ||
          part.type !== "text" ||
          typeof part.text !== "string" ||
          Object.keys(part).some(function (key) {
            return key !== "type" && key !== "text";
          })
        );
      })
    )
      return false;
    text = body.content
      .map(function (part) {
        return part.text;
      })
      .join("");
  } else if (service === "openai") {
    if (
      !Array.isArray(body.choices) ||
      body.choices.length !== 1 ||
      !body.choices[0] ||
      body.choices[0].finish_reason !== "stop"
    )
      return false;
    const message = body.choices[0].message;
    if (
      !message ||
      typeof message.content !== "string" ||
      message.refusal ||
      message.tool_calls
    )
      return false;
    text = message.content;
  } else return false;
  return text.trim() === EXPECTED;
}
function runProviderTest(service, expectedRevision, actor, operation) {
  if (["gemini", "anthropic", "openai"].indexOf(service) < 0)
    throw new Error("CONNECTION_PROVIDER_INVALID");
  const config = connectionConfig();
  const ticket = config.reserveVerification(
    service,
    undefined,
    expectedRevision,
    actor,
    operation,
  );
  if (ticket.replay) return ticket.result;
  let proof = { ok: false, capabilities: [], code: "CONNECTION_TEST_FAILED" };
  let request;
  try {
    request = requestFor(service, ticket.snapshot);
  } catch (_e) {
    return config.finalizeVerification(ticket, {
      ok: false,
      capabilities: [],
      code: "CONNECTION_MODEL_POLICY_INVALID",
    });
  }
  try {
    const response = require(__hooks + "/safeHttp.js").send(request);
    if (exactResponse(service, response)) proof = { ok: true, capabilities: ["text"] };
    else if (response && (response.statusCode === 401 || response.statusCode === 403))
      proof.code = "CONNECTION_AUTH_FAILED";
    else if (response && response.statusCode === 429)
      proof.code = "CONNECTION_RATE_LIMITED";
    else proof.code = "CONNECTION_RESPONSE_INVALID";
  } catch (_e) {
    // Do not expose provider messages, request headers, body, or credentials.
    // A lost response remains unknown; the same operation is never repeated.
    // Keep the reserved ticket pending until its bounded lease expires.
    return config.getPublicConfig(service);
  }
  return config.finalizeVerification(ticket, proof);
}
module.exports = {
  runProviderTest: runProviderTest,
  requestFor: requestFor,
  exactResponse: exactResponse,
};
