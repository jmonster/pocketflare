#!/bin/bash
set -euo pipefail

VERSION="${1:-v0.40.4}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PB_DIR="$PROJECT_DIR/internal/pocketbase"
PATCHES_DIR="$PROJECT_DIR/patches"

check_destination() {
    if [ -L "$PB_DIR" ] || [ -L "$PB_DIR/.git" ] || { [ -e "$PB_DIR" ] && [ ! -d "$PB_DIR/.git" ]; }; then
        echo "ERROR: refusing to replace a symlink or non-Git internal/pocketbase." >&2
        exit 1
    fi
    if [ -d "$PB_DIR/.git" ]; then
        if [ -e "$PB_DIR/.git/commondir" ] || git -C "$PB_DIR" config --get core.worktree >/dev/null; then
            echo "ERROR: internal/pocketbase must be a standalone Git checkout without core.worktree." >&2
            exit 1
        fi
        # Include ignored files: replacing the checkout must not delete local
        # data or build artifacts that git diff does not report.
        if ! git -C "$PB_DIR" diff --quiet || ! git -C "$PB_DIR" diff --cached --quiet || [ -n "$(git -C "$PB_DIR" ls-files --others)" ]; then
            echo "ERROR: internal/pocketbase has local changes or untracked/ignored files." >&2
            echo "  Preserve or stash them (including ignored files) before retrying." >&2
            exit 1
        fi
    fi
}

mkdir -p "$PROJECT_DIR/internal"
LOCK_DIR="$PROJECT_DIR/internal/.pocketbase-update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "ERROR: another PocketBase update may be running ($LOCK_DIR)." >&2
    echo "  Remove a stale lock only after confirming no updater is running." >&2
    exit 1
fi

STAGING=""
PROMOTED=false
cleanup() {
    local status=$?
    trap - EXIT
    if [ -n "$STAGING" ]; then
        if [ "$PROMOTED" = false ] && [ -d "$STAGING/previous" ]; then
            if [ -e "$PB_DIR" ] || [ -L "$PB_DIR" ] || ! mv "$STAGING/previous" "$PB_DIR"; then
                echo "ERROR: previous checkout preserved at $STAGING/previous; restore it manually." >&2
                rmdir "$LOCK_DIR"
                exit 1
            fi
        fi
        rm -rf "$STAGING"
    fi
    rmdir "$LOCK_DIR"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

check_destination
STAGING="$(mktemp -d "$PROJECT_DIR/internal/.pocketbase-update.XXXXXX")"

echo "Fetching PocketBase ${VERSION}..."
# Never fetch/checkout/reset in the active source tree. A missing tag, network
# failure, or conflict anywhere in the patch stack must leave it untouched.
if [ -d "$PB_DIR/.git" ]; then
    # Copy Git metadata too: a clean working tree may still contain stashes,
    # local branches, reflogs, and configuration that must survive an upgrade.
    cp -a "$PB_DIR" "$STAGING/next"
    git -C "$STAGING/next" fetch --depth 1 https://github.com/pocketbase/pocketbase.git "refs/tags/${VERSION}:refs/tags/${VERSION}"
    git -C "$STAGING/next" checkout --detach "${VERSION}"
else
    git clone --depth 1 --branch "${VERSION}" https://github.com/pocketbase/pocketbase.git "$STAGING/next"
fi

echo "Applying patches..."
for patch in "$PATCHES_DIR"/*.patch; do
    [ -f "$patch" ] || continue
    echo "  Applying $(basename "$patch")..."
    git -C "$STAGING/next" apply "$patch" || {
        echo "  ERROR: $(basename "$patch") failed to apply; existing checkout unchanged." >&2
        exit 1
    }
done

# Recheck in case local edits were made while cloning. Keep the previous tree
# until promotion succeeds, so the EXIT trap can restore it on a failed move.
check_destination
if [ -d "$PB_DIR" ]; then
    mv "$PB_DIR" "$STAGING/previous"
fi
mv "$STAGING/next" "$PB_DIR"
PROMOTED=true

echo "Done. PocketBase ${VERSION} is ready."
echo "Next: pnpm install && make build"
