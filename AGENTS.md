# Pocketflare -- PocketBase on Cloudflare Workers

## Build

```sh
make build        # GOOS=js GOARCH=wasm -tags no_default_driver
make deploy       # pnpm exec wrangler deploy
make dev          # pnpm exec wrangler dev
make clean        # rm -rf dist/
make update-pb    # ./scripts/update-pb.sh [version]
```

Required Go version: `go 1.26.1` (per go.mod).

All Go source files in `adapter/` and `cmd/pocketflare/` carry `//go:build js && wasm`. There is no native build path -- every file is WASM-only.

The build also passes `-tags no_default_driver`. This selects `core/db_connect_nodefaultdriver.go` in the forked PocketBase (instead of `core/db_connect.go`), suppressing the default SQLite driver registration that would pull in CGo. D1 connections use the custom `d1pocketflare` driver registered in `adapter/wasmdb/driver.go`.

Output: `dist/app.wasm` (~39MB uncompressed, ~8.6MB gzipped) + `dist/worker.mjs` + `dist/runtime.mjs` + `dist/wasm_exec.js`.

## Architecture

```
Workers fetch()/scheduled()
  \-- worker.mjs (JS entry point)
       \-- runtime.mjs (WASM loader, cached)
            \-- app.wasm (compiled Go binary)
                 \-- cmd/pocketflare/main.go
                      \-- adapter.New(config)
                           \-- pocketbase.NewWithConfig(pb.Config)
                                \-- DB:  wasmdb.Connect() -> D1 (APP_DB / LOGS_DB)
                                \-- FS:  core.NewWasmFilesystem  -> r2blob.New("STORAGE")
                                \-- FS:  core.NewWasmBackupsFilesystem -> r2blob.New("BACKUPS")
                           \-- pb.Bootstrap() (no-op data dir, no fsnotify)
                           \-- pb.RunAllMigrations()
                           \-- ensureSuperuser() (if AdminEmail/AdminPassword set)
                           \-- apis.NewRouter(pb) + CORS + admin static route
                      \-- router.BuildMux()
                      \-- workers.Serve(handler)
```

### Request flow (per-request)

1. Workers runtime calls `fetch(req, env, ctx)` in `worker.mjs`.
2. Each invocation runs `run()`, which creates a fresh `Go` instance, instantiates the WASM module with `workers.ready` callback, and calls `go.run()`.
3. The Go WASM initializes PocketBase (Bootstrap + migrations run every cold start).
4. `binding.handleRequest(req)` dispatches to the HTTP handler built from PocketBase's router.
5. DB queries go through `wasmdb` -> D1 binding via `syumai/workers/cloudflare/d1`.
6. File operations go through `r2blob` -> R2 binding via `syumai/workers/cloudflare`.

WASM module is cached (`runtime.mjs`) but `go.run()` creates a new runtime per request. On Workers, the WASM instance may be reused across warm requests inside the same isolate, but PocketBase's Bootstrap + migrations run on every cold start.

## Key design decisions

### No-op Tx (why not real D1 transactions)
D1 does not support multi-statement SQL transactions spanning separate `database/sql` calls. `BEGIN`/`COMMIT`/`ROLLBACK` are not available. D1's `batch()` requires all statements upfront -- incompatible with PocketBase's interleaved read/write/hook pattern. D1's `withSession()` provides sequential consistency but no transactional boundaries. The driver in `adapter/wasmdb/driver.go` wraps every `Begin()`/`BeginTx()` call with a `noopTx` whose `Commit()` and `Rollback()` are both no-ops. Every individual statement is atomic; multi-statement groups are not. This is a D1 platform constraint, not fixable in code. The `driver.go` file contains the full technical analysis.

### No native build path
A dual `!js` build path was deleted because it silently diverged from WASM behavior (never created superuser, ignored AdminEmail/AdminPassword). All adapter code is `js && wasm` only. Do not re-add a native path without a concrete reason.

### R2 via blob.Driver
PocketBase's filesystem abstraction (`tools/filesystem.System`) accepts a `blob.Driver` interface via `filesystem.NewBlob(drv)`. The `r2blob` package implements `blob.Driver` backed by Cloudflare R2 JavaScript bindings (via `syscall/js`). The adapter sets `core.NewWasmFilesystem` and `core.NewWasmBackupsFilesystem` (package-level func vars in patched PB) before Bootstrap so PB's `NewFilesystem()` and `NewBackupsFilesystem()` return R2-backed instances.

### Injected filesystem funcs instead of direct import
Directly importing `adapter/r2blob` from PocketBase core would create a circular dependency (PocketBase is the forked dependency). Instead, patch 002 adds package-level function variables (`NewWasmFilesystem`, `NewWasmBackupsFilesystem`) that the adapter sets at init time. This is the same pattern PocketBase itself uses for pluggable components.

### D1 database routing
`wasmdb.Connect()` returns a `DBConnectFunc` that maps `dbPath` to D1 bindings: paths containing "auxiliary" (the logs DB) use the `LOGS_DB` binding; everything else (the main `data.db`) uses `APP_DB`. A custom SQL driver name `d1pocketflare` is registered in `init()`, mapping to a `dbx.SqliteBuilder` via `dbx.BuilderFuncMap`.

## Patch inventory

Applied to PocketBase v0.36.9 in `internal/pocketbase/`. Managed by `scripts/update-pb.sh`.

| # | Files | Change | Why |
|---|-------|--------|-----|
| 001 | `core/base.go`, `core/base_unix.go` (new), `core/base_wasm.go` (new) | Extract `os.MkdirAll`/`os.RemoveAll` into `prepareDataDir()`, extract fsnotify into `registerNotifyWatcherHooks()`. WASM: no-ops. Unix: original behavior. Also removes `NewFilesystem()`/`NewBackupsFilesystem()` from `base.go` (moved to patch 002). | WASM has no `os.MkdirAll`/`os.RemoveAll` that work in Workers; no fsnotify. |
| 002 | `core/base_filesystem.go` (new), `core/base_filesystem_wasm.go` (new) | Move `NewFilesystem()`/`NewBackupsFilesystem()` to build-tagged files. Unix: original local/S3 logic. WASM: delegates to injectable `NewWasmFilesystem`/`NewWasmBackupsFilesystem` func vars. | R2-backed filesystem must be injected by adapter without circular import. |
| 003 | `tools/router/rereadable_read_closer.go` | Nil-guard `ReadCloser.Close()` calls in `Reread()` and `Close()` methods. | Workers fetch handler can pass nil body for GET requests; syumai/workers returns nil from `ToBody()` for null ReadableStream, causing nil pointer deref. |
| 004 | `tools/filesystem/filesystem.go` | Add `NewBlob(drv blob.Driver)` constructor returning `*System`. Restore `webp` decoder import. Strip verbose comments from `CreateThumb`. | Enables arbitrary blob.Driver injection (specifically R2). Webp import needed for image processing. |

## Adapter package map

### `adapter` (adapter/app.go, adapter/config.go)
Key types:
- `Config` -- `AdminEmail string`, `AdminPassword string`, `DataDir string`, `AppMigrations core.MigrationsList`
- `New(config)` -> `(*pocketbase.PocketBase, *router.Router[*core.RequestEvent], error)` -- bootstraps PB, sets R2 filesystem drivers, runs migrations, creates superuser, builds CORS+admin router.

Invariants:
- Every Config field is consumed by `New()`.
- `DataDir` defaults to `"/tmp/pb_data"` in `main.go` (ephemeral on Workers).
- `AdminEmail`/`AdminPassword` are optional; if both empty, no superuser is created.
- `AppMigrations` is copied via `core.AppMigrations.Copy()` before `RunAllMigrations()`.
- On bootstrap failure, `OnTerminate()` is triggered and `ResetBootstrapState()` is called.

### `adapter/wasmdb` (db.go, driver.go)
- `Connect() core.DBConnectFunc` -- routes db paths to D1 bindings (`APP_DB`/`LOGS_DB`).
- `txWrapperDriver` -- registers `d1pocketflare` SQL driver via `sql.Register`.
- `txWrapperConn` -- wraps `d1.Conn`, provides no-op `Begin()`/`BeginTx()`.
- `noopTx` -- `Commit()` and `Rollback()` are both no-ops.
- Custom `dbx.BuilderFuncMap["d1pocketflare"] = dbx.NewSqliteBuilder` enables PocketBase's dbx layer to use sqlite-compatible query building on D1.

### `adapter/r2blob` (r2blob.go)
- `Driver` -- implements `blob.Driver` via R2 JS bindings (`cloudflare.GetBinding`).
- `New(bucketName string)` -- creates driver for a named R2 binding (STORAGE or BACKUPS).
- Operations: `Attributes`, `ListPaged`, `NewRangeReader`, `NewTypedWriter`, `Copy` (client-side Get+Put -- R2 has no server-side copy in Workers binding), `Delete`, `Close`.
- `Copy` reads the entire source object into memory before writing. Large files may exceed Workers memory limits.
- `NewTypedWriter` buffers the full object in memory before uploading. Same caveat.
- Internal `readableStreamToReadCloser` wrapper converts JS `ReadableStream` to Go `io.ReadCloser`.
- Internal `r2Writer`/`r2Reader` implement `blob.DriverWriter`/`blob.DriverReader`.

### `adapter/internal/jsutil` (promise.go)
- `AwaitPromise(ctx, promise)` -- blocks on a JavaScript Promise, returns result or error. Handles ctx cancellation. Both `then`/`catch` JS funcs are always released on return.

### `cmd/pocketflare` (main.go)
- `main()` -- calls `adapter.New`, builds router mux, calls `workers.Serve`.
- Uses hardcoded credentials (`admin@test.com` / `test123456`). This is the dev/test entry point.

## Configuration

### `adapter.Config` fields

| Field | Type | Required | Default in cmd/main.go | Notes |
|-------|------|----------|----------------------|-------|
| `AdminEmail` | `string` | No | `"admin@test.com"` | If empty and AdminPassword empty, no superuser created. |
| `AdminPassword` | `string` | No | `"test123456"` | Must be >= 8 chars if set. |
| `DataDir` | `string` | No | `"/tmp/pb_data"` | Ephemeral on Workers. Only used for in-memory path references. |
| `AppMigrations` | `core.MigrationsList` | No | nil | Copied into `core.AppMigrations` before running all migrations. |

### `pocketbase.Config` (upstream, passed by adapter)

Fields consumed by `adapter.New()`:
- `DefaultDev: false`
- `DefaultDataDir: config.DataDir`
- `DBConnect: wasmdb.Connect()`

Unused fields (left at zero/nil): `DefaultEncryptionEnv`, `DefaultQueryTimeout`, `HideStartBanner`, `DataMaxOpenConns`, `DataMaxIdleConns`, `AuxMaxOpenConns`, `AuxMaxIdleConns`.

Note: `pocketbase.Config` has **no** `AppName` or `AppURL` fields. Those are PocketBase persisted settings stored in D1 `_params` table (defaults "Acme"/"http://localhost:8090"), not bootstrap config.

## Build constraints

| Tag | Files |
|-----|-------|
| `//go:build js && wasm` | All `adapter/*.go`, `cmd/pocketflare/main.go`, `internal/pocketbase/core/base_wasm.go`, `internal/pocketbase/core/base_filesystem_wasm.go`, `internal/pocketbase/core/syscall_wasm.go` |
| `//go:build !js` | `internal/pocketbase/core/base_unix.go`, `internal/pocketbase/core/base_filesystem.go`, `internal/pocketbase/core/syscall.go` |
| `//go:build no_default_driver` | `internal/pocketbase/core/db_connect_nodefaultdriver.go` |
| `//go:build !no_default_driver` | `internal/pocketbase/core/db_connect.go` |

The `no_default_driver` tag prevents CGo SQLite driver from being compiled in. The `js && wasm` constraint on all adapter files prevents accidental native compilation.

## Known limitations

- **No multi-statement transactions**: D1 does not support BEGIN/COMMIT across separate calls. `RunInTransaction` callbacks execute but every write takes effect immediately. Rollback is a no-op. Affects: migration steps, collection imports, batch API, DrySubmit (deprecated).
- **No realtime/SSE**: Requires Durable Objects broker (deferred to Phase 4).
- **No in-process cron**: Workers Cron Triggers are wired in `worker.mjs` (`scheduled()` export) but not yet integrated with PocketBase's cron system.
- **Cold starts**: WASM module (~39MB) must be instantiated on first request. Subsequent requests may reuse a warm isolate, but PocketBase Bootstrap + migrations run every cold start.
- **Admin UI**: Served at `/_/{path...}` with gzip + caching, but untested in production.
- **Sending email**: Depends on Workers TCP Sockets (not yet available in all regions).
- **Memory**: R2 Copy and Writer buffer full objects in Go memory. Large files may exceed Workers 128MB memory limit.
- **No server-side R2 copy**: Copy uses Get+Put, doubling bandwidth and memory.

## Test instructions

- **E2E test app**: `testapp/main.go` demonstrates custom migrations (creates `tasks` collection with `title` and `done` fields) and a custom hook (auto-capitalizes `title` on create).
- Run locally: `cd testapp && go mod tidy && make build` (or similar build), then `pnpm exec wrangler dev`.
- The testapp has its own `go.mod` that references the pocketflare module.

## File inventory

| Path | Purpose |
|------|---------|
| `go.mod` | Module definition; replaces pocketbase with `./internal/pocketbase` vendored fork. |
| `Makefile` | `build` (WASM compile + JS cp), `deploy`, `dev`, `clean`, `update-pb`. |
| `wrangler.toml` | Workers config: D1 bindings (APP_DB, LOGS_DB), R2 bindings (STORAGE, BACKUPS), compatibility_date, entry point. |
| `package.json` | pnpm wrapper with `build`/`deploy`/`dev` scripts; devDependency on wrangler. |
| `worker.mjs` | JS entry point for Workers: `fetch()` and `scheduled()` handlers. Boots WASM module per invocation. |
| `runtime.mjs` | Cached WASM module loader (`import("./app.wasm")`) and `createRuntimeContext`. |
| `wasm_exec.js` | Go WASM execution runtime (from Go toolchain via syumai/workers). |
| `.gitignore` | Ignores `dist/`, `node_modules/`, `.env`, `internal/pocketbase/`, build artifacts. |
| `patches/001-bootstrap-wasm.patch` | Extract OS ops, remove filesystem constructors from base.go. |
| `patches/002-filesystem-wasm.patch` | Build-tagged filesystem constructors + injectable WASM func vars. |
| `patches/003-nil-body-fix.patch` | Nil ReadCloser guard in RereadableReadCloser. |
| `patches/004-filesystem-newblob.patch` | NewBlob constructor. |
| `scripts/update-pb.sh` | Fetches PocketBase tag, clones to `internal/pocketbase`, applies patches. |
| `scripts/migrate-data.sh` | Exports SQLite `data.db` to D1-compatible SQL. Options: `--schema-only`, `--data-only`, `--include-logs`. Excludes `_migrations` (and `_logs` by default). |
| `scripts/migrate-files.sh` | Generates `wrangler r2 object put` commands for `pb_data/storage/`. Options: `--execute` (run uploads), `--all` (include files >5MB). Dry-run by default. |
| `testapp/main.go` | Example app: custom `tasks` collection migration, auto-capitalize hook. |
| `testapp/go.mod` | Separate module depending on pocketflare. |
| `adapter/app.go` | Bootstrap + superuser creation (WASM-only build constraint). |
| `adapter/config.go` | 4-field Config struct. |
| `adapter/wasmdb/db.go` | D1 DBConnect with binding routing. |
| `adapter/wasmdb/driver.go` | No-op Tx D1 driver (full platform constraint analysis in comments). |
| `adapter/r2blob/r2blob.go` | R2 blob.Driver implementation. |
| `adapter/internal/jsutil/promise.go` | JS Promise awaiter utility. |
| `cmd/pocketflare/main.go` | WASM entry point (workers.Serve). |
| `internal/pocketbase/` | Vendored PocketBase v0.36.9 with 4 patches applied. Managed by `scripts/update-pb.sh`. Not checked in (gitignored). |
| `dist/` | Build output (gitignored). |
| `OVERVIEW.md` | Project-level docs (may contain stale info; defer to CLAUDE.md for authoritative reference). |
