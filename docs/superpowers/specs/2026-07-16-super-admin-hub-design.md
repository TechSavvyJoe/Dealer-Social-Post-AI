# Super Admin Hub, Personal Codes & Hours Picker

**Date:** 2026-07-16  
**Status:** Approved for implementation planning  
**Product:** Dealer Social Post AI

> **Superseded authentication detail (2026-07-31):** the hub, roles, personal
> PINs, and impersonation decisions remain authoritative. The manager-login
> non-goal and 4-digit-only manager decision are superseded by
> `2026-07-31-manager-password-login.md`. Manager PINs remain a temporary
> compatibility fallback.

## Problem

System admins manage multiple dealerships but cannot:

1. Open a store as manager or salesperson without logging out and re-entering codes.
2. Manage store people from a clear Dealers / Admins / Users navigation.
3. Use short, consistent team access codes (today: 6-digit dealer codes + mixed manager codes).
4. Set business hours without free-text typing.

Setup and multi-store navigation feel cumbersome for the platform owner.

## Goals

- Super admin can **impersonate any manager or salesperson** (real session, banner, one-click exit).
- Super admin hub uses top navigation: **Dealers | Admins | Users**, with a **store filter**.
- **Personal 4-digit codes only** for managers and salespeople (no shared store team code).
- Named **multiple managers per store** and named salespeople, both as people with roles.
- **Hours picker**: toggle days open/closed, select open/close times, persist readable string.
- Simplify dealer create form (no login codes on the dealer record).

## Non-goals

- Changing `ADMIN_DEALER_CODE` env super-admin bootstrap flow (still secret-managed).
- Email/password auth, SSO, or SMS OTP.
- Multi-store access for a single non–super-admin person (one person remains one dealer + one role).
- Hard-deleting people who have post history (soft-deactivate only).

## Decisions (locked)

| Topic         | Choice                                              |
| ------------- | --------------------------------------------------- |
| Architecture  | **A** — one people roster + roles                   |
| Floor login   | Personal 4-digit codes only (no shared dealer code) |
| Manager login | Each manager has unique 4-digit code                |
| Admins        | Named managers, multiple per store                  |
| Hub IA        | Tabs: Dealers / Admins / Users + dealer filter      |
| Impersonation | Real session swap + exit back to super admin        |
| Hours         | Day toggles + time selects → stored text string     |
| Code length   | Exactly **4 digits** for all person pins            |

## Data model

### Evolve `salespeople` → people (recommended path)

Keep the existing collection name **`salespeople`** for minimal migration friction, or rename to `people` in a forward-only migration if clean rename is cheap. Spec uses logical name **people**.

| Field        | Type          | Notes                                                     |
| ------------ | ------------- | --------------------------------------------------------- |
| `id`         | text          | PB id                                                     |
| `dealer`     | relation      | Required                                                  |
| `name`       | text          | Display name, max 120                                     |
| `role`       | text          | `manager` \| `salesperson` (default `salesperson`)        |
| `pin`        | text          | Exactly 4 digits; **globally unique** among active people |
| `active`     | bool          | Soft delete via `active=false`                            |
| `created_at` | text/datetime | ISO                                                       |

Unique index: `pin` where active (or app-level uniqueness check on create/update covering all pins).

### `dealers`

- **Stop using** `code` and `admin_code` for authentication after migration.
- Fields remain temporarily for one-time migration / display cleanup; new UI does not create or require them for login.
- Brand fields, logo, `hours`, settings unchanged in purpose.
- Super-admin bootstrap dealer (`ADMIN_DEALER_CODE` / SYSTEM ADMIN) remains special; not a normal store.

### `sessions`

Extend session rows (or equivalent metadata) to support impersonation:

| Field                  | Notes                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| `dealer`               | Target dealership                                                              |
| `role`                 | `super_admin` \| `dealer_admin` \| `salesperson`                               |
| `person`               | Optional FK to people id when not super_admin                                  |
| `impersonator_session` | Optional: opaque session id/token hash of the super-admin session being paused |
| `is_impersonation`     | bool                                                                           |

Exact column names may match existing PB session schema; add only missing fields via migration.

### Role mapping

| Person role      | Session role   | Landing UI           |
| ---------------- | -------------- | -------------------- |
| `manager`        | `dealer_admin` | DealerAdminDashboard |
| `salesperson`    | `salesperson`  | Capture / post flow  |
| (env admin code) | `super_admin`  | Admin hub            |

## Authentication

### Dialpad login (`POST /api/app/session`)

Resolve order:

1. If credential matches configured `ADMIN_DEALER_CODE` → `super_admin` (existing auto-provision behavior).
2. Else look up **active** person by exact 4-digit `pin` → session for that person's dealer + mapped role + `person` id.
3. Else `401 Invalid code`.

Rules:

- Person pins must be `^\d{4}$`.
- Super-admin code length/policy remains env validation (`isValidAdminDealerCode`); dialpad UI can still accept the configured length for admin secret.
- Rate limit / lockout unchanged (or keep current 10 fails / 15 min).
- On success, mint opaque session cookie as today.

### Impersonation (super_admin only)

- `POST /api/app/session/impersonate` body: `{ personId: string }`
  - Caller must be `super_admin`.
  - Target person must exist and be `active`.
  - Mint new session with target role/dealer/person, set `is_impersonation=true`, store link to current super-admin session.
  - Replace cookie with new session token.
  - Log `auth_events`: `impersonate_start`.

- `POST /api/app/session/exit-impersonate`
  - Caller session must be impersonation.
  - Restore super-admin session cookie (or mint fresh super-admin session from stored impersonator reference).
  - Revoke impersonation session.
  - Log `impersonate_exit`.

- UI: persistent banner while impersonating: name, role, store, **Exit** button.
- Super admin may not impersonate another super admin (N/A — people are store-scoped).

### Tenant isolation

- Non–super-admin APIs continue to scope by session dealer.
- People CRUD:
  - `dealer_admin`: only their dealer; managers can manage salespeople and (optional) fellow managers at same store — **default:** managers can CRUD salespeople at their store; only super_admin creates/edits managers (avoids managers demoting each other). Spec choice: **super_admin manages all managers; dealer_admin manages salespeople only**.
  - `super_admin`: any dealer; list supports `?dealer=` filter and `?role=manager|salesperson`.

## Super admin hub UI

Replace the single long AdminDashboard stack with:

### Chrome

- Title: System Admin
- Tabs: **Dealers | Admins | Users**
- **Store filter** dropdown: All dealers | specific dealer (persists in component state)
- Impersonation banner when active

### Dealers tab

- List dealers (exclude or de-emphasize SYSTEM ADMIN bootstrap dealer if desired).
- Actions: Add dealer, Edit (name, logo, brand, hours, settings fields appropriate for super admin), jump to Admins/Users filtered to that dealer.
- **No** dealer `code` / `admin_code` fields on create/edit.

### Admins tab

- Table of people with `role=manager`, filtered by store filter.
- Columns: name, store, pin (reveal/copy for admin only), active, actions.
- Actions: Add, Edit, Deactivate, **Open as**.
- Add form: dealer (required if filter is All), name, pin (generate 4-digit unique helper).

### Users tab

- Same as Admins for `role=salesperson`.
- Dealer admin Team tab reuses the same list/add patterns for salespeople only.

### Cleanup

- Remove embedding of leaderboard/approval/history as the primary chrome for multi-dealer admin **or** move under an optional Overview sub-section so people management is primary. Prefer: **Dealers tab first**; health/approvals can remain as secondary panels on Dealers or a thin Overview strip — not mixed into Admins/Users lists.

## Hours picker

Shared component used in:

- DealerAdminDashboard settings
- DealerSetupWizard
- Super-admin dealer edit (if hours exposed there)

### UX

- Seven rows: Mon–Sun
- Click day to toggle Open / Closed
- When open: two selects (open time, close time), 30-minute steps (or 15)
- Optional: “Copy Mon → weekdays”
- Live preview of serialized string

### Storage

- Keep single `dealers.hours` string field.
- Serializer produces caption-friendly text, e.g.  
  `Mon–Fri 9:00 AM–8:00 PM, Sat 9:00 AM–6:00 PM, Sun closed`
- Parser: best-effort parse existing free text into structure for edit; if unparseable, start blank structure and show “current value” once for migration.

## Frontend / backend touchpoints (implementation map)

| Area               | Files (indicative)                                                                      |
| ------------------ | --------------------------------------------------------------------------------------- |
| Login resolve      | `pb_hooks/main.pb.js`, `pb_hooks/helpers.js`, `pb_hooks/requestPolicies.js`             |
| People APIs        | `main.pb.js` salespeople routes → role + pin uniqueness + dealer filter for super_admin |
| Impersonate routes | `main.pb.js` + session helpers                                                          |
| Super admin UI     | `components/AdminDashboard.tsx` restructure                                             |
| Manager team UI    | `components/DealerAdminDashboard.tsx` (salespeople only)                                |
| Hours              | new `components/HoursPicker.tsx`; wire into settings + wizard                           |
| Dialpad            | `components/LoginScreen.tsx` — 4-digit primary UX                                       |
| Types/services     | `types.ts`, `services/salespeople.ts`, `services/database.ts`                           |
| Session store      | `stores/appStore.ts` — person id, impersonation flag                                    |
| Migrations         | `pb_migrations/*` role field, pin length, session impersonation fields                  |
| Tests              | backend hook tests, AdminDashboard / hours / login unit tests                           |

## Migration plan

1. Add `role` to people collection (default `salesperson`).
2. Enforce pin = 4 digits on write; unique pin check.
3. For each dealer with `admin_code`: if no manager person exists, create manager named “Manager” (or dealer name + “ Manager”) with pin derived/normalized from admin_code when possible, else generate.
4. For each dealer with `code`: do **not** keep as shared login; optionally create no auto salesperson (codes were shared). Document that floor staff need personal pins.
5. Existing salespeople: if pin is 4 digits unique, keep; else generate new pin and surface in admin UI (cannot email automatically).
6. Stop accepting `dealers.code` / `dealers.admin_code` in login path.
7. Super-admin UI ships with tabs + impersonation.

## Security

- 4-digit space is small: retain lockout, log failures, unique pins, HttpOnly cookies, server-side role.
- Impersonation restricted to super_admin; audit start/exit with person + dealer ids.
- Never return other dealers’ pins to non–super-admin.
- PIN display in super-admin lists is intentional for owner ops; do not log pins in plaintext auth_events.

## Testing (acceptance)

1. Super admin sees Dealers / Admins / Users; filter by store works.
2. Create dealer without codes; add manager + salesperson with 4-digit pins.
3. Dialpad manager pin → manager dashboard; salesperson pin → capture flow.
4. Super admin Open as manager → banner → can use manager tools; Exit → back to hub.
5. Super admin Open as salesperson → capture flow; Exit → hub.
6. Duplicate pin rejected.
7. Hours picker toggles/days save string; caption generation still receives hours text.
8. Rate limit still locks after repeated bad pins.
9. Dealer admin cannot create managers; can add/deactivate salespeople for own store.

## Open implementation details (non-blocking)

- Collection rename `salespeople` → `people` vs keep name + `role` field only (prefer **keep name + role** unless rename is free).
- Whether SYSTEM ADMIN dealer appears in Dealers list (prefer hide or badge as system).
- Exact 15- vs 30-minute hour steps (default **30**).
