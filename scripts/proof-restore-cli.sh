#!/bin/bash
# proof-restore-cli.sh - Prove CLI restore happy path, resume, and scale fixture.
#
# Each lane starts a fresh wrangler dev instance with isolated local state. Restore
# only supports empty targets, so the proof must not mutate a restored app back to
# "empty" and reuse it for another restore.
#
# Usage:
#   ./scripts/proof-restore-cli.sh
#
# Requires: wrangler, jq, curl, node, Pocketflare deps (for JSZip/sql.js)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-restore-cli-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$ARTIFACT_DIR"

PASS=0
FAIL=0
BASE=""
DEV_LOG=""
WRANGLER_PID=""

ADMIN_EMAIL="proof-restore@test.local"
ADMIN_PASSWORD="test123456"
MINIMAL_FIXTURE="$ROOT/tests/fixtures/minimal-backup.zip"
LARGE_FIXTURE="$ROOT/tests/fixtures/large-backup.zip"

red() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
green() { printf "\033[32m%s\033[0m\n" "$*" >&2; }

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

stop_wrangler() {
    if [[ -n "${WRANGLER_PID:-}" ]]; then
        kill "$WRANGLER_PID" 2>/dev/null || true
        wait "$WRANGLER_PID" 2>/dev/null || true
        WRANGLER_PID=""
    fi
}

cleanup() {
    stop_wrangler
    echo ""
    echo "Artifacts: $ARTIFACT_DIR"
}
trap cleanup EXIT

ensure_fixtures() {
    if [[ ! -f "$MINIMAL_FIXTURE" ]]; then
        echo "Generating minimal fixture..."
        node "$ROOT/tests/fixtures/generate-backup-zip.mjs"
    fi
    if [[ ! -f "$LARGE_FIXTURE" ]]; then
        echo "Generating large fixture..."
        node "$ROOT/tests/fixtures/generate-large-backup-zip.mjs"
    fi
    if [[ ! -f "$MINIMAL_FIXTURE" ]]; then
        red "Fixture not found: $MINIMAL_FIXTURE"
        exit 1
    fi
    if [[ ! -f "$LARGE_FIXTURE" ]]; then
        red "Fixture not found: $LARGE_FIXTURE"
        exit 1
    fi
}

ensure_deps() {
    if [[ ! -f "$ROOT/node_modules/jszip/dist/jszip.min.js" ]]; then
        echo "Installing Pocketflare deps..."
        (cd "$ROOT" && pnpm install --frozen-lockfile) || {
            red "Failed to install Pocketflare deps"
            exit 1
        }
    fi
}

start_wrangler() {
    local lane="$1"
    local state_dir="$ARTIFACT_DIR/wrangler-state-$lane"
    DEV_LOG="$ARTIFACT_DIR/dev-$lane.log"
    mkdir -p "$state_dir"

    stop_wrangler
    echo "-- Starting wrangler dev ($lane) --"
    cd "$ROOT"
    "$ROOT/node_modules/.bin/wrangler" dev --port 0 --persist-to "$state_dir" > "$DEV_LOG" 2>&1 &
    WRANGLER_PID=$!

    local port=""
    for _ in $(seq 1 30); do
        port=$(grep -oE 'http://(localhost|127\.0\.0\.1|\[::1\]|[0-9.]+):[0-9]+' "$DEV_LOG" 2>/dev/null | head -1 | grep -oE '[0-9]+$' || true)
        if [[ -n "$port" ]]; then
            BASE="http://127.0.0.1:$port"
            break
        fi
        sleep 1
    done
    if [[ -z "$BASE" ]]; then
        red "FAIL: wrangler dev did not start within 30s"
        tail -80 "$DEV_LOG" || true
        exit 1
    fi
    green "  wrangler dev listening on $BASE"

    local booted=false
    for _ in $(seq 1 60); do
        local code
        code=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
        if [[ "$code" = "200" ]]; then
            booted=true
            break
        fi
        if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
            red "FAIL: wrangler dev exited before health check passed"
            tail -120 "$DEV_LOG" || true
            exit 1
        fi
        sleep 2
    done
    assert "$lane: WASM boots (health returns 200)" '$booted'
}

auth_superuser() {
    local email="$1" password="$2" prefix="$3"
    local safe_email="${email//@/_}"
    local out="$ARTIFACT_DIR/auth-${prefix}-${safe_email}.json"
    curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg identity "$email" --arg password "$password" '{identity:$identity,password:$password}')" 2>/dev/null \
        | tee "$out" \
        | jq -r '.token // empty' 2>/dev/null || echo ""
}

ensure_admin() {
    local lane="$1"
    local token
    token=$(auth_superuser "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$lane-initial")

    if [[ -z "$token" || "$token" = "null" ]]; then
        echo "  Creating superuser via installer..." >&2
        local location install_token
        location=$(curl -sS --max-time 30 -D - -o /dev/null "$BASE/_pf" 2>/dev/null | awk 'tolower($1)=="location:" {print $2; exit}' | tr -d '\r' || echo "")
        if [[ "$location" =~ /pbinstall?/([^/?#&]+) ]]; then
            install_token="${BASH_REMATCH[1]}"
            curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/records" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $install_token" \
                -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" --arg passwordConfirm "$ADMIN_PASSWORD" '{email:$email,password:$password,passwordConfirm:$passwordConfirm}')" \
                > "$ARTIFACT_DIR/install-$lane.json" 2>/dev/null || true
            token=$(auth_superuser "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$lane-created")
        fi
    fi

    assert "$lane: superuser auth obtained" '[ -n "$token" ] && [ "$token" != "null" ]'
    if [[ -z "$token" || "$token" = "null" ]]; then
        red "Cannot proceed without auth token."
        exit 1
    fi
    printf "%s" "$token"
}

assert_target_empty() {
    local token="$1" lane="$2"
    local out="$ARTIFACT_DIR/status-$lane.json"
    curl -sS --max-time 30 "$BASE/api/pocketflare/restore/status" \
        -H "Authorization: Bearer $token" > "$out" 2>/dev/null
    local empty
    empty=$(jq -r .empty "$out" 2>/dev/null || echo "false")
    assert "$lane: target is empty" '[ "$empty" = "true" ]'
}

run_restore() {
    local lane="$1" fixture="$2" auth_args="$3"
    local out="$ARTIFACT_DIR/restore-$lane-out.json"
    local err="$ARTIFACT_DIR/restore-$lane-err.log"
    local log_start=$(( $(wc -l < "$DEV_LOG") + 1 ))

    # shellcheck disable=SC2086
    node "$ROOT/scripts/restore-backup.mjs" "$BASE" "$fixture" $auth_args > "$out" 2>"$err" || {
        red "FAIL: restore-backup.mjs failed for $lane"
        tail -80 "$err" || true
        exit 1
    }

    local ok session_id
    ok=$(jq -r .ok "$out" 2>/dev/null || echo "false")
    session_id=$(jq -r .sessionId "$out" 2>/dev/null || echo "")
    assert "$lane: restore reports ok" '[ "$ok" = "true" ]'
    assert "$lane: restore returns sessionId" '[ -n "$session_id" ]'

    local qaw_count
    qaw_count=$(tail -n +"$log_start" "$DEV_LOG" 2>/dev/null | grep -c "query-after-write" || true)
    assert "$lane: no query-after-write errors during restore" '[ "$qaw_count" = "0" ]'
}

verify_minimal() {
    local token="$1" lane="$2"
    local total title
    total=$(curl -sS --max-time 30 "$BASE/api/collections/demo_items/records" \
        -H "Authorization: Bearer $token" 2>/dev/null | jq -r .totalItems 2>/dev/null || echo "0")
    assert "$lane: demo_items collection has 2 records" '[ "$total" = "2" ]'

    title=$(curl -sS --max-time 30 "$BASE/api/collections/demo_items/records?perPage=1&sort=title" \
        -H "Authorization: Bearer $token" 2>/dev/null | jq -r '.items[0].title' 2>/dev/null || echo "")
    assert "$lane: restored data is correct (title)" '[ "$title" = "hello world" ]'
}

verify_large() {
    local token="$1" lane="$2"
    local total title
    total=$(curl -sS --max-time 30 "$BASE/api/collections/scale_items/records" \
        -H "Authorization: Bearer $token" 2>/dev/null | jq -r .totalItems 2>/dev/null || echo "0")
    assert "$lane: scale_items has 1000 records" '[ "$total" = "1000" ]'

    title=$(curl -sS --max-time 30 "$BASE/api/collections/scale_items/records?perPage=1&sort=count" \
        -H "Authorization: Bearer $token" 2>/dev/null | jq -r '.items[0].title' 2>/dev/null || echo "")
    assert "$lane: first scale record is accessible" '[[ "$title" == Scale\ item* ]]'
}

run_minimal_lane() {
    echo "-- Minimal restore lane --"
    start_wrangler "minimal"
    local admin_token restored_token
    admin_token=$(ensure_admin "minimal")
    assert_target_empty "$admin_token" "minimal"
    run_restore "minimal" "$MINIMAL_FIXTURE" "--email $ADMIN_EMAIL --password $ADMIN_PASSWORD"
    restored_token=$(auth_superuser "admin@test.local" "test123456" "minimal-restored")
    assert "minimal: restored superuser can authenticate" '[ -n "$restored_token" ] && [ "$restored_token" != "null" ]'
    verify_minimal "$restored_token" "minimal"
}

run_resume_lane() {
    echo "-- Restore-token resume lane --"
    start_wrangler "resume"
    local admin_token start_resp restore_token session_id restored_token
    admin_token=$(ensure_admin "resume")
    assert_target_empty "$admin_token" "resume"

    start_resp=$(curl -sS --max-time 30 -X POST "$BASE/api/pocketflare/restore/start" \
        -H "Authorization: Bearer $admin_token" \
        -H "Content-Type: application/json" \
        -d '{}' 2>/dev/null)
    printf "%s" "$start_resp" > "$ARTIFACT_DIR/start-resume.json"
    restore_token=$(echo "$start_resp" | jq -r .fileUploadToken 2>/dev/null || echo "")
    session_id=$(echo "$start_resp" | jq -r .sessionId 2>/dev/null || echo "")
    assert "resume: restore session started" '[ -n "$restore_token" ] && [ -n "$session_id" ]'

    run_restore "resume" "$MINIMAL_FIXTURE" "--restore-token $restore_token"
    restored_token=$(auth_superuser "admin@test.local" "test123456" "resume-restored")
    assert "resume: restored superuser can authenticate" '[ -n "$restored_token" ] && [ "$restored_token" != "null" ]'
    verify_minimal "$restored_token" "resume"
}

run_large_lane() {
    echo "-- Large restore lane --"
    start_wrangler "large"
    local admin_token restored_token
    admin_token=$(ensure_admin "large")
    assert_target_empty "$admin_token" "large"
    run_restore "large" "$LARGE_FIXTURE" "--email $ADMIN_EMAIL --password $ADMIN_PASSWORD"
    restored_token=$(auth_superuser "admin@scale.local" "test123456" "large-restored")
    assert "large: restored superuser can authenticate" '[ -n "$restored_token" ] && [ "$restored_token" != "null" ]'
    verify_large "$restored_token" "large"
}

echo "=== Pocketflare CLI Restore Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo ""

ensure_fixtures
ensure_deps
run_minimal_lane
run_resume_lane
run_large_lane

echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [[ "$FAIL" -eq 0 ]]; then
    green "CLI RESTORE PROOF PASSED"
    exit 0
fi

red "$FAIL TEST(S) FAILED"
exit 1
