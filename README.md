<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1oUQItN2xAWstwviAV2sxEz_GXnXp2MId

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

### Configuring the Gemini API key

The app now provides two ways to connect your Gemini API key:

- **Environment variable (recommended for deployments):** create an `.env.local` file with `GEMINI_API_KEY=your-key` before starting the dev server.
- **In-app Settings:** from the login screen or the signed-in header, open **Settings → Gemini API Key** to paste a key directly in the UI. You can optionally store the key locally on the current device.

Leaving the field blank and saving will remove the current key, which is helpful when rotating credentials.

## Develop & Test

- Type-check the project: `npm run typecheck`
- Run component/unit tests: `npm run test`
