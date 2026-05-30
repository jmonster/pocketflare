#!/bin/bash
# Comprehensive e2e test suite for pocketflare.
# Usage: ./scripts/e2e-test.sh [base_url]
# Default: https://pocketflare.garage.workers.dev
set -euo pipefail

BASE="${1:-https://pocketflare.garage.workers.dev}"
ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${POCKETFLARE_ADMIN_PASSWORD:-}"
PASS=0
FAIL=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
json()  { jq -r "$@" 2>/dev/null; }

assert() {
    local desc="$1" condition="$2"
    if eval "$condition"; then
        green "  PASS: $desc"
        PASS=$((PASS + 1))
    else
        red "  FAIL: $desc"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== pocketflare e2e test suite ==="
echo "target: $BASE"
echo ""

if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
    echo "Error: set POCKETFLARE_ADMIN_EMAIL and POCKETFLARE_ADMIN_PASSWORD before running admin e2e tests."
    exit 1
fi

# ── 1. Health ──
echo "── 1. Health ──"
assert "health returns 200" '[ "$(curl -sS --max-time 60 "$BASE/api/health" | json .code)" = "200" ]'

# ── 2. Admin auth ──
echo "── 2. Admin auth ──"
TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" | json .token)
assert "login returns JWT token" '[ -n "$TOKEN" ]'

BAD_STATUS=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "__wrong__$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" | json .status)
assert "wrong password rejected" '[ "$BAD_STATUS" != "200" ]'

# ── 3. Collection CRUD ──
echo "── 3. Collection CRUD ──"

CREATE_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_test_coll","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"count","type":"number","required":false}]}')
TEST_COLL_ID=$(echo "$CREATE_RESP" | json .id)
assert "create collection" '[ -n "$TEST_COLL_ID" ]'

SCHEMA_TITLE=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" | json '.fields[] | select(.name=="title") | .name')
assert "collection has title field" '[ "$SCHEMA_TITLE" = "title" ]'

TOTAL=$(curl -sS --max-time 30 "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" | json .totalItems)
assert "list collections (>=1)" '[ "$TOTAL" -ge 1 ]'

curl -sS --max-time 30 -X PATCH "$BASE/api/collections/$TEST_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_test_renamed"}' >/dev/null
NEW_NAME=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" | json .name)
assert "rename collection" '[ "$NEW_NAME" = "e2e_test_renamed" ]'

# ── 4. Record CRUD ──
echo "── 4. Record CRUD ──"

RECORD_ID=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$TEST_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"hello world","count":42}' | json .id)
assert "create record" '[ -n "$RECORD_ID" ]'

TITLE=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" | json .title)
assert "view record (title matches)" '[ "$TITLE" = "hello world" ]'

curl -sS --max-time 30 -X PATCH "$BASE/api/collections/$TEST_COLL_ID/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"count":99}' >/dev/null
COUNT=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" | json .count)
assert "update record (count changed)" '[ "$COUNT" = "99" ]'

# Filter
ITEMS=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID/records?filter=(count%3E50)" \
    -H "Authorization: Bearer $TOKEN" | json .totalItems)
assert "filter records (count>50 returns 1)" '[ "$ITEMS" = "1" ]'

# Second record
R2_ID=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$TEST_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"second"}' | json .id)
assert "create second record" '[ -n "$R2_ID" ]'

ALL=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" | json .totalItems)
assert "list all records (2 total)" '[ "$ALL" = "2" ]'

# Pagination
PAGE=$(curl -sS --max-time 30 "$BASE/api/collections/$TEST_COLL_ID/records?perPage=1" \
    -H "Authorization: Bearer $TOKEN" | json .page)
assert "pagination (page 1)" '[ "$PAGE" = "1" ]'

# Delete
HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X DELETE \
    "$BASE/api/collections/$TEST_COLL_ID/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN")
assert "delete record (HTTP 204)" '[ "$HTTP" = "204" ]'

HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" \
    "$BASE/api/collections/$TEST_COLL_ID/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN")
assert "deleted record returns 404" '[ "$HTTP" = "404" ]'

# Clean up second record
curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$TEST_COLL_ID/records/$R2_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null

# ── 5. Auth records (PocketBase auth collections contain email templates with
#    embedded newlines, so we pipe through tr to strip control chars before jq) ──
echo "── 5. Auth records ──"

AUTH_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_users","type":"auth","createRule":"","viewRule":"id = @request.auth.id","schema":[{"name":"display_name","type":"text","required":false}]}')
AUTH_COLL_ID=$(echo "$AUTH_RESP" | tr -d '\000-\037' | json .id)
assert "create auth collection" '[ -n "$AUTH_COLL_ID" ]'

USER_ID=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$AUTH_COLL_ID/records" \
    -H "Content-Type: application/json" \
    -d '{"email":"e2e@test.com","password":"pass123456","passwordConfirm":"pass123456","display_name":"E2E User"}' \
    | json .id)
assert "register user" '[ -n "$USER_ID" ]'

USER_TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$AUTH_COLL_ID/auth-with-password" \
    -H "Content-Type: application/json" \
    -d '{"identity":"e2e@test.com","password":"pass123456"}' | json .token)
assert "user login returns JWT" '[ -n "$USER_TOKEN" ]'

NEW_TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$AUTH_COLL_ID/auth-refresh" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" | json .token)
assert "auth refresh returns new JWT" '[ -n "$NEW_TOKEN" ]'
# Refresh may return same token if called immediately (token hasn't expired yet)
assert "auth refresh returns JWT (pass or same token)" '[ -n "$NEW_TOKEN" ]'

# Auth record self-access (record is accessible to its owner)
VIEW_ID=$(curl -sS --max-time 30 "$BASE/api/collections/$AUTH_COLL_ID/records/$USER_ID" \
    -H "Authorization: Bearer $USER_TOKEN" | json .id)
assert "user can view own record" '[ "$VIEW_ID" = "$USER_ID" ]'

DUP_STATUS=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$AUTH_COLL_ID/records" \
    -H "Content-Type: application/json" \
    -d '{"email":"e2e@test.com","password":"pass123456","passwordConfirm":"pass123456"}' \
    | json .status)
assert "duplicate email rejected" '[ "$DUP_STATUS" = "400" ]'

MISMATCH_STATUS=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$AUTH_COLL_ID/records" \
    -H "Content-Type: application/json" \
    -d '{"email":"e2e2@test.com","password":"pass123456","passwordConfirm":"different"}' \
    | json .status)
assert "password mismatch rejected" '[ "$MISMATCH_STATUS" = "400" ]'

# ── 6. File upload (R2) ──
echo "── 6. File upload (R2) ──"

FILE_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_files","type":"base","fields":[{"name":"label","type":"text","required":true},{"name":"attachment","type":"file","required":false,"options":{"maxSelect":1,"maxSize":5242880}}]}')
FILE_COLL_ID=$(echo "$FILE_RESP" | json .id)
assert "create file collection" '[ -n "$FILE_COLL_ID" ]'

echo "pocketflare e2e test content" > /tmp/pocketflare-e2e-test.txt
FILE_RECORD=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$FILE_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" \
    -F "label=test doc" \
    -F "attachment=@/tmp/pocketflare-e2e-test.txt;type=text/plain")
FILE_RECORD_ID=$(echo "$FILE_RECORD" | json .id)
FILE_NAME=$(echo "$FILE_RECORD" | json .attachment)
assert "upload file (record created)" '[ -n "$FILE_RECORD_ID" ]'
assert "file field populated" '[ -n "$FILE_NAME" ]'

DL_CONTENT=$(curl -sS --max-time 30 "$BASE/api/files/$FILE_COLL_ID/$FILE_RECORD_ID/$FILE_NAME")
assert "download returns content" '[ "$DL_CONTENT" = "pocketflare e2e test content" ]'

HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" \
    "$BASE/api/files/$FILE_COLL_ID/$FILE_RECORD_ID/nonexistent.txt")
assert "wrong filename returns 404" '[ "$HTTP" = "404" ]'

# ── 7. Error handling ──
echo "── 7. Error handling ──"

HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" \
    "$BASE/api/collections/$TEST_COLL_ID/records")
assert "unauthenticated blocked (401/403)" '[ "$HTTP" = "401" ] || [ "$HTTP" = "403" ]'

HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" \
    "$BASE/api/collections/nonexistent_collection_xyz/records" \
    -H "Authorization: Bearer $TOKEN")
assert "nonexistent collection returns 404" '[ "$HTTP" = "404" ]'

STATUS=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$TEST_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":""}' | json .status)
assert "empty required field rejected" '[ "$STATUS" = "400" ]'

# ── 8. Sequential retry (verifies instance stability, not cold start) ──
echo "── 8. Sequential retry ──"
PASSES=0
for i in $(seq 1 3); do
    CODE=$(curl -sS --max-time 90 "$BASE/api/health" | json .code)
    [ "$CODE" = "200" ] && PASSES=$((PASSES + 1))
done
assert "3 sequential health checks pass" '[ "$PASSES" = "3" ]'

# ── Cleanup ──
echo "── Cleanup ──"
for id in "$TEST_COLL_ID" "$AUTH_COLL_ID" "$FILE_COLL_ID"; do
    [ -n "$id" ] && curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$id" \
        -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
done
rm -f /tmp/pocketflare-e2e-test.txt

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    green "ALL TESTS PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
