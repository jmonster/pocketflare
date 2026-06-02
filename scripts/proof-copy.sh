#!/bin/bash
# proof-copy.sh — Prove Pocketflare R2 filesystem Copy behavior.
#
# Runtime-proves the streaming fallback path against a local wrangler dev
# Worker. If R2 API credentials are configured, the same route reports the
# S3 CopyObject path, but that path still needs a credentialed runtime proof.
#
# Verifies:
#   - Source and destination objects exist after copy
#   - Bytes match exactly
#   - Content type is preserved
#   - Correct copy path is reported
#   - Large objects (20 MiB) succeed through the copy path under test
#
# Usage:
#   ./scripts/proof-copy.sh
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-copy-$(date +%Y%m%dT%H%M%S)"
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

echo "=== Pocketflare R2 Copy Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── 1. Start wrangler dev ──
echo "── 1. Starting wrangler dev ──"

# Credentials provisioned at boot via env vars (skips installer flow).
ADMIN_EMAIL="proof-copy@test.local"
ADMIN_PASSWORD="test123456"

cd "$ROOT"
pnpm exec wrangler dev --port 0 \
    --var POCKETFLARE_ADMIN_EMAIL:"$ADMIN_EMAIL" \
    --var POCKETFLARE_ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
    --var POCKETFLARE_ENABLE_PROOF_ROUTES:1 \
    > "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!
BASE=""
for i in $(seq 1 30); do
    if PORT=$(grep -o 'http://localhost:[0-9]\+' "$ARTIFACT_DIR/dev.log" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true); [[ -n "$PORT" ]]; then
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

# ── 3. Authenticate superuser ──
echo "── 3. Authenticating superuser ──"

TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

assert "superuser auth obtained" '[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]'

if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
    red "Cannot proceed without auth token."
    exit 1
fi

# ── 4. Probe which copy path is active ──
echo "── 4. Probing active copy path ──"
PROBE=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/copy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"size": 128, "contentType": "text/plain"}' 2>/dev/null)
PROBE_OK=$(echo "$PROBE" | jq -r .ok 2>/dev/null || echo "false")
PROBE_PATH=$(echo "$PROBE" | jq -r .copyPath 2>/dev/null || echo "unknown")
echo "  Active copy path: $PROBE_PATH"
assert "proof route responds ok" '[ "$PROBE_OK" = "true" ]'

# ── 5. Test small object (1 KiB) ──
echo "── 5. Small object copy (1 KiB) ──"
SMALL_SIZE=1024
SMALL=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/copy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"size\": $SMALL_SIZE, \"contentType\": \"text/plain\"}" 2>/dev/null)

SMALL_OK=$(echo "$SMALL" | jq -r .ok 2>/dev/null || echo "false")
SMALL_BYTES=$(echo "$SMALL" | jq -r .bytesMatch 2>/dev/null || echo "false")
SMALL_CT=$(echo "$SMALL" | jq -r .contentTypeMatch 2>/dev/null || echo "false")
SMALL_CP=$(echo "$SMALL" | jq -r .copyPath 2>/dev/null || echo "")
SMALL_SIZE_RET=$(echo "$SMALL" | jq -r .size 2>/dev/null || echo "0")

assert "small (1 KiB): overall ok" '[ "$SMALL_OK" = "true" ]'
assert "small (1 KiB): bytes match" '[ "$SMALL_BYTES" = "true" ]'
assert "small (1 KiB): content type matches" '[ "$SMALL_CT" = "true" ]'
assert "small (1 KiB): size is 1024" '[ "$SMALL_SIZE_RET" = "1024" ]'
assert "small (1 KiB): copy path reported" '[ -n "$SMALL_CP" ]'

# ── 6. Test medium object (10 MiB, multipart boundary) ──
echo "── 6. Medium object copy (10 MiB) ──"
MED_SIZE=10485760
MED=$(curl -sS --max-time 60 -X POST "$BASE/api/pocketflare/proof/copy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"size\": $MED_SIZE, \"contentType\": \"application/octet-stream\"}" 2>/dev/null)

MED_OK=$(echo "$MED" | jq -r .ok 2>/dev/null || echo "false")
MED_BYTES=$(echo "$MED" | jq -r .bytesMatch 2>/dev/null || echo "false")
MED_CT=$(echo "$MED" | jq -r .contentTypeMatch 2>/dev/null || echo "false")
MED_SIZE_RET=$(echo "$MED" | jq -r .size 2>/dev/null || echo "0")

assert "medium (10 MiB): overall ok" '[ "$MED_OK" = "true" ]'
assert "medium (10 MiB): bytes match" '[ "$MED_BYTES" = "true" ]'
assert "medium (10 MiB): content type matches" '[ "$MED_CT" = "true" ]'
assert "medium (10 MiB): size is 10485760" '[ "$MED_SIZE_RET" = "10485760" ]'

# ── 7. Test large object (20 MiB) ──
echo "── 7. Large object copy (20 MiB) ──"
LG_SIZE=20971520
LG=$(curl -sS --max-time 120 -X POST "$BASE/api/pocketflare/proof/copy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"size\": $LG_SIZE, \"contentType\": \"application/octet-stream\"}" 2>/dev/null)

LG_OK=$(echo "$LG" | jq -r .ok 2>/dev/null || echo "false")
LG_BYTES=$(echo "$LG" | jq -r .bytesMatch 2>/dev/null || echo "false")
LG_CT=$(echo "$LG" | jq -r .contentTypeMatch 2>/dev/null || echo "false")
LG_SIZE_RET=$(echo "$LG" | jq -r .size 2>/dev/null || echo "0")

assert "large (20 MiB): overall ok" '[ "$LG_OK" = "true" ]'
assert "large (20 MiB): bytes match" '[ "$LG_BYTES" = "true" ]'
assert "large (20 MiB): content type matches" '[ "$LG_CT" = "true" ]'
assert "large (20 MiB): size is 20971520" '[ "$LG_SIZE_RET" = "20971520" ]'

# ── 8. Log check: verify copy path log messages ──
echo "── 8. Log check ──"
if [[ "$PROBE_PATH" = "s3-copy-object" ]]; then
    # S3 path: should NOT have fallback warning, should not have streaming errors.
    FALLBACK_LOG=$(grep -c "copies will stream through Worker" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
    assert "S3 path: no streaming-fallback warning" '[ "$FALLBACK_LOG" = "0" ]'
else
    # Streaming fallback: should have fallback warning.
    FALLBACK_LOG=$(grep -c "copies will stream through Worker" "$ARTIFACT_DIR/dev.log" 2>/dev/null || echo 0)
    assert "streaming path: fallback warning present" '[ "$FALLBACK_LOG" -ge "1" ]'
fi

# No copy errors in logs.
STREAM_ERRS=$(grep -c "r2 streaming copy write:\|r2 streaming copy pipe:" "$ARTIFACT_DIR/dev.log" 2>/dev/null) || STREAM_ERRS=0
S3_ERRS=$(grep -c "s3 copy: HTTP" "$ARTIFACT_DIR/dev.log" 2>/dev/null) || S3_ERRS=0
assert "no copy errors in logs" '[ "$STREAM_ERRS" = "0" ] && [ "$S3_ERRS" = "0" ]'

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed  (copy path: $PROBE_PATH)"
if [ "$FAIL" -eq 0 ]; then
    green "R2 COPY PROOF PASSED"
    exit 0
else
    red "$FAIL TEST(S) FAILED"
    exit 1
fi
