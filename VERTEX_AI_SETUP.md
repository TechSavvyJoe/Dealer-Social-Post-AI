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
| `caption`            | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_regenerate` | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_edit`       | fast     | `gemini-3.5-flash-lite` → `gemini-3.6-flash`                                    | 2,048 tokens               |
| `image_standard`     | standard | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `image_studio`       | studio   | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 4K → 2K → 1K; 4,096 tokens |
| `video_standard`     | standard | `veo-3.1-fast-generate-preview`                                                 | 720p                       |
| `video_quality`      | quality  | `veo-3.1-generate-preview`                                                      | 1080p                      |

The canonical configuration is `config/gemini-model-policy.json`; `services/modelConfig.ts` consumes it and PocketBase enforces the same policy. Both image routes start with Pro; Standard requests 2K and Studio requests 4K from Pro for hero creative before the shared Flash/Lite fallbacks. Standard and quality video are separate one-model routes. The Veo IDs above are Gemini API identifiers; Vertex-hosted `-001` model IDs are not interchangeable with them.

Standard requests 2K from Pro and Flash. Studio requests 4K from Pro, then falls back to 2K Flash; both tiers use 1K Lite as the final image fallback. Run `npm run model-policy:check` to reject policy drift before deployment.

## Vertex status

Generic `/api/proxy/vertex/*` browser routes are intentionally denied by the server allowlist, and the legacy Vertex service-account code path has been deleted from `pb_hooks/main.pb.js` entirely (it wrote a private key to disk and shelled out to openssl, and was one policy edit away from reachable). A dealer session must not be able to select arbitrary Google Cloud projects, models, or billable operations.

`VERTEX_SERVICE_ACCOUNT_JSON` is not read by anything. If Vertex is needed later, add a dedicated server-to-server route with all of the following before enabling it:

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
