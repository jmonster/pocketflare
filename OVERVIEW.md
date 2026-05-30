# Pocketflare — PocketBase on Cloudflare Workers

## Architecture

PocketBase Core (minimally patched, ~40 lines)
  ├── DB layer ──→ adapter/wasmdb ──→ D1 (syumai/workers D1 driver)
  ├── Filesystem ──→ adapter/r2blob ──→ R2 (syumai/workers R2 client)
  ├── HTTP router ──→ syumai/workers Serve() ──→ fetch handler
  └── Hooks/auth ──→ unmodified pure Go (all synchronous)

## Why this works (researched against PocketBase v0.36.9)

### DB layer: zero PocketBase source changes

PocketBase ships the mechanism we need:
- `core/db_connect.go` — `//go:build !no_default_driver` — imports `modernc.org/sqlite`
- `core/db_connect_nodefaultdriver.go` — `//go:build no_default_driver` — panic stub
- `core/base.go:209` — `if app.config.DBConnect == nil { app.config.DBConnect = DefaultDBConnect }`

Build with `-tags no_default_driver`. Set `config.DBConnect` to our D1-backed function.
The sqlite driver is never imported. `DefaultDBConnect` is never called.

Our `DBConnect` maps PocketBase file paths to D1 binding names:
- `data.db` → `APP_DB`
- `auxiliary.db` → `LOGS_DB`

The D1 driver (`syumai/workers/cloudflare/d1`) is a complete `database/sql/driver`
implementation. dbx integration requires one line: `BuilderFuncMap["d1"] = NewSqliteBuilder`.

### Transactions: immediate execution, no-op Begin/Commit/Rollback

The D1 driver does not implement `driver.Tx`. D1 auto-commits every statement.
D1's `batch()` API provides atomic multi-statement execution but cannot implement
the interactive `database/sql/driver.Tx` interface (which requires per-statement
results before commit).

This is acceptable because:

1. **Single-record CRUD does not use transactions.** PocketBase's `Save()`,
   `Delete()`, `Create()` execute a single SQL statement. No `RunInTransaction`.

2. **Multi-statement operations that use transactions are idempotent:**
   - `cascadeRecordDelete` — SELECT records in batches, DELETE each batch
   - `auth_origin_model.go` hooks — FindAllRecords + loop Delete
   - Both are retry-safe: if the handler crashes mid-sequence, retry finds
     remaining records and continues

3. **Schema operations move to wrangler:**
   - `collection_record_table_sync.go` — move to `wrangler d1 execute`
   - `migrations_runner.go` — move to `wrangler d1 execute`
   - Schema changes are control-plane, not request-path

4. **Log batch writer** — replace with Workers Logs, no auxiliary DB needed

Our Tx implementation: `Begin()` returns a wrapper. `Exec()`/`Query()` execute
immediately. `Commit()`/`Rollback()` are no-ops. Each write auto-commits. D1
serializes all writes through a single SQLite primary — concurrent Workers
invocations cannot interleave.

### HTTP: direct

`workers.Serve()` accepts `http.Handler`. `apis.NewRouter(pb).BuildMux()` returns
`http.Handler`. No adapter needed.

### Hooks: all synchronous

Every PocketBase hook executes inline during request processing. The HTTP response
is written in the LAST handler of the hook chain. All hooks complete before
`ServeHTTP()` returns. WASM instance is destroyed after response body finishes
streaming — hooks are done by then. Confirmed by source audit: exactly 2 `go func()`
in the entire codebase (log writer ticker, batch API endpoint), neither hook-related.

### ATTACH DATABASE: not used

PocketBase does not use SQL `ATTACH DATABASE`. The auxiliary database is a
completely separate `*sql.DB` connection. Our `DBConnect` routes it to `LOGS_DB`.
Zero cross-DB queries exist.

### Filesystem: R2 adapter

Implement `blob.Driver` (19 methods). R2 is strongly consistent for read-after-write.
`Copy` falls back to Get+Put. Mechanical, no unknowns.

### Binary size

- `-tags no_default_driver` strips `modernc.org/sqlite` from the import graph
- JSVM plugin disabled (no `goja` import)
- `core/syscall_wasm.go` already exists in PocketBase (`//go:build js && wasm`)
- `-ldflags="-s -w"` strips DWARF and symbol table
- `wasm-opt -Oz` for further reduction

## What needs PocketBase source patches

~40 lines total, all build-tag-gated with `//go:build js && wasm`:

| Patch | File | Change |
|-------|------|--------|
| Bootstrap WASM | `core/base.go` | Extract `os.MkdirAll`/`os.RemoveAll` into `prepareDataDir()`, fsnotify into `registerNotifyWatcherHooks()` |
| Bootstrap WASM | `core/base_wasm.go` (new) | `prepareDataDir()` no-op, `registerNotifyWatcherHooks()` no-op |
| Filesystem WASM | `core/base_filesystem_wasm.go` (new) | `NewFilesystem()` returns R2-backed system, `NewBackupsFilesystem()` returns R2-backed system |

No changes needed for DB connection — handled entirely via `no_default_driver` build tag + `config.DBConnect` injection.

## Project structure

```
pocketflare/
├── go.mod
├── go.sum
├── Makefile
├── wrangler.toml
├── OVERVIEW.md
│
├── cmd/pocketflare/
│   └── main.go                  # Entry point (js/wasm build tag)
│
├── adapter/
│   ├── app.go                   # PocketBase bootstrap + router build
│   ├── r2blob/
│   │   └── r2blob.go            # blob.Driver impl backed by R2
│   └── wasmdb/
│       └── db.go                # D1-backed DBConnect function
│
├── internal/pocketbase/         # PocketBase source (script-managed)
│   └── ...                      # Full PocketBase tree + patches applied
│
├── patches/
│   ├── 001-bootstrap-wasm.patch
│   └── 002-filesystem-wasm.patch
│
├── scripts/
│   ├── update-pb.sh             # Fetch upstream + apply patches
│   └── build.sh                 # WASM compilation + workers-assets-gen
│
└── dist/                        # Build artifacts (gitignored)
    ├── app.wasm
    ├── worker.mjs
    ├── wasm_exec.js
    └── runtime.mjs
```

## wrangler.toml

```toml
name = "pocketflare"
main = "dist/worker.mjs"
compatibility_date = "2025-05-30"

[[d1_databases]]
binding = "APP_DB"
database_name = "pocketflare-app"

[[d1_databases]]
binding = "LOGS_DB"
database_name = "pocketflare-logs"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "pocketflare-storage"

[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "pocketflare-backups"

[wasm_modules]
app = "dist/app.wasm"
```

## Build

```bash
GOOS=js GOARCH=wasm go build -tags no_default_driver -trimpath -ldflags="-s -w" -o dist/app.wasm ./cmd/pocketflare
```

## Features deferred to later phases

- **Realtime/SSE** — Durable Objects broker (Phase 4)
- **Cron** — Workers Cron Triggers instead of PocketBase in-process cron (Phase 4)
- **Email** — Workers TCP Sockets or fetch-based mail API (Phase 4)
- **Admin UI** — Separate static host or omitted for size (Phase 5)
- **JSVM plugin** — Disabled (goja excluded from WASM build)
