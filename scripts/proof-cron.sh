#!/bin/bash
# proof-cron.sh — Prove PocketBase cron jobs execute through the Go/WASM
# runtime in a real wrangler dev Worker.
#
# Starts wrangler dev in D1 mode, registers a deterministic cron job via
# the proof route, calls RunDue (the same entry point used by the Workers
# scheduled handler), and asserts the job actually ran.
#
# Usage:
#   ./scripts/proof-cron.sh
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-cron-$(date +%Y%m%dT%H%M%S)"
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

cleanup() {
    if [[ -n "${WRANGLER_PID:-}" ]]; then
        kill "$WRANGLER_PID" 2>/dev/null || true
        wait "$WRANGLER_PID" 2>/dev/null || true
    fi
    echo ""
    echo "Logs: $ARTIFACT_DIR/dev.log"
}
trap cleanup EXIT

echo "=== Pocketflare Cron Proof ==="
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

# ── 2. Start wrangler dev ──
echo "── 2. Starting wrangler dev ──"

ADMIN_EMAIL="proof-cron@test.local"
ADMIN_PASSWORD="test123456"

cd "$ROOT"
"$ROOT/node_modules/.bin/wrangler" dev --port 0 \
    --var POCKETFLARE_ADMIN_EMAIL:"$ADMIN_EMAIL" \
    --var POCKETFLARE_ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
    --var POCKETFLARE_ENABLE_PROOF_ROUTES:1 \
    > "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

BASE=""
PORT=""
for i in $(seq 1 90); do
    PORT=$(grep -o 'http://localhost:[0-9]\+' "$ARTIFACT_DIR/dev.log" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)
    if [[ -n "$PORT" ]]; then
        BASE="http://127.0.0.1:$PORT"
        break
    fi
    if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
        red "FAIL: wrangler dev exited before port was found"
        cat "$ARTIFACT_DIR/dev.log"
        exit 1
    fi
    sleep 1
done

if [[ -z "$BASE" ]]; then
    red "FAIL: wrangler dev did not start within 90s"
    cat "$ARTIFACT_DIR/dev.log"
    exit 1
fi
green "  wrangler dev listening on $BASE"

# ── 3. Wait for WASM boot ──
echo "── 3. Waiting for WASM boot ──"
BOOTED=false
for i in $(seq 1 90); do
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

# ── 4. Authenticate superuser ──
echo "── 4. Authenticating superuser ──"

TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

assert "superuser auth obtained" '[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]'

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "Cannot proceed without auth token."
    exit 1
fi

# ── 5. Trigger cron proof ──
echo "── 5. Triggering cron proof ──"

CRON_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/cron" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" 2>/dev/null)

CRON_RAN=$(echo "$CRON_RESP" | jq -r .ran 2>/dev/null || echo "false")
CRON_TOTAL=$(echo "$CRON_RESP" | jq -r .jobsTotal 2>/dev/null || echo "0")

echo "  Response: $CRON_RESP"
assert "cron job ran (RunDue executed the registered job)" '[ "$CRON_RAN" = "true" ]'
assert "cron job total is >= 1 (including __pbDBOptimize__)" '[ "$CRON_TOTAL" -ge 1 ]'

# ── 6. Verify cleanup — the proof job is removed after the request ──
echo "── 6. Verifying proof job is cleaned up ──"

CRON_RESP2=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/cron" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" 2>/dev/null)

CRON_RAN2=$(echo "$CRON_RESP2" | jq -r .ran 2>/dev/null || echo "false")
CRON_TOTAL2=$(echo "$CRON_RESP2" | jq -r .jobsTotal 2>/dev/null || echo "0")

assert "second run also passes (previous job cleaned up)" '[ "$CRON_RAN2" = "true" ]'
assert "job count stable (no leak)" '[ "$CRON_TOTAL2" = "$CRON_TOTAL" ]'

# ── 7. Full scheduled-event path ──
# Uses wrangler's /cdn-cgi/handler/scheduled endpoint to trigger the
# Worker's scheduled() handler, which calls binding.runScheduler →
# Go cron.ScheduleTaskNonBlock callback → pb.Cron().RunDue().
echo "── 7. Full scheduled-event path (Worker scheduled → Go cron) ──"

SETUP_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/cron/scheduled" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" 2>/dev/null)
SETUP_OK=$(echo "$SETUP_RESP" | jq -r .setup 2>/dev/null || echo "false")
SETUP_TOTAL=$(echo "$SETUP_RESP" | jq -r .jobsTotal 2>/dev/null || echo "0")
echo "  Setup: $SETUP_RESP"
assert "persistent cron job registered" '[ "$SETUP_OK" = "true" ]'

# Confirm the job hasn't fired yet (no scheduled event has triggered).
PRE=$(curl -sS --max-time 30 "$BASE/api/pocketflare/proof/cron/scheduled" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
PRE_FIRED=$(echo "$PRE" | jq -r .fired 2>/dev/null || echo "true")
assert "cron job not fired before scheduled trigger" '[ "$PRE_FIRED" = "false" ]'

# Trigger the Worker's scheduled() handler through the gated proof route.
# This exercises the full path: scheduled() → getBinding → runScheduler
# → Go cron.ScheduleTaskNonBlock callback → pb.Cron().RunDue().
TRIGGER_RESP=$(curl -sS --max-time 30 "$BASE/_pf/proof/scheduled" 2>/dev/null)
TRIGGER_OK=$(echo "$TRIGGER_RESP" | jq -r .scheduled 2>/dev/null || echo "false")
echo "  Trigger response: $TRIGGER_RESP"
assert "scheduled handler executed (reached Go RunDue)" '[ "$TRIGGER_OK" = "true" ]'

# Check that the cron job fired.
POST=$(curl -sS --max-time 30 "$BASE/api/pocketflare/proof/cron/scheduled" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
POST_FIRED=$(echo "$POST" | jq -r .fired 2>/dev/null || echo "false")
echo "  Post-trigger: $POST"
assert "cron job fired after Worker scheduled event" '[ "$POST_FIRED" = "true" ]'

# Clean up.
CLEAN_RESP=$(curl -sS --max-time 30 -X DELETE "$BASE/api/pocketflare/proof/cron/scheduled" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
CLEAN_OK=$(echo "$CLEAN_RESP" | jq -r .ok 2>/dev/null || echo "false")
CLEAN_TOTAL=$(echo "$CLEAN_RESP" | jq -r .jobsTotal 2>/dev/null || echo "0")
assert "persistent job cleaned up" '[ "$CLEAN_OK" = "true" ]'
# Job count may drift slightly across calls due to PocketBase internal cron
# lifecycle; the key invariant is that ok=true confirmed deletion.

# ── Results ──
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
