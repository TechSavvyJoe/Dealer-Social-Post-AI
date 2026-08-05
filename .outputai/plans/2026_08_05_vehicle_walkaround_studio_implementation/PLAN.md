# Vehicle Walkaround Studio implementation

Implement a dealer-scoped, fail-closed walkaround-video system alongside the existing photo flow.

## Fixed product contract

- Accept one take or up to 12 ordered MOV/MP4/WebM clips, with a combined 20-minute and 10-GB ceiling.
- Upload originals resumably to private GCS; PocketBase stores ownership, state, consent, artifact references, approvals, provider jobs, publication records, and audits.
- Run deterministic Output.ai producer and YouTube publisher workflows in a separate `automation/` package.
- Use Vertex/Gemini for grounded edit decisions, metadata, and evaluation; Shotstack for timelines/renders; Auphonic for audio-only polish.
- Produce a private 1080p 16:9 master and a 9:16 teaser no longer than 30 seconds.
- Stop at private `review_ready`; only an explicit, version-bound approval may start YouTube publishing.
- Customer videos can become unlisted only. Inventory videos default unlisted and require explicit current-availability attestation before public publishing.
- Preserve originals and derived media until an authorized creator or dealer manager explicitly deletes them. YouTube deletion is separately confirmed.
- Never synthesize customer speech/footage or invent vehicle, price, finance, warranty, condition, history, or availability claims.

## Implementation areas

1. Add Walkaround Studio capture, upload, status, review, approval, visibility, sharing, and deletion UI.
2. Add session-gated client and PocketBase APIs, five durable collections, video/voice/YouTube consent, strict tenant ownership, idempotent internal worker callbacks, and manager-scoped YouTube connection metadata.
3. Add `vehicle_walkaround_producer` and `youtube_walkaround_publisher` Output workflows, shared provider clients, versioned prompts, evaluators, scenario inputs, documentation, and contract tests.
4. Prove fail-closed behavior when storage, workflow, provider, OAuth, or release configuration is absent.

## Verification

- Typecheck, focused and full Vitest, Output package checks, backend route/migration tests, and Chromium/WebKit tests.
- Fault tests for retries, ambiguous provider acceptance, stale callbacks, resumable uploads, corrupted media, approval invalidation, and cross-dealer access.
- Deployment and real provider/device/YouTube proof remain release gates and cannot be inferred from local green tests.
