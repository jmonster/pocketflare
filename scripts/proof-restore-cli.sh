#!/bin/bash
# proof-restore-cli.sh — Prove CLI restore happy path + resume against local wrangler dev.
#
# Starts wrangler dev, creates an admin superuser, runs restore-backup.mjs
# with the minimal fixture (tests/fixtures/minimal-backup.zip), verifies
# restored data is accessible, then tests --restore-token resume.
#
# Usage:
#   ./scripts/proof-restore-cli.sh
#
# Requires: wrangler, jq, curl, node, admin UI deps (for JSZip/sql.js)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-restore-cli-$(date +%Y%m%dT%H%M%S)"
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

FIXTURE="$ROOT/tests/fixtures/minimal-backup.zip"
if [[ ! -f "$FIXTURE" ]]; then
    echo "Generating fixture..."
    node "$ROOT/tests/fixtures/generate-backup-zip.mjs"
fi
if [[ ! -f "$FIXTURE" ]]; then
    red "Fixture not found: $FIXTURE"
    exit 1
fi

# Ensure admin UI deps are available for restore-backup.mjs.
if [[ ! -f "$ROOT/internal/pocketbase/ui/node_modules/jszip/dist/jszip.min.js" ]]; then
    echo "Installing admin UI deps..."
    (cd "$ROOT/internal/pocketbase/ui" && pnpm install) || {
        red "Failed to install admin UI deps"
        exit 1
    }
fi

echo "=== Pocketflare CLI Restore Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── 1. Start wrangler dev ──
echo "── 1. Starting wrangler dev ──"
cd "$ROOT"
pnpm exec wrangler dev --port 0 > "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

BASE=""
for i in $(seq 1 30); do
    if PORT=$(grep -o 'http://[0-9.:]*' "$ARTIFACT_DIR/dev.log" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true); [[ -n "$PORT" ]]; then
        BASE="http://127.0.0.1:$PORT"
        break
    fi
    sleep 1
done

if [[ -z "$BASE" ]]; then
    red "FAIL: wrangler dev did not start within 30s"
    cat "$ARTIFACT_DIR/dev.log"
    exit 1
fi
green "  wrangler dev listening on $BASE"

# ── 2. Wait for WASM boot ──
echo "── 2. Waiting for WASM boot ──"
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

# ── 3. Check target is empty ──
echo "── 3. Checking target emptiness ──"

# Create superuser via installer flow.
ADMIN_EMAIL="proof-restore@test.local"
ADMIN_PASSWORD="test123456"

TOKEN=""
# Try auth first (in case superuser already exists from previous run).
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
            -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" --arg passwordConfirm "$ADMIN_PASSWORD" --arg token "$INSTALL_TOKEN" '{email:$email,password:$password,passwordConfirm:$passwordConfirm,token:$token}')" >/dev/null 2>&1 || true
        TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")
    fi
fi
assert "superuser auth obtained" '[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]'

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "Cannot proceed without auth token."
    exit 1
fi

# ── 4. Run restore-backup.mjs ──
echo "── 4. Running restore-backup.mjs ──"
RESTORE_OUT="$ARTIFACT_DIR/restore-out.json"

# Run restore with email/password auth.
node "$ROOT/scripts/restore-backup.mjs" "$BASE" "$FIXTURE" --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" > "$RESTORE_OUT" 2>"$ARTIFACT_DIR/restore-err.log" || {
    red "FAIL: restore-backup.mjs exited non-zero"
    cat "$ARTIFACT_DIR/restore-err.log"
    exit 1
}

RESTORE_OK=$(jq -r .ok "$RESTORE_OUT" 2>/dev/null || echo "false")
SESSION_ID=$(jq -r .sessionId "$RESTORE_OUT" 2>/dev/null || echo "")
assert "restore-backup.mjs reports ok" '[ "$RESTORE_OK" = "true" ]'
assert "restore-backup.mjs returns sessionId" '[ -n "$SESSION_ID" ]'

# ── 5. Verify restored data ──
echo "── 5. Verifying restored data ──"

# demo_items collection should exist with 2 records.
ITEMS_TOTAL=$(curl -sS --max-time 30 "$BASE/api/collections/demo_items/records" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r .totalItems 2>/dev/null || echo "0")
assert "demo_items collection has 2 records" '[ "$ITEMS_TOTAL" = "2" ]'

# demo_items should have the "hello world" record.
FIRST_TITLE=$(curl -sS --max-time 30 "$BASE/api/collections/demo_items/records?perPage=1&sort=title" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.items[0].title' 2>/dev/null || echo "")
assert "restored data is correct (title)" '[ "$FIRST_TITLE" = "hello world" ]'

# ── 6. Test restore resume via --restore-token ──
echo "── 6. Testing --restore-token resume ──"

# Clean up the first restore's data so the target is empty again.
echo "  Cleaning up first restore data..."
curl -sS --max-time 30 -X DELETE "$BASE/api/collections/demo_items" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
# Also delete any users records created by the first restore.
for uid in $(curl -sS --max-time 30 "$BASE/api/collections/users/records" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.items[].id' 2>/dev/null || echo ""); do
    curl -sS --max-time 30 -X DELETE "$BASE/api/collections/users/records/$uid" \
        -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
done

# Verify target is empty before starting new session.
EMPTY_STATUS=$(curl -sS --max-time 30 "$BASE/api/pocketflare/restore/status" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
IS_EMPTY=$(echo "$EMPTY_STATUS" | jq -r .empty 2>/dev/null || echo "false")
assert "target is empty before resume test" '[ "$IS_EMPTY" = "true" ]'

# Start a new restore session.
echo "  Starting new restore session for resume test..."
START_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/restore/start" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null)
RESUME_TOKEN=$(echo "$START_RESP" | jq -r .fileUploadToken 2>/dev/null || echo "")
RESUME_SID=$(echo "$START_RESP" | jq -r .sessionId 2>/dev/null || echo "")
assert "resume restore session started" '[ -n "$RESUME_TOKEN" ] && [ -n "$RESUME_SID" ]'

# Run restore-backup.mjs with --restore-token to resume the active session.
echo "  Running restore-backup.mjs --restore-token..."
RESUME_OUT="$ARTIFACT_DIR/resume-out.json"
node "$ROOT/scripts/restore-backup.mjs" "$BASE" "$FIXTURE" --restore-token "$RESUME_TOKEN" > "$RESUME_OUT" 2>"$ARTIFACT_DIR/resume-err.log" || {
    red "FAIL: restore-backup.mjs --restore-token exited non-zero"
    cat "$ARTIFACT_DIR/resume-err.log"
    exit 1
}

RESUME_OK=$(jq -r .ok "$RESUME_OUT" 2>/dev/null || echo "false")
RESUME_SID_OUT=$(jq -r .sessionId "$RESUME_OUT" 2>/dev/null || echo "")
assert "resume restore reports ok" '[ "$RESUME_OK" = "true" ]'
assert "resume restore returns sessionId" '[ -n "$RESUME_SID_OUT" ]'

# Verify restored data after resume.
echo "  Verifying resumed restore data..."
RESUME_ITEMS=$(curl -sS --max-time 30 "$BASE/api/collections/demo_items/records" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r .totalItems 2>/dev/null || echo "0")
assert "resumed restore: demo_items has 2 records" '[ "$RESUME_ITEMS" = "2" ]'

# ── 7. Re-auth check (token still valid after restore) ──
echo "── 7. Post-restore auth check ──"

# The restore replaces _superusers table. Our original token may be invalid.
# Re-authenticate with the restored superuser credentials.
RESTORED_TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "admin@test.local" --arg password "test123456" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")
assert "restored superuser can authenticate" '[ -n "$RESTORED_TOKEN" ] && [ "$RESTORED_TOKEN" != "null" ]'

# ── 8. Check for query-after-write in logs ──
echo "── 8. Post-restore log check ──"
QAW_COUNT=$(grep -c "query-after-write" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
assert "no query-after-write errors during restore" '[ "$QAW_COUNT" = "0" ]'

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    green "CLI RESTORE PROOF PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
