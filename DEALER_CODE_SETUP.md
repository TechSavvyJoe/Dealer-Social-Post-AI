# Access and manager-login setup

Dealer Social Post AI has three distinct credential types. Do not share or
substitute one for the other:

- The system administrator signs in with a username and an exact 8–128
  character password. The account is provisioned from the
  `ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` deployment secrets.
- Dealership managers sign in with a dealer-scoped username and an exact
  8–128 character password configured by the system administrator.
- Personal-code sign-in uses a private dealership invitation plus a unique
  four-digit PIN. Manager password sign-in remains available for recovery.

Treat each credential as sensitive. Distribute credentials out of band and never place
real values in source control, screenshots, logs, support tickets, or release
evidence.

## Current architecture

- Browser login goes through `POST /api/app/session`.
- The server validates the selected credential and returns an opaque, HttpOnly
  app session cookie. It never returns a PocketBase auth token.
- The system-administrator account lives in the locked `admin_accounts`
  PocketBase auth collection (one-way password verifier only). It is
  provisioned and rotated at boot from the `ADMIN_LOGIN_USERNAME` and
  `ADMIN_LOGIN_PASSWORD` deployment secrets. Sessions bind to the account's
  token key, so a password rotation invalidates outstanding admin sessions.
- A personal session is continuously revalidated against that person's active
  status, dealer, current role, and credential version.
- Manager passwords use PocketBase's one-way password verifier in a locked
  `manager_accounts` auth collection. Built-in username, email, OAuth, and
  public record authentication are disabled for that collection.
- PocketBase collection rules remain locked. Public access to `dealers` is not
  required for login and must not be enabled.
- New schema changes are forward-only migrations in `pb_migrations/`; do not
  mutate production schemas with one-off scripts.

## Set up private dealership invitations

New dealerships require an invitation before any personal code can sign in.
Existing dealerships keep their current access until the manager distributes a
link and explicitly activates the requirement.

1. In the system-admin **Dealers** setup board, expand the store and open
   **Private dealership access**. A manager finds the same panel under **Team**.
2. Choose **Create private invitation**. Copy the one-time link and distribute it
   privately to the team. The normal dealer list never reveals it again.
3. Each person opens the link on their own device, chooses **Set up this device**,
   then signs in with their personal code. Repeat on each device/browser. Installed
   iPhone web apps may have separate browser storage; open the invitation there too.
4. For an existing store, only after distribution choose **Require invitation for
   sign-in**. Uninvited personal-code sessions end. The manager performing the
   action stays signed in; manager passwords and authorized admin impersonation
   remain available for recovery.
5. Use **Replace private invitation** if a link is lost or exposed. Previous links,
   invited devices and personal-code sessions become invalid, except the manager
   performing the replacement. Distribute the new link. Deactivate a departing
   person separately to revoke that individual's access.

The link puts its 256-bit random token in `/join#<token>`, never a query parameter.
Explicit redemption removes it from the address and stores an HttpOnly, Secure,
SameSite=Strict cookie for 90 days at `/api`. SQLite stores only a domain-separated
SHA-256 verifier. The invitation selects a dealership; the personal code selects
the individual. Invitation/session checks and manager mutations fail closed, and
rotation is rechecked during session creation. No invitation is sent automatically.
After any store enables invitations, rollback must retain these invitation-aware
backend hooks. A pre-invitation application image would ignore this policy; roll
forward or use an invitation-aware rollback image instead. The additive schema
is deliberately not removed by a down migration.

A manager who loses both device access and the link uses their password or contacts
the system administrator for a replacement.

## Create or rotate a personal PIN

1. Sign in with the configured super-admin account.
2. Open the dealership's people management screen.
3. Create a manager or salesperson, or use the approved rotate-PIN action for an
   existing person.
4. Copy the generated four-digit PIN from the one-time credential response and
   deliver it directly to that person. Ordinary roster and session responses
   expose only `hasPin`, never the PIN.
5. Acknowledge any migrated PIN marked for distribution after the person
   receives it.
6. For rotations, verify the prior PIN and prior sessions no longer work before
   considering the handoff complete.

PINs are personal and must not be reused as a shared store credential.

## Configure, replace, or disable manager sign-in

1. Sign in as system administrator and open **Admins** for the correct
   dealership.
2. Create or edit the manager, then choose **Set up manager login**.
3. Assign a unique 3–32 character username. It starts with a letter and may use
   lowercase letters, numbers, periods, dashes, and underscores.
4. Enter and confirm an 8–128 character password. Spaces are allowed; password
   case and whitespace are preserved exactly.
5. Deliver the username and password through a private channel. The password is
   write-only: it is never returned or revealable after saving.

Replacing or disabling manager sign-in revokes every current session for that
manager. Changing their PIN, role, or active status does the same. Only the
system administrator can configure manager username/password access;
dealership managers never receive PocketBase dashboard, Fly, Vercel, R2, or
system-admin credentials.

The app contract is:

```json
{
  "authType": "manager_password",
  "username": "store.manager",
  "password": "<exact value>"
}
```

An invalid username/password pair returns the generic
`INVALID_CREDENTIALS` error. It does not disclose whether the username exists.
Rate limiting, risk-triggered Turnstile, and the hard lockout apply to manager,
PIN, and system-admin attempts through the same `/api/app/session` route.

## Configure or rotate system-administrator access

`ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` have no defaults. The
username is 3–32 characters starting with a letter; the password is 8–128
exact characters. Store both only in the deployment secret manager and a
password manager or Keychain. Never log the password or persist it outside
the PocketBase password verifier.

On every boot the server provisions the administrator account from these
secrets: it creates the account if missing, renames it on a username change,
and resets the password on a password change. Rotating the password changes
the account's token key, which immediately invalidates existing administrator
sessions and derived impersonation sessions. Complete a rotation by proving
the prior password and prior administrator sessions no longer work.

## Read-only maintenance checks

The supported diagnostic scripts require an explicit target and PocketBase
superuser credentials. Keep the values in your shell or secret manager:

```bash
PB_URL="https://your-pocketbase-host.example" \
PB_ADMIN_EMAIL="admin@example.com" \
PB_ADMIN_PASSWORD="<read-from-secret-manager>" \
node scripts/check_all_rules.js
```

The expected production state is `null` (locked) for every dealers collection
rule. Mutating maintenance commands additionally require an exact target and an
explicit confirmation phrase documented by the script; this is an execution
guard, not a substitute for a backup and change review.
