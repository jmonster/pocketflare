#!/bin/bash
set -euo pipefail

# migrate-data.sh — Export PocketBase SQLite data.db to D1-compatible SQL
#
# Usage:
#   ./scripts/migrate-data.sh <path-to-data.db> [--include-logs] [--data-only] [--schema-only]
#
# Examples:
#   ./scripts/migrate-data.sh ./pb_data/data.db > schema-and-data.sql
#   ./scripts/migrate-data.sh ./pb_data/data.db --schema-only > schema.sql
#   ./scripts/migrate-data.sh ./pb_data/data.db --data-only > data.sql
#   ./scripts/migrate-data.sh ./pb_data/data.db --include-logs > with-logs.sql

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Help ──────────────────────────────────────────────────────────────────────
usage() {
    sed -n '4,/^$/s/^# //p' "$0"
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        -h|--help) usage ;;
    esac
done

# ── Arguments ──────────────────────────────────────────────────────────────────
DB_PATH="${1:-}"
shift 2>/dev/null || true

INCLUDE_LOGS=false
DATA_ONLY=false
SCHEMA_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --include-logs) INCLUDE_LOGS=true ;;
        --data-only)    DATA_ONLY=true ;;
        --schema-only)  SCHEMA_ONLY=true ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
    shift
done

if [[ -z "$DB_PATH" ]]; then
    echo "Error: missing path to data.db"
    usage
fi

if [[ ! -f "$DB_PATH" ]]; then
    echo "Error: file not found: $DB_PATH"
    exit 1
fi

if [[ "$DATA_ONLY" == true && "$SCHEMA_ONLY" == true ]]; then
    echo "Error: --data-only and --schema-only are mutually exclusive"
    exit 1
fi

# ── sqlite3 check ─────────────────────────────────────────────────────────────
if ! command -v sqlite3 &>/dev/null; then
    echo "Error: sqlite3 is not installed."
    echo ""
    echo "  Install it with one of:"
    echo "    macOS:  brew install sqlite3"
    echo "    Ubuntu: sudo apt install sqlite3"
    echo "    Fedora: sudo dnf install sqlite"
    echo ""
    exit 1
fi

# ── Tables to exclude ─────────────────────────────────────────────────────────
EXCLUDE_TABLES=("_migrations")

if [[ "$INCLUDE_LOGS" != true ]]; then
    EXCLUDE_TABLES+=("_logs")
fi

# Build SQL exclusion clause: one string per table name for use with .separator
EXCLUDE_CSV=""
sep=""
for t in "${EXCLUDE_TABLES[@]}"; do
    EXCLUDE_CSV="${EXCLUDE_CSV}${sep}'${t}'"
    sep=","
done

# ── Schema dump ───────────────────────────────────────────────────────────────
if [[ "$DATA_ONLY" != true ]]; then
    echo "-- PocketBase → D1 migration"
    echo "-- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "-- Source: $DB_PATH"
    echo ""

    # Fetch the SQL schema for each user table, filtering out excluded tables
    TABLES=$(sqlite3 "$DB_PATH" ".tables")

    for table in $TABLES; do
        # Check if excluded
        excluded=false
        for et in "${EXCLUDE_TABLES[@]}"; do
            if [[ "$table" == "$et" ]]; then
                excluded=true
                break
            fi
        done
        [[ "$excluded" == true ]] && continue

        # Dump the CREATE TABLE statement
        SCHEMA=$(sqlite3 "$DB_PATH" ".schema \"$table\"" 2>/dev/null || true)
        if [[ -z "$SCHEMA" ]]; then
            continue
        fi

        echo "-- Table: $table"
        echo "$SCHEMA"
        echo ""
    done
fi

# ── Data dump ─────────────────────────────────────────────────────────────────
if [[ "$SCHEMA_ONLY" != true ]]; then
    TABLES=$(sqlite3 "$DB_PATH" ".tables")

    for table in $TABLES; do
        # Check if excluded
        excluded=false
        for et in "${EXCLUDE_TABLES[@]}"; do
            if [[ "$table" == "$et" ]]; then
                excluded=true
                break
            fi
        done
        [[ "$excluded" == true ]] && continue

        # Check if table is empty
        ROWCOUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM \"$table\";" 2>/dev/null || echo "0")
        if [[ "$ROWCOUNT" == "0" ]]; then
            continue
        fi

        echo "-- Data for: $table ($ROWCOUNT rows)"

        # Use .mode insert to generate INSERT statements
        # .dump is the most reliable approach — it handles BLOBs and special characters
        # Then filter to only INSERT lines
        sqlite3 "$DB_PATH" ".dump \"$table\"" 2>/dev/null | grep -E '^INSERT' || true
        echo ""
    done

    echo "-- Migration complete."
fi
