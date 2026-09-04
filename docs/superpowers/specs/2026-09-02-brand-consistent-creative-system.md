# Brand-Consistent Creative System

Status: proposed · Date: 2026-09-02 · Owner: Joe Gallant

## 1. Problem

Every post today re-decides the dealership's brand from the phone in hand. The
salesperson chooses from a 5 × 6 × 12 style/tone/scenario matrix (360 cells),
91 Fun Mode styles (79 of which share one generic prompt), ~396 video
combinations (most cosmetic), 10 platforms, 5 canvas sizes, and five free-text
prompt surfaces. Three default authorities fight each other: the dealership's
`default_style`, each scenario's own `defaultStyle`/`defaultTone`, and the
salesperson's last-used tone persisted per device. Brand voice reaches the
caption model only inside a 900-character window and can be silently
truncated; tone never reaches the image model at all.

Result: two salespeople posting the same delivery ship different-looking posts,
and no manager control exists that fixes it. The compliance skeleton (release →
identity lock → claims → approval → exact per-platform files) is sound and is
not the problem.

## 2. Goals

1. One dealership = one recognizable look across every salesperson and category.
2. The salesperson happy path is ≤ 5 decisions: photo → category → who/what →
   playful? → post.
3. Every brand attribute a dealership sets provably reaches the output
   (prompt, deterministic post-processing, or pixels) — never just stored.
4. Fewer, better creative options: a curated slate with real art direction,
   chosen by the dealership, not per post.
5. Reversible: nothing is hard-deleted from the catalog; the slate is
   configuration with an opinionated default.

## 3. Non-goals

- The six categories (deliveries / inventory / service / promotions / community
  / team) do not change.
- FTC/legal disclosure wording and gating do not change.
- Auth flows, PIN login, and the PocketBase tenancy model do not change.
- No new AI capabilities are required; the model bundles existing primitives.

## 4. The creative model

### 4.1 Signature Looks (dealership-owned)

A Look bundles the three axes the salesperson picks separately today.

| Look     | Image treatment (`StyleOption`) | Caption voice (`ToneOption`) | Layout rule                   | Motion (`VideoStyle`) |
| -------- | ------------------------------- | ---------------------------- | ----------------------------- | --------------------- |
| Showroom | Luxury                          | Professional                 | clean type, logo bottom-right | GoldenRadiance        |
| Hometown | Friendly                        | Family                       | warm, headline over photo     | Spotlight             |
| Turbo    | Sporty (or Modern)              | Excited                      | bold type, DepthPop allowed   | LiquidChrome          |

- A dealer admin picks **one** house Look; a manager may enable one alternate.
- Scenarios (today's 12 built-ins + custom) keep driving _content_ through
  `promptAdditions`, but no longer switch style or tone. The three-authority
  conflict disappears because only the Look sets style + tone.
- The per-device `preferredStyle` / `preferredTone` memory is retired.

### 4.2 Playful (one per dealership)

Exactly one Fun Mode style from the 12 featured entries that have hand-written
art direction. Rendered as a **second image** on demand, never replacing the
house-style master. The 79 generic-prompt styles stay in the catalog behind a
`system_admin`-only "extended catalog" flag; they are not shown to dealers.
"Surprise Me", favorites, search, and categories leave the salesperson UI.

### 4.3 Motion (one format)

9:16 · 6 s · 720p · music on, motion style bound to the Look. Manager may enable
a 16:9 variant. Salesperson sees "Add video" (yes/no). The Video Director
option matrix moves to admin configuration; `pacing`, unused presets, and the
9 unreachable `VideoStyle` values are removed from the UI surface (enum kept).

### 4.4 Fixed export and destination sets per category

| Category   | Photo files                   | Video    | Destinations pre-wired         |
| ---------- | ----------------------------- | -------- | ------------------------------ |
| deliveries | 4:5 feed + 9:16 story         | optional | IG Feed, IG Story, Facebook    |
| inventory  | 4:5 feed + 1.91:1 marketplace | optional | IG Feed, Facebook, Marketplace |
| service    | 4:5 feed + 4:3 GBP            | —        | Facebook, Google Business      |
| promotions | 4:5 feed + 9:16 story         | optional | IG Feed, IG Story, Facebook    |
| community  | 4:5 feed + 4:3 GBP            | —        | Facebook, Google Business      |
| team       | 4:5 feed + 1:1                | —        | Facebook, LinkedIn             |

All formats already exist in `EXPORT_FORMATS` and `publishTargets`. This
replaces per-post "Share to", "More platforms", "Main image size",
"Photo/Video/Both", and the 6-format export modal for salespeople.

### 4.5 Result-screen tools

- "Try another photo" and "Try another caption": once each per asset, then
  manager-only.
- Free-text image edit and free-text caption edit: manager permission.
- "Add a personal line": ≤ 140 characters, appended after the caption body,
  never replacing it. This retires "Write my own" and the 10 hardcoded
  templates for salespeople.

## 5. Settings information architecture (by role)

Roles today: `salesperson` · `dealer_admin` · `super_admin`. Add **Sales
manager** as a permission subset of `dealer_admin` (can approve, curate,
enable; cannot change brand kit or compliance). Implement as a `manager_scope`
flag on the person record rather than a fourth login path.

| Section            | Control                                                        | Edits                                                          | Output effect                                            |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Brand kit          | Logo, brand color, name, tagline                               | Dealer admin (name/logo self-service — today super-admin only) | header, watermark, theme                                 |
|                    | Signature Look (+ optional alternate)                          | Dealer admin                                                   | replaces `enabled_styles`/`default_style`; sets tone     |
|                    | Logo placement (corner, size)                                  | Dealer admin                                                   | image prompt + QC                                        |
|                    | Playful style (1 of 12)                                        | Dealer admin                                                   | writes `enabled_fun_styles` (currently unwritable)       |
|                    | Motion signature                                               | Dealer admin                                                   | fixed `VideoRequestOptions`                              |
| Voice & compliance | Brand voice: 3 "do" + 3 "don't" chips + one sentence           | Dealer admin                                                   | structured, guaranteed inside the prompt window          |
|                    | Banned phrases, OEM affiliation                                | Dealer admin                                                   | existing hard block; OEM into wizard                     |
|                    | Required hashtags with "never trim" flag                       | Dealer admin                                                   | fixes the 5-tag cap dropping dealer tags                 |
|                    | Footer / CTA, phone, website, hours                            | Dealer admin                                                   | deterministic footer                                     |
|                    | Social handles, Facebook Page tag                              | Dealer admin                                                   | attribution mention                                      |
| Destinations       | Per-category destination + file set (table 4.4)                | Dealer admin sets, manager narrows                             | replaces per-post choices                                |
|                    | Customer Hub draft on/off per category                         | Dealer admin                                                   | `websiteEnabled` default                                 |
|                    | Image quality tier                                             | Dealer admin                                                   | moves out of the salesperson Settings modal              |
| Approval & cadence | Require approval: none / first N posts / always / per category | Manager                                                        | extends `requires_approval`                              |
|                    | Enable Playful / video for team or per person                  | Manager                                                        | gates the two salesperson toggles                        |
|                    | Curate category sub-templates (today's scenarios)              | Manager                                                        | scenarios become content templates, never style switches |
|                    | Free-text edit permission                                      | Manager                                                        | gates result-screen edits                                |
| Team               | Roster, codes, deactivate                                      | Dealer admin / manager                                         | existing                                                 |
| Personal           | Display name, signature line, headshot                         | Salesperson                                                    | appended after footer                                    |
|                    | Default category; Playful default                              | Salesperson (within allowance)                                 | pre-selects steps 2 and 4                                |
|                    | Theme (Sunlight Mode), haptics                                 | Salesperson                                                    | existing                                                 |

System admin gets a read/write view of any dealership's brand section (today
the only path is impersonation).

## 6. Data model changes (`dealers`)

New fields (all optional; migration seeds defaults from existing values):

- `signature_look` (select: showroom | hometown | turbo), `alternate_look`
- `default_tone` (derived from Look; stored for override auditing)
- `playful_style` (one fun-style id) — supersedes free-form `enabled_fun_styles`
- `motion_signature` (JSON: style, aspects[], audio)
- `logo_placement` (JSON: corner, scale)
- `brand_voice_do[]`, `brand_voice_dont[]` (≤ 3 each, ≤ 60 chars) alongside
  `brand_voice`
- `required_hashtags_locked` (bool)
- `category_destinations` (JSON: category → { platformIds[], formatIds[], video })
- `approval_policy` (JSON: mode, firstN, categories[])
- `feature_permissions` (JSON: playful, video, freeTextEdit — team/person)
- `image_quality_tier` (moves from client localStorage)

`salespeople`: `manager_scope` (bool), `signature_line`, `default_category`,
`playful_default`.

Drop from the UI (keep columns): `gbp_url`, `facebook_url` until a consumer
exists; retire `code`/`admin_code` write paths.

## 7. Prompt-plumbing fixes required for "provably reaches the output"

1. Move brand voice (structured do/don't) and the Look's style/tone into the
   `systemInstruction` block once the proxy whitelist admits it (see the Gemini
   integration assessment, P1 item 6); until then, place them **before** the
   900-character brief window instead of after it.
2. Pass the Look's tone to the image model as part of the structured brief
   class (today tone is caption-only).
3. Honor `required_hashtags_locked`: locked tags are never displaced by
   `AGENCY_DISCOVERY_HASHTAGS`.
4. Apply `logo_placement` in the image prompt and the vision QC contract.
5. Retire `preferredStyle` / `preferredTone` persistence.

## 8. Salesperson flow (target)

1. Photo — take or choose (existing capture + review sheet).
2. Category — six tiles, default from personal setting.
3. Who / what — first name (+ release signature when required); VIN chip
   optional. Only screen with typing.
4. Playful? — single toggle, shown only if enabled.
5. Post — one button. Result shows the house-style master and a
   destination-ordered "Post to Facebook / Post to Instagram" list; "Copy
   caption" secondary; "Try another" once per asset; everything else behind
   "Studio tools" (manager-visible).

## 9. Rollout

- **Phase 1 — foundations (additive, no behavior change):** migration + server
  allowlist for the new fields; dealer-admin Brand section UI; manager scope
  flag; hashtag lock; brand-voice-before-window fix. Ships dark.
- **Phase 2 — Looks and slate:** Look resolver replaces style/tone pickers
  behind a dealer flag `creative_system_v2`; Playful + Motion + category
  destinations honored; option surfaces hidden for salespeople when the flag is
  on. Default flag off; enable per pilot dealership.
- **Phase 3 — simplified flow:** new 5-step customizer + result screen under
  the same flag; retire per-device preference memory; system-admin brand view.
- **Phase 4 — default on:** flag defaults on for new dealerships; migration
  assistant for existing ones (maps their current `default_style` to a Look).

Each phase keeps the 895-test suite green and adds tests for the resolver and
the settings allowlist.

## 10. Success metrics

- Median decisions per post ≤ 5 (instrument the customizer).
- Cross-salesperson look variance per dealership → 0 (Look id on every post).
- Brand-voice presence: 100% of prompts include the do/don't block (assert in
  the prompt builder tests).
- Manager overrides of salesperson posts trend down after Phase 2.
