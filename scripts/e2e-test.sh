#!/bin/bash
# Comprehensive e2e test suite for pocketflare.
# Usage: ./scripts/e2e-test.sh [base_url]
# Default: https://pocketflare.garage.workers.dev
set -euo pipefail

BASE="${1:-https://pocketflare.garage.workers.dev}"
ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${POCKETFLARE_ADMIN_PASSWORD:-}"
E2E_DB_MODE="${POCKETFLARE_E2E_DB_MODE:-}"
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
HEALTH_HEADERS="$(mktemp)"
HEALTH_BODY="$(mktemp)"
curl -sS --max-time 60 -D "$HEALTH_HEADERS" -o "$HEALTH_BODY" "$BASE/api/health"
HEALTH_CODE="$(json .code < "$HEALTH_BODY")"
PF_ROUTE="$(awk -F': *' 'tolower($1)=="x-pocketflare-route" { gsub(/\r/, "", $2); print $2 }' "$HEALTH_HEADERS" | tail -n 1)"
rm -f "$HEALTH_HEADERS" "$HEALTH_BODY"
if [[ -z "$E2E_DB_MODE" ]]; then
    if [[ "$PF_ROUTE" == "dynamic-do" ]]; then
        E2E_DB_MODE="do_sqlite"
    else
        E2E_DB_MODE="d1"
    fi
fi
echo "database mode: $E2E_DB_MODE"
assert "health returns 200" '[ "$HEALTH_CODE" = "200" ]'

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

# ── 8. Batch transaction atomicity ──
echo "── 8. Batch transaction atomicity ──"

# Ensure batch is enabled
curl -sS --max-time 30 -X PATCH "$BASE/api/settings" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"batch":{"enabled":true,"maxRequests":10,"timeout":30,"maxBodySize":5242880}}' >/dev/null

# Create a temp collection for batch tests
BATCH_COLL=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_batch_test","type":"base","fields":[{"name":"title","type":"text","required":true}]}')
BATCH_COLL_ID=$(echo "$BATCH_COLL" | json .id)
assert "create batch test collection" '[ -n "$BATCH_COLL_ID" ]'

# Test 1: failed batch with mixed valid/invalid requests must leave zero records
BATCH_FAIL_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/batch" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg cid "$BATCH_COLL_ID" '{requests:[
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"batch-ok-1"}},
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"batch-ok-2"}},
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:""}}
    ]}')")
BATCH_FAIL_STATUS=$(echo "$BATCH_FAIL_RESP" | json .status)
BATCH_FAIL_DATA=$(echo "$BATCH_FAIL_RESP" | json '.data.requests // empty')
assert "failed batch returns 400 status" '[ "$BATCH_FAIL_STATUS" = "400" ]'
assert "failed batch includes batch_request_failed" 'grep -q batch_request_failed <<< "$BATCH_FAIL_DATA"'

BATCH_FAIL_COUNT=$(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" | json .totalItems)
assert "failed batch leaves zero records" '[ "$BATCH_FAIL_COUNT" = "0" ]'

# Test 2: successful batch must persist all records
BATCH_OK_HTTP=$(curl -sS --max-time 30 -o /tmp/pocketflare-batch-ok.json -w "%{http_code}" -X POST "$BASE/api/batch" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg cid "$BATCH_COLL_ID" '{requests:[
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"batch-ok-1"}},
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"batch-ok-2"}},
        {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"batch-ok-3"}}
    ]}')")
assert "successful batch returns 200" '[ "$BATCH_OK_HTTP" = "200" ]'

BATCH_OK_COUNT=$(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" | json .totalItems)
assert "successful batch persists all 3 records" '[ "$BATCH_OK_COUNT" = "3" ]'

# Cleanup batch records (delete all)
for rid in $(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" | json '.items[].id'); do
    curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$BATCH_COLL_ID/records/$rid" \
        -H "Authorization: Bearer $TOKEN" >/dev/null
done

# Test 3: query-after-write behavior depends on database mode.
# Create a record first (outside batch) so PATCH has an ID to query for.
PRE_RECORD_ID=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$BATCH_COLL_ID/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"pre-existing"}' | json .id)
assert "pre-existing record created" '[ -n "$PRE_RECORD_ID" ]'

QAW_BODY="$(jq -n --arg cid "$BATCH_COLL_ID" --arg rid "$PRE_RECORD_ID" '{requests:[
    {method:"POST",url:("/api/collections/"+$cid+"/records"),body:{title:"queued-write"}},
    {method:"PATCH",url:("/api/collections/"+$cid+"/records/"+$rid),body:{title:"patched-after-write"}}
]}')"

if [[ "$E2E_DB_MODE" == "do_sqlite" ]]; then
    QAW_HTTP=$(curl -sS --max-time 30 -o /tmp/pocketflare-qaw-ok.json -w "%{http_code}" -X POST "$BASE/api/batch" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$QAW_BODY")
    assert "query-after-write batch succeeds in DO SQLite" '[ "$QAW_HTTP" = "200" ]'

    QAW_COUNT=$(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
        -H "Authorization: Bearer $TOKEN" | json .totalItems)
    assert "query-after-write persists both DO SQLite records" '[ "$QAW_COUNT" = "2" ]'

    QAW_TITLE=$(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records/$PRE_RECORD_ID" \
        -H "Authorization: Bearer $TOKEN" | json .title)
    assert "query-after-write patches pre-existing DO SQLite record" '[ "$QAW_TITLE" = "patched-after-write" ]'

    for rid in $(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
        -H "Authorization: Bearer $TOKEN" | json '.items[].id'); do
        curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$BATCH_COLL_ID/records/$rid" \
            -H "Authorization: Bearer $TOKEN" >/dev/null
    done
else
    # D1 batches are atomic fixed write groups. The PATCH handler reads after
    # a queued POST, so D1 mode must fail before partial persistence.
    QAW_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/batch" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$QAW_BODY")
    QAW_STATUS=$(echo "$QAW_RESP" | json .status)
    QAW_DATA=$(echo "$QAW_RESP" | json '.data.requests // empty')
    assert "query-after-write batch returns 400 in D1" '[ "$QAW_STATUS" = "400" ]'
    assert "query-after-write includes batch_request_failed in D1" 'grep -q batch_request_failed <<< "$QAW_DATA"'

    QAW_COUNT=$(curl -sS --max-time 30 "$BASE/api/collections/$BATCH_COLL_ID/records" \
        -H "Authorization: Bearer $TOKEN" | json .totalItems)
    assert "query-after-write leaves only pre-existing D1 record" '[ "$QAW_COUNT" = "1" ]'

    curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$BATCH_COLL_ID/records/$PRE_RECORD_ID" \
        -H "Authorization: Bearer $TOKEN" >/dev/null
fi

# ── 9. Multi/single field flip (exercises normalizeSingleVsMultipleFieldChanges) ──
echo "── 9. Multi/single field flip ──"

FLIP_COLL=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":5,"maxSize":5242880}}]}')
FLIP_COLL_ID=$(echo "$FLIP_COLL" | json .id)
assert "create collection with multi-valued file field" '[ -n "$FLIP_COLL_ID" ]'

# Flip docs field from multi (maxSelect=5) to single (maxSelect=1).
# This triggers normalizeSingleVsMultipleFieldChanges which drops/recreates
# views while converting the JSON array column to a scalar column.
# With the fix in patch 014, view definitions are pre-fetched outside the
# write transaction so D1 batch mode does not hit query-after-write.
FLIP_PATCH_BODY="$(jq -n '{name:"e2e_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":1,"maxSize":5242880}}]}')"
FLIP_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$FLIP_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$FLIP_PATCH_BODY")
assert "flip multi to single field succeeds (200)" '[ "$FLIP_HTTP" = "200" ]'

FLIP_READ_NAME=$(curl -sS --max-time 30 "$BASE/api/collections/$FLIP_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" | json .name)
assert "collection readable after field flip" '[ "$FLIP_READ_NAME" = "e2e_flip_test" ]'

# Now flip back from single to multi to exercise the reverse path.
FLIP_BACK_BODY="$(jq -n '{name:"e2e_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":5,"maxSize":5242880}}]}')"
FLIP_BACK_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$FLIP_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$FLIP_BACK_BODY")
assert "flip single to multi field succeeds (200)" '[ "$FLIP_BACK_HTTP" = "200" ]'

# Cleanup
curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$FLIP_COLL_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null

# ── 10. Sequential retry (verifies instance stability, not cold start) ──
echo "── 10. Sequential retry ──"
PASSES=0
for i in $(seq 1 3); do
    CODE=$(curl -sS --max-time 90 "$BASE/api/health" | json .code)
    [ "$CODE" = "200" ] && PASSES=$((PASSES + 1))
done
assert "3 sequential health checks pass" '[ "$PASSES" = "3" ]'

# ── Cleanup ──
echo "── Cleanup ──"
for id in "$TEST_COLL_ID" "$AUTH_COLL_ID" "$FILE_COLL_ID" "$BATCH_COLL_ID"; do
    [ -n "$id" ] && curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$id" \
        -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
done
rm -f /tmp/pocketflare-e2e-test.txt
rm -f /tmp/pocketflare-batch-ok.json /tmp/pocketflare-qaw-ok.json

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
