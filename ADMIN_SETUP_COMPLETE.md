# Archived administrator setup note

This document described a retired short-code login and direct schema-editing workflow. Those instructions are unsafe for the current application and must not be used.

Use [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md) as the authoritative credential guide. Current access uses the system-administrator username and password provisioned from the `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD` deployment secrets, a dealer-scoped manager username and password, or a person's unique four-digit PIN through `/api/app/session`, followed by an opaque server-managed session cookie. Dealers do not have shared login codes. Do not enable public PocketBase collection rules or run one-off credential population scripts.
