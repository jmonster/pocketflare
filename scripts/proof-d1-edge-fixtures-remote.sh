#!/bin/bash
# proof-d1-edge-fixtures-remote.sh — Prove D1 edge fixtures against a deployed
# Worker on remote D1. Same test coverage as proof-d1-edge-fixtures.sh but
# targets a deployed Worker URL instead of local wrangler dev.
#
# Usage:
#   POCKETFLARE_D1_EDGE_BASE_URL=<deployed-worker-url> \
#   POCKETFLARE_ADMIN_EMAIL=<email> \
#   POCKETFLARE_ADMIN_PASSWORD=<password> \
#   ./scripts/proof-d1-edge-fixtures-remote.sh
#
# Requires: jq, curl, node
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="$(date +%Y%m%dT%H%M%S)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-d1-edge-remote-$RUN_ID"
mkdir -p "$ARTIFACT_DIR"

PASS=0
FAIL=0

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

json_field() {
  jq -r "$1 // empty" 2>/dev/null
}

req_json() {
  local method="$1" url="$2" body="$3" out="$4" headers="$5"
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

resp_status() {
  awk 'NR==1 { print $2 }' "$1" | tr -d '\r'
}

json_get() {
  jq -r "$1 // empty" "$2" 2>/dev/null || true
}

create_record() {
  local collection="$1" name="$2" body="$3"
  local out="$ARTIFACT_DIR/${name}.json"
  local headers="$ARTIFACT_DIR/${name}.headers"
  req_json POST "$BASE/api/collections/$collection/records" "$body" "$out" "$headers"
  echo "$out"
}

delete_record() {
  local collection="$1" record_id="$2"
  local headers="$ARTIFACT_DIR/delete-${collection}-${record_id}.headers"
  curl -sS --max-time 30 -D "$headers" -o /dev/null \
    -X DELETE "$BASE/api/collections/$collection/records/$record_id" \
    -H "Authorization: Bearer $TOKEN"
  resp_status "$headers"
}

get_record_code() {
  local collection="$1" record_id="$2"
  local headers="$ARTIFACT_DIR/get-${collection}-${record_id}.headers"
  curl -sS --max-time 30 -D "$headers" -o /dev/null \
    "$BASE/api/collections/$collection/records/$record_id" \
    -H "Authorization: Bearer $TOKEN"
  resp_status "$headers"
}

list_total_items() {
  local collection="$1" query="${2:-}"
  local url="$BASE/api/collections/$collection/records"
  if [[ -n "$query" ]]; then url="$url?$query"; fi
  curl -sS --max-time 30 "$url" \
    -H "Authorization: Bearer $TOKEN" \
    | jq -r '.totalItems'
}

# ── Validate ──────────────────────────────────────────────────────────

if [[ -z "${POCKETFLARE_D1_EDGE_BASE_URL:-}" ]]; then
  red "FAIL: POCKETFLARE_D1_EDGE_BASE_URL is required (deployed Worker URL)"
  exit 1
fi
if [[ -z "${POCKETFLARE_ADMIN_EMAIL:-}" || -z "${POCKETFLARE_ADMIN_PASSWORD:-}" ]]; then
  red "FAIL: POCKETFLARE_ADMIN_EMAIL and POCKETFLARE_ADMIN_PASSWORD are required"
  exit 1
fi

cd "$ROOT"
BASE="${POCKETFLARE_D1_EDGE_BASE_URL%/}"
ADMIN_EMAIL="$POCKETFLARE_ADMIN_EMAIL"
ADMIN_PASSWORD="$POCKETFLARE_ADMIN_PASSWORD"

echo "=== Pocketflare D1 Edge Fixture Remote Proof ==="
echo "run: $RUN_ID"
echo "target: $BASE"
echo "artifacts: $ARTIFACT_DIR"
echo ""

# ── Health check ──
BOOTED=false
for i in $(seq 1 30); do
  HEALTH_CODE=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
  if [[ "$HEALTH_CODE" = "200" ]]; then BOOTED=true; break; fi
  sleep 2
done
assert "Worker boots (health 200)" '$BOOTED'

# ── Authenticate ──
TOKEN=$(curl -sS --max-time 30 -X POST "$BASE/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg identity "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{identity:$identity,password:$password}')" \
  | jq -r '.token // empty' 2>/dev/null || true)

assert "superuser auth works" '[ -n "$TOKEN" ]'
if [[ -z "$TOKEN" ]]; then
  red "FAIL: could not authenticate as superuser"
  exit 1
fi

RUN_SUFFIX="${RUN_ID//[^a-zA-Z0-9]/}"
ROOT_COLL="pf_edge_remote_root_${RUN_SUFFIX}"
CHILD_COLL="pf_edge_remote_child_${RUN_SUFFIX}"
GRAND_COLL="pf_edge_remote_grand_${RUN_SUFFIX}"
BASE_COLL="pf_edge_remote_base_${RUN_SUFFIX}"
VIEW1_COLL="pf_edge_remote_view1_${RUN_SUFFIX}"
VIEW2_COLL="pf_edge_remote_view2_${RUN_SUFFIX}"
SQL_TABLE="pf_edge_remote_sql_${RUN_SUFFIX}"

# ---------------------------------------------------------------------------
# 1. Cascade delete across 3 levels
# ---------------------------------------------------------------------------
echo "── 1. Multi-level cascade delete (remote D1) ──"

ROOT_CREATE="$(jq -n --arg name "$ROOT_COLL" '{name:$name,type:"base",fields:[{name:"label",type:"text",required:true}]}')"
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

CHILD_ONE_RECORD="$(create_record "$CHILD_COLL" "child-one-record" "$(jq -n --arg parent "$ROOT_RECORD_ID" '{label:"child-1",parent:$parent}')")"
CHILD_ONE_ID="$(json_get '.id' "$CHILD_ONE_RECORD")"
assert "create first child record" '[ -n "$CHILD_ONE_ID" ]'

CHILD_TWO_RECORD="$(create_record "$CHILD_COLL" "child-two-record" "$(jq -n --arg parent "$ROOT_RECORD_ID" '{label:"child-2",parent:$parent}')")"
CHILD_TWO_ID="$(json_get '.id' "$CHILD_TWO_RECORD")"
assert "create second child record" '[ -n "$CHILD_TWO_ID" ]'

GRAND_ONE_RECORD="$(create_record "$GRAND_COLL" "grand-one-record" "$(jq -n --arg parent "$CHILD_ONE_ID" '{label:"grand-1",parent:$parent}')")"
GRAND_ONE_ID="$(json_get '.id' "$GRAND_ONE_RECORD")"
assert "create first grandchild record" '[ -n "$GRAND_ONE_ID" ]'

GRAND_TWO_RECORD="$(create_record "$GRAND_COLL" "grand-two-record" "$(jq -n --arg parent "$CHILD_TWO_ID" '{label:"grand-2",parent:$parent}')")"
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
echo "── 2. Raw SQL route behavior (remote D1) ──"

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
MIXED_COUNT_RESP="$ARTIFACT_DIR/sql-mixed-count.json"
MIXED_COUNT_HEADERS="$ARTIFACT_DIR/sql-mixed-count.headers"
req_json POST "$BASE/api/sql" "$(jq -n --arg query "$(printf 'select count(*) from "%s"' "$SQL_TABLE")" '{query:$query}')" "$MIXED_COUNT_RESP" "$MIXED_COUNT_HEADERS"
MIXED_TABLE_COUNT="$(json_get '.rows[0][0]' "$MIXED_COUNT_RESP")"
assert "mixed read/write left table unchanged" '[ "$MIXED_TABLE_COUNT" = "3" ]'

# ---------------------------------------------------------------------------
# 3. Collection import with interdependent views
# ---------------------------------------------------------------------------
echo "── 3. Collection import with interdependent views (remote D1) ──"

BASE_CREATE="$(jq -n --arg name "$BASE_COLL" '
  {name:$name,type:"base",fields:[
    {name:"title",type:"text",required:true},
    {name:"kind",type:"text",required:true}
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
        viewQuery: ("select id, title, kind from `" + $base + "` where kind = '\''keep'\''")
      },
      {
        name: $view2,
        type: "view",
        viewQuery: ("select id, title, kind from `" + $view1 + "` where kind = '\''keep'\''")
      }
    ]
  }
')"

IMPORT_RESP="$ARTIFACT_DIR/import-views.json"
IMPORT_HEADERS="$ARTIFACT_DIR/import-views.headers"
req_json PUT "$BASE/api/collections/import" "$IMPORT_BODY" "$IMPORT_RESP" "$IMPORT_HEADERS"
IMPORT_HTTP="$(resp_status "$IMPORT_HEADERS")"
IMPORT_RESP_BODY="$(cat "$IMPORT_RESP" 2>/dev/null)"
echo "  Import response HTTP: $IMPORT_HTTP"

if [[ "$IMPORT_HTTP" = "204" ]]; then
  assert "import dependent views returns 204" 'true'
else
  # D1 raw SQL supports chained views (verified via wrangler d1 execute). The import endpoint fails at the PocketBase/Pocketflare app layer.
  assert "import dependent views returns 204" 'false'
  echo "  Import response body: $IMPORT_RESP_BODY"
fi

# Only test view resolution if import succeeded
if [[ "$IMPORT_HTTP" = "204" ]]; then
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
fi

echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"

if [[ "$FAIL" -eq 0 ]]; then
  green "D1 EDGE FIXTURE REMOTE PROOF PASSED"
  exit 0
fi

red "$FAIL TEST(S) FAILED"
exit 1
