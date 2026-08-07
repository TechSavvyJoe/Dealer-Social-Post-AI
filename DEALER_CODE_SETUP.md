# Access and manager-login setup

Dealer Social Post AI has three distinct credential types. Do not share or
substitute one for the other:

- The system administrator signs in with a username and an exact 8–128
  character password. The account is provisioned from the
  `ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` deployment secrets.
- Dealership managers sign in with a dealer-scoped username and an exact
  8–128 character password configured by the system administrator.
- Salespeople sign in with personal, unique four-digit PINs. Manager PINs
  remain available as a temporary compatibility fallback.

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
