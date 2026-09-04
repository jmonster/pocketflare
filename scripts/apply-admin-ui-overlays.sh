#!/bin/bash
# Build the pinned upstream dashboard, then add Pocketflare's extension module.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PB_UI="$ROOT/internal/pocketbase/ui"
ADMIN_UI="$ROOT/dist/admin-ui/_"

if [[ ! -f "$PB_UI/package.json" ]]; then
    echo "Run ./scripts/update-pb.sh before building the admin UI." >&2
    exit 1
fi
if [[ ! -f "$PB_UI/node_modules/.package-lock.json" || "$PB_UI/package-lock.json" -nt "$PB_UI/node_modules/.package-lock.json" ]]; then
    npm --prefix "$PB_UI" ci --no-audit --no-fund
fi
npm --prefix "$PB_UI" run build
mkdir -p "$ADMIN_UI"
rsync -a --delete "$PB_UI/dist/" "$ADMIN_UI/"
cd "$ROOT"
pnpm exec esbuild ui/extensions.js --bundle --splitting --format=esm --platform=browser \
    --outdir="$ADMIN_UI" --chunk-names='assets/pocketflare-[name]-[hash]' --minify
cp node_modules/sql.js/dist/sql-wasm-browser.wasm "$ADMIN_UI/assets/"
echo "Built PocketBase admin UI with Pocketflare extensions."
