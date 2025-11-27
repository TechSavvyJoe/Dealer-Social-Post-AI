# Google Gemini Image & Veo Video Generation: Complete SDK Implementation Guide

The @google/genai SDK uses **two distinct methods** for image generation and a dedicated **async method** for video generation. Most implementation failures stem from three issues: using the deprecated SDK package, omitting the critical `responseModalities` configuration, or using region-restricted model identifiers. Here's exactly how to implement both correctly.

## The critical configuration most developers miss

For Gemini image models, you **must** set `responseModalities: ['TEXT', 'IMAGE']` in the config object—without this, the model will refuse to generate images and return only text. This requirement isn't clearly communicated in error messages, causing silent failures even when API access works in AI Studio.

```typescript
// THIS WILL FAIL - missing responseModalities
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: "Generate a cat in a spacesuit",
});

// THIS WORKS - responseModalities included
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: "Generate a cat in a spacesuit",
  config: {
    responseModalities: ["TEXT", "IMAGE"],  // REQUIRED
  },
});
```

## Correct SDK package and initialization

The `@google/generative-ai` package is **deprecated** (end-of-life August 31, 2025). Use `@google/genai` instead:

```bash
npm install @google/genai
```

```typescript
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";

// Initialize with API key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// OR use environment variable (auto-detected)
const ai = new GoogleGenAI({});  // Uses GEMINI_API_KEY or GOOGLE_API_KEY env var
```

## Image generation with Gemini models

Gemini's native image generation uses `ai.models.generateContent()` with specific configuration. The latest recommended model is **gemini-2.5-flash-image**.

### Complete working example (text-to-image)

```typescript
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";

async function generateImage() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: "Create a photorealistic image of a golden retriever playing in autumn leaves",
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  // Process response - images returned as base64 in inlineData
  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      console.log("Description:", part.text);
    } else if (part.inlineData) {
      const buffer = Buffer.from(part.inlineData.data, "base64");
      fs.writeFileSync("generated-image.png", buffer);
      console.log("Image saved to generated-image.png");
    }
  }
}

generateImage();
```

### Advanced configuration with Gemini 3 Pro

The `gemini-3-pro-image-preview` model supports **4K resolution**, aspect ratios, and thinking mode:

```typescript
const response = await ai.models.generateContent({
  model: "gemini-3-pro-image-preview",
  contents: "Da Vinci style anatomical sketch of a butterfly",
  config: {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: {
      aspectRatio: "16:9",  // Options: "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"
      imageSize: "2K",      // Options: "1K", "2K", "4K" (4K only on Gemini 3 Pro)
    },
  },
});
```

### Image editing (text + reference image input)

```typescript
async function editImage() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Read and encode source image
  const imageData = fs.readFileSync("./source-image.png");
  const base64Image = imageData.toString("base64");
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [
      { text: "Add a small wizard hat on this cat's head" },
      {
        inlineData: {
          mimeType: "image/png",
          data: base64Image,  // NO "data:image/png;base64," prefix
        },
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  // Extract edited image from response
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      const buffer = Buffer.from(part.inlineData.data, "base64");
      fs.writeFileSync("edited-image.png", buffer);
    }
  }
}
```

## Image generation with Imagen models

For Imagen (Google's dedicated image model), use the separate `ai.models.generateImages()` method:

```typescript
async function generateWithImagen() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",  // or "imagen-3.0-generate-002"
    prompt: "Robot holding a red skateboard in cyberpunk city",
    config: {
      numberOfImages: 4,         // 1-4 images per request
      aspectRatio: "16:9",       // "1:1", "3:4", "4:3", "9:16", "16:9"
      imageSize: "1K",           // "1K" or "2K"
      personGeneration: "allow_adult",  // "dont_allow", "allow_adult", "allow_all"
    },
  });

  // Save all generated images
  let idx = 1;
  for (const generatedImage of response.generatedImages) {
    const buffer = Buffer.from(generatedImage.image.imageBytes, "base64");
    fs.writeFileSync(`imagen-output-${idx}.png`, buffer);
    idx++;
  }
}
```

## Video generation with Veo models

Video generation requires the `ai.models.generateVideos()` method and **mandatory polling** for completion:

```typescript
import { GoogleGenAI } from "@google/genai";

async function generateVideo() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Start video generation (returns immediately with operation object)
  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",  // Latest with audio
    prompt: `A close up of two explorers discovering ancient ruins. 
             The woman whispers excitedly, "This is incredible!"`,
    config: {
      aspectRatio: "16:9",     // "16:9" or "9:16"
      resolution: "1080p",     // "720p" or "1080p" (Veo 3+ only)
      durationSeconds: 8,      // Veo 3.x: 4, 6, 8 | Veo 2: 5, 6, 8
      negativePrompt: "cartoon, low quality, blurry",
    },
  });

  // REQUIRED: Poll until generation completes (11 sec - 6 min)
  while (!operation.done) {
    console.log("Generating video... waiting 10 seconds");
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({
      operation: operation,
    });
  }

  // Download the generated video
  const video = operation.response.generatedVideos[0].video;
  await ai.files.download({
    file: video,
    downloadPath: "output-video.mp4",
  });
  
  console.log("Video saved to output-video.mp4");
}

generateVideo();
```

### Image-to-video generation

```typescript
async function imageToVideo() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const imageData = fs.readFileSync("./starting-frame.png");
  const base64Image = imageData.toString("base64");
  
  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt: "Slow zoom out revealing the full landscape",
    image: {
      imageBytes: base64Image,
      mimeType: "image/png",
    },
  });

  // Poll and download as shown above
}
```

## Model identifiers reference

| Model Type | Model Identifier | Method | Notes |
|------------|------------------|--------|-------|
| Gemini Image | `gemini-2.5-flash-image` | `generateContent()` | **Recommended**, production-ready |
| Gemini Image | `gemini-3-pro-image-preview` | `generateContent()` | Highest quality, 4K support |
| Imagen | `imagen-4.0-generate-001` | `generateImages()` | Latest Imagen, up to 4 images |
| Imagen | `imagen-3.0-generate-002` | `generateImages()` | Stable, good quality |
| Veo Video | `veo-3.1-generate-preview` | `generateVideos()` | Native audio, 1080p, reference images |
| Veo Video | `veo-3.0-generate-preview` | `generateVideos()` | Native audio support |
| Veo Video | `veo-2.0-generate-001` | `generateVideos()` | GA, no audio, 720p only |

## Known issues and troubleshooting

**Geographic restrictions cause 404 errors.** Models like `gemini-2.0-flash-exp-image-generation` are unavailable in Europe, Middle East, and Africa. Use `gemini-2.5-flash-image` instead, or deploy from a supported region.

**RAI filtering returns empty responses.** Safety filters may block content without throwing errors. Check for `raiFilteredReason`:

```typescript
if (response.generatedImages?.[0]?.raiFilteredReason) {
  console.error("Blocked:", response.generatedImages[0].raiFilteredReason);
}
```

**Cannot request IMAGE modality alone.** Setting `responseModalities: ["IMAGE"]` causes errors—always include both `["TEXT", "IMAGE"]`.

**External URLs aren't supported.** The API doesn't accept HTTP/HTTPS URLs directly. Convert images to base64 or use the File API upload.

**Video generation has 2-day retention.** Generated videos are stored on Google's servers for only 2 days—download immediately.

## SDK version and deprecation notes

The current SDK version is **1.30.0** (as of November 2025). The old `@google/generative-ai` package reaches end-of-life on August 31, 2025. Key migration differences:

```typescript
// OLD SDK (deprecated)
import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// NEW SDK (recommended)
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey });
await ai.models.generateContent({ model: "gemini-2.5-flash-image", ... });
```

## Conclusion

Successful implementation requires three key elements: using `@google/genai` (not the deprecated package), including `responseModalities: ["TEXT", "IMAGE"]` for Gemini image generation, and implementing the async polling pattern for Veo video generation. The SDK exposes distinct methods—`generateContent()` for Gemini models, `generateImages()` for Imagen, and `generateVideos()` for Veo—each with different parameter structures and response formats. Model identifier strings that work in AI Studio should work identically in the SDK, provided geographic restrictions don't apply.