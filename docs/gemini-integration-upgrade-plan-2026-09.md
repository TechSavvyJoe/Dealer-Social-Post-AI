# Gemini integration — upgrade plan (September 2026)

Sources: live Google docs/pricing fetched 2026-09-02 (ai.google.dev models,
pricing, changelog, deprecations, thinking, image-generation, omni pages) and a
file-level audit of this repo's integration. Model policy on file is v5,
verified 2026-09-02 (originally 2026-08-14).

## Where we stand

| Lane         | Pinned                                                                        | Status                                                                                                                                                      | Action                                                                            |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Text quality | `gemini-3.6-flash`                                                            | GA (2026-07-21), no shutdown announced; `gemini-3.7-flash` is newer at the same price                                                                       | Keep. Set `thinkingLevel` (see P0-2).                                             |
| Text fast    | `gemini-3.5-flash-lite`                                                       | GA, current Lite                                                                                                                                            | Keep.                                                                             |
| Image        | `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image` | All GA, no shutdown announced                                                                                                                               | Keep; tune defaults. Reference images: see the 2026-09-04 correction.             |
| Video        | `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`                   | **Preview only, no GA path; Google now positions Veo 3.1 for "legacy pipelines."** Replacement is `gemini-omni-1.1-flash` (GA 2026-08-27, Interactions API) | Plan the migration (P1-4). Single-model tasks = total video outage on retirement. |

The models are current. What is dated is the **integration pattern**: raw
`v1beta` REST through the proxy with an exact-key request whitelist that
admits only `maxOutputTokens` for text, no `systemInstruction`, no structured
output, no thinking control, no usage accounting, prompts assembled in the
browser (119 kB chunk), and a Claude fallback that returns 400 whenever it is
switched on.

## Hard dates

- **2026-10-17** — `config/gemini-model-policy.json` `verifiedAt` (re-verified
  2026-09-02) turns 45 days old and `scripts/check-model-policy.mjs` turns CI
  red, which silently blocks Fly deploys. Re-verify and bump `verifiedAt`
  before then — but never bump `version` casually (see the pin note below).
- **2026-09-30** — `gemini-omni-flash-preview` shuts down (not pinned; do not
  adopt it — go straight to `gemini-omni-1.1-flash`).
- **2027-01-01** — 3.6/3.7 Flash text pricing doubles ($0.75→$1.50 in,
  $3.75→$7.50 out per 1M). Budget for it; confirm whether 3.6 is billed at intro
  rates today (pricing page and launch post disagree).

## P0 — do now (small, high value)

1. **Usage, latency, and finishReason accounting.** `generation_events` stores
   no token counts, latency, or finish reason; `usageMetadata` is never read.
   Time `$http.send` in `pb_hooks/main.pb.js` (~341-354), record
   `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`,
   `cachedContentTokenCount`, `finishReason`, image size and video seconds in
   `recordProxyGenerationEvent` (`pb_hooks/helpers.js` ~1721-1782), add an
   `X-Generation-Purpose` header so vision-QC reviews stop being counted as
   captions (`services/geminiService.ts:782`), and expose a per-dealer
   aggregate to the admin health view. Everything below is measured by this.
2. **Set `thinkingConfig.thinkingLevel` per task.** 3.6 Flash defaults to
   `medium` and thinking tokens bill as output, so every caption call pays for
   reasoning it does not need. Use `low` (or `minimal`) for `caption` and
   `caption_edit`; keep `medium` for the vision-QC review only. Requires
   whitelisting `thinkingConfig.thinkingLevel` (enum-bound; reject
   `includeThoughts`) in the policy JSON + `pb_hooks/requestPolicies.js` text
   branch (~803-830). Never send `thinkingBudget` (deprecated; both → 400).
3. **Typed blocked-content handling.** `finishReason` / `promptFeedback.blockReason`
   are never inspected on text: a SAFETY block becomes an empty caption, trips
   the "quality gate," retries the next model with the same input, then Claude,
   then a template; on images a block triggers the OpenAI text-to-image fallback
   which fabricates a photo without the customer. Parse the reason in
   `services/geminiClient.ts` (~68-85), add a `blocked` kind to
   `utils/errorHandler.ts`, stop the fallback ladder on
   SAFETY/PROHIBITED_CONTENT/IMAGE_SAFETY, and show a specific toast.
4. **Fix or delete the Claude fallback.** Client sends `max_tokens: 2048`
   (`geminiService.ts` ~1700, 1942) but the server rejects >1200
   (`requestPolicies.js` ~1107); the server pins a dated Haiku id while
   `modelConfig.ts` advertises Sonnet/Opus ids it would reject; the image is
   not sent; `system` is unused. Both feature flags default off, so this is a
   100%-failure path waiting to be enabled. Align the cap, pass `system` and the
   image, and add a test that runs the adapter body through
   `buildAnthropicMessageRequest`.
5. **Text-first part ordering** (no policy change): caption and image requests
   put the image bytes before the shared prompt prefix
   (`geminiService.ts` ~1645, 1827, 2047), which defeats implicit caching.
   Note implicit caching needs a ≥4,096-token prefix on 3.x Flash; measure with
   `cachedContentTokenCount` after P0-1 before expecting savings.
6. **Distinct `POLICY_VERSION_MISMATCH` response** when the client's
   `X-Model-Policy-Version` is stale (`helpers.js` ~1629-1645), so an outdated
   installed PWA gets an "update the app" prompt instead of "check your inputs."
7. **Do not add `HARM_CATEGORY_CIVIC_INTEGRITY`.** On 3.x the default
   threshold is `OFF`; the four categories at `BLOCK_MEDIUM_AND_ABOVE` are
   fine. Civic integrity is no longer in the documented adjustable set and the
   new `HARM_CATEGORY_JAILBREAK` is undocumented — sending either risks 400s on
   image/video models.

## P1 — next (medium effort, high value)

1. **Policy v6 with a table-driven validator.** Add `systemInstruction`
   (top-level) and, under text `generationConfig`: `thinkingConfig`,
   `responseMimeType`, and a **server-side schema registry** (client sends a
   `schemaId`; server injects `responseJsonSchema`) rather than accepting
   arbitrary schema JSON from the browser. Drop the `legacy*` request shapes.
   Never whitelist `temperature`/`topP`/`topK`/`candidateCount` — deprecated on
   3.x since 2026-07-21 and documented as returning 400 on 3.6/3.5-Lite; put
   style guidance in `systemInstruction` instead. Anchors:
   `config/gemini-model-policy.json` (allowedRequestFields),
   `pb_hooks/requestPolicies.js` (~286-396, 794-948),
   `scripts/check-model-policy.mjs`, `__tests__/backendHookPolicies.test.ts`,
   `services/geminiClient.ts`, `services/modelConfig.ts`.
2. **Move the static prompt blocks server-side as `systemInstruction`
   templates.** Brand identity, scenario rules, and the skill packet are
   concatenated into one user text part today (`services/promptsV2.ts`
   ~796-828, 884-966). Server-owned templates keyed by id shrink the browser
   bundle by ~100 kB, decouple prompt releases from PWA updates (the recurring
   stale-build support problem), let the proxy enforce the prompt contract, and
   are the prerequisite for structured brand voice reaching the model reliably
   (see the brand-consistent creative system spec, §7).
3. **Structured outputs for the four places that already want JSON:** caption
   `{body, hashtags[], mentionsPricing, mentionsFinancing}`, the vision-QC
   review (`geminiService.ts` ~562-647 brace-scanning), the caption pack
   (`services/platformCopy.ts` ~290-375), and the website draft
   (`services/websitePublishing.ts` ~448-477). Supported on text models only,
   not on the image models. Lets disclosure slots come from the model instead
   of regex.
4. **Video: add `gemini-omni-1.1-flash` behind a flag for the 1080p path.**
   GA; $0.15/s at 1080p vs Veo standard $0.40/s (62% cheaper); 360p drafts at
   ~$0.03/s; first/last-frame and extension built in; native audio. Costs: it
   is Interactions-API only (new endpoint and `steps` response shape, new proxy
   route + ownership ledger), 3–10 s clips, 16:9/9:16 only, upscaled
   1080p/4K, EEA/UK/CH limits. Keep Veo 3.1 Fast for 720p (same $0.10/s) until
   Omni is proven, but treat both Veo ids as retirement risk and give each
   video task a second model.
5. **Tune the image lane.** Default `gemini-3.1-flash-image` at `1K` (2K is
   +50% per image); use its **character-consistency references (up to 4) and
   style references (up to 3)** — this is the single biggest lever for
   consistent dealership branding across posts; reserve `gemini-3-pro-image`
   for 4K or text-heavy creative (2× cost); the Lite model has no
   character/style refs, so never use it for people. Raise
   `requestLimits.maxImageTaskImages` accordingly. Route non-interactive
   generation (scheduled posts) through the Batch API at 50% off.
6. **Veo request parameters.** ~~Whitelist `generateAudio`~~ — REFUTED, see the
   2026-09-04 correction below. (Original text: whitelist `generateAudio` (makes "soundtrack:
   none" deterministic instead of prose), `negativePrompt` (carry the "no
   second car / no morph" locks), `referenceImages`/`lastFrame`; read
   `raiMediaFilteredReasons` so a content-filtered video stops looking like
   "no video found." Re-verify the exact Veo 3.1 enums against the live docs
   first — the research pass could not confirm them from a primary page.

## P2 — later

- Multi-turn image correction (prior render + reviewer verdict as conversation
  turns) instead of single-turn re-renders; requires allowing role-tagged turns
  in the validator. Today the QC loop can cost up to 5 generations + 5 vision
  reviews per image.
- Harden Veo/Omni response parsing to the documented shape with strict Zod;
  delete the speculative 7-key/4-shape probes.
- Separate rate buckets for video polls vs generation starts (polls currently
  burn the dealer's 60/min budget).
- Batch API + webhooks (May 2026) for scheduled posts; video is not batchable.

## Not worth doing

- Streaming: blocked by PocketBase 0.22's buffered `$http.send`; captions are
  ~50 tokens — the latency is in image QC, not text.
- Explicit context caching: the per-dealer brief is far below the 4,096-token
  minimum; storage is $0.50–1.00/hr per 1M tokens.
- Switching to the `@google/genai` SDK for `generateContent`: nothing forces
  it; adopt ≥2.17 only when Omni/Interactions lands.
- Chasing `gemini-3.7-flash`: same price and limits as 3.6, agentic-oriented,
  loses `minimal` thinking. Not a caption win.

## Disclosure posture (unchanged, now explicit)

All Gemini images and Omni videos carry SynthID; there is no opt-out and the
watermark must stay. Meta auto-applies an "AI info" label to detected
AI imagery in ads. The existing FTC rule holds: AI imagery must never
misrepresent the actual vehicle, price, or condition. Lyria music beds are not
licensed for commercial use in the API terms — check before using in ads.

---

## Correction — 2026-09-04 (verified against the official SDKs)

Two items above were written from documentation-site research and are **wrong
for this API surface**. Both were checked against the Google SDK converters,
which encode the exact wire shape per surface, because the live doc pages
render their field tables through JavaScript and could not be extracted
reliably. Implementing either as originally written would have returned 400 on
every affected generation.

**1. `generateAudio` does not exist on this endpoint.** The proxy's upstream is
`https://generativelanguage.googleapis.com/` (`pb_hooks/main.pb.js`) — the
Gemini Developer API ("mldev"), not Vertex. Both SDKs hard-refuse the field on
that surface:

- `googleapis/python-genai`, `_GenerateVideosConfig_to_mldev`: raises
  `generate_audio parameter is only supported in Gemini Enterprise Agent
Platform mode, not in Gemini Developer API mode.`
- `googleapis/js-genai`, `_models_converters.ts`: the identical throw on the
  mldev converter; only the Vertex converter sets `parameters.generateAudio`.

Veo 3.1 audio is always on. "Silent" is therefore carried by `negativePrompt`
(music, soundtrack, score, singing, voiceover, narration, dialogue, speech) —
confirmed and accepted, strictly better than the prose-only sentence it
replaced, but a strong suppression rather than a hard boolean guarantee.
`scripts/check-model-policy.mjs` now fails if `generateAudio` is ever added.

**2. There is no reference-image field for the `generateContent` image models.**
`referenceImages` exists only on the **Veo** path (`instances[0]`). For image
generation, `ImageConfig` exposes only aspect ratio, image size, person
generation, prominent people, output mime type, compression quality, and output
options. Character-consistency and style references are supplied as **additional
inline image Parts inside the request contents** — which is exactly the
mechanism the dealer logo already uses. There is no separate mechanism to
migrate to. `maxImageTaskImages` was therefore left at 2: raising it without a
caller only widens an inline-image security bound for no behavioural gain.

If cross-post logo fidelity is the goal, the lever is prompt and part-ordering
work inside the existing inline-parts contract, not a new request field.

**3. Priority note on P1-2 (server-side prompt templates).** The "119 kB
shipped to the browser" framing overstates the urgency: `promptConfig` is
already a lazy chunk and is not in the boot-critical modulepreload list, so
this is not a first-paint cost. The real benefit is operational — decoupling
prompt releases from PWA updates, which is a recurring support problem — and it
should be weighed as such, against the risk of altering prompt fidelity for
every dealership.

**Still genuinely open:** the Veo → Omni migration (P1-4). Both Veo 3.1 ids
remain preview-only with no GA path. As of 2026-09-04 each video task carries
`veo-3.1-lite-generate-preview` as a second rung, so a single-id retirement
degrades video to the lite model (via the existing 404 → next-model path)
instead of taking it down; a whole-family retirement still needs Omni. Omni is a different API surface
(Interactions), needs its own proxy route and ownership ledger, and carries a
different cost model — a planned effort, not a drop-in.

### Capability negotiation for optional request fields (2026-09-04, PR #30 review)

`parameters.negativePrompt` is optional on the wire and is **negotiated, not
assumed**. The backend advertises `capabilities: { veoNegativePrompt: true }`
on every session payload and on `/api/app/health` (`PROXY_CAPABILITIES` in
`pb_hooks/helpers.js`); the client (`services/proxyCapabilities.ts`) sends the
field only when the server that issued its session said so, so a rollback to a
pre-capability backend keeps every video start byte-identical to what that
server validates. For a mixed-version deploy (session from a new instance,
start answered by an old one) the client re-issues the start exactly once
without the field, on the same model, keyed on the proxy's own pre-upstream
validation body (`"Invalid or unsupported generation request"`), which proves
no Veo job was started. Neither the model policy version (exact match, guards
paid routing) nor `API_CONTRACT_VERSION` (guards breaking response shapes) is
bumped for an optional field.
