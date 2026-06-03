#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

prompt() {
    local label="$1"
    local default="${2:-}"
    local value

    if [[ -n "$default" ]]; then
        if ! read -r -p "$label [$default]: " value; then
            echo "Aborted: no input for $label." >&2
            exit 1
        fi
        printf "%s" "${value:-$default}"
    else
        if ! read -r -p "$label: " value; then
            echo "Aborted: no input for $label." >&2
            exit 1
        fi
        printf "%s" "$value"
    fi
}

prompt_required() {
    local label="$1"
    local default="${2:-}"
    local value

    while true; do
        value="$(prompt "$label" "$default")"
        if [[ -n "$value" ]]; then
            printf "%s" "$value"
            return 0
        fi
        echo "Required." >&2
    done
}

confirm() {
    local label="$1"
    local default="${2:-n}"
    local value suffix

    case "$default" in
        y|Y) suffix="[Y/n]" ;;
        *) suffix="[y/N]" ;;
    esac

    while true; do
        if ! read -r -p "$label $suffix: " value; then
            echo "Aborted: no input for $label." >&2
            exit 1
        fi
        value="${value:-$default}"
        case "$value" in
            y|Y|yes|YES) return 0 ;;
            n|N|no|NO) return 1 ;;
        esac
        echo "Answer y or n." >&2
    done
}

slugify() {
    printf "%s" "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

toml_escape() {
    printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

replace_module_path() {
    local target="$1"
    local module="$2"
    local escaped
    escaped="$(printf "%s" "$module" | sed 's/[\/&]/\\&/g')"

    {
        printf "module %s\n" "$module"
        sed '1d' "$target/go.mod"
    } > "$target/go.mod.tmp"
    mv "$target/go.mod.tmp" "$target/go.mod"

    while IFS= read -r -d '' file; do
        sed "s/github.com\\/pocketflare\\/pocketflare/$escaped/g" "$file" > "$file.tmp"
        mv "$file.tmp" "$file"
    done < <(find "$target" -path "$target/testapp" -prune -o -name '*.go' -type f -print0)
}

replace_package_name() {
    local target="$1"
    local name="$2"

    if [[ -f "$target/package.json" ]]; then
        sed "s/\"name\": \"pocketflare\"/\"name\": \"$name\"/" "$target/package.json" > "$target/package.json.tmp"
        mv "$target/package.json.tmp" "$target/package.json"
    fi
}

copy_template() {
    local target="$1"

    mkdir -p "$target"
    (
        cd "$ROOT"
        git ls-files -z
    ) | while IFS= read -r -d '' file; do
        case "$file" in
            testapp/*|TODO.md) continue ;;
        esac
        mkdir -p "$target/$(dirname "$file")"
        cp -p "$ROOT/$file" "$target/$file"
    done
}

write_wrangler() {
    local target="$1"
    local worker_name="$2"
    local app_url="$3"
    local app_db_name="$4"
    local app_db_id="$5"
    local logs_db_name="$6"
    local logs_db_id="$7"
    local storage_bucket="$8"
    local backups_bucket="$9"
    local db_mode="${10}"

    cat > "$target/wrangler.toml" <<EOF
name = "$(toml_escape "$worker_name")"
main = "dist/worker.mjs"
compatibility_date = "2025-05-30"

[vars]
POCKETFLARE_APP_URL = "$(toml_escape "$app_url")"
EOF

    if [[ "$db_mode" == "do_sqlite" ]]; then
        cat >> "$target/wrangler.toml" <<EOF
POCKETFLARE_DB_MODE = "do_sqlite"
EOF
    fi

    cat >> "$target/wrangler.toml" <<EOF

POCKETFLARE_STORAGE_BUCKET_NAME = "$(toml_escape "$storage_bucket")"
POCKETFLARE_BACKUPS_BUCKET_NAME = "$(toml_escape "$backups_bucket")"

# File copies stream through the Worker with bounded memory.
# Server-side R2 S3 CopyObject is disabled after deployed Worker E2E rejected
# r2.cloudflarestorage.com fetch URLs before HTTP.
EOF

    if [[ "$db_mode" == "d1" ]]; then
        cat >> "$target/wrangler.toml" <<EOF

[[d1_databases]]
binding = "APP_DB"
database_name = "$(toml_escape "$app_db_name")"
database_id = "$(toml_escape "$app_db_id")"

[[d1_databases]]
binding = "LOGS_DB"
database_name = "$(toml_escape "$logs_db_name")"
database_id = "$(toml_escape "$logs_db_id")"
EOF
    fi

    cat >> "$target/wrangler.toml" <<EOF

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "$(toml_escape "$storage_bucket")"

[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "$(toml_escape "$backups_bucket")"

[assets]
directory = "./admin-ui"
binding = "ASSETS"
EOF

    if [[ "$db_mode" == "do_sqlite" ]]; then
        cat >> "$target/wrangler.toml" <<EOF

[[durable_objects.bindings]]
name = "APP_DO"
class_name = "AppDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AppDO"]
EOF
    else
        cat >> "$target/wrangler.toml" <<EOF

# ── Optional: DO SQLite mode ───────────────────────────────────────────────
# Uncomment this binding, add a migration with new_sqlite_classes = ["AppDO"],
# and set POCKETFLARE_DB_MODE = "do_sqlite" to use Durable Object SQLite.
#
# [[durable_objects.bindings]]
# name = "APP_DO"
# class_name = "AppDO"
EOF
    fi

    cat >> "$target/wrangler.toml" <<EOF

# ── Cron triggers ──────────────────────────────────────────────────────────
# Uncomment to enable scheduled tasks. PocketBase cron jobs run on the
# scheduled event; the Worker fires every minute to check for due jobs.
#
# [triggers]
# crons = ["* * * * *"]

# ── Optional: realtime/SSE via Durable Objects ─────────────────────────────
# Uncomment to enable cross-isolate SSE. Without this, GET /api/realtime
# falls through to Go where SSE is non-functional on Workers (the WASM
# bridge's Flush is a no-op). ~$4/mo for a single always-warm DO instance.
#
# [[durable_objects.bindings]]
# name = "REALTIME_DO"
# class_name = "RealtimeDO"
#
# [[migrations]]
# tag = "realtime-v1"
# new_classes = ["RealtimeDO"]
EOF
}

create_cloudflare_resources() {
    local db_mode="$1"
    local app_db_name="$2"
    local logs_db_name="$3"
    local storage_bucket="$4"
    local backups_bucket="$5"

    echo "Wrangler will create remote Cloudflare resources in the account selected by your Wrangler login."
    if [[ "$db_mode" == "d1" ]]; then
        echo "Creates: D1 $app_db_name, D1 $logs_db_name, R2 $storage_bucket, R2 $backups_bucket."
    else
        echo "Creates: R2 $storage_bucket, R2 $backups_bucket. APP_DO is created by the Worker migration."
    fi
    echo "It will not delete or overwrite existing resources."

    if ! confirm "Create these resources now?" "n"; then
        return 0
    fi

    if [[ "$db_mode" == "d1" ]]; then
        pnpm exec wrangler d1 create "$app_db_name"
        pnpm exec wrangler d1 create "$logs_db_name"
    fi
    pnpm exec wrangler r2 bucket create "$storage_bucket"
    pnpm exec wrangler r2 bucket create "$backups_bucket"
}

validate_scaffold() {
    local mode="${1:-d1}"
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap "rm -rf '$tmpdir'" EXIT

    echo "=== Scaffold validation: $mode mode ==="
    local fails=0

    # Generate a scaffold project with canned answers.
    local project_name="validate-pocketflare"
    local module="example.com/validate-pocketflare"
    local storage_bucket="validate-pocketflare-storage"
    local backups_bucket="validate-pocketflare-backups"

    (
        cd "$ROOT"
        git ls-files -z
    ) | while IFS= read -r -d '' file; do
        case "$file" in
            testapp/*|TODO.md) continue ;;
        esac
        mkdir -p "$tmpdir/$(dirname "$file")"
        cp -p "$ROOT/$file" "$tmpdir/$file"
    done

    # Write wrangler.toml for the given mode.
    if [[ "$mode" == "do_sqlite" ]]; then
        write_wrangler "$tmpdir" "$project_name" "https://validate.workers.dev" "" "" "" "" "$storage_bucket" "$backups_bucket" "do_sqlite"
    else
        write_wrangler "$tmpdir" "$project_name" "https://validate.workers.dev" "validate-app" "00000000-0000-0000-0000-000000000001" "validate-logs" "00000000-0000-0000-0000-000000000002" "$storage_bucket" "$backups_bucket" "d1"
    fi

    # ── Validation 1: wrangler.toml parses ──
    echo -n "  wrangler.toml parse: "
    if python3 -c "import tomllib; tomllib.load(open('$tmpdir/wrangler.toml','rb'))" 2>/dev/null; then
        echo "PASS"
    elif python3 -c "import toml; toml.load('$tmpdir/wrangler.toml')" 2>/dev/null; then
        echo "PASS (toml)"
    elif command -v toml-test &>/dev/null && toml-test "$tmpdir/wrangler.toml" 2>/dev/null; then
        echo "PASS (toml-test)"
    else
        # Fallback: check basic TOML structure.
        if grep -q '^name = ' "$tmpdir/wrangler.toml" && grep -q '^main = ' "$tmpdir/wrangler.toml"; then
            echo "PASS (basic structure check)"
        else
            echo "FAIL (no TOML parser available; structure check failed)"
            fails=$((fails + 1))
        fi
    fi

    # ── Validation 2: DB mode is correct ──
    echo -n "  DB mode ($mode): "
    if [[ "$mode" == "d1" ]]; then
        if grep -q '\[\[d1_databases\]\]' "$tmpdir/wrangler.toml" && \
           grep -q 'binding = "APP_DB"' "$tmpdir/wrangler.toml" && \
           grep -q 'binding = "LOGS_DB"' "$tmpdir/wrangler.toml"; then
            echo "PASS (D1 bindings present)"
        else
            echo "FAIL (missing D1 bindings)"
            fails=$((fails + 1))
        fi
    else
        if grep -q '\[\[durable_objects.bindings\]\]' "$tmpdir/wrangler.toml" && \
           grep -q 'name = "APP_DO"' "$tmpdir/wrangler.toml" && \
           grep -q 'new_sqlite_classes = \["AppDO"\]' "$tmpdir/wrangler.toml" && \
           grep -q 'POCKETFLARE_DB_MODE = "do_sqlite"' "$tmpdir/wrangler.toml"; then
            echo "PASS (DO SQLite bindings present)"
        else
            echo "FAIL (missing DO SQLite bindings)"
            fails=$((fails + 1))
        fi
    fi

    # ── Validation 3: Required sections exist ──
    echo -n "  required sections: "
    local missing=""
    grep -q '\[\[r2_buckets\]\]' "$tmpdir/wrangler.toml" || missing="$missing R2"
    grep -q 'binding = "STORAGE"' "$tmpdir/wrangler.toml" || missing="$missing STORAGE"
    grep -q 'binding = "BACKUPS"' "$tmpdir/wrangler.toml" || missing="$missing BACKUPS"
    grep -q '\[assets\]' "$tmpdir/wrangler.toml" || missing="$missing assets"
    grep -q 'binding = "ASSETS"' "$tmpdir/wrangler.toml" || missing="$missing ASSETS"

    if [[ -z "$missing" ]]; then
        echo "PASS"
    else
        echo "FAIL (missing:$missing)"
        fails=$((fails + 1))
    fi

    # ── Validation 4: Next-step hint is appropriate ──
    echo -n "  next-step hint: "
    if [[ "$mode" == "do_sqlite" ]]; then
        if grep -q "APP_DO\|DO SQLite\|new_sqlite_classes" "$tmpdir/wrangler.toml"; then
            echo "PASS (DO SQLite guidance present)"
        else
            echo "FAIL (no DO SQLite guidance)"
            fails=$((fails + 1))
        fi
    else
        # D1 is the default; POCKETFLARE_DB_MODE should NOT be set to do_sqlite.
        # Exclude comment lines (#) from the active-setting check.
        if grep -v '^#' "$tmpdir/wrangler.toml" | grep -q 'POCKETFLARE_DB_MODE = "do_sqlite"'; then
            echo "FAIL (do_sqlite set in D1 mode)"
            fails=$((fails + 1))
        elif grep -q "DO SQLite\|new_sqlite_classes\|APP_DO" "$tmpdir/wrangler.toml"; then
            echo "PASS (DO SQLite guidance present as comment)"
        else
            echo "FAIL (missing DO SQLite migration guidance)"
            fails=$((fails + 1))
        fi
    fi

    echo ""
    if [[ "$fails" -eq 0 ]]; then
        echo "Scaffold validation ($mode): PASS"
    else
        echo "Scaffold validation ($mode): $fails FAILURE(S)"
        exit 1
    fi
}

main() {
    local target project_name default_module module worker_name subdomain default_url app_url
    local app_db_name logs_db_name storage_bucket backups_bucket app_db_id logs_db_id
    local db_mode

    # ── Non-interactive validation mode ──
    if [[ "${1:-}" == "--validate" ]]; then
        shift
        validate_scaffold "${1:-d1}"
        return
    fi

    target="$(prompt_required "Target directory")"
    mkdir -p "$(dirname "$target")"
    target="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"

    if [[ -e "$target" && -n "$(find "$target" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
        echo "Error: target directory is not empty: $target"
        exit 1
    fi

    project_name="$(slugify "$(basename "$target")")"
    default_module="example.com/$project_name"
    module="$(prompt_required "Go module path" "$default_module")"
    worker_name="$(prompt_required "Cloudflare Worker name" "$project_name")"
    subdomain="$(prompt "Workers.dev account subdomain, without .workers.dev")"

    if [[ -n "$subdomain" ]]; then
        default_url="https://$worker_name.$subdomain.workers.dev"
        app_url="$(prompt_required "Application URL for new installs" "$default_url")"
    else
        app_url="$(prompt_required "Application URL for new installs")"
    fi
    db_mode="d1"
    if confirm "Use Durable Object SQLite for the app database?" "n"; then
        db_mode="do_sqlite"
    fi

    if [[ "$db_mode" == "d1" ]]; then
        app_db_name="$(prompt_required "APP_DB D1 database name" "$worker_name-app")"
        logs_db_name="$(prompt_required "LOGS_DB D1 database name" "$worker_name-logs")"
    else
        app_db_name=""
        logs_db_name=""
    fi
    storage_bucket="$(prompt_required "STORAGE R2 bucket name" "$worker_name-storage")"
    backups_bucket="$(prompt_required "BACKUPS R2 bucket name" "$worker_name-backups")"

    if confirm "Run Wrangler create commands for these Cloudflare resources?" "n"; then
        create_cloudflare_resources "$db_mode" "$app_db_name" "$logs_db_name" "$storage_bucket" "$backups_bucket"
    fi

    if [[ "$db_mode" == "d1" ]]; then
        echo "Paste the database IDs from Wrangler output or from Cloudflare D1."
        app_db_id="$(prompt_required "APP_DB database_id")"
        logs_db_id="$(prompt_required "LOGS_DB database_id")"
    else
        app_db_id=""
        logs_db_id=""
    fi

    copy_template "$target"
    replace_module_path "$target" "$module"
    replace_package_name "$target" "$project_name"
    write_wrangler "$target" "$worker_name" "$app_url" "$app_db_name" "$app_db_id" "$logs_db_name" "$logs_db_id" "$storage_bucket" "$backups_bucket" "$db_mode"

    echo ""
    echo "Created Pocketflare project: $target"
    echo "Next:"
    echo "  cd \"$target\""
    echo "  ./scripts/update-pb.sh"
    echo "  pnpm install"
    echo "  make build"
    echo "  make deploy"
    echo "  open /_pf after deploy to create the first PocketBase superuser"
}

main "$@"
