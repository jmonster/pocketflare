#!/bin/bash
# proof-realtime-production.sh — Prove the un-gated production Worker realtime path.
#
# Uses the normal GET /api/realtime route with REALTIME_DO bound and without
# POCKETFLARE_REALTIME_WORKER_BRIDGE. The SSE connection is owned by the
# Durable Object, and PocketBase broadcasts flow through DOClient.Send.
#
# This proof lane is remote-only. wrangler dev exercises the local runtime and
# local DO emulation, which is not proof of the deployed Worker. Set
# POCKETFLARE_REALTIME_BASE_URL to a deployed Worker that already has REALTIME_DO
# bound. The bridge-only local proof stays separate and must not be used here.
#
# Usage:
#   ./scripts/proof-realtime-production.sh
#
# Requires: jq, curl, node
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-realtime-production-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$ARTIFACT_DIR"

PASS=0
FAIL=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }

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

sse_query() {
    node - "$1" "$2" "${3:-}" <<'NODE'
const fs = require("fs");

const [file, mode, recordId] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");

const frames = [];
for (const frame of text.split(/\n\n+/)) {
  let event = "";
  let dataText = "";
  for (const line of frame.split(/\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataText += line.slice(5);
  }
  if (!dataText) continue;
  try {
    frames.push({ event, data: JSON.parse(dataText) });
  } catch {}
}

if (mode === "client-id") {
  const connect = frames.find((frame) => frame.event === "PB_CONNECT");
  process.stdout.write(connect?.data?.clientId || "");
  process.exit(0);
}

if (mode === "record-count") {
  process.stdout.write(String(frames.filter((frame) => frame.data?.record?.id === recordId).length));
  process.exit(0);
}

if (mode === "record-events") {
  const recordEvents = frames.filter((frame) => frame.data?.record?.id === recordId);
  process.stdout.write(JSON.stringify(recordEvents));
  process.exit(0);
}

process.exit(2);
NODE
}

wait_for_client_id() {
    local stream_file="$1"
    local client_id=""

    for i in $(seq 1 60); do
        client_id="$(sse_query "$stream_file" client-id)"
        if [[ -n "$client_id" ]]; then
            printf "%s" "$client_id"
            return 0
        fi
        if [[ -n "${SSE_PID:-}" ]] && ! kill -0 "$SSE_PID" 2>/dev/null; then
            return 1
        fi
        sleep 0.5
    done

    return 1
}

wait_for_record_event_count() {
    local stream_file="$1"
    local record_id="$2"
    local expected="$3"
    local count=""

    for i in $(seq 1 60); do
        count="$(sse_query "$stream_file" record-count "$record_id")"
        if [[ "$count" = "$expected" ]]; then
            printf "%s" "$count"
            return 0
        fi
        if [[ -n "${SSE_PID:-}" ]] && ! kill -0 "$SSE_PID" 2>/dev/null; then
            return 1
        fi
        sleep 0.5
    done

    printf "%s" "$count"
    return 1
}

cleanup() {
    if [[ -n "${SSE_PID:-}" ]]; then
        kill "$SSE_PID" 2>/dev/null || true
        wait "$SSE_PID" 2>/dev/null || true
    fi
    if [[ -n "${BASE:-}" && -n "${TOKEN:-}" && -n "${COLL_ID:-}" ]]; then
        curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$COLL_ID" \
            -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
    echo ""
    echo "SSE:  $ARTIFACT_DIR/sse-stream.txt"
}
trap cleanup EXIT

echo "=== Pocketflare Production Realtime Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── 1. Require deployed Worker URL ──
if [[ -z "${POCKETFLARE_REALTIME_BASE_URL:-}" ]]; then
    red "FAIL: POCKETFLARE_REALTIME_BASE_URL is required."
    red "This lane only proves the deployed Worker. Local wrangler dev exercises the local runtime and cannot be used to claim production realtime."
    exit 1
fi
if [[ -z "${POCKETFLARE_ADMIN_EMAIL:-}" || -z "${POCKETFLARE_ADMIN_PASSWORD:-}" ]]; then
    red "FAIL: POCKETFLARE_ADMIN_EMAIL and POCKETFLARE_ADMIN_PASSWORD are required for the deployed proof target."
    exit 1
fi

cd "$ROOT"
BASE="${POCKETFLARE_REALTIME_BASE_URL%/}"
echo "── 1. Using deployed Worker base URL ──"
echo "  $BASE"

# ── 2. Wait for health ──
echo "── 2. Waiting for health ──"
BOOTED=false
for i in $(seq 1 60); do
    HEALTH_CODE=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
    if [[ "$HEALTH_CODE" = "200" ]]; then
        BOOTED=true
        break
    fi
    sleep 2
done
assert "WASM boots (health returns 200)" '$BOOTED'

# ── 3. Authenticate as superuser ──
echo "── 3. Authenticating ──"
ADMIN_EMAIL="$POCKETFLARE_ADMIN_EMAIL"
ADMIN_PASSWORD="$POCKETFLARE_ADMIN_PASSWORD"

TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

assert "superuser authenticated" '[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]'

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "Remote proof requires POCKETFLARE_ADMIN_EMAIL and POCKETFLARE_ADMIN_PASSWORD for an existing superuser on $BASE."
    red "Cannot proceed without auth token."
    exit 1
fi

# ── 4. Create test collection ──
echo "── 4. Creating test collection ──"
COLL_NAME="proof_rt_prod_$(date +%s)"
COLL_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg name "$COLL_NAME" '{name:$name,type:"base",fields:[{name:"title",type:"text",required:true},{name:"count",type:"number",required:false}]}')" 2>/dev/null)
COLL_ID=$(echo "$COLL_RESP" | jq -r .id 2>/dev/null || echo "")
assert "test collection created" '[ -n "$COLL_ID" ]'

# ── 5. Open SSE connection and capture clientId ──
echo "── 5. Opening SSE connection ──"
curl -sN --max-time 300 "$BASE/api/realtime" > "$ARTIFACT_DIR/sse-stream.txt" 2>&1 &
SSE_PID=$!

CLIENT_ID=""
CLIENT_ID="$(wait_for_client_id "$ARTIFACT_DIR/sse-stream.txt" || true)"
if [[ -z "$CLIENT_ID" ]] && ! kill -0 "$SSE_PID" 2>/dev/null; then
    red "FAIL: SSE curl exited before PB_CONNECT"
    tail -n 80 "$ARTIFACT_DIR/sse-stream.txt" || true
fi
assert "SSE PB_CONNECT received with clientId" '[ -n "$CLIENT_ID" ]'

if [[ -z "$CLIENT_ID" ]]; then
    red "Remote proof requires a deployed Worker that serves GET /api/realtime from REALTIME_DO."
    red "Cannot proceed without SSE clientId."
    exit 1
fi

# ── 6. Subscribe to collection ──
echo "── 6. Subscribing to collection $COLL_NAME ──"
SUB_CODE=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/realtime" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg clientId "$CLIENT_ID" --arg coll "$COLL_NAME" '{clientId:$clientId,subscriptions:[$coll]}')" 2>/dev/null)
assert "subscription POST accepted (HTTP 204)" '[ "$SUB_CODE" = "204" ]'

# Give the subscription sync a moment before broadcasting.
sleep 1

# ── 7. Create record → expect create event ──
echo "── 7. Create record → expect create event ──"
CREATE_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$COLL_NAME/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"realtime-proof-alpha","count":1}' 2>/dev/null)
RECORD_ID=$(echo "$CREATE_RESP" | jq -r .id 2>/dev/null || echo "")
assert "record created" '[ -n "$RECORD_ID" ]'

CREATE_COUNT=$(wait_for_record_event_count "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" 1 || true)
assert "exactly 1 SSE record event after create" '[ "$CREATE_COUNT" = "1" ]'

CREATE_EVENTS_JSON=$(sse_query "$ARTIFACT_DIR/sse-stream.txt" record-events "$RECORD_ID")
assert "create event payload is exact" 'printf "%s" "$CREATE_EVENTS_JSON" | jq -e --arg recordId "$RECORD_ID" --arg coll "$COLL_NAME" '"'"'
  length == 1 and
  .[0].event == "RECORD_CREATE" and
  .[0].data.action == "create" and
  .[0].data.collection == $coll and
  .[0].data.record.id == $recordId and
  .[0].data.record.title == "realtime-proof-alpha" and
  .[0].data.record.count == 1
'"'"' >/dev/null'

# ── 8. Update record → expect update event ──
echo "── 8. Update record → expect update event ──"
UPDATE_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$COLL_NAME/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"realtime-proof-beta","count":99}' 2>/dev/null)
assert "record updated (HTTP 200)" '[ "$UPDATE_HTTP" = "200" ]'

UPDATE_COUNT=$(wait_for_record_event_count "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" 2 || true)
assert "exactly 2 SSE record events after update" '[ "$UPDATE_COUNT" = "2" ]'

UPDATE_EVENTS_JSON=$(sse_query "$ARTIFACT_DIR/sse-stream.txt" record-events "$RECORD_ID")
assert "update event payload is exact" 'printf "%s" "$UPDATE_EVENTS_JSON" | jq -e --arg recordId "$RECORD_ID" --arg coll "$COLL_NAME" '"'"'
  length == 2 and
  .[0].event == "RECORD_CREATE" and
  .[0].data.action == "create" and
  .[0].data.collection == $coll and
  .[0].data.record.id == $recordId and
  .[0].data.record.title == "realtime-proof-alpha" and
  .[0].data.record.count == 1 and
  .[1].event == "RECORD_UPDATE" and
  .[1].data.action == "update" and
  .[1].data.collection == $coll and
  .[1].data.record.id == $recordId and
  .[1].data.record.title == "realtime-proof-beta" and
  .[1].data.record.count == 99
'"'"' >/dev/null'

# ── 9. Delete record → expect delete event ──
echo "── 9. Delete record → expect delete event ──"
DELETE_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/collections/$COLL_NAME/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
assert "record deleted (HTTP 204)" '[ "$DELETE_HTTP" = "204" ]'

DELETE_COUNT=$(wait_for_record_event_count "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" 3 || true)
assert "exactly 3 SSE record events after delete" '[ "$DELETE_COUNT" = "3" ]'

DELETE_EVENTS_JSON=$(sse_query "$ARTIFACT_DIR/sse-stream.txt" record-events "$RECORD_ID")
assert "delete event payload is exact" 'printf "%s" "$DELETE_EVENTS_JSON" | jq -e --arg recordId "$RECORD_ID" --arg coll "$COLL_NAME" '"'"'
  length == 3 and
  [.[] | .event] == ["RECORD_CREATE", "RECORD_UPDATE", "RECORD_DELETE"] and
  [.[] | .data.action] == ["create", "update", "delete"] and
  all(.[]; .data.record.id == $recordId) and
  all(.[]; .data.collection == $coll) and
  .[0].data.record.title == "realtime-proof-alpha" and
  .[0].data.record.count == 1 and
  .[1].data.record.title == "realtime-proof-beta" and
  .[1].data.record.count == 99
'"'"' >/dev/null'

# ── 10. Clean up test collection ──
echo "── 10. Cleaning up ──"
curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$COLL_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
COLL_ID=""
green "  test collection removed"

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    green "REALTIME PRODUCTION PROOF PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
