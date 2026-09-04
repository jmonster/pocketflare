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
COVERAGE_MISSING=0

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
status_key() { printf '%s' "$1" | tr ' /:()+-' '_______' | tr -cd '[:alnum:]_'; }
coverage_status() {
	local path="$1" script="$2" required="${3:-required}" key var status
	key="$(status_key "$script")"
	var="step_status_$key"
	if [[ -z "${!var+x}" ]]; then
		status="NOT RUN"
		if [[ "$required" == "required" ]]; then
			COVERAGE_MISSING=$((COVERAGE_MISSING + 1))
		fi
	else
		status="${!var}"
	fi
	printf "  %-30s %s\n" "$path" "$status"
}

run_step() {
	local name="$1"
	shift
	local safe_name
	safe_name="$(echo "$name" | tr ' /:' '---' | tr -cd '[:alnum:]_.-')"
	local log="$ARTIFACT_DIR/$safe_name.log"
	local key
	key="$(status_key "$name")"

	echo "── $name ──"
	if (cd "$ROOT" && "$@" > "$log" 2>&1); then
		green "  PASS: $name"
		printf -v "step_status_$key" '%s' PASS
		PASS=$((PASS + 1))
	else
		red "  FAIL: $name"
		red "  log: $log"
		tail -80 "$log" >&2 || true
		printf -v "step_status_$key" '%s' FAIL
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
	if [[ "$(git rev-parse HEAD)" != "$(git -C "$ROOT/internal/pocketbase" rev-parse HEAD)" ]]; then
		echo "The built PocketBase checkout does not match the pinned release." >&2
		return 1
	fi
	# Verify the sources that make build actually consumed, including added files.
	while IFS= read -r file; do
		cmp "$file" "$ROOT/internal/pocketbase/$file" || return 1
	done < <(git diff --name-only; git ls-files --others --exclude-standard)
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
run_step "adapter regressions" go test ./adapter/d1
run_step "restore schema regressions" node --test tests/restore-schema.test.mjs
run_step "deploy dry-run" deploy_dry_run
run_step "restore CLI proof" ./scripts/proof-restore-cli.sh
run_step "D1 bootstrap proof" ./scripts/proof-d1-bootstrap.sh
run_step "DO SQLite chained-view proof" ./scripts/proof-do-sqlite-view-chained.sh
run_step "R2 copy proof" ./scripts/proof-copy.sh
run_step "cron proof" ./scripts/proof-cron.sh
run_step "D1 edge fixtures proof" ./scripts/proof-d1-edge-fixtures.sh
run_step "realtime proof" ./scripts/proof-realtime.sh

if [[ "$REMOTE" == "true" ]]; then
	run_step "remote D1 edge fixtures proof" ./scripts/proof-d1-edge-fixtures-remote.sh
	run_step "production realtime proof" ./scripts/proof-realtime-production.sh
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

echo ""
echo "── Coverage ──"
printf "  %-30s %s\n" "Critical Path" "Proven"
printf "  %-30s %s\n" "──────────────────────────────" "──────"
coverage_status "restore (minimal + large)" "restore CLI proof"
coverage_status "D1 bootstrap" "D1 bootstrap proof"
coverage_status "D1 edge fixtures" "D1 edge fixtures proof"
coverage_status "DO SQLite chained views" "DO SQLite chained-view proof"
coverage_status "realtime (local bridge)" "realtime proof"
coverage_status "cron" "cron proof"
coverage_status "R2 copy fallback" "R2 copy proof"
coverage_status "patch replay" "patch replay"
coverage_status "deploy dry-run" "deploy dry-run"
if [[ "$REMOTE" == "true" ]]; then
  coverage_status "D1 edge fixtures (remote)" "remote D1 edge fixtures proof"
  coverage_status "realtime (production)" "production realtime proof"
fi

echo "Artifacts: $ARTIFACT_DIR"

if [[ "$COVERAGE_MISSING" -gt 0 ]]; then
	red "Coverage table references $COVERAGE_MISSING step(s) that did not run."
	exit 1
fi

if [[ "$FAIL" -gt 0 ]]; then
	exit 1
fi
