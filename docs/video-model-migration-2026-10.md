# Gemini video model migration (October 2026)

## Why the model changes

Google lists `veo-3.1-fast-generate-preview`, `veo-3.1-generate-preview`, and `veo-3.1-lite-generate-preview` with October 22, 2026 as their earliest possible shutdown date and recommends `gemini-omni-1.1-flash` as their replacement. The date is an earliest possible date, not a guaranteed shutdown date. [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations/)

## Application contract

The standard and quality video tiers now use one canonical model, `gemini-omni-1.1-flash`. There is no duplicate fallback entry: retrying the same model under a second model name would not provide a distinct fallback. Browser and internal API requests keep the existing `POST models/{model}:predictLongRunning` route and sanitized legacy request body. The server adapter translates that compatibility request to Omni Interactions API calls; the browser does not receive provider credentials or call that API directly.

The adapter projects completion back to the existing long-running-operation DTO. A successful poll has `name: "operations/omni-<32 alphanumeric characters>"`, `done: true`, and `response.generateVideoResponse.generatedSamples[0].video` containing `encodedVideo` and `encoding: "video/mp4"`. Pending operations keep the `{name, done: false}` shape, and provider failures are returned as a static safe error. The canary validates the inline base64 payload, MP4 container signature, byte limit, and playable H.264/AAC streams with `ffprobe`; it also retains the authorized Files API URI download path used by older Veo responses.

The existing model policy remains version 5 so archived posts do not become subject to an unrelated forced review. Standard and quality remain 720p and 1080p respectively; the app's existing 4/6/8-second choices remain available, with 1080p requiring 8 seconds. Google documents 1080p as an upscaled output; the app does not perform that upscaling. These are application delivery settings; Google's Gemini Omni guide documents 3–10-second output and 360p, 720p, 1080p, and 4K resolutions. [Gemini Omni video guide](https://ai.google.dev/gemini-api/docs/omni/)

## Provider storage and privacy

The backend uses stored Omni interactions so it can retrieve the request's eventual response while generation runs. Its cleanup record stores only an opaque provider ID and operation metadata, not the prompt, media, or provider keys. A SHA-256 fingerprint binds deletion evidence to the creation key: a 404 under a different key leaves the cleanup record pending. Expired records become eligible after 24 hours. Cleanup runs every 15 minutes, scans at most 20 due rows, and has a 90-second total time budget. A failed delete remains recorded for another scheduled attempt, so this bounds work per run rather than guaranteeing a finite retry count. This is application-side cleanup, not a provider deletion guarantee. Google's Gemini API logging documentation describes project log retention of up to 55 days by default and configurable windows of 7, 14, 28, or 55 days. The currently selected Google project's retention configuration has not been verified as changed. [Gemini API logs and datasets](https://ai.google.dev/gemini-api/docs/logs-datasets)

Do not claim zero Google logging or guaranteed deletion from Google's systems. Google's abuse-monitoring documentation separately describes retaining prompts and responses for 55 days for safety and policy enforcement. [Gemini API abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies)

Omni supports video generation with audio. The application request does not establish a guaranteed hard mute, so a silent soundtrack is not promised; inspect generated audio as part of product acceptance. [Gemini Omni video guide](https://ai.google.dev/gemini-api/docs/omni/)

## Verification status

On October 10, 2026, direct synthetic provider checks completed for 4-second 720p and 8-second 1080p H.264/AAC MP4 outputs. The direct probe cleaned up each retained provider interaction with HTTP 200; this does not verify the integrated PocketBase cleanup job. These checks establish only the exercised direct provider contract. They do not establish full CI, browser and backend integration, all user flows, production deployment, or release acceptance. Run the full CI and live release checks before describing the migration as released.

## Rollback and cleanup

Prefer a frontend-only rollback while keeping the Omni-capable backend and its cleanup cron running; it continues to accept the older installed-client contract. A backend rollback must retain the adapter, private mapping collection, and cleanup worker until all recorded interactions have been removed. If another backend change must be reverted, retain these compatibility and cleanup modules in that rollback build. Do not deploy a pre-migration backend and assume the queue will clean itself.

The down migration refuses to remove a nonempty recovery queue. Keep the original provider project accessible until cleanup finishes; changing to a different project cannot establish deletion of the original interactions. Cleanup failures emit aggregate warnings without operation IDs or provider content. The real PocketBase canary verifies both nonempty rollback refusal and empty rollback success.
