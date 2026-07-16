# Dealer login setup

Dealer login codes are six-digit credentials. Treat them like passwords: create
them through the authenticated super-admin UI, distribute them out of band, and
never put real values in source control, screenshots, logs, or support tickets.

## Current architecture

- Browser login goes through `POST /api/app/session`.
- The server validates the code and returns an opaque, HttpOnly session cookie.
- PocketBase collection rules remain locked. Public access to `dealers` is not
  required for login and must not be enabled.
- New schema changes are forward-only migrations in `pb_migrations/`; do not
  mutate production schemas with one-off scripts.

## Create or rotate a code

1. Sign in with the configured super-admin account.
2. Open the dealership management screen.
3. Create a dealer with a unique six-digit code, or rotate the code through the
   approved admin workflow.
4. Verify the old credential no longer works and the new credential creates an
   opaque session cookie.

Do not use predictable sequences or shared demo values. `ADMIN_DEALER_CODE` is
configured only in the deployment secret manager and must match the designated
super-admin dealer. No default is provided.

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
