# Upstream compatibility checks

The release pin lives in `scripts/update-pb.sh`. A passing build against that
pin is not evidence that a newer upstream release works.

## Pull requests

`CI` runs the offline updater/version-check regressions, checks the pin against
the latest stable GitHub release, replays the patch stack, and builds the real
Worker. A stale pin fails the version check rather than silently passing CI.

`PocketBase compatibility` runs `make proof` in an isolated GitHub runner. This
includes the real Wrangler deploy **dry-run**, D1 bootstrap and edge fixtures,
restore, R2 copy, cron, local realtime, and opt-in DO SQLite chained views. It
also tests the Go/JS Promise boundary and native-testable adapter packages.
There is no Cloudflare token requirement and no production deployment. Failure
logs are retained as workflow artifacts for seven days.

## Daily upstream checks

`PocketBase upstream` runs daily at 08:17 UTC and can also be run manually.
It reports the committed pin and latest stable release separately. If the pin
is stale, the freshness job fails, but the independent candidate job still
replays/builds/proves the latest release using the same compatibility workflow.
It changes the pin only in the disposable runner checkout; it never pushes,
opens or merges an upgrade automatically, or modifies deployed resources.

When the pin already matches latest, the scheduled run skips the expensive
candidate proof. Changes to the watcher or reusable workflow, and manual runs,
also exercise the candidate path even when the versions match. Candidate
checks retain the dependency-metadata guard: required Go dependency changes
are an upgrade task, not silently accepted compatibility.

GitHub Actions failure notifications depend on the maintainer's notification
settings. Review both freshness and candidate compatibility: they answer
different questions. An API failure is not treated as a successful check.

## Local commands

```sh
node --test tests/check-pb-version.test.mjs
pnpm run check:pb-version
node scripts/check-pb-version.mjs --latest
```

The last command emits only the validated stable tag for automation. Network
requests have a 15-second deadline and use `GITHUB_TOKEN` or `GH_TOKEN` when
available; anonymous checks still work. Offline tests cover stale pins, numeric
version order, release filtering, HTTP failures, and CLI exit codes.

A successful local proof does not certify production latency, cold starts,
or every custom hook. Run the explicit remote proofs and deployment benchmarks
when those boundaries change. D1 transaction limitations and the optional
Durable Object modes remain as documented in `D1-COMPATIBILITY.md`.
