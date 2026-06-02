#!/bin/bash
# proof-copy.sh — Prove Pocketflare R2 filesystem Copy behavior.
#
# Runtime-proves both the streaming fallback path and (when credentials are
# configured) the S3 CopyObject path against a local wrangler dev Worker.
#
# Verifies:
#   - Source and destination objects exist after copy
#   - Bytes match exactly
#   - Content type is preserved
#   - Correct copy path is reported per mode
#   - 1 KiB, 10 MiB, and 20 MiB sizes pass in each available mode
#   - Logs contain no copy errors
#   - S3 mode: no streaming-fallback warning in logs
#   - Fallback mode: streaming-fallback warning present in logs
#
# Usage:
#   ./scripts/proof-copy.sh
#
# R2 API credentials (for S3 CopyObject proof):
#   Set via environment variables:
#     export R2_ACCESS_KEY_ID=...
#     export R2_SECRET_ACCESS_KEY=...
#     export R2_ACCOUNT_ID=...
#   Or store in macOS Keychain:
#     security add-generic-password -s pocketflare-r2-access-key-id -a "$USER" -w "<key>"
#     security add-generic-password -s pocketflare-r2-secret-access-key -a "$USER" -w "<secret>"
#     security add-generic-password -s pocketflare-r2-account-id -a "$USER" -w "<account-id>"
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-copy-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$ARTIFACT_DIR"

PASS=0
FAIL=0
S3_SKIPPED=false

ADMIN_EMAIL="proof-copy@test.local"
ADMIN_PASSWORD="test123456"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

# ---------------------------------------------------------------------------
# Credential sourcing — env vars first, then macOS Keychain.
# Never prints credential values.
# ---------------------------------------------------------------------------

keychain_get() {
	local service="$1"
	security find-generic-password -s "$service" -a "$USER" -w 2>/dev/null || true
}

source_credentials() {
	R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
	R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
	R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-}"

	if [[ -z "$R2_ACCESS_KEY_ID" ]]; then
		R2_ACCESS_KEY_ID="$(keychain_get "pocketflare-r2-access-key-id")"
	fi
	if [[ -z "$R2_SECRET_ACCESS_KEY" ]]; then
		R2_SECRET_ACCESS_KEY="$(keychain_get "pocketflare-r2-secret-access-key")"
	fi
	if [[ -z "$R2_ACCOUNT_ID" ]]; then
		R2_ACCOUNT_ID="$(keychain_get "pocketflare-r2-account-id")"
	fi
}

have_credentials() {
	[[ -n "${R2_ACCESS_KEY_ID:-}" ]] && [[ -n "${R2_SECRET_ACCESS_KEY:-}" ]] && [[ -n "${R2_ACCOUNT_ID:-}" ]]
}

# ---------------------------------------------------------------------------
# Assertion helper
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Wrangler lifecycle
# ---------------------------------------------------------------------------

WRANGLER_PID=""
BASE=""

start_wrangler() {
	local artifact_dir="$1"
	shift

	cd "$ROOT"
	pnpm exec wrangler dev --port 0 \
		--var POCKETFLARE_ADMIN_EMAIL:"$ADMIN_EMAIL" \
		--var POCKETFLARE_ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
		--var POCKETFLARE_ENABLE_PROOF_ROUTES:1 \
		"$@" \
		> "$artifact_dir/dev.log" 2>&1 &
	WRANGLER_PID=$!
}

wait_for_port() {
	local artifact_dir="$1"
	BASE=""
	for i in $(seq 1 30); do
		if port=$(grep -o 'http://localhost:[0-9]\+' "$artifact_dir/dev.log" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true); [[ -n "$port" ]]; then
			BASE="http://127.0.0.1:$port"
			return 0
		fi
		sleep 1
	done
	return 1
}

wait_for_health() {
	for i in $(seq 1 60); do
		local health_code
		health_code=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
		if [[ "$health_code" = "200" ]]; then
			return 0
		fi
		if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
			return 1
		fi
		sleep 2
	done
	return 1
}

stop_wrangler() {
	if [[ -n "${WRANGLER_PID:-}" ]]; then
		kill "$WRANGLER_PID" 2>/dev/null || true
		wait "$WRANGLER_PID" 2>/dev/null || true
		WRANGLER_PID=""
		BASE=""
	fi
}

# ---------------------------------------------------------------------------
# Test suite runner
# ---------------------------------------------------------------------------

run_proof_suite() {
	local label="$1"          # e.g. "S3 CopyObject" or "streaming fallback"
	local expected_path="$2"  # "s3-copy-object" or "streaming-fallback"
	local artifact_dir="$3"
	shift 3
	local extra_vars=("$@")   # additional --var args for wrangler (may be empty)

	echo ""
	echo "── $label mode ──"

	if [[ ${#extra_vars[@]} -gt 0 ]]; then
		start_wrangler "$artifact_dir" "${extra_vars[@]}"
	else
		start_wrangler "$artifact_dir"
	fi

	if ! wait_for_port "$artifact_dir"; then
		red "  FAIL: wrangler dev did not start within 30s"
		cat "$artifact_dir/dev.log"
		FAIL=$((FAIL + 1))
		stop_wrangler
		return 1
	fi
	green "  wrangler dev listening on $BASE"

	if ! wait_for_health; then
		red "  FAIL: WASM did not boot (health check failed)"
		cat "$artifact_dir/dev.log"
		FAIL=$((FAIL + 1))
		stop_wrangler
		return 1
	fi
	green "  WASM booted"

	# ---- Authenticate superuser ----
	local token
	token=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
		-H "Content-Type: application/json" \
		-d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" 2>/dev/null | jq -r .token 2>/dev/null || echo "")

	if [[ -z "$token" || "$token" = "null" ]]; then
		red "  FAIL: superuser auth failed"
		FAIL=$((FAIL + 1))
		stop_wrangler
		return 1
	fi

	# ---- Probe active copy path ----
	local probe probe_ok probe_path
	probe=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/copy" \
		-H "Authorization: Bearer $token" \
		-H "Content-Type: application/json" \
		-d '{"size": 128, "contentType": "text/plain"}' 2>/dev/null)
	probe_ok=$(echo "$probe" | jq -r .ok 2>/dev/null || echo "false")
	probe_path=$(echo "$probe" | jq -r .copyPath 2>/dev/null || echo "unknown")

	echo "  Active copy path: $probe_path"
	assert "$label: proof route responds ok" '[ "$probe_ok" = "true" ]'
	assert "$label: copyPath=$expected_path" '[ "$probe_path" = "$expected_path" ]'

	# ---- 1 KiB ----
	local resp ok
	resp=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/proof/copy" \
		-H "Authorization: Bearer $token" \
		-H "Content-Type: application/json" \
		-d '{"size": 1024, "contentType": "text/plain"}' 2>/dev/null)
	ok=$(echo "$resp" | jq -r .ok 2>/dev/null || echo "false")
	assert "$label: 1 KiB ok" '[ "$ok" = "true" ]'
	assert "$label: 1 KiB bytes match" '[ "$(echo "$resp" | jq -r .bytesMatch)" = "true" ]'
	assert "$label: 1 KiB content type matches" '[ "$(echo "$resp" | jq -r .contentTypeMatch)" = "true" ]'
	assert "$label: 1 KiB size=1024" '[ "$(echo "$resp" | jq -r .size)" = "1024" ]'

	# ---- 10 MiB ----
	resp=$(curl -sS --max-time 60 -X POST "$BASE/api/pocketflare/proof/copy" \
		-H "Authorization: Bearer $token" \
		-H "Content-Type: application/json" \
		-d '{"size": 10485760, "contentType": "application/octet-stream"}' 2>/dev/null)
	ok=$(echo "$resp" | jq -r .ok 2>/dev/null || echo "false")
	assert "$label: 10 MiB ok" '[ "$ok" = "true" ]'
	assert "$label: 10 MiB bytes match" '[ "$(echo "$resp" | jq -r .bytesMatch)" = "true" ]'
	assert "$label: 10 MiB content type matches" '[ "$(echo "$resp" | jq -r .contentTypeMatch)" = "true" ]'
	assert "$label: 10 MiB size=10485760" '[ "$(echo "$resp" | jq -r .size)" = "10485760" ]'

	# ---- 20 MiB ----
	resp=$(curl -sS --max-time 120 -X POST "$BASE/api/pocketflare/proof/copy" \
		-H "Authorization: Bearer $token" \
		-H "Content-Type: application/json" \
		-d '{"size": 20971520, "contentType": "application/octet-stream"}' 2>/dev/null)
	ok=$(echo "$resp" | jq -r .ok 2>/dev/null || echo "false")
	assert "$label: 20 MiB ok" '[ "$ok" = "true" ]'
	assert "$label: 20 MiB bytes match" '[ "$(echo "$resp" | jq -r .bytesMatch)" = "true" ]'
	assert "$label: 20 MiB content type matches" '[ "$(echo "$resp" | jq -r .contentTypeMatch)" = "true" ]'
	assert "$label: 20 MiB size=20971520" '[ "$(echo "$resp" | jq -r .size)" = "20971520" ]'

	# ---- Log assertions ----
	local s3_errs stream_errs fallback_warn
	s3_errs=$(grep -c "s3 copy: HTTP" "$artifact_dir/dev.log" 2>/dev/null) || s3_errs=0
	stream_errs=$(grep -c "r2 streaming copy write:\|r2 streaming copy pipe:" "$artifact_dir/dev.log" 2>/dev/null) || stream_errs=0
	fallback_warn=$(grep -c "copies will stream through Worker" "$artifact_dir/dev.log" 2>/dev/null) || fallback_warn=0

	assert "$label: no s3 copy HTTP errors in logs" '[ "$s3_errs" = "0" ]'
	assert "$label: no streaming copy errors in logs" '[ "$stream_errs" = "0" ]'

	if [[ "$expected_path" = "s3-copy-object" ]]; then
		assert "$label: no streaming-fallback warning in logs" '[ "$fallback_warn" = "0" ]'
	else
		assert "$label: streaming-fallback warning in logs" '[ "$fallback_warn" -ge "1" ]'
	fi

	stop_wrangler
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "=== Pocketflare R2 Copy Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

# Source credentials from env or Keychain.
source_credentials

# ── S3 CopyObject mode (credentials required) ──
if have_credentials; then
	echo "R2 API credentials: configured"
	S3_DIR="$ARTIFACT_DIR/s3"
	mkdir -p "$S3_DIR"
	run_proof_suite "S3 CopyObject" "s3-copy-object" "$S3_DIR" \
		--var "R2_ACCESS_KEY_ID:${R2_ACCESS_KEY_ID}" \
		--var "R2_SECRET_ACCESS_KEY:${R2_SECRET_ACCESS_KEY}" \
		--var "R2_ACCOUNT_ID:${R2_ACCOUNT_ID}" || true
else
	S3_SKIPPED=true
	yellow ""
	yellow "R2 API credentials not configured — S3 CopyObject runtime proof will be skipped."
	yellow "Set env vars R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID"
	yellow "or store in macOS Keychain (pocketflare-r2-*) and re-run."
fi

# ── Streaming fallback mode (always runs) ──
FALLBACK_DIR="$ARTIFACT_DIR/fallback"
mkdir -p "$FALLBACK_DIR"
run_proof_suite "streaming fallback" "streaming-fallback" "$FALLBACK_DIR"

# ── Report ──
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if $S3_SKIPPED; then
	yellow ""
	yellow "S3 CopyObject runtime proof: SKIPPED (credentials not configured)"
	yellow ""
fi
if [ "$FAIL" -eq 0 ]; then
	green "R2 COPY PROOF PASSED"
	exit 0
else
	red "$FAIL TEST(S) FAILED"
	exit 1
fi
