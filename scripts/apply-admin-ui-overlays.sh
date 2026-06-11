#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ADMIN_UI="$ROOT/admin-ui/_"

if [[ ! -d "$ADMIN_UI" ]]; then
	echo "ERROR: admin-ui/_ does not exist. Build and sync the admin UI before applying overlays." >&2
	exit 1
fi

install -d "$ADMIN_UI/images"
cp "$ROOT/branding/logo.png" "$ADMIN_UI/images/logo.png"
echo "Applied admin UI overlays."
