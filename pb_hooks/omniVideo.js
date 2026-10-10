// Pure PocketBase 0.22-compatible adapter. Provider records never leave this module.
const MODEL = "gemini-omni-1.1-flash";
const MAX_RAW_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedRaw(raw) {
  try {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof text !== "string" || text.length > MAX_RAW_BYTES) return null;
    // Count UTF-8 without Node globals unavailable in PocketBase's JSVM.
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        bytes += 4;
        i++;
      } else bytes += 3;
      if (bytes > MAX_RAW_BYTES) return null;
    }
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function providerInteractionId(raw) {
  const value = boundedRaw(raw);
  const id = value && value.id;
  // Application bounds, not an asserted Google identifier format.
  return typeof id === "string" &&
    id.length > 0 &&
    id.length <= 2048 &&
    id.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(id)
    ? id
    : null;
}

function isOmniOperationName(name) {
  return typeof name === "string" && /^operations\/omni-[A-Za-z0-9]{32}$/.test(name);
}

function buildOmniVideoRequest(body) {
  if (
    !isObject(body) ||
    !Array.isArray(body.instances) ||
    body.instances.length !== 1 ||
    !isObject(body.parameters)
  )
    return null;
  const instance = body.instances[0];
  const parameters = body.parameters;
  if (
    !isObject(instance) ||
    !isObject(instance.image) ||
    typeof instance.prompt !== "string" ||
    !instance.prompt.trim() ||
    typeof instance.image.bytesBase64Encoded !== "string" ||
    !instance.image.bytesBase64Encoded ||
    ["image/jpeg", "image/png", "image/webp"].indexOf(instance.image.mimeType) === -1 ||
    ["16:9", "9:16"].indexOf(parameters.aspectRatio) === -1 ||
    [4, 6, 8].indexOf(parameters.durationSeconds) === -1 ||
    ["720p", "1080p"].indexOf(parameters.resolution) === -1
  )
    return null;
  let prompt = instance.prompt;
  if (parameters.negativePrompt !== undefined) {
    if (
      typeof parameters.negativePrompt !== "string" ||
      !parameters.negativePrompt.trim()
    )
      return null;
    prompt += "\nAvoid the following: " + parameters.negativePrompt;
  }
  return {
    model: MODEL,
    background: true,
    store: true,
    stream: false,
    input: [
      {
        type: "image",
        data: instance.image.bytesBase64Encoded,
        mime_type: instance.image.mimeType,
      },
      { type: "text", text: prompt },
    ],
    response_format: {
      type: "video",
      aspect_ratio: parameters.aspectRatio,
      duration: parameters.durationSeconds + "s",
      resolution: parameters.resolution,
      delivery: "inline",
    },
    generation_config: { video_config: { task: "image_to_video" } },
  };
}

function byteAt(data, index) {
  const offset = Math.floor(index / 3) * 4;
  const a = BASE64.indexOf(data.charAt(offset));
  const b = BASE64.indexOf(data.charAt(offset + 1));
  const c = BASE64.indexOf(data.charAt(offset + 2));
  const d = BASE64.indexOf(data.charAt(offset + 3));
  if (index % 3 === 0) return (a << 2) | (b >> 4);
  if (index % 3 === 1) return ((b & 15) << 4) | (c >> 2);
  return ((c & 3) << 6) | d;
}

function validMp4(data) {
  if (
    typeof data !== "string" ||
    !data ||
    data.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    return false;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length / 4) * 3 - padding;
  if (bytes < 24 || bytes > MAX_VIDEO_BYTES) return false;
  // Reject noncanonical padding bits instead of accepting alternate encodings.
  if (
    (padding === 2 && (BASE64.indexOf(data.charAt(data.length - 3)) & 15) !== 0) ||
    (padding === 1 && (BASE64.indexOf(data.charAt(data.length - 2)) & 3) !== 0)
  )
    return false;
  const size =
    byteAt(data, 0) * 16777216 +
    byteAt(data, 1) * 65536 +
    byteAt(data, 2) * 256 +
    byteAt(data, 3);
  return (
    size >= 16 &&
    size <= bytes &&
    size % 4 === 0 &&
    byteAt(data, 4) === 102 &&
    byteAt(data, 5) === 116 &&
    byteAt(data, 6) === 121 &&
    byteAt(data, 7) === 112
  );
}

function safeFailure(name) {
  return {
    name: name,
    done: true,
    error: {
      code: 13,
      status: "INTERNAL",
      message: "Video generation did not produce a usable video. Please try again.",
    },
  };
}

function projectOmniVideoResponse(raw, publicOperationName) {
  if (!isOmniOperationName(publicOperationName)) return null;
  const value = boundedRaw(raw);
  if (!value) return safeFailure(publicOperationName);
  if (value.status === "queued" || value.status === "in_progress")
    return { name: publicOperationName, done: false };
  if (value.status !== "completed" || !Array.isArray(value.steps))
    return safeFailure(publicOperationName);
  const videos = [];
  for (let i = 0; i < value.steps.length; i++) {
    const step = value.steps[i];
    if (!isObject(step) || step.type !== "model_output") continue;
    if (!Array.isArray(step.content)) return safeFailure(publicOperationName);
    for (let j = 0; j < step.content.length; j++) {
      const content = step.content[j];
      if (isObject(content) && content.type === "video") videos.push(content);
    }
  }
  if (
    videos.length !== 1 ||
    videos[0].mime_type !== "video/mp4" ||
    !validMp4(videos[0].data)
  )
    return safeFailure(publicOperationName);
  return {
    name: publicOperationName,
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [
          { video: { encodedVideo: videos[0].data, encoding: "video/mp4" } },
        ],
      },
    },
  };
}

module.exports = {
  MODEL,
  buildOmniVideoRequest,
  providerInteractionId,
  isOmniOperationName,
  projectOmniVideoResponse,
};
