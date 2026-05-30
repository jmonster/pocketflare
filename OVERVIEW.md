# Pocketflare — PocketBase on Cloudflare Workers

## Quick start (new app)

```bash
git clone https://github.com/pocketflare/pocketflare
cd pocketflare
./scripts/update-pb.sh v0.36.9
pnpm install
make build
# Create Cloudflare resources (see below), then:
make deploy
```

## Quick start (existing PocketBase app)

```bash
# Inside your PocketBase project:
/pocketflare-migrate
```

This skill analyzes your project and applies the transformations described below.

## Architecture

```
PocketBase Core (4 patches, build-tag-gated)
  ├── DB layer ──→ adapter/wasmdb ──→ D1 (no-op Tx wrapper)
  ├── Filesystem ──→ adapter/r2blob ──→ R2 (blob.Driver)
  ├── HTTP router ──→ syumai/workers Serve() ──→ fetch handler
  └── Hooks/auth ──→ unmodified pure Go
```

## Project structure

```
pocketflare/
├── go.mod, go.sum, Makefile, wrangler.toml, package.json
├── OVERVIEW.md
│
├── adapter/
│   ├── app_wasm.go / app_native.go  # Bootstrap + superuser creation
│   ├── wasmdb/db.go                 # D1 DBConnect
│   ├── wasmdb/driver.go             # No-op Tx wrapper
│   └── r2blob/r2blob.go             # R2 blob.Driver
│
├── cmd/pocketflare/
│   ├── main_wasm.go                 # workers.Serve() entry point
│   └── main_native.go               # http.ListenAndServe() for dev
│
├── patches/
│   ├── 001-bootstrap-wasm.patch     # OS ops extraction
│   ├── 002-filesystem-wasm.patch    # R2 filesystem injection
│   ├── 003-nil-body-fix.patch       # Nil body guard for Workers
│   └── 004-filesystem-newblob.patch # NewBlob constructor
│
├── scripts/
│   ├── update-pb.sh                 # Fetch PocketBase + apply patches
│   ├── migrate-data.sh              # SQLite → D1 data export
│   └── migrate-files.sh             # pb_data/storage → R2 uploads
│
├── testapp/                         # Example migrated app
│   ├── main.go                      # Custom migration + hook
│   └── go.mod
│
├── worker.mjs, runtime.mjs          # JS glue for Workers
│   wasm_exec.js                     # syumai/workers modified runtime
│
└── dist/                            # Build artifacts (gitignored)
```

## Migrating an existing PocketBase app

### main.go transformation

**Before:**
```go
app := pocketbase.New()
app.OnRecordCreate("posts").BindFunc(myHook)
app.Start()
```

**After:**
```go
pb, router, _ := adapter.New(adapter.Config{
    AppName:       "myapp",
    AppURL:        "https://myapp.workers.dev",
    DataDir:       "/tmp/pb_data",
    AdminEmail:    "admin@example.com",
    AdminPassword: "changeme123",
    AppMigrations: appMigrations(),
})
pb.OnRecordCreate("posts").BindFunc(myHook) // identical API
handler, _ := router.BuildMux()
workers.Serve(handler) // replaces app.Start()
```

### Go migrations

Embed `pb_migrations/*.go` and pass to `AppMigrations`:

```go
func appMigrations() core.MigrationsList {
    //go:embed pb_migrations
    var migrationsFS embed.FS
    migrations, _ := core.NewMigrationsList(migrationsFS)
    return migrations
}
```

### Data migration

```bash
./scripts/migrate-data.sh ./pb_data/data.db > migration.sql
wrangler d1 execute APP_DB --remote --file=migration.sql
```

### File migration

```bash
./scripts/migrate-files.sh ./pb_data/storage/ --execute
```

### Cloudflare resources

```bash
wrangler d1 create myapp-db
wrangler d1 create myapp-logs
wrangler r2 bucket create myapp-storage
wrangler r2 bucket create myapp-backups
# Fill returned IDs into wrangler.toml
```

## Limitations

| Feature | Status | Notes |
|---|---|---|
| CRUD (collections, records) | Works | Full REST API |
| Auth (superusers, users, JWT) | Works | Registration, login, refresh, scoping |
| File upload/download | Works | R2-backed, multipart upload |
| Image thumbnails | Works | `disintegration/imaging` compiled in |
| Go migrations | Works | No-op Tx wrapper; schema migrations safe |
| Custom hooks | Works | Identical API to PocketBase |
| Realtime/SSE | Deferred | Durable Objects broker (Phase 4) |
| In-process cron | Deferred | Workers Cron Triggers (Phase 4) |
| Admin UI | Partial | `/_{path...}` route served, untested |
| Sending email | Deferred | Workers TCP Sockets (Phase 4) |

## Build

```bash
make build
# Builds dist/app.wasm (8.6MB gzipped) + JS glue
```

## Patches (against PocketBase v0.36.9)

| # | File | Change |
|---|------|--------|
| 001 | `core/base.go` + new files | Extract OS ops to `prepareDataDir()`/`registerNotifyWatcherHooks()` |
| 002 | `core/base_filesystem_wasm.go` (new) | Inject R2 filesystem via function variables |
| 003 | `tools/router/rereadable_read_closer.go` | Nil guard on `ReadCloser` for GET requests |
| 004 | `tools/filesystem/filesystem.go` | `NewBlob()` constructor for arbitrary blob.Driver |
