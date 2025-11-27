<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1oUQItN2xAWstwviAV2sxEz_GXnXp2MId

## Quick Start

**Prerequisites:** Node.js 18+

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Get your API keys:**
   - **Gemini API:** Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - **Vertex AI (optional):** For advanced features like Veo video generation

3. **Configure your API keys:**
   - Edit `.env.local` file in the project root
   - Set `GEMINI_API_KEY=your-actual-api-key`
   - (Optional) Set `VERTEX_API_KEY=your-vertex-api-key` for advanced features

4. **Start the app:**
   ```bash
   npm run dev:full
   ```
   This starts both the PocketBase backend (port 8090) and Vite frontend (port 5173).

5. **Open your browser:**
   - Frontend: http://localhost:5173
   - PocketBase Admin: http://localhost:8090/_/

📖 **For detailed setup instructions, see [SETUP.md](SETUP.md)**
🚀 **For Vertex AI setup and advanced features, see [VERTEX_AI_SETUP.md](VERTEX_AI_SETUP.md)**

## Troubleshooting

If you see an error like "Failed to generate image content" or "Something went wrong while processing your request":

1. Make sure your `GEMINI_API_KEY` is set in `.env.local`
2. Restart PocketBase completely
3. See [SETUP.md](SETUP.md) for detailed troubleshooting steps

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev:full` | Start both backend and frontend (recommended) |
| `npm run start:backend` | Start PocketBase backend only |
| `npm run dev` | Start Vite frontend only |
| `npm run build` | Build for production |
| `npm run test` | Run tests |

## Develop & Test

- Type-check the project: `npm run typecheck`
- Run component/unit tests: `npm run test`
