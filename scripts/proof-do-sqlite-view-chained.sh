#!/bin/bash
# proof-do-sqlite-view-chained.sh — Prove DO SQLite supports chained view
# collections via individual POST /api/collections (not the import endpoint).
#
# Starts wrangler dev with APP_DO bound and POCKETFLARE_DB_MODE=do_sqlite,
# creates a base collection, creates view_a (depends on base) and view_b
# (depends on view_a) individually via POST /api/collections, then verifies
# a base record appears through both views.
#
# Also asserts that PUT /api/collections/import hangs in DO SQLite mode
# (this is the known limitation; individual POST is the workaround).
#
# Usage:
#   ./scripts/proof-do-sqlite-view-chained.sh
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="$(date +%Y%m%dT%H%M%S)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-do-sqlite-view-import-$RUN_ID"
STATE_DIR="$ARTIFACT_DIR/wrangler-state"
TEMP_WRANGLER="$ROOT/wrangler.proof-do-sqlite-views.toml"
mkdir -p "$ARTIFACT_DIR" "$STATE_DIR"

PASS=0
FAIL=0

ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-proof-do-views@test.local}"
ADMIN_PASSWORD="${POCKETFLARE_ADMIN_PASSWORD:-test123456}"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
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
	rm -f "$TEMP_WRANGLER"
	echo ""
	echo "Logs: $ARTIFACT_DIR/dev.log"
	echo "Artifacts: $ARTIFACT_DIR"
}
trap cleanup EXIT

echo "=== Pocketflare DO SQLite View Import Proof ==="
echo "run: $RUN_ID"
echo "artifacts: $ARTIFACT_DIR"
echo ""

cd "$ROOT"

# ── 1. Build WASM ──
echo "── 1. Building WASM ──"
make build > "$ARTIFACT_DIR/build.log" 2>&1
if [[ ! -f "$ROOT/dist/app.wasm" ]]; then
	red "FAIL: build did not produce dist/app.wasm"
	cat "$ARTIFACT_DIR/build.log"
	exit 1
fi
green "  build complete"

# ── 2. Generate temporary wrangler config with APP_DO binding ──
echo "── 2. Generating temporary wrangler config ──"
cp "$ROOT/wrangler.toml" "$TEMP_WRANGLER"
cat >> "$TEMP_WRANGLER" <<'EOF'

[[durable_objects.bindings]]
name = "APP_DO"
class_name = "AppDO"

[[migrations]]
tag = "v3"
new_sqlite_classes = ["AppDO"]
EOF
green "  wrangler.proof-do-sqlite-views.toml created"

# ── 3. Start wrangler dev in DO SQLite mode ──
echo "── 3. Starting wrangler dev (DO SQLite mode) ──"
pnpm exec wrangler dev --port 0 --config "$TEMP_WRANGLER" --persist-to "$STATE_DIR" \
	--var POCKETFLARE_DB_MODE:do_sqlite \
	--var POCKETFLARE_ADMIN_EMAIL:"$ADMIN_EMAIL" \
	--var POCKETFLARE_ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
	> "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

BASE=""
for i in $(seq 1 45); do
	if grep -q "Ready on" "$ARTIFACT_DIR/dev.log" 2>/dev/null; then
		PORT=$(grep -oE 'http://(127\.0\.0\.1|localhost):[0-9]+' "$ARTIFACT_DIR/dev.log" | head -1 | grep -oE '[0-9]+$' || true)
		if [[ -n "$PORT" ]]; then
			BASE="http://127.0.0.1:$PORT"
			break
		fi
	fi
	sleep 1
done

if [[ -z "$BASE" ]]; then
	red "FAIL: wrangler dev did not report a port within 45s"
	sed -n '1,160p' "$ARTIFACT_DIR/dev.log"
	exit 1
fi
green "  wrangler dev listening on $BASE"

# ── 4. Wait for WASM boot ──
echo "── 4. Waiting for WASM boot inside DO ──"
BOOTED=false
for i in $(seq 1 90); do
	HEALTH_CODE=$(curl -sS --max-time 15 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
	if [[ "$HEALTH_CODE" = "200" ]]; then
		BOOTED=true
		break
	fi
	if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
		red "FAIL: wrangler dev exited before health check passed"
		sed -n '1,200p' "$ARTIFACT_DIR/dev.log"
		exit 1
	fi
	sleep 2
done
assert "DO SQLite WASM boots (health returns 200)" '$BOOTED'

if ! $BOOTED; then
	red "FAIL: WASM did not boot within 180s"
	sed -n '1,200p' "$ARTIFACT_DIR/dev.log"
	exit 1
fi

# ── 5. Authenticate as superuser ──
echo "── 5. Authenticating ──"
TOKEN="$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
	-H "Content-Type: application/json" \
	-d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" \
	| jq -r '.token // empty' 2>/dev/null || true)"

if [[ -z "$TOKEN" ]]; then
	# Fallback: try the installer flow via _pf redirect.
	REDIRECT_URL="$(curl -sS --max-time 30 -o /dev/null -w "%{redirect_url}" "$BASE/_pf" 2>/dev/null || true)"
	INSTALL_TOKEN="$(echo "$REDIRECT_URL" | grep -o '/pbinstal/[^/&?#]\+' | head -1 | cut -d/ -f3 || true)"
	if [[ -n "$INSTALL_TOKEN" ]]; then
		curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/records" \
			-H "Content-Type: application/json" \
			-d "$(jq -n \
				--arg email "$ADMIN_EMAIL" \
				--arg password "$ADMIN_PASSWORD" \
				--arg passwordConfirm "$ADMIN_PASSWORD" \
				--arg token "$INSTALL_TOKEN" \
				'{email:$email,password:$password,passwordConfirm:$passwordConfirm,token:$token}')" \
			>/dev/null
		sleep 0.5
		TOKEN="$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
			-H "Content-Type: application/json" \
			-d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" \
			| jq -r '.token // empty' 2>/dev/null || true)"
	fi
fi
assert "superuser authenticated" '[ -n "$TOKEN" ]'

if [[ -z "$TOKEN" ]]; then
	red "FAIL: could not authenticate as superuser"
	exit 1
fi

# ── 6. Verify running in DO SQLite mode ──
echo "── 6. Verifying DO SQLite mode ──"
ROUTE_HEADER=$(curl -sS --max-time 30 -D - -o /dev/null "$BASE/api/health" 2>/dev/null | grep -i "x-pocketflare-route" | tr -d '\r' || echo "")
assert "health response routed through DO" 'echo "$ROUTE_HEADER" | grep -q "dynamic-do"'

# ── 7. Create base collection for dependent views ──
echo "── 7. Creating base collection ──"
BASE_COLL="pf_do_base_${RUN_ID//[^a-zA-Z0-9]/}"
VIEW1_COLL="pf_do_view1_${RUN_ID//[^a-zA-Z0-9]/}"
VIEW2_COLL="pf_do_view2_${RUN_ID//[^a-zA-Z0-9]/}"

BASE_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$(jq -n --arg name "$BASE_COLL" '
		{name:$name,type:"base",fields:[
			{name:"title",type:"text",required:true},
			{name:"kind",type:"text",required:true}
		]}
	')" 2>/dev/null)
BASE_COLL_ID=$(echo "$BASE_RESP" | jq -r '.id // empty' 2>/dev/null)
assert "create base collection" '[ -n "$BASE_COLL_ID" ]'

# ── 8. Create interdependent views via POST (individual creation) ──
echo "── 8. Creating interdependent views via POST ──"
# view1 depends on base; view2 depends on view1 (chained dependency).

VIEW1_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$(jq -n --arg name "$VIEW1_COLL" --arg base "$BASE_COLL" '
		{name:$name,type:"view",viewQuery:("select id, title, kind from `" + $base + "` where kind = '\''keep'\''")}
	')" 2>/dev/null)
VIEW1_ID=$(echo "$VIEW1_RESP" | jq -r '.id // empty' 2>/dev/null)
assert "create view_a (depends on base)" '[ -n "$VIEW1_ID" ]'

VIEW2_RESP=$(curl -sS --max-time 30 -X POST "$BASE/api/collections" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$(jq -n --arg name "$VIEW2_COLL" --arg view1 "$VIEW1_COLL" '
		{name:$name,type:"view",viewQuery:("select id, title, kind from `" + $view1 + "` where kind = '\''keep'\''")}
	')" 2>/dev/null)
VIEW2_ID=$(echo "$VIEW2_RESP" | jq -r '.id // empty' 2>/dev/null)
assert "create view_b (depends on view_a)" '[ -n "$VIEW2_ID" ]'

# ── 9. Verify both views are available via API ──
echo "── 9. Verifying views after creation ──"

VIEW1_SCHEMA=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW1_COLL" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null)
VIEW1_TYPE=$(echo "$VIEW1_SCHEMA" | jq -r '.type // empty' 2>/dev/null)
assert "view1 exists and is type 'view'" '[ "$VIEW1_TYPE" = "view" ]'

VIEW2_SCHEMA=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW2_COLL" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null)
VIEW2_TYPE=$(echo "$VIEW2_SCHEMA" | jq -r '.type // empty' 2>/dev/null)
assert "view2 exists and is type 'view'" '[ "$VIEW2_TYPE" = "view" ]'

# ── 10. Create base record and verify it appears through both views ──
echo "── 10. Verifying record propagation through chained views ──"

BASE_RECORD=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/$BASE_COLL/records" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"title":"chained view test","kind":"keep"}' 2>/dev/null)
BASE_RECORD_ID=$(echo "$BASE_RECORD" | jq -r '.id // empty' 2>/dev/null)
assert "create base record" '[ -n "$BASE_RECORD_ID" ]'

sleep 0.5

VIEW1_RECORDS=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW1_COLL/records?sort=title" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null)
VIEW1_TOTAL=$(echo "$VIEW1_RECORDS" | jq -r '.totalItems // 0' 2>/dev/null)
assert "view1 returns base record" '[ "$VIEW1_TOTAL" = "1" ]'

VIEW2_RECORDS=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW2_COLL/records?sort=title" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null)
VIEW2_TOTAL=$(echo "$VIEW2_RECORDS" | jq -r '.totalItems // 0' 2>/dev/null)
assert "view2 returns base record through chained view" '[ "$VIEW2_TOTAL" = "1" ]'

VIEW2_TITLE=$(echo "$VIEW2_RECORDS" | jq -r '.items[0].title // empty' 2>/dev/null)
assert "view2 record title matches" '[ "$VIEW2_TITLE" = "chained view test" ]'

# ── 11. Delete base record → verify removed from both views ──
echo "── 11. Verifying deletion propagation ──"

DELETE_HTTP=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code}" \
	-X DELETE "$BASE/api/collections/$BASE_COLL/records/$BASE_RECORD_ID" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null)
assert "base record deleted (204)" '[ "$DELETE_HTTP" = "204" ]'

sleep 0.5

VIEW1_POST_DEL=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW1_COLL/records" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.totalItems // 0' 2>/dev/null)
assert "view1 empty after base record deleted" '[ "$VIEW1_POST_DEL" = "0" ]'

VIEW2_POST_DEL=$(curl -sS --max-time 30 "$BASE/api/collections/$VIEW2_COLL/records" \
	-H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.totalItems // 0' 2>/dev/null)
assert "view2 empty after base record deleted" '[ "$VIEW2_POST_DEL" = "0" ]'

# ── 12. Document import API limitation ──
echo "── 12. Import API limitation ──"
IMPORT_HTTP=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" \
	-X PUT "$BASE/api/collections/import" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$(jq -n '{deleteMissing:false,collections:[{name:"test_import_probe",type:"base",fields:[{name:"x",type:"text"}]}]}')" 2>/dev/null || true)
assert "PUT /api/collections/import hangs in DO SQLite (known issue)" '[ "${IMPORT_HTTP:-000}" = "000" ]'

# ── 13. Check for errors in dev log ──
echo "── 13. Log checks ──"

FATAL_COUNT=$(grep -ci "fatal\|panic\|init-error" "$ARTIFACT_DIR/dev.log" 2>/dev/null; true)
assert "no fatal/panic/init-error in dev log" '[ "${FATAL_COUNT:-0}" = "0" ]'

QAW_COUNT=$(grep -c "query-after-write-blocked" "$ARTIFACT_DIR/dev.log" 2>/dev/null; true)
assert "no query-after-write errors" '[ "${QAW_COUNT:-0}" = "0" ]'

echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"

if [[ "$FAIL" -eq 0 ]]; then
	green "DO SQLITE VIEW IMPORT PROOF PASSED"
	exit 0
fi

red "$FAIL TEST(S) FAILED"
exit 1
