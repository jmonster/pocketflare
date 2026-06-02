#!/bin/bash
# proof-realtime-local-bridge.sh — Prove the gated local Worker realtime bridge.
#
# Sets POCKETFLARE_REALTIME_WORKER_BRIDGE=1 so the Worker holds SSE connections
# and bridges record-change events from Go responses to the RealtimeDO. This is
# a local-dev proof workaround; it does NOT exercise the production DO streaming
# path (stub.fetch → RealtimeDO.handleConnection). For production parity, run a
# separate proof against a deployed Worker without the bridge env var.
#
# Starts wrangler dev with REALTIME_DO bound, opens an SSE connection,
# subscribes to a test collection, exercises create/update/delete, and
# asserts the client receives the expected realtime events.
#
# Usage:
#   ./scripts/proof-realtime.sh
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-realtime-$(date +%Y%m%dT%H%M%S)"
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

sse_record_stat() {
    local stream_file="$1"
    local record_id="$2"
    local stat="$3"

    node - "$stream_file" "$record_id" "$stat" <<'NODE'
const fs = require("fs");

const [file, recordId, stat] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");
const events = [];

for (const frame of text.split(/\n\n+/)) {
  const data = frame
    .split(/\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) continue;
  try {
    const parsed = JSON.parse(data);
    if (parsed?.record?.id === recordId) events.push(parsed);
  } catch {}
}

if (stat === "count") {
  console.log(events.length);
} else if (stat === "hasCreateTitle") {
  console.log(events.some((event) => event.action === "create" && event.record?.title === "realtime-proof-alpha") ? "true" : "false");
} else if (stat === "hasUpdateTitle") {
  console.log(events.some((event) => event.action === "update" && event.record?.title === "realtime-proof-beta") ? "true" : "false");
} else if (stat === "hasUpdateCount") {
  console.log(events.some((event) => event.action === "update" && event.record?.count === 99) ? "true" : "false");
} else if (stat === "hasDeleteAction") {
  console.log(events.some((event) => event.action === "delete") ? "true" : "false");
} else {
  process.exit(2);
}
NODE
}

cleanup() {
    if [[ -n "${SSE_PID:-}" ]]; then
        kill "$SSE_PID" 2>/dev/null || true
        wait "$SSE_PID" 2>/dev/null || true
    fi
    if [[ -n "${WRANGLER_PID:-}" ]]; then
        kill "$WRANGLER_PID" 2>/dev/null || true
        wait "$WRANGLER_PID" 2>/dev/null || true
    fi
    rm -f "$ROOT/wrangler.proof-realtime.toml"
    echo ""
    echo "Logs: $ARTIFACT_DIR/dev.log"
    echo "SSE:  $ARTIFACT_DIR/sse-stream.txt"
}
trap cleanup EXIT

echo "=== Pocketflare Realtime Local Bridge Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── 1. Build ──
echo "── 1. Building WASM ──"
cd "$ROOT"
make build > "$ARTIFACT_DIR/build.log" 2>&1
if [[ ! -f "$ROOT/dist/app.wasm" ]]; then
    red "FAIL: build did not produce dist/app.wasm"
    cat "$ARTIFACT_DIR/build.log"
    exit 1
fi
green "  build complete"

# ── 2. Generate temp wrangler config with REALTIME_DO binding ──
# Copy the base config and append the REALTIME_DO sections that are
# commented out in the canonical wrangler.toml.
echo "── 2. Generating wrangler config with REALTIME_DO ──"
cp "$ROOT/wrangler.toml" "$ROOT/wrangler.proof-realtime.toml"
cat >> "$ROOT/wrangler.proof-realtime.toml" <<'EOF'

[[durable_objects.bindings]]
name = "REALTIME_DO"
class_name = "RealtimeDO"

[[migrations]]
tag = "v2"
new_classes = ["RealtimeDO"]
EOF
green "  wrangler.proof-realtime.toml created"

# ── 3. Start wrangler dev ──
echo "── 3. Starting wrangler dev ──"
pnpm exec wrangler dev --port 0 --config wrangler.proof-realtime.toml --var POCKETFLARE_REALTIME_WORKER_BRIDGE:1 > "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

BASE=""
for i in $(seq 1 30); do
    if grep -q "Ready on" "$ARTIFACT_DIR/dev.log" 2>/dev/null; then
        PORT=$(grep -o 'http://[^ ]*:[0-9]\+' "$ARTIFACT_DIR/dev.log" | head -1 | grep -o '[0-9]\+$' || true)
        if [[ -n "$PORT" ]]; then
            BASE="http://127.0.0.1:$PORT"
            break
        fi
    fi
    sleep 1
done

if [[ -z "$BASE" ]]; then
    red "FAIL: wrangler dev did not start within 30s"
    cat "$ARTIFACT_DIR/dev.log"
    exit 1
fi
green "  wrangler dev listening on $BASE"

# ── 4. Wait for WASM boot ──
echo "── 4. Waiting for WASM boot ──"
BOOTED=false
for i in $(seq 1 60); do
    HEALTH_CODE=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
    if [[ "$HEALTH_CODE" = "200" ]]; then
        BOOTED=true
        break
    fi
    if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
        red "FAIL: wrangler dev exited before health check passed"
        cat "$ARTIFACT_DIR/dev.log"
        exit 1
    fi
    sleep 2
done
assert "WASM boots (health returns 200)" '$BOOTED'

# ── 5. Verify REALTIME_DO binding is available ──
echo "── 5. Checking REALTIME_DO binding ──"
REALTIME_MISSING=$(grep -c "REALTIME_DO binding not available" "$ARTIFACT_DIR/dev.log" 2>/dev/null || true)
assert "REALTIME_DO binding available to Go runtime" '[ "$REALTIME_MISSING" = "0" ]'

# ── 6. Authenticate as superuser ──
echo "── 6. Authenticating ──"
ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-admin@test.local}"
ADMIN_PASSWORD="${POCKETFLARE_ADMIN_PASSWORD:-test123456}"

TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    echo "  Creating superuser via installer..."
    PF_LOCATION=$(curl -sS --max-time 30 -o /dev/null -w "%{redirect_url}" "$BASE/_pf" 2>/dev/null || echo "")
    if [[ "$PF_LOCATION" =~ /pbinstal/([^/]+) ]]; then
        INSTALL_TOKEN="${BASH_REMATCH[1]}"
        curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/records" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $INSTALL_TOKEN" \
            -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" --arg passwordConfirm "$ADMIN_PASSWORD" '{email:$email,password:$password,passwordConfirm:$passwordConfirm}')" >/dev/null 2>&1 || true
        TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")
    fi
fi
assert "superuser authenticated" '[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]'

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "Cannot proceed without auth token."
    exit 1
fi

# ── 7. Create test collection ──
echo "── 7. Creating test collection ──"
COLL_NAME="proof_rt_$(date +%s)"
COLL_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg name "$COLL_NAME" '{name:$name,type:"base",fields:[{name:"title",type:"text",required:true},{name:"count",type:"number",required:false}]}')" 2>/dev/null)
COLL_ID=$(echo "$COLL_RESP" | jq -r .id 2>/dev/null || echo "")
assert "test collection created" '[ -n "$COLL_ID" ]'

# ── 8. Open SSE connection and capture clientId ──
echo "── 8. Opening SSE connection ──"

curl -sN --max-time 120 "$BASE/api/realtime" > "$ARTIFACT_DIR/sse-stream.txt" 2>&1 &
SSE_PID=$!

CLIENT_ID=""
for i in $(seq 1 30); do
    if grep -q "PB_CONNECT" "$ARTIFACT_DIR/sse-stream.txt" 2>/dev/null; then
        CLIENT_ID=$(grep -o '"clientId":"[^"]*"' "$ARTIFACT_DIR/sse-stream.txt" | head -1 | cut -d'"' -f4)
        if [[ -n "$CLIENT_ID" ]]; then
            break
        fi
    fi
    if ! kill -0 "$SSE_PID" 2>/dev/null; then
        red "FAIL: SSE curl exited before PB_CONNECT"
        break
    fi
    sleep 0.5
done
assert "SSE PB_CONNECT received with clientId" '[ -n "$CLIENT_ID" ]'

if [[ -z "$CLIENT_ID" ]]; then
    red "Cannot proceed without SSE clientId."
    exit 1
fi

# ── 9. Subscribe to test collection ──
echo "── 9. Subscribing to collection $COLL_NAME ──"

SUB_CODE=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/realtime" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg clientId "$CLIENT_ID" --arg coll "$COLL_NAME" '{clientId:$clientId,subscriptions:[$coll]}')" 2>/dev/null)
# PocketBase returns 204 No Content on successful subscription
assert "subscription POST accepted (HTTP 204)" '[ "$SUB_CODE" = "204" ]'

# Give the subscription time to sync to the DO before triggering broadcasts.
sleep 1

# ── 10. Create record → assert RECORD_CREATE ──
echo "── 10. Create record → expect RECORD_CREATE ──"

CREATE_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$COLL_NAME/records" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"realtime-proof-alpha","count":1}' 2>/dev/null)
RECORD_ID=$(echo "$CREATE_RESP" | jq -r .id 2>/dev/null || echo "")
assert "record created" '[ -n "$RECORD_ID" ]'

# Allow bridge delivery and SSE write (bridge → DO /__send → poll → SSE stream).
sleep 2

CREATE_EVENTS=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" count)
assert "exactly 1 SSE event for this record after create" '[ "$CREATE_EVENTS" -eq 1 ]'

# ── 11. Update record → assert RECORD_UPDATE ──
echo "── 11. Update record → expect RECORD_UPDATE ──"

UPDATE_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$COLL_NAME/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"realtime-proof-beta","count":99}' 2>/dev/null)
assert "record updated (HTTP 200)" '[ "$UPDATE_HTTP" = "200" ]'

sleep 2

UPDATE_EVENTS=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" count)
assert "exactly 2 SSE events for this record after update" '[ "$UPDATE_EVENTS" -eq 2 ]'

# ── 12. Delete record → assert RECORD_DELETE ──
echo "── 12. Delete record → expect RECORD_DELETE ──"

DELETE_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/collections/$COLL_NAME/records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
assert "record deleted (HTTP 204)" '[ "$DELETE_HTTP" = "204" ]'

sleep 2

DELETE_EVENTS=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" count)
assert "exactly 3 SSE events for this record after delete" '[ "$DELETE_EVENTS" -eq 3 ]'

# ── 13. Verify event payloads are authoritative ──
echo "── 13. Verifying event payloads ──"

# Create event must contain the record id and submitted fields.
CREATE_DATA_OK=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" hasCreateTitle)
assert "RECORD_CREATE payload contains submitted title" '[ "$CREATE_DATA_OK" = "true" ]'
CREATE_HAS_ID=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" count)
assert "RECORD_CREATE payload contains record id" '[ "$CREATE_HAS_ID" -ge 1 ]'

# Update event must contain the updated fields.
UPDATE_DATA_OK=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" hasUpdateTitle)
assert "RECORD_UPDATE payload contains updated title" '[ "$UPDATE_DATA_OK" = "true" ]'
UPDATE_HAS_COUNT=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" hasUpdateCount)
assert "RECORD_UPDATE payload contains updated count" '[ "$UPDATE_HAS_COUNT" = "true" ]'

# Delete event must carry the correct action.
DELETE_ACTION_OK=$(sse_record_stat "$ARTIFACT_DIR/sse-stream.txt" "$RECORD_ID" hasDeleteAction)
assert "RECORD_DELETE payload action is delete" '[ "$DELETE_ACTION_OK" = "true" ]'

# ── 14. Clean up test collection ──
echo "── 14. Cleaning up ──"
curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$COLL_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
green "  test collection removed"

# ── 15. Log checks ──
echo "── 15. Log checks ──"

QAW_COUNT=$(grep -c "query-after-write" "$ARTIFACT_DIR/dev.log" 2>/dev/null || true)
# Query-after-write is a D1 replication artifact unrelated to realtime.
# Allow up to a handful; only fail if excessive.
assert "query-after-write errors within tolerance (<= 5)" '[ "$QAW_COUNT" -le 5 ]'

FATAL_COUNT=$(grep -ci "fatal\|panic\|init-error" "$ARTIFACT_DIR/dev.log" 2>/dev/null || true)
assert "no fatal/panic/init-error in dev log" '[ "$FATAL_COUNT" = "0" ]'

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    green "REALTIME LOCAL BRIDGE PROOF PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
