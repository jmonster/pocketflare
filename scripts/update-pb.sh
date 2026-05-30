#!/bin/bash
set -euo pipefail

VERSION="${1:-v0.36.9}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PB_DIR="$PROJECT_DIR/internal/pocketbase"
PATCHES_DIR="$PROJECT_DIR/patches"

echo "Fetching PocketBase ${VERSION}..."

if [ -d "$PB_DIR/.git" ]; then
    cd "$PB_DIR"
    git fetch --depth 1 origin "refs/tags/${VERSION}:refs/tags/${VERSION}" 2>/dev/null || true
    git checkout -- . 2>/dev/null || true
    git clean -fd 2>/dev/null || true
    git checkout "${VERSION}" 2>/dev/null || {
        echo "Tag ${VERSION} not found locally; cloning fresh..."
        rm -rf "$PB_DIR"
        git clone --depth 1 --branch "${VERSION}" https://github.com/pocketbase/pocketbase.git "$PB_DIR"
    }
else
    rm -rf "$PB_DIR"
    git clone --depth 1 --branch "${VERSION}" https://github.com/pocketbase/pocketbase.git "$PB_DIR"
fi

cd "$PB_DIR"

echo "Applying patches..."
for patch in "$PATCHES_DIR"/*.patch; do
    [ -f "$patch" ] || continue
    echo "  Applying $(basename "$patch")..."
    git apply "$patch" || {
        echo "  ERROR: $(basename "$patch") failed to apply."
        exit 1
    }
done

echo "Done. PocketBase ${VERSION} is ready."
