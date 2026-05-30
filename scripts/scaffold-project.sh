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

    cat > "$target/wrangler.toml" <<EOF
name = "$(toml_escape "$worker_name")"
main = "dist/worker.mjs"
compatibility_date = "2025-05-30"

[vars]
POCKETFLARE_APP_URL = "$(toml_escape "$app_url")"

[[d1_databases]]
binding = "APP_DB"
database_name = "$(toml_escape "$app_db_name")"
database_id = "$(toml_escape "$app_db_id")"

[[d1_databases]]
binding = "LOGS_DB"
database_name = "$(toml_escape "$logs_db_name")"
database_id = "$(toml_escape "$logs_db_id")"

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
}

create_cloudflare_resources() {
    local app_db_name="$1"
    local logs_db_name="$2"
    local storage_bucket="$3"
    local backups_bucket="$4"

    echo "Wrangler will create remote Cloudflare resources in the account selected by your Wrangler login."
    echo "Creates: D1 $app_db_name, D1 $logs_db_name, R2 $storage_bucket, R2 $backups_bucket."
    echo "It will not delete or overwrite existing resources."

    if ! confirm "Create these resources now?" "n"; then
        return 0
    fi

    pnpm exec wrangler d1 create "$app_db_name"
    pnpm exec wrangler d1 create "$logs_db_name"
    pnpm exec wrangler r2 bucket create "$storage_bucket"
    pnpm exec wrangler r2 bucket create "$backups_bucket"
}

main() {
    local target project_name default_module module worker_name subdomain default_url app_url
    local app_db_name logs_db_name storage_bucket backups_bucket app_db_id logs_db_id

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
    app_db_name="$(prompt_required "APP_DB D1 database name" "$worker_name-app")"
    logs_db_name="$(prompt_required "LOGS_DB D1 database name" "$worker_name-logs")"
    storage_bucket="$(prompt_required "STORAGE R2 bucket name" "$worker_name-storage")"
    backups_bucket="$(prompt_required "BACKUPS R2 bucket name" "$worker_name-backups")"

    if confirm "Run Wrangler create commands for these D1/R2 resources?" "n"; then
        create_cloudflare_resources "$app_db_name" "$logs_db_name" "$storage_bucket" "$backups_bucket"
    fi

    echo "Paste the database IDs from Wrangler output or from Cloudflare D1."
    app_db_id="$(prompt_required "APP_DB database_id")"
    logs_db_id="$(prompt_required "LOGS_DB database_id")"

    copy_template "$target"
    replace_module_path "$target" "$module"
    replace_package_name "$target" "$project_name"
    write_wrangler "$target" "$worker_name" "$app_url" "$app_db_name" "$app_db_id" "$logs_db_name" "$logs_db_id" "$storage_bucket" "$backups_bucket"

    echo ""
    echo "Created Pocketflare project: $target"
    echo "Next:"
    echo "  cd \"$target\""
    echo "  ./scripts/update-pb.sh"
    echo "  pnpm install"
    echo "  make build"
    echo "  make deploy"
    echo "  open /_/ after deploy to create the first PocketBase superuser"
}

main "$@"
