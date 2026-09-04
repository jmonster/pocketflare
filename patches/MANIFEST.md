# Pocketflare patches

Target: **PocketBase v0.40.2**. Apply these patches in filename order with
`./scripts/update-pb.sh`; implementations that do not need private PocketBase
internals live in this repository.

| Patch | Purpose | Implementation owner |
|---|---|---|
| `001-worker-runtime.patch` | WASM bootstrap, injected filesystem constructors, external transaction/realtime/cron entry points, restore bootstrap control, optional record-delete and SQL-console hooks | `adapter/`, `adapter/d1/`, `adapter/wasmdb/` |
| `002-d1-migrations.patch` | D1 initialization and migration execution without an outer deferred transaction | PocketBase migration internals; enabled by `core.D1BatchMode` |
| `003-d1-collections.patch` | Read schema metadata before queuing D1 writes, resolve imported collection definitions, and check view dependencies | PocketBase collection internals; parent-connection reads are limited to D1 |

There are no patches to the upstream dashboard, package manifest, logos, colors,
or version branding. `ui/extensions.js` uses PocketBase's existing extension
loader to register the restore and R2 settings pages. The restore UI and CLI use
root JS dependencies and share schema selection in `lib/restore-schema.mjs`.
`make build` builds the pinned upstream dashboard from its npm lockfile and adds
these extensions under `dist/admin-ui/_/`. SQLite WASM and all other generated
assets stay out of the patch stack and source control. A separate 1.1 KB
`runtime/wasm_exec.patch` supplies the per-instance Workers context bridge to the
active Go compiler's runtime file, replacing the checked-in copy of that file.

Native SQLite and DO SQLite retain upstream cascade deletion and transaction
reads. The D1 cascade planner and SQL parser are independently testable under
`adapter/d1/`; the filesystem injection preserves PocketBase 0.40's file hooks.

Validation: `make proof` builds the real Worker, checks the latest release,
replays these patches in a fresh checkout, compares the patched files with the
built sources, runs adapter/restore regressions, and exercises the local Worker
proofs. `pnpm run test:e2e:restore-ui` separately checks the dashboard extension
against the local URL and credentials supplied through its environment variables.
