# Content workspace

## Product contract

My Work is a saved-content workspace; the manager Content tab is the dealership review and organization workspace. Both use the same server-scoped list/detail contract. Search spans all authorized saved posts, including records beyond the loaded page. Matching totals follow the selected filters; loading more does not change the meaning of the total.

The primary sequence is find → inspect → act. Selecting a row opens its inspector; selecting a checkbox explicitly adds that post to a batch. Actions never implicitly select every search result. Batches are capped at 50 selected loaded records. Each result is independent: successful items leave the selection and failures remain available for recovery.

Archive is reversible organization, not deletion or an unpublish command. It preserves creative revision, approval, release, and publishing history. An archived post must be restored before new approval, edits, sharing or website delivery. Previously queued website delivery can finish; archival does not cancel an in-flight operation or remove material from a social network or website.

Manager review starts with the oldest pending items. The inspector provides the saved image, caption, release state, author, approval history and truthful recorded activity. Approval and requests for changes apply to the exact saved revision. Website publication and share-sheet activity are distinct: opening a share sheet does not prove a social-network publication.

Historical video metadata does not imply a playable asset. Existing device recovery remains clearly labeled as temporary and device-specific. The 360 and walkaround actions open the actual existing studios; they do not claim a unified server library that the API does not provide.

## Visual reference and implementation

- `my-work-concept.png`: generated desktop composition before implementation.
- `manager-content-concept.png`: generated manager review composition before implementation.
- Source components: `components/workspace/`, `components/MyWork.tsx`, and the Content tab in `components/DealerAdminDashboard.tsx`.
- Reused system primitives: Button, Modal, existing Header, protected-image reader, safe website link handling, post label helpers and device recovery.
- Matte graphite surfaces, existing Inter type, compact rows, defined borders, cobalt primary action, and semantic state colors use the existing theme tokens. No new hardcoded brand palette is introduced in component CSS.

## Intended reference deviations

1. The app keeps its established Header and guarded navigation, rather than reproducing the concept’s invented global navigation.
2. The inspector is constrained to 320–400 px so the post list remains usable on ordinary laptops.
3. All counts, content and states come from the API. The concept’s fictional sample names, vehicles and numbers are not shipped as product data.
4. Studio links are buttons that open existing workflows. They are not selected collection tabs backed by nonexistent list APIs.
5. On phones the inspector becomes a full detail view below the existing header, with Back to results preserving the list and filters.

## Acceptance checks

- Global query, filter and sorting criteria reset the cursor; stale results are discarded across search, dealership or identity changes.
- Only authorized content influences search matches or counts. Held caption, customer and media fields do not become a search oracle.
- Archive/restore checks creative and workspace revisions and writes private audit evidence in the same transaction.
- Manager roster filters include inactive people without exposing credentials and discard stale responses on account changes.
- Empty, loading, error, held-media, missing-video and partial-batch states are explicit.
- Mobile safe areas, keyboard focus, contrast, scroll behavior and narrow widths require rendered browser verification.
- Pinned PocketBase migration must be proven against a disposable database copy. Production release gates and current storage remain unchanged.

## Visual fidelity ledger

The two concept images were compared with Chromium desktop list/inspector captures and the WebKit 390 × 844 inspector capture from `e2e/content-workspace.spec.ts`. These are synthetic test records, not production content.

| Point                 | Rendered comparison and decision                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy             | My Work and manager Content retain a clear page title, one creation action, then collection navigation and filters. The manager view uses the existing admin navigation so switching tabs retains its established behavior.                                                                                                |
| Density               | Compact bordered rows expose creative thumbnail, title, caption excerpt, review and date; managers also see the creator. The inspector stays alongside the list on desktop. Extra website/export controls sit under More filters and actions rather than widening the main toolbar.                                        |
| Spacing and alignment | Search, selects and view switches align at a common control height. The embedded manager workspace aligns with its heading and description; the personal workspace uses the wider page frame.                                                                                                                              |
| Color and typography  | Existing graphite surfaces, Inter typography and dealership theme tokens are preserved. The synthetic dealership's blue is less saturated than the concept; respecting dealership theming is intentional. Status color is always paired with text.                                                                         |
| Creative preview      | The full saved image is contained rather than cropped to the concept's landscape example. Portrait posts have dark side space so consent-sensitive details remain visible.                                                                                                                                                 |
| Actions               | The single Open post action enters the real editor/share flow. Manager approval and request-changes actions appear on a teammate's reviewable saved version. The concept's duplicate editing/share buttons are not reproduced.                                                                                             |
| Narrow screens        | At 390 px the inspector becomes a scrollable detail view with Back to results. No horizontal overflow was observed. Final Chromium and WebKit captures show the measured header boundary after adding an in-flow banner; Chromium also exercises a 59px safe area. Archive remains reachable, and Back restores row focus. |
| Honest states         | Saved post count comes from the filtered API response. The empty inspector invites selection; missing video and unrecorded social activity are explained rather than represented as successful publication.                                                                                                                |

The browser test writes these captures into its `test-results/` project directories: `my-work-desktop-list.png`, `my-work-desktop-inspector.png`, `my-work-mobile-inspector-390x844.png`, `manager-desktop-list.png` and `manager-desktop-inspector.png`. The final header-offset and login captures are preserved locally under `.release-evidence/content-ui-final/`. The final WebKit landscape login capture was also viewed: all keypad borders fit inside both the 844 × 390 viewport and the access-pane scrollport with the update banner visible; each key is 48px tall.

## Database verification

The migration was exercised up/down/up against a disposable synthetic database with the pinned PocketBase 0.22.55 binary. Actual collection fields, indexes and private access rules were checked after each step; the original baseline copy remained unchanged. Real route checks covered archive/restore revisions and audit events, stale-revision conflicts, archived-send rejection and preservation of creative content/revision.

A separate synthetic fixture contained 1,201 posts for the authorized store and 150 cross-store decoys. Four sequential real-API queries returned the exact expected active total (1,081), approved marker matches (360), archived marker matches (120) and successive pages across mixed ISO/space timestamps. The cross-store decoys never appeared or affected counts. Raw stored revision timestamps were unchanged. Local query times were 308–416 ms; this bounded fixture check is not a production concurrency or capacity claim.
