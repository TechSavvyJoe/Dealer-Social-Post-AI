#!/usr/bin/env bash
# Smoke test for the 2026-05-28 auth hardening pass. Run against either
# a local dev instance (BASE=http://localhost:8090) or the deployed Fly app.
#
# Usage:
#   BASE=https://dealer-social-post-ai-production.fly.dev \
#   DEALER_CODE=<your salesperson code> \
#   ADMIN_CODE=<your super-admin code> \
#   ./scripts/smoke_test_auth.sh
#
# Exits 0 if every assertion holds. Exits non-zero on first failure with the
# offending response in stderr.
set -uo pipefail

BASE="${BASE:-http://localhost:8090}"
DEALER_CODE="${DEALER_CODE:-}"
ADMIN_CODE="${ADMIN_CODE:-}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
note()  { printf "\033[36m%s\033[0m\n" "$*"; }

fail() { red "✗ $*"; exit 1; }
pass() { green "✓ $*"; }

note "BASE=$BASE"

# -----------------------------------------------------------------------------
# 1. Health check responds.
# -----------------------------------------------------------------------------
HEALTH=$(curl -sS -w '\n%{http_code}' "$BASE/api/app/health")
HEALTH_CODE=$(echo "$HEALTH" | tail -n1)
[ "$HEALTH_CODE" = "200" ] || [ "$HEALTH_CODE" = "503" ] \
  || fail "Health check returned $HEALTH_CODE"
pass "Health endpoint reachable ($HEALTH_CODE)"

# -----------------------------------------------------------------------------
# 2. Proxy with NO auth → 401.
# -----------------------------------------------------------------------------
CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/proxy/v1beta/models/gemini-3.6-flash:generateContent" \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "401" ] || fail "Proxy without auth returned $CODE (expected 401)"
pass "Proxy rejects unauthenticated requests"

# -----------------------------------------------------------------------------
# 3. Forged legacy cookie (id::role) → rejected.
# -----------------------------------------------------------------------------
CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/app/posts" \
  -H "Cookie: dealer_session=fakeid123::super_admin" \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "401" ] || fail "Forged ::role cookie was accepted (got $CODE)"
pass "Forged ::role cookie rejected with 401"

# -----------------------------------------------------------------------------
# 4. Random hex token (not in DB) → rejected.
# -----------------------------------------------------------------------------
RAND_TOKEN=$(head -c 32 /dev/urandom | xxd -p -c 32 | tr -d '\n')
CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/app/posts" \
  -H "Cookie: dealer_session=$RAND_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "401" ] || fail "Random opaque token was accepted (got $CODE)"
pass "Random opaque token rejected with 401"

# -----------------------------------------------------------------------------
# 5. Login rate limit triggers after 10 fails.
# -----------------------------------------------------------------------------
note "Hammering login endpoint with bogus codes…"
CODES=""
for i in $(seq 1 12); do
  C=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$BASE/api/app/session" \
    -H "Content-Type: application/json" -d '{"dealerCode":"9876"}')
  CODES="$CODES $C"
done
LAST=$(echo "$CODES" | awk '{print $NF}')
if [ "$LAST" = "429" ]; then
  pass "Login rate limit fires (got 429 on attempt 12)"
else
  red "  attempts: $CODES"
  fail "Expected last attempt to be 429, got $LAST"
fi

# -----------------------------------------------------------------------------
# 6. Real login succeeds + session cookie is opaque + GET resolves.
#    Skip if DEALER_CODE not set.
# -----------------------------------------------------------------------------
if [ -n "$DEALER_CODE" ]; then
  COOKIE_FILE=$(mktemp)
  LOGIN_BODY=$(curl -sS -c "$COOKIE_FILE" -X POST "$BASE/api/app/session" \
    -H "Content-Type: application/json" \
    -d "{\"dealerCode\":\"$DEALER_CODE\"}")
  ROLE=$(echo "$LOGIN_BODY" | grep -o '"role":"[^"]*"' | head -1)
  [ -n "$ROLE" ] || fail "Login with DEALER_CODE failed: $LOGIN_BODY"
  pass "Real dealer login succeeded ($ROLE)"

  COOKIE_VAL=$(grep dealer_session "$COOKIE_FILE" | awk '{print $NF}')
  case "$COOKIE_VAL" in
    *"::"*) fail "Cookie still contains '::' separator: $COOKIE_VAL" ;;
    *) pass "Cookie is opaque (no '::' tampering surface)" ;;
  esac

  GET_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
    -b "$COOKIE_FILE" "$BASE/api/app/session")
  [ "$GET_CODE" = "200" ] || fail "GET /api/app/session returned $GET_CODE"
  pass "GET session resolves opaque token"

  rm -f "$COOKIE_FILE"
else
  note "(skipping live login — DEALER_CODE not set)"
fi

green ""
green "All assertions passed."
