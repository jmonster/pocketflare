#!/bin/bash
set -euo pipefail

# migrate-files.sh — Generate upload instructions for PocketBase storage files to R2
#
# Usage:
#   ./scripts/migrate-files.sh <path-to-storage-dir> [--execute] [--all] [--no-storage-prefix]
#
# Examples:
#   ./scripts/migrate-files.sh ./pb_data/storage/         # print wrangler commands
#   ./scripts/migrate-files.sh ./pb_data/storage/ --execute  # run uploads
#   ./scripts/migrate-files.sh ./pb_data/storage/ --all      # include files >5MB
#   ./scripts/migrate-files.sh ./r2-export --no-storage-prefix --execute

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

# ── Helper: human-readable size ───────────────────────────────────────────────
human_size() {
    local bytes=$1
    if (( bytes < 1024 )); then
        echo "${bytes}B"
    elif (( bytes < 1048576 )); then
        echo "$(( bytes / 1024 ))KB"
    elif (( bytes < 1073741824 )); then
        local mb=$(( bytes / 1048576 ))
        local frac=$(( (bytes % 1048576) * 10 / 1048576 ))
        echo "${mb}.${frac}MB"
    else
        local gb=$(( bytes / 1073741824 ))
        local frac=$(( (bytes % 1073741824) * 10 / 1073741824 ))
        echo "${gb}.${frac}GB"
    fi
}

# ── Arguments ──────────────────────────────────────────────────────────────────
STORAGE_DIR="${1:-}"
shift 2>/dev/null || true

EXECUTE=false
INCLUDE_ALL=false
STORAGE_PREFIX=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --execute)           EXECUTE=true ;;
        --all)               INCLUDE_ALL=true ;;
        --no-storage-prefix) STORAGE_PREFIX=false ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
    shift
done

if [[ -z "$STORAGE_DIR" ]]; then
    echo "Error: missing path to storage directory"
    usage
fi

if [[ ! -d "$STORAGE_DIR" ]]; then
    echo "Error: directory not found: $STORAGE_DIR"
    exit 1
fi

# ── wrangler check ────────────────────────────────────────────────────────────
if [[ "$EXECUTE" == true ]] && ! command -v pnpm &>/dev/null; then
    echo "Error: pnpm is not installed."
    echo ""
    echo "  Install pnpm, then run this from a Pocketflare project with Wrangler available to pnpm exec."
    echo ""
    exit 1
fi

# ── Determine bucket name ─────────────────────────────────────────────────────
BUCKET="${WRANGLER_R2_BUCKET:-pocketflare-storage}"

# ── Collect files ─────────────────────────────────────────────────────────────
MAX_SIZE=$((5 * 1024 * 1024))  # 5MB default limit
SKIPPED_COUNT=0
UPLOAD_COUNT=0
TOTAL_SIZE=0

STORAGE_ABS="$(cd "$STORAGE_DIR" && pwd)"

echo "Scanning: $STORAGE_ABS"
echo "Bucket:   $BUCKET"
echo "Max size: $([ "$INCLUDE_ALL" == true ] && echo "unlimited" || echo "5 MB")"
echo "Execute:  $([ "$EXECUTE" == true ] && echo "yes" || echo "no (dry-run)")"
echo "Prefix:   $([ "$STORAGE_PREFIX" == true ] && echo "storage/" || echo "none")"
echo ""

# Walk the PocketBase storage layout: collectionId/recordId/filename
# Using process substitution (<(...)) instead of pipe to avoid subshell
while IFS= read -r -d '' filepath; do
    relpath="${filepath#$STORAGE_ABS/}"
    filesize=$(wc -c < "$filepath")

    # Size filter
    if [[ "$INCLUDE_ALL" != true ]] && [[ "$filesize" -gt "$MAX_SIZE" ]]; then
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        echo "# SKIP ($(human_size "$filesize"), >5MB): $relpath"
        continue
    fi

    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
    TOTAL_SIZE=$((TOTAL_SIZE + filesize))

    if [[ "$STORAGE_PREFIX" == true ]]; then
        OBJECT_KEY="storage/$relpath"
    else
        OBJECT_KEY="$relpath"
    fi

    if [[ "$EXECUTE" == true ]]; then
        echo "# Uploading: $relpath ($(human_size "$filesize"))"
        pnpm exec wrangler r2 object put --remote "$BUCKET/$OBJECT_KEY" --file "$filepath" 2>/dev/null || {
            echo "# FAILED: $relpath"
        }
    else
        echo "pnpm exec wrangler r2 object put --remote \"$BUCKET/$OBJECT_KEY\" --file \"$filepath\""
    fi
done < <(find "$STORAGE_ABS" -type f -print0)

echo ""
if [[ "$EXECUTE" != true ]]; then
    echo "# To run these uploads, pass --execute"
fi
echo "# Summary: $UPLOAD_COUNT files to upload, $SKIPPED_COUNT skipped (over 5MB)"
echo "# Total data: $(human_size "$TOTAL_SIZE")"
echo "#"
echo "# To include files over 5MB, pass --all"
echo "# If your source export already includes storage/ in each path, pass --no-storage-prefix"
echo "# To set a custom bucket: WRANGLER_R2_BUCKET=<name> $0 ..."
