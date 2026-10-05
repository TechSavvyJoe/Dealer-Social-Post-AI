# Settings and admin hub: the sample post beside every setting

Date: 2026-10-05. Status: approved by the owner on 2026-10-05 ("that all sounds great do that"), including
the new admin-only setup notes field.

Canvas (eight artboards): https://claude.ai/artifact/FBy61AyUimQQngDNye6fGp

This spec extends `2026-09-18-light-table-ui-design.md` (tokens, type, radii, motion, banned patterns) and
`2026-09-22-streamlined-posting-flow-design.md`. Where this spec is silent, those two apply.

## 1. The idea

A manager changing a setting cannot see what it does. A page tag, a disclosure line, an approval rule and a
Look are all abstract until a post goes out. So every settings section shows a sample post beside it, and
the part of the post that section controls is marked. The sample changes as the manager types, before
anything is saved.

The system administrator gets the same grounding one level up: a setup board with one row per store and one
column per thing a store has to set up, so what is missing is visible without opening a store.

Everything else on these screens is quiet. Forms sit directly on the canvas with hairlines between rows. No
boxed panels, no section tiles, no icons beside headings.

## 2. The sample post tells the truth

The sample is not a mock-up. It is built by the functions that build real posts, in the same order.

- Caption. A fixed sample body goes through `applyDealerBrandKit` (footer, then hashtags) and then
  `buildCopyText` for the Facebook destination (page tag on its own line, compliance scan, team-member
  disclosure first). The sample never assembles these pieces by hand. If one piece has no reusable function,
  extract one from the code that does it today; do not write a second copy.
- Inputs. The saved dealer record overlaid with the unsaved form values, so the sample is live.
- Channels. "Your team can share this to" lists the channels `resolveStoreDefaults` returns for a delivery.
- Approval. The note under the sample states the rule the server applies to a delivery post
  (`pb_hooks/requestPolicies.js`, `initialApprovalStatus`): approval off shares at once; on with no
  narrowing holds every post; "first posts" holds a person's posts until N of theirs are approved;
  "selected post types" holds a delivery only when Deliveries is checked.
- Look. The photo treatment per Look is an illustration drawn in CSS over one bundled sample photo
  (`public/samples/delivery.webp`). The Creative section says so in words: "These previews are
  illustrations; each post is designed around its own photo."
- Sample people. The post is from "Your salesperson". No invented person or customer names.
- Marks. One visual language: a 2 px `brand-ink` underline on marked text, a 2 px dashed `brand-ink`
  outline on the logo. Each mark has a one-sentence note below the sample with the same glyph. Marks carry
  no meaning for assistive technology; the notes do.

What each section marks:

| Section       | Mark                                                                              | Note                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Store profile | none                                                                              | "The caption writer knows your website, phone, address and hours and can mention them. Nothing here is stamped on every post." |
| Channels      | the page tag line                                                                 | "Your Facebook page tag. It is added to every Facebook and Marketplace caption for your team."                                 |
| Voice         | the footer and the hashtag line                                                   | "Your footer and hashtags. They close every caption." (only the parts that are set)                                            |
| Creative      | the headline on the photo and the logo                                            | "The {Look} headline. The signature Look sets its type and the photo finish." and "Your logo, placed {corner}."                |
| Workflow      | the disclosure line, and a "Waiting for you" strip when the rule holds the sample | "The team-member disclosure. It opens every post your team shares." plus the approval note                                     |

Every sentence shown must be true of the code. A sentence that cannot be verified against the code is
replaced by a neutral one.

## 3. Manager dashboard shell

- One row holds the page title (left) and the three text tabs (right) over one hairline. The title is the
  page's `h1`: "Manager dashboard" on Overview, "Dealership settings" on Settings, "Your team" on Team.
- The dealership identity block (logo, name, "Manager dashboard" caption) is removed: the app header
  already shows the dealership and who is posting.
- On phones the title is visually hidden and the tabs stay sticky, as today.
- The page container widens to `max-w-7xl`. Overview and Team keep their content at `max-w-5xl`.

## 4. Settings layout

Three columns at `lg` and up: section rail (about 190 px), form (flexible), sample post (320 to 380 px).

- Rail: a plain list of the five sections. The selected one has a raised fill and `aria-current="page"`.
  Status sits at the right of each row: a check when the section is ready, "1 of 2" when partly done, "Not
  started" when nothing is saved, nothing for Workflow. Below the list: a thin progress bar and "N of 4
  areas ready". Status is read from the saved record, never from unsaved values.
- Below `lg` the rail becomes the horizontally scrolling chip row (same status marks), and the sample post
  collapses to a one-line strip under the section title: thumbnail, "On a post", a one-line summary of what
  this section does to a post, chevron. The strip expands in place to the full sample.
- Form: section title (`h2`, display face) and one sentence. Groups get an `h3`. Rows are separated by
  hairlines on the canvas. Row kinds: field (label above), choice (radio rows with a helper line), switch
  (label and helper left, "On"/"Off" and the switch right), chips (multi-select and small single-select),
  disclosure (a full-width row that opens advanced controls).
- "Easy on top, advanced collapsed." Each section leads with the few controls most stores touch. Everything
  else in that section sits under one collapsed disclosure row.

### Sections

**Store profile.** Website, phone, address, hours, tagline, OEM affiliation.

**Channels.** One collapsible row per channel: name, saved value, status ("Ready" with a check, "Missing"
in warning ink with what it costs, "Optional"), and Edit or Add. Open rows show the fields and "Where to
find these" steps. Facebook (page address and page tag) and Instagram (handle) count toward setup. Google
Business Profile, TikTok, X and LinkedIn share one optional row: the app stores them but a missing one
costs nothing, so they are never called missing. The first row that is not ready opens by default.
Below: "Connected services" with the dealership website and the YouTube channel as two rows.

**Voice.** Brand voice, the Do and Don't phrases, default hashtags (with the lock switch), footer, banned
phrases.

**Creative.** Signature Look as three photo prints of the same sample photo (a radio group), second Look
as chips, playful style, store color, logo (current logo, Replace logo, placement on photos). Under
"Video and advanced": motion, logo size, image quality, classic image styles, custom post types.
The manager can replace the store logo here; the server already accepts a logo from a store's own manager.

**Workflow.** Manager approval (two radio rows; when required, "Which posts need approval?" with Every
post, Each person's first posts and a count, Selected post types and the six types), team-member
disclosure (one switch, the wording field, the existing warning when it is off), and "Advanced workflow
controls": team feature access (Playful style, Video) and channels by post type (one row per post type
with only the channels that type offers).

Compliance copy in this section is unchanged from the code: the FTC explanation, the warning shown when
the disclosure is off, the wording label and its placeholder.

## 5. Saving

One form, one save, as today.

- At `lg` and up the action row is static at the end of the form: "Save changes" (primary), "Discard"
  (ghost), and a status line: "Unsaved changes in Channels and Voice", "Saved 10:32 AM", or "Up to date".
- Below `lg` the same row is the sticky bar at the bottom of the screen.
- Discard asks first, using the existing "Discard unsaved settings?" dialog, then restores every field to
  the saved record.

## 6. One status model

`utils/dealerSetupStatus.ts` is the only place that decides what a store has set up. The manager's rail
and the administrator's board both read it.

- Counted rows (six): Store profile, Brand (logo and color), Facebook, Instagram, Brand voice, Signature
  look.
- Optional rows: Google Business Profile, TikTok, X, LinkedIn.
- Settings rows: Manager approval, Team-member disclosure, Creative system.
- Each row names the settings section it belongs to and, when missing, one true sentence about what that
  costs.

## 7. System admin hub

Shell: "System admin" title and the four text tabs on one row over a hairline.

**Dealers tab: the setup board.** Title "Setup board" and a one-sentence count ("3 dealerships. 5 setup
items are missing across 2 of them."). Toolbar: refresh, search, "Add dealer".

At `md` and up, a table: one row per store; columns Dealership, the six counted rows, Approval (in
words), Creative system (the switch only a system administrator can use). A check means set up; a warning
ring means missing. Opening a row shows:

- "N things left to set up": each missing item, the sentence about what it costs, and a button that opens
  that store's settings as its manager on the right section. A store with no active manager says so and
  offers the Admins tab instead. "Everything on file" is a collapsed list of the saved values.
- Setup notes: free text for the administrator, saved with "Save notes". "Only system admins see these."
- This store's posts: the sample photo in the store's Look with its logo, and the Look names in words.
- Actions: Open as manager, Admins, Users, Edit name and logo, Delete dealership.

Below `md` the board is a list: store, "4 of 6 set up, 2 missing", and the same expanded content stacked.

**Connections tab.** Service rows on the canvas, status in words, "Setup instructions" per row; an aside
with the overall state, what the page checks, and "Check again". No behavior change.

## 8. Setup notes (backend)

- `dealers.setup_notes`: optional text, at most 4,000 characters.
- Written only by a system administrator. A manager's save that carries the field is saved without it,
  the same way `creative_system_v2` is handled.
- Returned only by the administrator's dealer list. Never part of a session payload, so a manager, a
  salesperson, or an administrator opened as a manager never receives it.
- The administrator's dealer list returns every field `serializeDealer` returns, plus `setup_notes`.

## 9. Out of scope

The first-time setup wizard's own steps. The Overview and Team tab contents. The Admins and Users tabs
beyond the shared shell. Applying the store image-quality tier to generation. Using the saved Google
Business Profile link when sharing.
