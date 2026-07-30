# Access-code setup

Dealer Social Post AI has two distinct credential types. Do not share or
substitute one for the other:

- The system administrator signs in with the exact, case-sensitive
  12-character alphanumeric `ADMIN_DEALER_CODE` deployment secret.
- Managers and salespeople sign in with personal, unique four-digit PINs
  managed through the authenticated people workflow.

Treat both like passwords. Distribute credentials out of band and never place
real values in source control, screenshots, logs, support tickets, or release
evidence.

## Current architecture

- Browser login goes through `POST /api/app/session`.
- The server validates the code and returns an opaque, HttpOnly session cookie.
- The system-administrator secret is held only in secure deployment
  configuration. The database stores a stable system-dealer marker and one-way
  session fingerprints, not the secret itself.
- A personal session is continuously revalidated against that person's active
  status, dealer, current role, and credential version.
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

## Configure or rotate system-administrator access

`ADMIN_DEALER_CODE` has no default. It must be exactly 12 alphanumeric
characters and is case-sensitive. Store it only in the deployment secret
manager and a password manager or Keychain. The login field preserves typed
case; never uppercase, lowercase, trim, log, or persist the value in a dealer
record.

Rotating the deployment secret invalidates existing administrator session
fingerprints. Complete a rotation by proving the prior secret, prior
administrator sessions, and derived impersonation sessions all fail. Use the
coordinated production runbook for the compatibility-phase and final
mixed-case rotation sequence; do not perform an uncoordinated rotation during
a split frontend/backend release.

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
