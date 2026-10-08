# Dealership launch readiness

Target confirmed by the owner on October 8, 2026: **25 dealerships, approximately
250 users**. This is a controlled launch target, not a measured nationwide capacity
or an availability promise. A green health endpoint is necessary, but insufficient.

## Release evidence

The baseline production release `c684a6de1d9b55cd5d722c40deac4870c9d466ef`
was verified on October 8 at 16:06 UTC: canonical frontend, direct and proxied
backend, and release-bound recovery evidence agreed. Subsequent changes must pass
the entire CI and backend-before-frontend release sequence again.

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
| Team access            | Owner selected private dealership invitations plus personal codes. Ship and verify the invitation boundary before multi-store onboarding; four-digit codes alone are not the target access model. Preserve existing users during the transition.                                            |
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
