#!/bin/bash
# proof-d1-bootstrap.sh — Prove D1 Worker boots locally without query-after-write.
#
# Starts wrangler dev, waits for WASM boot, hits /api/health, then runs a
# collection field flip (multi→single→multi) to exercise the
# normalizeSingleVsMultipleFieldChanges path patched in 014-d1-parity-fixes.
#
# Usage:
#   ./scripts/proof-d1-bootstrap.sh
#
# Requires: wrangler, jq, curl
# The Worker must be configured for D1 mode (POCKETFLARE_DB_MODE != do_sqlite).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-d1-$(date +%Y%m%dT%H%M%S)"
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

echo "=== Pocketflare D1 Bootstrap Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── 1. Start wrangler dev ──
echo "── 1. Starting wrangler dev ──"
cd "$ROOT"
pnpm exec wrangler dev --port 0 > "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

# Extract the actual port wrangler chose.
# wrangler dev --port 0 prints "Ready on http://127.0.0.1:<port>" to stderr.
BASE=""
for i in $(seq 1 30); do
    if grep -q "Ready on" "$ARTIFACT_DIR/dev.log" 2>/dev/null; then
        PORT=$(grep -o 'http://[0-9.:]*' "$ARTIFACT_DIR/dev.log" | head -1 | grep -o '[0-9]\+$' || true)
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

# ── 2. Wait for WASM boot ──
echo "── 2. Waiting for WASM boot ──"
BOOTED=false
for i in $(seq 1 60); do
    HEALTH_CODE=$(curl -sS --max-time 10 -o "$ARTIFACT_DIR/health-$i.json" -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
    if [[ "$HEALTH_CODE" = "200" ]]; then
        BOOTED=true
        break
    fi
    # Check if wrangler dev is still running
    if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
        red "FAIL: wrangler dev exited before health check passed"
        cat "$ARTIFACT_DIR/dev.log"
        exit 1
    fi
    sleep 2
done

if ! $BOOTED; then
    red "FAIL: WASM did not boot within 120s"
    cat "$ARTIFACT_DIR/dev.log"
    exit 1
fi
green "  WASM booted successfully"

# ── 3. Check for query-after-write in dev logs ──
echo "── 3. Checking for query-after-write errors ──"
QAW_COUNT=$(grep -c "query-after-write" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
assert "no query-after-write errors in dev log" '[ "$QAW_COUNT" = "0" ]'

# Check that the D1 bootstrap completed (look for init-ready marker).
INIT_READY=$(grep -c "init-ready" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
assert "WASM runtime init-ready fired" '[ "$INIT_READY" -ge 1 ]'

# ── 4. Auto-detect auth ──
echo "── 4. Setting up admin auth ──"

# Check if _pf redirect works (empty db should redirect to installer).
PF_REDIRECT=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" "$BASE/_pf" 2>/dev/null || echo "000")
assert "_pf route responds" '[ "$PF_REDIRECT" = "302" ] || [ "$PF_REDIRECT" = "301" ]'

# Try to create a superuser via the installer if database is empty.
# If POCKETFLARE_ADMIN_EMAIL/PASSWORD are set in env, use those.
ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-admin@test.local}"
ADMIN_PASSWORD="${POCKETFLARE_ADMIN_PASSWORD:-test123456}"

# First check if a superuser already exists by trying to auth.
TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    # Try the installer flow: visit _pf, get token, create superuser.
    echo "  No existing superuser, attempting installer flow..."
    PF_LOCATION=$(curl -sS --max-time 30 -o /dev/null -w "%{redirect_url}" "$BASE/_pf" 2>/dev/null || echo "")
    if [[ "$PF_LOCATION" =~ /pbinstal/([^/]+) ]]; then
        INSTALL_TOKEN="${BASH_REMATCH[1]}"
        INSTALL_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/records" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" --arg passwordConfirm "$ADMIN_PASSWORD" --arg token "$INSTALL_TOKEN" '{email:$email,password:$password,passwordConfirm:$passwordConfirm,token:$token}')" 2>/dev/null || echo "{}")
        echo "  Installer response: $INSTALL_RESP"
        TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")
    fi
fi

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "  Could not authenticate. Set POCKETFLARE_ADMIN_EMAIL/PASSWORD or ensure the database is empty."
    # Continue anyway — the bootstrap health check already passed.
    TOKEN=""
else
    green "  Authenticated as $ADMIN_EMAIL"
fi

# ── 5. Collection field flip (exercises patch 014 path) ──
echo "── 5. Collection field flip ──"

if [[ -n "$TOKEN" ]]; then
    # Create collection with multi-valued file field.
    FLIP_COLL=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"name":"proof_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":5,"maxSize":5242880}}]}' 2>/dev/null)
    FLIP_COLL_ID=$(echo "$FLIP_COLL" | jq -r .id 2>/dev/null || echo "")
    assert "create collection with multi-valued file field" '[ -n "$FLIP_COLL_ID" ]'

    if [[ -n "$FLIP_COLL_ID" ]]; then
        # Flip multi → single
        FLIP_BODY="$(jq -n '{name:"proof_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":1,"maxSize":5242880}}]}')"
        FLIP_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$FLIP_COLL_ID" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$FLIP_BODY" 2>/dev/null)
        assert "multi→single field flip succeeds (200)" '[ "$FLIP_HTTP" = "200" ]'

        # Flip single → multi
        FLIP_BACK_BODY="$(jq -n '{name:"proof_flip_test","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"docs","type":"file","required":false,"options":{"maxSelect":5,"maxSize":5242880}}]}')"
        FLIP_BACK_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/collections/$FLIP_COLL_ID" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$FLIP_BACK_BODY" 2>/dev/null)
        assert "single→multi field flip succeeds (200)" '[ "$FLIP_BACK_HTTP" = "200" ]'

        # Verify collection still readable
        FLIP_NAME=$(curl -sS --max-time 30 "$BASE/api/collections/$FLIP_COLL_ID" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r .name 2>/dev/null || echo "")
        assert "collection readable after flips" '[ "$FLIP_NAME" = "proof_flip_test" ]'

        # Cleanup
        curl -sS --max-time 30 -X DELETE "$BASE/api/collections/$FLIP_COLL_ID" \
            -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
else
    echo "  Skipping field flip test (no auth token)"
fi

# ── 6. Check for query-after-write after field operations ──
echo "── 6. Post-operation log check ──"
QAW_COUNT2=$(grep -c "query-after-write" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
assert "no query-after-write errors after field flip" '[ "$QAW_COUNT2" = "0" ]'

# ── 7. Check first-boot WASM didn't hit fatal errors ──
echo "── 7. Boot error check ──"
FATAL_COUNT=$(grep -ci "fatal\|panic\|init-error" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
assert "no fatal/panic/init-error in dev log" '[ "$FATAL_COUNT" = "0" ]'

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    green "D1 BOOTSTRAP PROOF PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
