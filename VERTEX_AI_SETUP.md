# Google AI model routing

Dealer Social Post AI keeps its Google credential on the PocketBase server. The browser authenticates with an opaque session cookie and sends requests to the same-origin `/api/proxy/*` routes; it never receives a provider key.

## Active credential

Set one server-side secret:

```bash
GEMINI_API_KEY=your-gemini-api-key
```

The active text, image, and video workloads all use the Gemini API at `generativelanguage.googleapis.com`.

## Configured application models

| Job          | Primary                    | Fallback                                                     |
| ------------ | -------------------------- | ------------------------------------------------------------ |
| Text/caption | `gemini-3.5-flash`         | `gemini-3.1-flash-lite`, then `gemini-2.5-flash`             |
| Image/edit   | `gemini-3-pro-image`       | `gemini-3.1-flash-image`, then `gemini-3.1-flash-lite-image` |
| Video        | `veo-3.1-generate-preview` | `veo-3.1-fast-generate-preview`                              |

The canonical configuration is `services/modelConfig.ts`. The Veo IDs above are the Gemini API identifiers. Vertex-hosted stable `-001` model IDs are not interchangeable with them.

The premium and standard image models request 2K output; the Lite emergency model is pinned to its supported 1K output.

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
npm run typecheck
npm test
npm run build
```

Use `npm run test:api-keys` only as an intentional paid/live provider diagnostic. Never put a real key in source, frontend variables, screenshots, or shell transcripts.
