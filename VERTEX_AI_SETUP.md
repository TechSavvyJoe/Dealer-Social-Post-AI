# Google AI model routing

Dealer Social Post AI keeps its Google credential on the PocketBase server. The browser authenticates with an opaque session cookie and sends requests to the same-origin `/api/proxy/*` routes; it never receives a provider key.

## Active credential

Set one server-side secret:

```bash
GEMINI_API_KEY=your-gemini-api-key
```

The active text, image, and video workloads all use the Gemini API at `generativelanguage.googleapis.com`.

## Configured application models

| Task                 | Tier     | Routing order                                                                   | Output contract            |
| -------------------- | -------- | ------------------------------------------------------------------------------- | -------------------------- |
| `caption`            | quality  | `gemini-3.5-flash` → `gemini-3.1-flash-lite`                                    | 2,048 tokens               |
| `caption_regenerate` | quality  | `gemini-3.5-flash` → `gemini-3.1-flash-lite`                                    | 2,048 tokens               |
| `caption_edit`       | fast     | `gemini-3.1-flash-lite` → `gemini-3.5-flash`                                    | 2,048 tokens               |
| `image_standard`     | standard | `gemini-3.1-flash-image` → `gemini-3-pro-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `image_studio`       | studio   | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `video_standard`     | standard | `veo-3.1-fast-generate-preview`                                                 | 720p                       |
| `video_quality`      | quality  | `veo-3.1-generate-preview`                                                      | 1080p                      |

The canonical configuration is `config/gemini-model-policy.json`; `services/modelConfig.ts` consumes it and PocketBase enforces the same policy. The standard image route starts with Flash, while only the explicit Studio preference starts with Pro. Standard and quality video are separate one-model routes. The Veo IDs above are Gemini API identifiers; Vertex-hosted `-001` model IDs are not interchangeable with them.

Both image tiers request 2K from Flash and Pro, then 1K from the Lite image fallback. Run `npm run model-policy:check` to reject policy drift before deployment.

## Vertex status

Generic `/api/proxy/vertex/*` browser routes are intentionally denied by the server allowlist. A dealer session must not be able to select arbitrary Google Cloud projects, models, or billable operations.

Do not configure `VERTEX_SERVICE_ACCOUNT_JSON` for this release. If Vertex is needed later, add a dedicated server-to-server route with all of the following before enabling it:

- service-to-service authentication distinct from dealer browser sessions;
- exact project, region, model, and method allowlists;
- bounded request schemas and cost-specific rate limits;
- Vertex `fetchPredictOperation` polling and response validation;
- least-privilege workload identity rather than a long-lived JSON key where possible.

## Verification

After configuring `GEMINI_API_KEY`, run:

```bash
npm run security:secrets
npm run model-policy:check
npm run typecheck
npm test
npm run build
```

Use `npm run test:api-keys` only as an intentional paid/live provider diagnostic. Never put a real key in source, frontend variables, screenshots, or shell transcripts.
