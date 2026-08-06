# Vehicle Walkaround automation worker

This isolated Output.ai 0.10.0 package implements the durable processing boundary for Vehicle Walkaround Studio. It does not run inside Vite or PocketBase's JSVM.

## Workflows

### `vehicle_walkaround_producer`

Input:

```json
{
  "projectId": "walkaround_123",
  "workflowId": "walkaround_123_producer_r1",
  "expectedRevision": 4
}
```

The producer loads all trusted context from PocketBase, enforces the 12-clip/20-minute/10-GB and consent gates, normalizes and transcribes media, creates an evidence-linked edit plan, renders 16:9 and 9:16 outputs, polishes narration, runs deterministic and Gemini quality checks, and stops at `review_ready`. It never contacts YouTube.

### `youtube_walkaround_publisher`

The publisher accepts the same opaque identity shape. It reloads the authoritative publication context and requires approval bound to the exact master SHA-256 and metadata revision. It starts private, waits for processing and playback verification, then changes visibility to unlisted or an attested public inventory target.

Customer videos are always unlisted. The UI should warn that anyone with an unlisted link can forward it.

## Security and internal API contract

Every internal request uses:

- `Authorization: Bearer <worker service token>`
- `X-Walkaround-Timestamp`
- `X-Walkaround-Signature`, HMAC-SHA256 over `<timestamp>.<raw body>`
- `Idempotency-Key` on every mutation

Required endpoints under `/api/internal/walkarounds/{projectId}`:

- `GET /production-context`
- `POST /production-events`
- `GET /publication-context`
- `POST /publication-events`
- `POST /assets/{assetId}/signed-read`
- `POST /youtube/upload-session`
- `POST /youtube/upload-next`
- `GET /youtube/videos/{videoId}`
- `POST /youtube/videos/{videoId}/visibility`

The separate dispatcher claims PocketBase's durable task outbox through signed `/api/internal/walkaround-tasks/claim`, `/renew`, `/ack`, and `/nack` endpoints. It uses the queued workflow ID as Temporal's workflow ID, so a crash after Temporal accepts a start is recovered as an idempotent already-started success. Long metadata-QC and deletion tasks renew their fenced leases every 20 seconds and retain the task idempotency key at the media service.

Only producer and publisher are public Output workflows. `validate_review` and `delete_objects` outbox entries run directly in the leased dispatcher against the idempotent media worker. Deletion claims contain an exact server-derived object list; project deletion marks the project deleted only after acknowledgement, while abandoned-upload cleanup deletes only the named asset object.

The browser never supplies dealer IDs, storage keys, provider IDs, channel IDs, OAuth tokens, or YouTube session URIs. PocketBase creates the resumable YouTube session with the dealer's encrypted OAuth grant, reads the canonical private master, uploads one bounded chunk at a time, persists the acknowledged offset before replying, and returns only `{ providerJobId, state, nextOffset, videoId?, revision }`.

Provider create calls have a persisted request-key reservation before execution and a recorded provider identifier immediately after acceptance. An ambiguous accepted request must move the backend record to `reconciliation_required`; it must not be blindly created again. Webhooks may wake processing but cannot change state until the worker or backend re-fetches authoritative provider status.

## Configuration

Use `config/credentials.yml.template` as the key map and provision values through Output.ai's encrypted credential system. Required configuration includes:

- Signed PocketBase internal-worker endpoint and secrets.
- Private media-worker endpoint for malware scanning, ffprobe-style measurement, HEVC/HDR/VFR normalization, transcription, GCS ingest, muxing, and deterministic QC.
- Shotstack stage/production URL and API key.
- Auphonic URL and API key.
- Vertex credentials and project/region required by the Output Vertex provider.

All clients call `credentials.require` at activity execution time and fail closed if configuration is absent. No secret values or production OAuth grants are included in this package.

The private media worker must return normalized asset references plus short-lived render URLs. It must enforce object ownership and output byte signatures, codecs, dimensions, A/V sync, loudness, black/frozen-frame, caption, and overlay checks before returning `deterministicQc.passed: true`.

## Commands

Requires Node 24.15 or later.

```bash
npm install
npm run check
npm run build
npm run output:worker:check
npm run output:worker:start
npm run dispatcher:start
```

The worker and dispatcher are separate supervised processes and must use the same `OUTPUT_CATALOG_ID`, Temporal address, namespace, and credentials. The dispatcher refuses to start without the catalog/task-queue identifier.

Scenarios live within each workflow's `scenarios/` directory. They require a configured local backend fixture or deployed integration; running them without providers is expected to fail closed.

## Release boundary

Local typechecks, unit tests, and workflow bundle validation do not prove provider or production readiness. Release still requires provisioned private GCS, the media service, Vertex, Shotstack, Auphonic, dealer-scoped YouTube OAuth, API audit status, a real private-to-final YouTube run, physical-device playback, and confirmed deletion behavior.
