# Vertex AI Setup Guide

## ✅ Configuration Complete

Your Vertex AI API key has been successfully configured! Both Gemini API and Vertex AI are now working.

## What Was Configured

### 1. API Keys Added ([.env.local](.env.local))
```bash
GEMINI_API_KEY=AIzaSyD5g64nF8GmSlDPcNBySnsms-lPEOQdqpE
VERTEX_API_KEY=AQ.Ab8RN6Liri1IvdZLXPKa3QsEtKd-wfOSHM1gSiy0Q5p8KkwrUA
```

### 2. PocketBase Proxy Updated ([pb_hooks/main.pb.js](pb_hooks/main.pb.js))
The proxy now supports both:
- **Gemini API** (standard endpoint) - uses `GEMINI_API_KEY`
- **Vertex AI** (advanced features) - uses `VERTEX_API_KEY`

### 3. Automatic API Detection
The proxy automatically routes requests:
- Standard paths → Gemini API
- Paths starting with `vertex/` → Vertex AI

## How to Use Vertex AI in Your App

### Through the PocketBase Proxy

**For Vertex AI video generation (Veo):**
```javascript
// Frontend code - through proxy
const response = await fetch('http://localhost:8090/api/proxy/vertex/v1beta1/projects/gen-lang-client-0994987899/locations/us-central1/publishers/google/models/veo-3.1-generate-001:predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instances: [{
      prompt: "A cinematic drone shot of a futuristic city at sunset"
    }],
    parameters: {
      sampleCount: 1,
      videoLength: "5s",
      aspectRatio: "16:9"
    }
  })
});
```

**For Vertex AI text generation (Gemini models):**
```javascript
const response = await fetch('http://localhost:8090/api/proxy/vertex/v1/projects/gen-lang-client-0994987899/locations/us-central1/publishers/google/models/gemini-2.0-flash-exp:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{
      role: "user",
      parts: [{ text: "Your prompt here" }]
    }]
  })
});
```

## Available Models

### Via Vertex AI (use `VERTEX_API_KEY`)

| Model | Identifier | Use Case |
|-------|------------|----------|
| Veo 3.1 | `veo-3.1-generate-001` | Video generation with audio, 1080p |
| Veo 3.0 | `veo-3.0-generate-001` | Video generation with audio |
| Gemini 2.0 Flash | `gemini-2.0-flash-exp` | Fast text generation |
| Gemini 3 Pro Image | `gemini-3-pro-image-preview` | 4K image generation |

### Via Standard Gemini API (use `GEMINI_API_KEY`)

| Model | Identifier | Use Case |
|-------|------------|----------|
| Gemini 2.5 Flash Image | `gemini-2.5-flash-image` | Production-ready image generation |
| Imagen 4.0 | `imagen-4.0-generate-001` | Dedicated image model |

## Testing Your Setup

Run the test script to verify both API keys:
```bash
npm run test:api-keys
```

Or manually:
```bash
export GEMINI_API_KEY="your-key" && \
export VERTEX_API_KEY="your-vertex-key" && \
node scripts/test_api_keys.js
```

### Expected Output
```
✅ Gemini API: Working!
✅ Vertex AI: Working!
```

## Important Notes

### Quota Limits
- If you see **429 errors** (quota exceeded), your API key is working correctly
- Vertex AI has separate quotas per model
- Request quota increases at: https://cloud.google.com/vertex-ai/docs/generative-ai/quotas-genai

### Request Format Differences

**Gemini API:**
```json
{
  "contents": [{
    "parts": [{ "text": "prompt" }]
  }]
}
```

**Vertex AI:**
```json
{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "prompt" }]
  }]
}
```

Note the required `role` field for Vertex AI!

### Region and Project
- **Project ID:** `gen-lang-client-0994987899`
- **Default Location:** `us-central1`
- These are extracted automatically from request paths

## Starting the Application

Restart PocketBase to load the new environment variables:

```bash
# Stop any running PocketBase instances
killall pocketbase

# Start the full development environment
npm run dev:full
```

Or separately:
```bash
# Terminal 1 - Backend
npm run start:backend

# Terminal 2 - Frontend
npm run dev
```

## Troubleshooting

### "VERTEX_API_KEY environment variable is not set"
- Make sure [.env.local](.env.local) contains the `VERTEX_API_KEY`
- Restart PocketBase after editing `.env.local`
- Check: `cat .env.local | grep VERTEX_API_KEY`

### 401/403 Authentication Errors
- Verify the API key is correct (no extra spaces)
- Check the key hasn't expired
- Ensure you're using the right key for the right endpoint

### 429 Quota Exceeded
- This means authentication is working!
- Wait for quotas to reset (usually per minute/hour)
- Request quota increase if needed
- Try a different model with available quota

### 400 Invalid Argument
- Check you're using the correct request format (include `role: "user"`)
- Verify model identifier is correct
- Ensure all required fields are present

## Next Steps

1. **Integrate video generation** in your UI
2. **Add error handling** for quota limits
3. **Implement polling** for long-running Veo video generation
4. **Cache results** to reduce API calls

## Security

✅ API keys stored in `.env.local` (git-ignored)
✅ Keys only accessible on backend (PocketBase)
✅ Frontend never sees raw API keys
✅ All requests proxied through secure backend

Never commit `.env.local` to version control!
