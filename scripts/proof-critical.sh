#!/bin/bash
# proof-critical.sh — Run Pocketflare's canonical critical proof lane.
#
# Default mode runs local, self-contained proofs. Use --remote to also run
# deployed-Worker proofs that require real Cloudflare resources and credentials.
#
# Usage:
#   ./scripts/proof-critical.sh
#   ./scripts/proof-critical.sh --remote
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="$(date +%Y%m%dT%H%M%S)"
ARTIFACT_DIR="$ROOT/.artifacts/proof-critical-$RUN_ID"
REMOTE=false

for arg in "$@"; do
	case "$arg" in
		--remote) REMOTE=true ;;
		-h|--help)
			sed -n '1,12p' "$0"
			exit 0
			;;
		*)
			echo "Unknown argument: $arg" >&2
			exit 2
			;;
	esac
done

mkdir -p "$ARTIFACT_DIR"

PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*" >&2; }

run_step() {
	local name="$1"
	shift
	local safe_name
	safe_name="$(echo "$name" | tr ' /:' '---' | tr -cd '[:alnum:]_.-')"
	local log="$ARTIFACT_DIR/$safe_name.log"

	echo "── $name ──"
	if (cd "$ROOT" && "$@" > "$log" 2>&1); then
		green "  PASS: $name"
		PASS=$((PASS + 1))
	else
		red "  FAIL: $name"
		red "  log: $log"
		tail -80 "$log" >&2 || true
		FAIL=$((FAIL + 1))
		return 1
	fi
}

patch_replay() {
	local replay_dir="$ARTIFACT_DIR/pb-replay"
	local version
	version="$(sed -n 's/^VERSION="${1:-\([^}]*\)}"/\1/p' "$ROOT/scripts/update-pb.sh")"
	if [[ -z "$version" ]]; then
		echo "Could not read PocketBase version from scripts/update-pb.sh" >&2
		return 1
	fi
	git clone --depth 1 --branch "$version" https://github.com/pocketbase/pocketbase.git "$replay_dir"
	cd "$replay_dir"
	for patch in "$ROOT"/patches/*.patch; do
		git apply "$patch"
	done
}

deploy_dry_run() {
	pnpm exec wrangler deploy --dry-run --outdir "$ARTIFACT_DIR/deploy-dry-run"
}

echo "=== Pocketflare Critical Proof ==="
echo "artifacts: $ARTIFACT_DIR"
echo "remote: $REMOTE"
echo ""

run_step "build" make build
run_step "PocketBase version check" node scripts/check-pb-version.mjs
run_step "patch replay" patch_replay
run_step "deploy dry-run" deploy_dry_run
run_step "restore CLI proof" ./scripts/proof-restore-cli.sh
run_step "D1 bootstrap proof" ./scripts/proof-d1-bootstrap.sh
run_step "DO SQLite chained-view proof" ./scripts/proof-do-sqlite-view-chained.sh
run_step "R2 copy proof" ./scripts/proof-copy.sh
run_step "cron proof" ./scripts/proof-cron.sh

if [[ "$REMOTE" == "true" ]]; then
	run_step "remote D1 edge fixtures proof" ./scripts/proof-d1-edge-fixtures-remote.sh
	run_step "production realtime proof" ./scripts/proof-realtime-production.sh
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
echo "Artifacts: $ARTIFACT_DIR"

if [[ "$FAIL" -gt 0 ]]; then
	exit 1
fi
