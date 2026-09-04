#!/bin/bash
# proof-d1-edge-fixtures.sh — Prove the remaining D1 edge fixtures against a
# local wrangler dev Worker in D1 mode.
#
# Coverage:
#   1. Multi-level cascade delete across 3+ levels
#   2. Collection import with interdependent views via /api/collections/import
#   3. Raw SQL route statement splitting and mixed read/write rejection
#
# Usage:
#   ./scripts/proof-d1-edge-fixtures.sh
#
# Requires: wrangler, jq, curl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="$(date +%Y%m%dT%H%M%S)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-d1-edge-fixtures-$RUN_ID"
STATE_DIR="$ARTIFACT_DIR/wrangler-state"
mkdir -p "$ARTIFACT_DIR" "$STATE_DIR"

PASS=0
FAIL=0

ADMIN_EMAIL="${POCKETFLARE_ADMIN_EMAIL:-proof-d1-edge-fixtures@test.local}"
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
	echo ""
	echo "Logs: $ARTIFACT_DIR/dev.log"
	echo "Artifacts: $ARTIFACT_DIR"
}
trap cleanup EXIT

json_field() {
	jq -r "$1 // empty" 2>/dev/null
}

req_json() {
	local method="$1"
	local url="$2"
	local body="${3:-}"
	local out="$4"
	local headers="$5"

	if [[ -n "$body" ]]; then
		curl -sS --max-time 45 -D "$headers" -o "$out" \
			-X "$method" "$url" \
			-H "Authorization: Bearer $TOKEN" \
			-H "Content-Type: application/json" \
			-d "$body"
	else
		curl -sS --max-time 45 -D "$headers" -o "$out" \
			-X "$method" "$url" \
			-H "Authorization: Bearer $TOKEN"
	fi
}

req_public_json() {
	local method="$1"
	local url="$2"
	local body="${3:-}"
	local out="$4"
	local headers="$5"

	if [[ -n "$body" ]]; then
		curl -sS --max-time 45 -D "$headers" -o "$out" \
			-X "$method" "$url" \
			-H "Content-Type: application/json" \
			-d "$body"
	else
		curl -sS --max-time 45 -D "$headers" -o "$out" \
			-X "$method" "$url"
	fi
}

resp_status() {
	local headers="$1"
	awk 'NR==1 { print $2 }' "$headers" | tr -d '\r'
}

json_get() {
	local filter="$1"
	local file="$2"
	jq -r "$filter // empty" "$file" 2>/dev/null || true
}

wait_for_port() {
	for _ in $(seq 1 30); do
		if grep -q "Ready on" "$ARTIFACT_DIR/dev.log" 2>/dev/null; then
			local port
			port="$(grep -oE 'http://(127\.0\.0\.1|localhost):[0-9]+' "$ARTIFACT_DIR/dev.log" | head -1 | grep -oE '[0-9]+$' || true)"
			if [[ -n "$port" ]]; then
				BASE="http://127.0.0.1:$port"
				return 0
			fi
		fi
		sleep 1
	done
	return 1
}

wait_for_health() {
	for _ in $(seq 1 60); do
		local code
		code="$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo 000)"
		if [[ "$code" = "200" ]]; then
			return 0
		fi
		if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
			return 1
		fi
		sleep 2
	done
	return 1
}

authenticate() {
	TOKEN="$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
		-H "Content-Type: application/json" \
		-d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" \
		| jq -r '.token // empty' 2>/dev/null || true)"

	if [[ -n "$TOKEN" ]]; then
		return 0
	fi

	local location
	location="$(curl -sS --max-time 30 -o /dev/null -w "%{redirect_url}" "$BASE/_pf" 2>/dev/null || true)"
	if [[ "$location" =~ /pbinstall/([^/]+) ]]; then
		local install_token="${BASH_REMATCH[1]}"
		curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/records" \
			-H "Content-Type: application/json" \
			-H "Authorization: Bearer $install_token" \
			-d "$(jq -n \
				--arg email "$ADMIN_EMAIL" \
				--arg password "$ADMIN_PASSWORD" \
				--arg passwordConfirm "$ADMIN_PASSWORD" \
				--arg token "$install_token" \
				'{email:$email,password:$password,passwordConfirm:$passwordConfirm,token:$token}')" \
			>/dev/null

		TOKEN="$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
			-H "Content-Type: application/json" \
			-d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" \
			| jq -r '.token // empty' 2>/dev/null || true)"
	fi
}

create_collection() {
	local name="$1"
	local body="$2"
	local out="$ARTIFACT_DIR/${name}.json"
	local headers="$ARTIFACT_DIR/${name}.headers"
	req_json POST "$BASE/api/collections" "$body" "$out" "$headers"
	echo "$out"
}

update_collection() {
	local collection_id="$1"
	local name="$2"
	local body="$3"
	local out="$ARTIFACT_DIR/${name}.json"
	local headers="$ARTIFACT_DIR/${name}.headers"
	req_json PATCH "$BASE/api/collections/$collection_id" "$body" "$out" "$headers"
	echo "$out"
}

create_record() {
	local collection="$1"
	local name="$2"
	local body="$3"
	local out="$ARTIFACT_DIR/${name}.json"
	local headers="$ARTIFACT_DIR/${name}.headers"
	req_json POST "$BASE/api/collections/$collection/records" "$body" "$out" "$headers"
	echo "$out"
}

delete_record() {
	local collection="$1"
	local record_id="$2"
	local headers="$ARTIFACT_DIR/delete-${collection}-${record_id}.headers"
	curl -sS --max-time 30 -D "$headers" -o /dev/null \
		-X DELETE "$BASE/api/collections/$collection/records/$record_id" \
		-H "Authorization: Bearer $TOKEN"
	resp_status "$headers"
}

get_record_code() {
	local collection="$1"
	local record_id="$2"
	local headers="$ARTIFACT_DIR/get-${collection}-${record_id}.headers"
	curl -sS --max-time 30 -D "$headers" -o /dev/null \
		"$BASE/api/collections/$collection/records/$record_id" \
		-H "Authorization: Bearer $TOKEN"
	resp_status "$headers"
}

list_total_items() {
	local collection="$1"
	local query="${2:-}"
	local url="$BASE/api/collections/$collection/records"
	if [[ -n "$query" ]]; then
		url="$url?$query"
	fi
	curl -sS --max-time 30 "$url" \
		-H "Authorization: Bearer $TOKEN" \
		| jq -r '.totalItems'
}

sql_request() {
	local name="$1"
	local query="$2"
	local out="$ARTIFACT_DIR/${name}.json"
	local headers="$ARTIFACT_DIR/${name}.headers"
	req_json POST "$BASE/api/sql" "$(jq -n --arg query "$query" '{query:$query}')" "$out" "$headers"
	echo "$out"
}

echo "=== Pocketflare D1 Edge Fixture Proof ==="
echo "run: $RUN_ID"
echo "artifacts: $ARTIFACT_DIR"
echo ""

cd "$ROOT"
make build > "$ARTIFACT_DIR/build.log" 2>&1
green "  build complete"

"$ROOT/node_modules/.bin/wrangler" dev --port 0 --persist-to "$STATE_DIR" \
	--var POCKETFLARE_ADMIN_EMAIL:"$ADMIN_EMAIL" \
	--var POCKETFLARE_ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
	> "$ARTIFACT_DIR/dev.log" 2>&1 &
WRANGLER_PID=$!

if ! wait_for_port; then
	red "FAIL: wrangler dev did not report a port"
	sed -n '1,160p' "$ARTIFACT_DIR/dev.log"
	exit 1
fi
green "  wrangler dev listening on $BASE"

if ! wait_for_health; then
	red "FAIL: /api/health never returned 200"
	sed -n '1,200p' "$ARTIFACT_DIR/dev.log"
	exit 1
fi
green "  worker is healthy"

authenticate
assert "superuser auth works" '[ -n "$TOKEN" ]'
if [[ -z "$TOKEN" ]]; then
	red "FAIL: could not authenticate as superuser"
	exit 1
fi

RUN_SUFFIX="${RUN_ID//[^a-zA-Z0-9]/}"
ROOT_COLL="pf_edge_root_${RUN_SUFFIX}"
CHILD_COLL="pf_edge_child_${RUN_SUFFIX}"
GRAND_COLL="pf_edge_grand_${RUN_SUFFIX}"
BASE_COLL="pf_edge_base_${RUN_SUFFIX}"
VIEW1_COLL="pf_edge_view1_${RUN_SUFFIX}"
VIEW2_COLL="pf_edge_view2_${RUN_SUFFIX}"
SQL_TABLE="pf_edge_sql_${RUN_SUFFIX}"

# ---------------------------------------------------------------------------
# 1. Cascade delete across 3 levels
# ---------------------------------------------------------------------------
echo "── 1. Multi-level cascade delete ──"

ROOT_CREATE="$(jq -n --arg name "$ROOT_COLL" '{name:$name,type:"base",fields:[{name:"label",type:"text",required:true}]}' )"
ROOT_RESP="$ARTIFACT_DIR/root-create.json"
ROOT_HEADERS="$ARTIFACT_DIR/root-create.headers"
req_json POST "$BASE/api/collections" "$ROOT_CREATE" "$ROOT_RESP" "$ROOT_HEADERS"
ROOT_ID="$(json_get '.id' "$ROOT_RESP")"
assert "create root collection" '[ -n "$ROOT_ID" ]'

CHILD_CREATE="$(jq -n --arg name "$CHILD_COLL" --arg rootId "$ROOT_ID" '
	{name:$name,type:"base",fields:[
		{name:"label",type:"text",required:true},
		{name:"parent",type:"relation",required:true,collectionId:$rootId,maxSelect:1,cascadeDelete:true}
	]}
')"
CHILD_RESP="$ARTIFACT_DIR/child-create.json"
CHILD_HEADERS="$ARTIFACT_DIR/child-create.headers"
req_json POST "$BASE/api/collections" "$CHILD_CREATE" "$CHILD_RESP" "$CHILD_HEADERS"
CHILD_ID="$(json_get '.id' "$CHILD_RESP")"
assert "create child collection" '[ -n "$CHILD_ID" ]'

GRAND_CREATE="$(jq -n --arg name "$GRAND_COLL" --arg childId "$CHILD_ID" '
	{name:$name,type:"base",fields:[
		{name:"label",type:"text",required:true},
		{name:"parent",type:"relation",required:true,collectionId:$childId,maxSelect:1,cascadeDelete:true}
	]}
')"
GRAND_RESP="$ARTIFACT_DIR/grand-create.json"
GRAND_HEADERS="$ARTIFACT_DIR/grand-create.headers"
req_json POST "$BASE/api/collections" "$GRAND_CREATE" "$GRAND_RESP" "$GRAND_HEADERS"
GRAND_ID="$(json_get '.id' "$GRAND_RESP")"
assert "create grandchild collection" '[ -n "$GRAND_ID" ]'

ROOT_RECORD="$(create_record "$ROOT_COLL" "root-record" '{"label":"root"}')"
ROOT_RECORD_ID="$(json_get '.id' "$ROOT_RECORD")"
assert "create root record" '[ -n "$ROOT_RECORD_ID" ]'

CHILD_ONE_RECORD="$(create_record "$CHILD_COLL" "child-one-record" "$(jq -n --arg parent "$ROOT_RECORD_ID" '{label:"child-1",parent:$parent}')" )"
CHILD_ONE_ID="$(json_get '.id' "$CHILD_ONE_RECORD")"
assert "create first child record" '[ -n "$CHILD_ONE_ID" ]'

CHILD_TWO_RECORD="$(create_record "$CHILD_COLL" "child-two-record" "$(jq -n --arg parent "$ROOT_RECORD_ID" '{label:"child-2",parent:$parent}')" )"
CHILD_TWO_ID="$(json_get '.id' "$CHILD_TWO_RECORD")"
assert "create second child record" '[ -n "$CHILD_TWO_ID" ]'

GRAND_ONE_RECORD="$(create_record "$GRAND_COLL" "grand-one-record" "$(jq -n --arg parent "$CHILD_ONE_ID" '{label:"grand-1",parent:$parent}')" )"
GRAND_ONE_ID="$(json_get '.id' "$GRAND_ONE_RECORD")"
assert "create first grandchild record" '[ -n "$GRAND_ONE_ID" ]'

GRAND_TWO_RECORD="$(create_record "$GRAND_COLL" "grand-two-record" "$(jq -n --arg parent "$CHILD_TWO_ID" '{label:"grand-2",parent:$parent}')" )"
GRAND_TWO_ID="$(json_get '.id' "$GRAND_TWO_RECORD")"
assert "create second grandchild record" '[ -n "$GRAND_TWO_ID" ]'

ROOT_DELETE_HTTP="$(delete_record "$ROOT_COLL" "$ROOT_RECORD_ID")"
assert "delete root record returns 204" '[ "$ROOT_DELETE_HTTP" = "204" ]'
assert "child records cascade deleted" '[ "$(list_total_items "$CHILD_COLL")" = "0" ]'
assert "grandchild records cascade deleted" '[ "$(list_total_items "$GRAND_COLL")" = "0" ]'
assert "deleted child record 1 returns 404" '[ "$(get_record_code "$CHILD_COLL" "$CHILD_ONE_ID")" = "404" ]'
assert "deleted child record 2 returns 404" '[ "$(get_record_code "$CHILD_COLL" "$CHILD_TWO_ID")" = "404" ]'
assert "deleted grandchild record 1 returns 404" '[ "$(get_record_code "$GRAND_COLL" "$GRAND_ONE_ID")" = "404" ]'
assert "deleted grandchild record 2 returns 404" '[ "$(get_record_code "$GRAND_COLL" "$GRAND_TWO_ID")" = "404" ]'

# ---------------------------------------------------------------------------
# 2. Raw SQL route behavior
# ---------------------------------------------------------------------------
echo "── 2. Raw SQL route behavior ──"

SQL_SETUP_QUERY="$(cat <<SQL
drop table if exists "$SQL_TABLE";
create table "$SQL_TABLE"(
	id integer primary key,
	text_value text not null,
	blob_value blob not null,
	note text not null
);
insert into "$SQL_TABLE"(id,text_value,blob_value,note) values
	(1, 'alpha;beta', X'3B', 'line-comment-safe'),
	(2, 'gamma', X'414243', 'block-comment-safe');
-- this line comment contains ; ; ; and must not split
/* this block comment contains ; ; ; and must not split either */
insert into "$SQL_TABLE"(id,text_value,blob_value,note) values
	(3, 'semi;colon', X'3B3B', 'tail');
SQL
)"
SQL_SETUP_RESP="$ARTIFACT_DIR/sql-setup.json"
SQL_SETUP_HEADERS="$ARTIFACT_DIR/sql-setup.headers"
req_json POST "$BASE/api/sql" "$(jq -n --arg query "$SQL_SETUP_QUERY" '{query:$query}')" "$SQL_SETUP_RESP" "$SQL_SETUP_HEADERS"
assert "sql setup returns 200" '[ "$(resp_status "$SQL_SETUP_HEADERS")" = "200" ]'

SQL_VERIFY_QUERY="select id, text_value, hex(blob_value) as blob_hex, note from \"$SQL_TABLE\" order by id"
SQL_VERIFY_RESP="$ARTIFACT_DIR/sql-verify.json"
SQL_VERIFY_HEADERS="$ARTIFACT_DIR/sql-verify.headers"
req_json POST "$BASE/api/sql" "$(jq -n --arg query "$SQL_VERIFY_QUERY" '{query:$query}')" "$SQL_VERIFY_RESP" "$SQL_VERIFY_HEADERS"
assert "sql verify query returns 200" '[ "$(resp_status "$SQL_VERIFY_HEADERS")" = "200" ]'
SQL_ROW_COUNT="$(json_get '.rows | length' "$SQL_VERIFY_RESP")"
SQL_ROW_1_TEXT="$(json_get '.rows[0][1]' "$SQL_VERIFY_RESP")"
SQL_ROW_1_BLOB="$(json_get '.rows[0][2]' "$SQL_VERIFY_RESP")"
SQL_ROW_3_TEXT="$(json_get '.rows[2][1]' "$SQL_VERIFY_RESP")"
SQL_ROW_3_BLOB="$(json_get '.rows[2][2]' "$SQL_VERIFY_RESP")"
assert "sql splitter preserved three rows" '[ "$SQL_ROW_COUNT" = "3" ]'
assert "sql splitter preserved semicolons inside strings" '[ "$SQL_ROW_1_TEXT" = "alpha;beta" ]'
assert "sql splitter preserved blob literal parsing" '[ "$SQL_ROW_1_BLOB" = "3B" ]'
assert "sql splitter preserved semicolons inside trailing string" '[ "$SQL_ROW_3_TEXT" = "semi;colon" ]'
assert "sql splitter preserved blob hex in final row" '[ "$SQL_ROW_3_BLOB" = "3B3B" ]'

SQL_MIXED_QUERY="select 1 as read_value; insert into \"$SQL_TABLE\"(id,text_value,blob_value,note) values (4, 'mixed', X'00', 'mixed')"
SQL_MIXED_RESP="$ARTIFACT_DIR/sql-mixed.json"
SQL_MIXED_HEADERS="$ARTIFACT_DIR/sql-mixed.headers"
req_json POST "$BASE/api/sql" "$(jq -n --arg query "$SQL_MIXED_QUERY" '{query:$query}')" "$SQL_MIXED_RESP" "$SQL_MIXED_HEADERS"
SQL_MIXED_HTTP="$(resp_status "$SQL_MIXED_HEADERS")"
assert "mixed read/write query is rejected" '[ "$SQL_MIXED_HTTP" = "400" ]'
MIXED_COUNT_QUERY="$(sql_request sql-mixed-count "$(printf 'select count(*) from "%s"' "$SQL_TABLE")")"
MIXED_TABLE_COUNT="$(json_get '.rows[0][0]' "$MIXED_COUNT_QUERY")"
assert "mixed read/write left table unchanged" '[ "$MIXED_TABLE_COUNT" = "3" ]'

# ---------------------------------------------------------------------------
# 3. Collection import with interdependent views
# ---------------------------------------------------------------------------
echo "── 3. Collection import with interdependent views ──"

BASE_CREATE="$(jq -n --arg name "$BASE_COLL" '
	{name:$name,type:"base",fields:[
		{name:"title",type:"text",required:true},
		{name:"kind",type:"text",required:true},
		{name:"count",type:"number"}
	]}
')"
BASE_RESP="$ARTIFACT_DIR/base-create.json"
BASE_HEADERS="$ARTIFACT_DIR/base-create.headers"
req_json POST "$BASE/api/collections" "$BASE_CREATE" "$BASE_RESP" "$BASE_HEADERS"
BASE_ID="$(json_get '.id' "$BASE_RESP")"
assert "create base collection for import fixture" '[ -n "$BASE_ID" ]'

IMPORT_BODY="$(jq -n --arg base "$BASE_COLL" --arg view1 "$VIEW1_COLL" --arg view2 "$VIEW2_COLL" '
	{
		deleteMissing: false,
		collections: [
			{
				name: $view1,
				type: "view",
				viewQuery: ("select id, title, kind, count from `" + $base + "` where kind = '\''keep'\''")
			},
			{
				name: $view2,
				type: "view",
				viewQuery: ("select id, title, kind, count from `" + $view1 + "` where kind = '\''keep'\''")
			}
		]
	}
')"
IMPORT_RESP="$ARTIFACT_DIR/import-views.json"
IMPORT_HEADERS="$ARTIFACT_DIR/import-views.headers"
req_json PUT "$BASE/api/collections/import" "$IMPORT_BODY" "$IMPORT_RESP" "$IMPORT_HEADERS"
IMPORT_HTTP="$(resp_status "$IMPORT_HEADERS")"
assert "import dependent views returns 204" '[ "$IMPORT_HTTP" = "204" ]'

IMPORT_QAW_COUNT="$(grep -c 'query-after-write-blocked' "$ARTIFACT_DIR/dev.log" 2>/dev/null || true)"
IMPORT_QAW_COUNT="${IMPORT_QAW_COUNT:-0}"
assert "no query-after-write error during import" '[ "$IMPORT_QAW_COUNT" = "0" ]'

BASE_RECORD="$(create_record "$BASE_COLL" "import-base-record" '{"title":"imported row","kind":"keep"}')"
BASE_RECORD_ID="$(json_get '.id' "$BASE_RECORD")"
assert "create base record after import" '[ -n "$BASE_RECORD_ID" ]'

VIEW2_LIST_HEADERS="$ARTIFACT_DIR/view2-list.headers"
VIEW2_LIST="$ARTIFACT_DIR/view2-list.json"
curl -sS --max-time 30 -D "$VIEW2_LIST_HEADERS" -o "$VIEW2_LIST" \
	"$BASE/api/collections/$VIEW2_COLL/records?perPage=1&sort=title" \
	-H "Authorization: Bearer $TOKEN"
assert "view2 records endpoint returns 200" '[ "$(resp_status "$VIEW2_LIST_HEADERS")" = "200" ]'
VIEW2_TOTAL_ITEMS="$(json_get '.totalItems' "$VIEW2_LIST")"
VIEW2_ROW_TITLE="$(json_get '.items[0].title' "$VIEW2_LIST")"
assert "view2 resolves imported base record" '[ "$VIEW2_TOTAL_ITEMS" = "1" ]'
assert "view2 row title matches imported base data" '[ "$VIEW2_ROW_TITLE" = "imported row" ]'

VIEW2_SCHEMA_HEADERS="$ARTIFACT_DIR/view2-schema.headers"
VIEW2_SCHEMA="$ARTIFACT_DIR/view2-schema.json"
curl -sS --max-time 30 -D "$VIEW2_SCHEMA_HEADERS" -o "$VIEW2_SCHEMA" \
	"$BASE/api/collections/$VIEW2_COLL" \
	-H "Authorization: Bearer $TOKEN"
assert "view2 collection resolves after import" '[ "$(resp_status "$VIEW2_SCHEMA_HEADERS")" = "200" ]'
VIEW2_TYPE="$(json_get '.type' "$VIEW2_SCHEMA")"
assert "view2 collection type is view" '[ "$VIEW2_TYPE" = "view" ]'
VIEW2_COUNT_TYPE=$(jq -r '.fields[] | select(.name == "count") | .type' "$VIEW2_SCHEMA")
assert "imported view retains numeric source field type" '[ "$VIEW2_COUNT_TYPE" = "number" ]'
TEMP_VIEWS=$(sql_request temp-view-cleanup "SELECT count(*) FROM sqlite_master WHERE name GLOB '_temp_*'")
assert "view inspection leaves no temporary schema objects" '[ "$(jq -r ".rows[0][0]" "$TEMP_VIEWS")" = "0" ]'

echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"

if [[ "$FAIL" -eq 0 ]]; then
	green "D1 EDGE FIXTURE PROOF PASSED"
	exit 0
fi

red "$FAIL TEST(S) FAILED"
exit 1
