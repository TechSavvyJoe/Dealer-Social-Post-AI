# Dealer-scoped manager username/password login

**Date:** 2026-07-31
**Status:** Implemented and locally verified
**Product:** Dealer Social Post AI

## Decision

Dealership managers receive dealer-scoped application accounts. They do not
share the system-admin credential and do not receive PocketBase dashboard,
Fly.io, Vercel, Cloudflare R2, or provider-key access. Salespeople continue to
use personal four-digit PINs. Manager PINs remain as a compatibility fallback
for one release.

System-admin access remains the exact, case-sensitive 12-character deployment
secret. Manager access uses a unique normalized username and an exact 15–128
character password. Passwords permit spaces and have no composition rule.

## Data and authority

- `salespeople.manager_username` holds the normalized public identifier only.
- A locked `manager_accounts` PocketBase auth collection owns password
  verifiers and relates one-to-one to a manager person.
- Built-in email, username, OAuth, public record, and manage-rule auth paths are
  disabled. The browser receives only the existing opaque app-session cookie.
- Password-backed sessions store the related account id plus a one-way
  fingerprint of PocketBase's credential token key. Every request revalidates
  that fingerprint, the active manager, role, dealership, PIN version, and
  expiry before refreshing the session.
- PIN rotation, password replacement, password disablement, role change, and
  deactivation revoke every session for the person.
- Credential mutations re-read and validate the person inside the same audited
  database transaction, preventing a stale write from undoing a concurrent PIN
  rotation, demotion, or deactivation.

## API contract

Manager login:

```http
POST /api/app/session
Content-Type: application/json

{
  "authType": "manager_password",
  "username": "store.manager",
  "password": "<exact-manager-password>",
  "turnstileToken": "optional risk-triggered token"
}
```

Invalid pairs return `INVALID_CREDENTIALS` without identifying which field was
wrong. Known and unknown syntactically valid usernames both perform a
PocketBase password-verification operation whenever an account exists.

System-admin-only management:

- `PUT /api/app/salespeople/:id/manager-login` accepts `{ username, password }`
  and atomically creates/replaces the credential and revokes sessions.
- `DELETE /api/app/salespeople/:id/manager-login` removes the credential and
  revokes sessions.
- Both responses are `private, no-store`; neither returns a password,
  password hash, token key, credential fingerprint, or PocketBase auth token.

Roster DTOs add `hasManagerLogin` and optional `managerUsername`. Session
identity remains the minimal `PersonSummary` and contains no credential state.

## UX

- Login offers **My code**, **Manager**, and **System** modes with explicit
  labels and mobile-sized targets.
- Username normalization is limited to trim/lowercase. Password values are
  never trimmed, normalized, logged, retained after failure, or persisted in
  browser storage.
- The system-admin manager editor uses new-password autocomplete, confirmation,
  optional reveal, clear validation, and an explicit disable confirmation.
- New-manager onboarding keeps the one-time PIN visible and exposes a separate
  **Set up manager login** action so opening the editor cannot hide the PIN
  before handoff.

## Verification evidence required before release

- Fresh and deliberately dirty PocketBase 0.22.37 migrations.
- Direct built-in `manager_accounts/auth-with-password` denial with no token.
- Exact password login in Chromium and WebKit.
- Super-admin-only configuration and manager 403 denial.
- Session revocation after PIN rotation, password replacement, disablement,
  role change, and deactivation.
- Old password rejection, new password acceptance, and PIN fallback after
  password disablement.
- Component coverage for validation, write-only fields, authorization,
  confirmation, keyboard/focus behavior, and generic errors.
