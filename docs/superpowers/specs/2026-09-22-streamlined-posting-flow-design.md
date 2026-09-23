# Streamlined posting flow — design

Date: 2026-09-22. Status: approved by Joe (flow, category tiles first, one small
Look choice). Companion to `2026-09-18-light-table-ui-design.md`, which owns the
visual system; this spec owns the salesperson's sequence of screens.

## 1. Why

A five-area code audit (capture, details, publish, creative variants,
history/admin) counted the most common job — a salesperson posting a customer
delivery to Facebook from a phone — at **19 taps, 4 screens and 3 modals**:

- the photo is confirmed twice (the OS camera, then a "Review photo" modal that
  cannot crop, rotate or straighten);
- "Post details" is one scroll of 7 sections and ~40 controls (12 scenarios,
  5 Looks, tone chips, caption source, photo/video/both, pixel sizes), the
  customer's name is typed twice (first name, then full name in the release
  sheet), four channels are pre-selected so Facebook-only costs three deselects,
  and "Create post" is enabled while the required release is missing;
- the publish studio makes **Save** the filled button while **Share** takes two
  taps through a modal whose copy explains the WebKit activation rule; phones
  cannot type into the caption; optional tools (Video, Fun mode, Schedule, More)
  sit at the same weight as the job;
- leaving after a successful share warns "Create another post? … Discard and
  continue".

Joe's verdict on 2026-09-19: not streamlined, not professional — and "not just
the coloring, the whole workflow".

## 2. Decisions (2026-09-22)

1. **Flow approved**: Home → Details → Creating → Post → Shared (§3).
2. **Category tiles first**: Home shows the six categories; tapping one opens
   the camera. The tile decides the scenario, the release rule and the default
   channels.
3. **Creative choice**: salespeople keep **one small Look choice** — 2–3 options
   curated by the manager — on the Post screen. Tone, sizes, caption source,
   Fun Mode's style browser and the Video Director option matrix leave the
   salesperson flow. "Add video" and "Playful" are single taps, only where the
   store allows them per category.

## 3. The flow (salesperson, phone-first; desktop mirrors it in a card)

Target for the delivery-to-Facebook job: **10 taps, 3 screens, 1 sheet, name
typed once, nothing confirmed twice.**

### 3.1 Home — "What are you posting?"

- Six tiles: Delivery · New arrival · Service · Promotion · Community · Team
  (the Hub's final six categories; custom dealer scenarios appear as extra tiles
  only when the store has them).
- Tapping a tile opens the native camera on phones (`capture="environment"`)
  and the file picker on desktop; "Choose from library" is the tile's long-press
  / secondary on phones and a link on desktop. Drag-and-drop stays on desktop.
- Below the fold: **My work** — the last posts with status (Shared · Waiting
  for approval · Draft) and "See all".
- Retired here: the "Start with a photo" screen, the dead preview panel, the
  "Recent originals" strip and its retention copy (recovery stays reachable from
  My work), the progress rail, the walkaround/photo mode toggle (when the
  walkaround flag is on it is a seventh tile, "Walkaround video").

### 3.2 Details

- The photo is the hero (edge-to-edge on phones, 4:3 well on desktop) with
  "Change photo". The **Review photo modal is removed** — the OS camera already
  confirmed the frame; a real crop/rotate can return later as "Adjust" on this
  screen, never as a mandatory step.
- Delivery (and every customer-facing category): one row, "Customer's
  signature — Needed", and one button, **Get customer's signature**, opening one
  sheet: the consent text in plain language, "Customer's full name", the
  signature pad (draw or type + attestation), "Done". The public first name is
  derived from the release; nothing is typed twice. After signing the row reads
  "Signed · Maria Lopez" and the name is locked as today.
- Vehicle: "Scan VIN · optional" (manual entry inside the same sheet; on iOS
  the sheet opens directly in manual mode instead of a dead camera box).
- One optional line, "Anything to mention?" (the 140-character personal line),
  collapsed by default.
- **Create post** is enabled only when the category's requirements are met and
  the disabled state says why ("Needs the customer's signature first"). No Look,
  tone, size, caption source, channel matrix, media mode or "Advanced options"
  on this screen.
- Non-customer categories skip the signature row; the screen is photo + optional
  vehicle + optional line + Create post.

### 3.3 Creating

- One honest state on top of the photo: "Creating your post…" with real stages
  from the generation hook (Design → Caption → Checks), no synthetic percentage,
  no second message stream. **Cancel** returns to Details with everything kept.

### 3.4 Post

- A preview card that looks like the destination post: avatar + salesperson +
  store, the creative, the caption with the employee disclosure inside it.
- **Share to {channel}** is the single primary. It opens the OS share sheet
  directly (the WebKit activation is preserved by invoking `navigator.share`
  synchronously from the tap) with the caption already on the clipboard. Desktop:
  "Download" + "Copy caption".
- Channels: the store's defaults as chips (e.g. Facebook · Instagram); toggling
  one changes which exact file the share prepares. No batch checkboxes, no
  guided-share queue, no "Preparing" tiles for outputs nobody selected.
- Secondary row: **Edit caption** (inline text editing on every device, with
  the identity guard and prohibited-claims check re-run on blur), **Try
  another** (one regenerate of image + caption; brand mode's one-shot budget
  stays), the **Look** choice (2–3 manager-curated options, decision 3), and
  **Add video** / **Playful** only where the store allows them for this
  category.
- Locks (approval pending, release not saved, image review, claims, identity)
  are one banner with one action — never a banner plus a bar plus a toast.
- Retired from the salesperson flow: the "Share exact output" modal, the
  "Finish in the Facebook app" checklist after a completed share, Export sizes,
  Schedule (reminder-only), Fun Mode's browser, the Video Director matrix, the
  "More" panel and its duplicated regenerate/edit tools, the platform caption
  tabs (per-channel captions are derived; the salesperson edits one caption).

### 3.5 Shared

- After the share sheet completes: "Shared to Facebook" is recorded on the post
  and shown; **Done** returns Home; the post sits in My work with that status.
  Leaving never warns after a share or a save; the discard guard fires only for
  an unsaved post.

### 3.6 My work

- A list, not a modal: each post with its creative thumbnail, category, date and
  status; tap to reopen the Post screen (read-only for teammates' posts). The
  device-local recovery grid lives here as one section, in the same visual
  language, with confirm-on-delete.

## 4. Set once by the manager (PR3)

Default channels; the creative slate (the 2–3 Looks offered, the tone, Playful
on/off and video on/off per category); employee disclosure text; approval
on/off; the Facebook page handle for caption tagging. Salespeople see the
results of these settings, never the settings.

## 5. Invariants that do not move

Photo-release gate before any AI processing; release ↔ name ↔ VIN lock;
first-name-only public label; customer-identity guard on typed text and on
generated captions (client, save, server); prohibited-claims/pricing checks;
disclosure kept outside the editable body and inside every outgoing caption;
manager approval lock; offline-honest saving; exact per-destination file
preparation; the WebKit share activation mechanism.

## 6. Delivery plan

- **PR2 — the salesperson flow**: Home, Details (+ signature sheet, VIN sheet),
  Creating, Post, Shared, My work list. Replaces CameraCapture/ImageCropModal/
  PostCustomizer/LoadingOverlay/PostResult/MobilePublishStudio/ShareDialog as
  screens; the services and hooks behind them (generation, release storage,
  delivery plan, guards) are reused.
- **PR3 — manager and admin**: settings for §4, the approvals queue as one
  screen (preview + Approve/Reject), the team roster, system admin, all on the
  Light Table system. The walkaround studio stays behind its flag and is
  restyled last.

Design record: the canvas
`https://claude.ai/artifact/MG9T8X83CRWD4XBELJhnwB` (row "Workflow — today vs
proposed", then the PR2 screens).
