# Vehicle Spin Studio

Build a spin from frames of a real, complete walk around a parked vehicle. The
operator chooses the start and end of one turn, reviews every angle, and can
replace the background while preserving the vehicle pixels. This is an image
sequence, not a reconstructed 3D model; it cannot reveal an angle not recorded.

## Acceptance

- Record with the phone camera or choose a video. Explain level landscape capture,
  steady distance, daylight, a clear vehicle, and one complete circle.
- Extract 48 ordered frames locally; cancel and retry without losing the source.
- Drag with a finger or mouse, use arrow keys, and zoom with buttons or a pinch.
- Optional background replacement uses a pinned, self-hosted segmentation model.
  Keep originals; inspect all angles, use positive/negative taps to correct a
  single angle, and restore the original background if edges are wrong. No footage leaves the device during processing.
- VIN decoding supplies vehicle identity; people review decoded and entered facts.
  Never infer price, condition, mileage, or installed equipment from the video.
- Save immutable frames and facts privately. A dealership's server-resolved
  approval policy controls customer links and video exports. Managers review the
  exact saved spin, including all angles and text.
- Upload each bounded image separately to stay below the frontend proxy's request
  limit. Tenant/person ownership, locked PocketBase rules, bounded record counts,
  immutable submissions, and authenticated asset reads apply.
- A revocable customer link is created only on an explicit Share action after
  approval. Native social destinations receive a video or link; they do not host
  the interactive viewer.
- Export the saved, approved frames with the saved vehicle facts. Detect actual
  browser encoder support and label MP4/WebM honestly.

## Validation

Exercise image extraction, cancellation, input bounds, pointer/keyboard controls,
auth changes, upload interruption, denied cross-tenant reads, premature export,
approval races, revocation, small iPhones, desktop, and Chromium/WebKit.
Use synthetic fixtures. Real vehicle edge quality and physical-phone recording
remain separate acceptance evidence.

## Operational limits

The first save uploads immutable JPEG angles (at most 500 KB each). Libraries are
bounded to 10 spins per person, 30 per dealership and 750 total (25 stores at the dealership limit). The studio shows personal and dealership usage, and System Health reports the fleet allowance and available backup headroom. These limits
protect the existing storage volume. Each create/upload also reserves disk room
for a full backup archive and a 256 MB buffer; delete an older spin when the library is
full. An incomplete upload can resume in the current editor. After a refresh,
delete the incomplete entry and choose the original recording again.

Editing a saved spin creates a new copy and repeats approval. Revoking a customer
link blocks future fetches; it cannot retract video files or images a recipient
already downloaded. Public links carry their random capability in the URL
fragment and send it to the backend in a header, without dealership cookies.

Background processing runs in a cancellable worker and can take several minutes
on a phone. The model and runtime are pinned and self-hosted by `npm run
spin:assets`; the model download is SHA-256 verified at build time. The original
frames remain available if processing fails. A real walkaround and a physical
iPhone home-screen install still require field acceptance; synthetic clips and
browser emulation cannot establish capture quality on every device.

`npm run test:spin:backend` is limited to an explicitly enabled loopback backend
with synthetic credentials. CI runs it inside the isolated production container.
