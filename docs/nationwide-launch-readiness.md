# Dealership launch readiness

Target confirmed by the owner on October 8, 2026: **25 dealerships, approximately
250 users**. This is a controlled launch target, not a measured nationwide capacity
or an availability promise. A green health endpoint is necessary, but insufficient.

## Release evidence

The baseline production release `b47796fb8af7728eb02d95b3d0e07646ab92daa4`
was verified on October 9 at 02:03 UTC: canonical frontend, service worker,
direct and proxied backend, and release-bound recovery evidence agreed.
Subsequent changes must pass the entire CI and backend-before-frontend release
sequence again.

The `25 dealerships / 250 users` CI job runs the pinned real PocketBase executable
against fresh, isolated synthetic data. It provisions all 250 identities, signs in
at 25 concurrent requests across 25 simulated store networks, saves 250 private
review images, checks 1,000 history reads, rejects cross-store access, and checks
session revocation. It also issues 500 simultaneous provider-capacity reservations
without making any paid provider call. Its redacted artifact records observed
latency; it is a CI-host benchmark, not a production-region or mobile-network SLA.

Run it locally with an already verified PocketBase 0.22.55 executable:

```bash
POCKETBASE_TEST_BINARY=/absolute/path/to/pocketbase npm run test:launch:capacity
```

The harness has no remote URL option, uses explicitly separate data/hook/public
directories, creates random temporary credentials, and removes its database after
the run. Never run `sync:prod` to prepare a load test. Do not infer capacity from
timings on a busy development machine; use a clean runner and retain its evidence.

## Corrections in this hardening release

- Provider concurrency uses atomic SQLite leases instead of an overwritable
  shared-memory read/modify/write. Leases fail closed on database errors, expire
  after six minutes, and cannot free another request's slot.
- Login reservations continue to count against the guessing limit. Recent
  in-flight checks ask the user to retry after two seconds, instead of displaying
  a fifteen-minute lock for a valid dealership Wi-Fi burst. Failed or abandoned
  comparisons retain the original lockout protection.
- The 360 library supports 750 total saved spins, matching 25 stores at 30 each,
  while keeping a ten-spin personal limit. Quota counts use an aggregate query
  under the existing write transaction. Every upload still checks physical free
  space and reserves room for the next full backup; raising the record allowance
  does not provision disk space.
- Personal/dealership usage appears in the studio. System Health reports fleet
  usage and whether another complete spin fits with backup headroom.
- Media metadata, frame reads and uploads have a 30-second request/body deadline.
  A failed frame read cancels its sibling workers. Interrupted writes are resumed
  by checking the server's saved angles; create requests are never blindly retried.
- Copied crash receipts include release, area, and bundle locations without
  exception messages, full URLs, customer details, or private spin-link tokens.

## Gates before inviting the 25 dealerships

| Area                   | Required evidence / current constraint                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team access            | Owner selected private dealership invitations plus personal codes. The invitation boundary requires verification before release. New stores require it; existing stores preserve access until a manager distributes and enables the invitation. Finish that activation before onboarding.   |
| Isolation              | Pass the real multi-tenant canary plus existing ownership, manager approval, immutable media, session rotation and protected-file tests.                                                                                                                                                    |
| Storage                | Inspect actual production capacity before onboarding. At the maximum 72 angles × 500 KB, 750 spins can occupy 27 GB before posts, signatures, database and backup archives. The runtime guard blocks uploads before backup headroom is exhausted. A quota is not reserved physical storage. |
| Availability           | PocketBase remains one stateful SQLite service on one Fly volume. Do not add independent writable replicas behind a load balancer. Define incident ownership, monitoring destination and a tested recovery-time objective before promising an SLA.                                          |
| Recovery               | Require the protected off-box full-media restore gate for the exact release. Retain the nightly drill evidence. Existing rollback and incident runbooks remain authoritative.                                                                                                               |
| Real media             | Run the authenticated synthetic caption/image/video provider canary and inspect generated results. CI stubs and local 360 fixtures cannot establish real provider quality or phone performance.                                                                                             |
| Mobile                 | Perform physical iPhone installed-PWA acceptance: safe areas, keyboard, rotation, image/video swipe, native sharing, cancellation, background/resume and a real vehicle walkaround. Browser emulation is only partial evidence.                                                             |
| Social handoff         | Facebook, Instagram and TikTok receive native file sharing or downloads, with caption copy. Automatic caption placement and confirmed direct publishing depend on destination support and approved account integrations; do not label a share-sheet opening as a published post.            |
| Privacy and operations | Resolve the owner/counsel retention decisions, historical credential-rotation evidence, support contact and incident response ownership documented in the existing security/operations runbooks. Code checks do not attest these decisions.                                                 |
| Revision compatibility | Preserve the seven clear-day observation gate. A deployment resets its window. Do not combine strict revision enforcement with this release.                                                                                                                                                |

The launch decision must identify outstanding gates explicitly. Passing CI does
not close business, physical-device, provider-quality, or operational evidence gaps.

## Studio refinement release

This release adds recovery for generated posts whose initial save failed or
whose save response was lost. A browser keeps the completed image, caption and
existing signature while it reconciles the original save operation. Repeating
that operation cannot create a second post or trigger another AI generation.
Delivery and editing remain blocked until the post is saved. Leaving or closing
the page can still discard an unsaved result; the interface does not promise
durability before the server confirms it.
After reopening an interrupted save, the app retains the source details and
directs the person to My Work before creating a replacement. It does not offer
a retry rebuilt from incomplete persisted display metadata.

The recovery ledger is private SQL state bound to the exact authenticated
session, dealership, operation and immutable request digest. A replay whose saved
creative or caption has since changed cannot label the original preview with a
newer revision. The user must reopen the authoritative saved post through My Work.
The migration creates the ledger without rewriting existing posts; compatibility
with older clients is preserved. Do not remove this state during a rollback while
recovery clients can still retry.

Media writes share a transaction fence and reserve physical headroom for the next
full backup. Posts, replacement images, signatures, dealership logos and 360
frames reject writes with an actionable storage response when measurements fail
or space is limited. Finishing an already uploaded spin and other metadata-only
changes remain available. CI exercises the real pinned backend with concurrent
cross-dealership writes, idempotent post recovery and low-space metadata changes;
retain its `media-storage-and-save-recovery` artifact for the exact release.

The manager queue distinguishes an unavailable queue from a confirmed empty
queue, uses the signed-in manager as the reviewer, and prevents decisions against
stale rows after a failed refresh. Rejected or quarantined posts offer an explicit
replacement path that keeps source details but requires a new customer signature.

The vehicle studio adds precise trim controls, cancellation that preserves the
previous recording, a fresh viewer state after rebuilding, and decoded output
checks before an export is offered. The decoder primes its drawable surface once,
then waits for each paused seek and paint boundary without imposing a frame-rate
floor. A four-second, 6 fps synthetic fixture uses a changing timing band to check
first, repeated, middle and final samples. Synthetic still-vehicle browser fixtures
prove decoding, controls and visible pixels; they do not prove complete real
walkaround coverage, reconstruction quality or physical iPhone performance.
An image sequence from a walkaround is not a reconstructed 3D model.

The owner accepted the installed iPhone header and bottom controls on October 8
("Top is sharp and bottom fits"). That acceptance covers those existing controls,
not every subsequent studio, keyboard, capture or social sharing behavior.

### Read-only production storage inspection

Run **Inspect production storage** from the Actions page on `main`, or use:

```bash
gh workflow run inspect-production-storage.yml --ref main
```

The protected production credential measures the mounted data filesystem as
`pbuser`. It pins both measurements to one running machine and checks the health
release before and after inspection. The job shares the deployment/backup lock,
does not modify production, and retains a numeric `production-storage` artifact
for 30 days. File names, application records, credentials and service logs are
excluded. The filesystem totals are usable storage measurements, not the Fly
billing allocation. A successful snapshot or room for one maximum spin does not
establish capacity for all 25 dealerships; apply the fleet and backup requirements
above to the measured available bytes before onboarding.

### Current storage decision and reviewed growth plan

The protected inspection on October 8, 2026 measured 1,021,005,824 filesystem
bytes, 896,565,248 available bytes and 54,812,672 bytes in the data directory.
This is roughly a 1 GB filesystem and is insufficient for the full fleet quota.
The numeric receipt is in [run 37844690958](https://github.com/TechSavvyJoe/Dealer-Social-Post-AI/actions/runs/37844690958).

The owner explicitly chose **Keep current storage for now**. Do not run the
extension below, provision a paid substitute, or advertise space for the full
25-dealership media allowance. The upload guard protects the existing volume; it
does not increase its capacity. Continue monitoring the actual mounted usage and
backup headroom before admitting more stores or large media batches.

The initial proposal is **60 GB for the existing `pb_data` volume**. Maximum
spin frames require 27 GB; allowing another 27 GB for backup working space
leaves a limited buffer for other media and the database. Reassess that buffer
as media usage grows; this is not an unlimited retention promise.
At [Fly's October 1, 2026 pricing](https://fly.io/pricing-update/), the provisioned
volume costs $9 per month at $0.15/GB/month, excluding compute, egress,
off-box backups and snapshots. Snapshot storage has its own charges.
[Extensions cannot be shrunk](https://docs.fly.io/volumes/volume-manage).
Get the owner's explicit cost approval before performing the extension.

**Plan or grow production storage** defaults to a read-only `inspect-plan`.
It runs only on protected `main`, shares the deployment/backup lock, requires
the exact healthy release and release-bound recovery proof, and selects only
the named data volume attached at `/pb/pb_data` to the sole running writer.
It retains a safe preflight receipt before any extension, refuses volumes above
the reviewed target, and will not automatically restart the machine.

After the approved code has deployed, inspect the plan:

```bash
gh workflow run grow-production-storage.yml --ref main -f mode=inspect-plan
```

Only after explicit owner approval for that recurring cost, run the protected
backup/restore drill and require it to pass. The growth preflight requires a
release-bound recovery verification within the last 30 minutes. Then run the
extension:

```bash
gh workflow run pocketbase-backup.yml --ref main
# Wait for that backup/restore run to pass before the extension below.
gh workflow run grow-production-storage.yml --ref main \
  -f mode=extend-to-60gb -f confirmation=approve-60gb-monthly-volume
```

Download the `production-storage-growth` receipt. A passed extension requires
both the allocated 60 GB and measured mounted capacity, the same healthy writer,
and enough free space for maximum fleet frames plus backup headroom. An error
may occur after Fly accepts an extension: inspect current allocation and the
receipt before retrying. Do not interpret an `in_progress` receipt as success.
The operation does not alter media quotas, replicas or retention policies.

## Capacity failure found and corrected

The first clean CI run provisioned 25 dealerships and 250 people, signed every
person in, and saved all 250 drafts, then timed out during concurrent History
reads. Profiling an isolated PocketBase process identified repeated compilation
of the same 18 customer-identity regular expressions. The fixed grammar is now
cached per JSVM; customer content and dealer-specific allowances are never cached.
Empty projection work also returns early. All identity decisions remain enforced.

After the fix, the complete local canary passed, including 1,000 History reads
at concurrency 25, cross-dealer denial, 250 spin projects, and 500 capacity-lease
attempts. History p95 was 1,943 ms and max 3,820 ms on the heavily loaded local
host. These are synthetic loopback measurements, not production latency claims.
The 1,421 identity/disclosure regression tests also passed. Clean CI and the
production release verification remain required.
