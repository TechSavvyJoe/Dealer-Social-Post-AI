# Archived administrator setup note

This document described a retired short-code login and direct schema-editing workflow. Those instructions are unsafe for the current application and must not be used.

Use [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md) as the sole authoritative guide for creating, rotating, and validating dealer or administrator credentials. Current login uses the authenticated `/api/app/session` route and an opaque server-managed session cookie; do not enable public PocketBase collection rules or run one-off credential population scripts.
