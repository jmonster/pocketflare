# Pocketflare Overview

Pocketflare runs PocketBase on Cloudflare Workers by compiling PocketBase to Go WASM, adapting SQLite access to D1, and adapting file storage to R2.

The file-storage adapter covers PocketBase-managed file fields and PocketBase filesystem calls. It is not a general POSIX filesystem for custom Go code; direct `os.*`, fsnotify, subprocess, and raw socket assumptions still need Worker-compatible replacements.

## Runtime

```
Browser
  ├─ /_pf first-run admin setup
  │    └─ worker.mjs redirects empty databases to PocketBase's installer
  ├─ /_/* static admin files
  │    └─ Cloudflare Workers Assets binding: ASSETS -> admin-ui/_
  ├─ /api/realtime (GET)
  │    └─ worker.mjs routes to Durable Object (RealtimeDO)
  │         ├─ SSE stream (TransformStream)
  │         ├─ /__send (message delivery from Go)
  │         └─ /__subscribe (subscription metadata)
  └─ /api/* and other dynamic routes
       └─ worker.mjs
            └─ singleton Go WASM runtime per isolate
                 └─ cmd/pocketflare/main.go
                      └─ adapter.New()
                           ├─ PocketBase router
                           ├─ D1 APP_DB / LOGS_DB
                           ├─ R2 STORAGE / BACKUPS
                           └─ adapter/realtime.go (DO bridge)
```

`worker.mjs` keeps one Go runtime per isolate. Creating one Go WASM runtime per request can exceed the Worker memory limit.

Admin UI files are checked in under `admin-ui/_` and served by Workers Assets, not by PocketBase. `/_pf` is Pocketflare's first-run setup route; it boots the runtime only to redirect empty databases to the tokenized first-superuser installer. `/_` and nested admin static assets remain asset-first.

## Project Layout

| Path | Purpose |
|---|---|
| `cmd/pocketflare/main.go` | WASM entry point; reads optional env config and starts `syumai/workers`. |
| `adapter/app.go` | Creates PocketBase, wires D1/R2, applies new-install defaults, runs migrations, builds router. |
| `adapter/wasmdb/` | D1 `database/sql` driver wrapper and DB binding routing. |
| `adapter/r2blob/` | `blob.Driver` implementation backed by Cloudflare R2 bindings. |
| `admin-ui/_/` | PocketBase admin UI static assets served by Workers Assets. |
| `worker.mjs` | Worker fetch/scheduled handlers, singleton WASM runtime management, and realtime DO routing. |
| `realtime-do.mjs` | Durable Object class that holds SSE connections open and delivers messages from Go to clients. |
| `runtime.mjs` | WASM module loader and Workers runtime context bridge. |
| `adapter/realtime.go` | DO-based realtime bridge: `DOClient` wraps PocketBase's `DefaultClient` so subscription matching stays in Go while message delivery goes through the DO. |
| `patches/` | Patch set applied to upstream PocketBase by `scripts/update-pb.sh`. |
| `scripts/scaffold-project.sh` | Prompts and creates a new Pocketflare project. |
| `scripts/migrate-data.sh` | Exports PocketBase SQLite `data.db` to SQL for D1 import. |
| `scripts/migrate-files.sh` | Uploads `pb_data/storage` files to the R2 `STORAGE` bucket. |
| `scripts/backup-verify.mjs` | Non-destructive backup readiness check against a deployed Worker. |
| `docs/production-backups.md` | Production backup strategy, recovery paths, and support matrix. |
| `wrangler.toml` | Worker name, app URL var, D1/R2 bindings, Durable Object bindings, Workers Cron Triggers, and Assets binding. |

## Cloudflare Resources

Required bindings:
- `APP_DB`: D1 database for PocketBase application data.
- `LOGS_DB`: D1 database for PocketBase auxiliary/log data.
- `STORAGE`: R2 bucket for PocketBase file fields.
- `BACKUPS`: R2 bucket for upstream PocketBase backup zip artifacts, not complete Pocketflare data backups.
- `ASSETS`: Workers Assets binding for `admin-ui/`.
- `REALTIME_DO`: (optional) Durable Object for SSE connections. Uncomment in `wrangler.toml` to enable; adds ~$4/mo for a single always-warm DO instance.

A per-minute Workers Cron Trigger (`[triggers] crons = ["* * * * *"]`) drives PocketBase's cron scheduler.

`STORAGE` and `BACKUPS` are used directly by the patched WASM filesystem path. Users do not need to enable PocketBase's S3 file-storage feature for normal file fields.

Pocketflare does not build a new backup system. Use Cloudflare-native primitives for ongoing backups: D1 Time Travel/export, DO SQLite PITR, and R2 bucket backup/copy. PocketBase backup zips can be restored/imported into an empty Pocketflare target from the admin UI or CLI as a migration path from standalone PocketBase.

`ASSETS` is not an R2 bucket. It is a Workers Assets binding. Matching static assets can be served by Cloudflare without invoking Worker code.

Worker limits that drive the design:
- memory is 128 MB per isolate, including WASM allocations;
- Worker size is 3 MB gzip on Free and 10 MB gzip on Paid;
- startup time is 1 second for global-scope parse and execution;
- request body size is 100 MB on Free/Pro, 200 MB on Business, and 500 MB by default on Enterprise;
- each Static Asset file can be up to 25 MiB.

## New Projects

Use:

```sh
./scripts/scaffold-project.sh
```

The script prompts for:
- target directory
- Go module path
- Cloudflare Worker name
- workers.dev account subdomain or explicit app URL
- D1 database names and IDs
- R2 bucket names
- whether to run Wrangler create commands

The generated `wrangler.toml` sets `POCKETFLARE_APP_URL` to the chosen Worker URL. Fresh databases use that as the PocketBase app URL and trust `CF-Connecting-IP`.

Admin setup uses Pocketflare's `/_pf` route. When no real superuser exists, it redirects to PocketBase's `/_/#/pbinstal/<token>` first-access installer. After setup, use `/_/` for the admin UI. For headless bootstrap, set `POCKETFLARE_ADMIN_EMAIL` and `POCKETFLARE_ADMIN_PASSWORD`, then remove them after the first successful boot.

## Email

Pocketflare replaces PocketBase's Go `net/smtp` transport in the Workers build. Provider selection priority is:

1. `POCKETFLARE_MAIL_PROVIDER`: `resend`, `postmark`, `sendgrid`, `mailgun`, `smtp`, or `webhook`.
2. `POCKETFLARE_MAIL_WEBHOOK_URL`: legacy generic webhook mode.
3. PocketBase admin SMTP settings, delivered through the Workers sockets SMTP transport.

SMTP over Workers sockets has live proof only with Amazon SES STARTTLS on port 587. Other providers can still vary by port, TLS mode, and auth behavior. Workers block outbound port 25.

The shared payload format includes `from`, `to`, `cc`, `bcc`, `subject`, `html`, `text`, headers, and base64 attachments up to 10 MiB each. See `docs/email-implementation.md`.

## File Storage Behavior

Pocketflare's WASM build ignores PocketBase's upstream local/S3 filesystem selection for normal file fields. The adapter injects an R2-backed filesystem directly. This covers PocketBase-managed file fields and PocketBase filesystem calls, not arbitrary local `os.*` filesystem use in custom Go code.

The standard PocketBase file API still proxies uploads and downloads through PocketBase. Upstream S3 mode does not make normal file-field uploads direct-to-S3. Direct browser-to-R2 uploads, signed R2 download redirects, or a public R2 custom domain would require explicit Pocketflare routes that preserve PocketBase access rules.

Uploads use a chunked R2 multipart writer: PocketBase receives the file through the API, the adapter buffers up to one part in Go, uploads that part, and releases it. This is bounded-memory pseudo-streaming, not direct browser-to-R2 upload.

Copies are separate from uploads. They happen only when PocketBase's filesystem `Copy(src, dst)` method duplicates an existing object. Copy uses a Worker relay with `FixedLengthStream` and is runtime-proven up to 20 MiB. Server-side R2 S3 `CopyObject` was tested with scoped credentials, but deployed Workers rejected `r2.cloudflarestorage.com` fetch URLs before HTTP, so that optimization is disabled.

## Migrating Existing PocketBase Projects

1. Scaffold a Pocketflare project.

2. Copy your Go hooks and app customization into `cmd/pocketflare/main.go` or local packages. Replace `app.Start()` with:

   ```go
   pb, router, err := adapter.New(adapter.Config{
       DataDir:       "/tmp/pb_data",
       AppURL:        trimmedEnv("POCKETFLARE_APP_URL"),
       AdminEmail:    trimmedEnv("POCKETFLARE_ADMIN_EMAIL"),
       AdminPassword: os.Getenv("POCKETFLARE_ADMIN_PASSWORD"),
       AppMigrations: customMigrations(),
   })
   if err != nil {
       log.Fatal(err)
   }

   // Register hooks before BuildMux().

   handler, err := router.BuildMux()
   if err != nil {
       log.Fatal(err)
   }
   workers.ServeNonBlock(handler)
   workers.Ready()
   select {}
   ```

3. Port migrations into a `core.MigrationsList` and pass it as `AppMigrations`. Keep migration registration at package/runtime level, not inside a function-scoped `//go:embed` declaration.

4. Export data:

   ```sh
   mkdir -p .artifacts
   ./scripts/migrate-data.sh /path/to/pb_data/data.db > .artifacts/pocketbase-to-d1.sql
   pnpm exec wrangler d1 execute APP_DB --remote --file .artifacts/pocketbase-to-d1.sql
   ```

   Logs are excluded unless `--include-logs` is passed.

5. Upload files:

   ```sh
   WRANGLER_R2_BUCKET=<storage-bucket> ./scripts/migrate-files.sh /path/to/pb_data/storage --execute
   ```

   Files are uploaded under the `storage/` prefix expected by `adapter/r2blob`.

   Existing S3-backed PocketBase apps should copy their existing `storage/` prefix into the Pocketflare R2 `STORAGE` bucket. See `docs/storage-migration.md`.

6. Build and deploy:

   ```sh
   ./scripts/update-pb.sh
   pnpm install
   make deploy
   ```

## Known Limits

- **D1 transactions:** Pocketflare maps fixed write transactions to `D1Database.batch()`, which executes statements sequentially as a SQL transaction and rolls back the entire sequence on failure. Reads after queued writes fail deterministically before any partial persistence. Reads before writes are direct (non-isolated). D1 migrations run statement-by-statement because older PocketBase migrations read their own writes. See `docs/D1-COMPATIBILITY.md` for the full feature matrix.
- **DO SQLite mode:** `POCKETFLARE_DB_MODE=do_sqlite` routes dynamic requests through `APP_DO`, a SQLite-backed Durable Object. This provides callback-scoped transactions with read-your-writes semantics. Tradeoff: the app database moves from D1 to a single Durable Object with different latency, cost, storage limit, and scaling characteristics.
- Uploads and downloads still pass through the Worker. Direct browser-to-R2 upload and signed R2 download redirects are possible app-level optimizations, not required for PocketBase API compatibility.
- R2 filesystem Copy uses the Worker relay fallback. It is runtime-proven up to 20 MiB and does not hold the whole copied object in Go memory. Server-side S3 `CopyObject` is disabled after failing deployed Worker E2E at R2 S3 endpoint fetch.
- Realtime/SSE without the optional Durable Object is non-functional on Workers (the WASM bridge `Flush()` is a no-op). Enabling the `RealtimeDO` binding in `wrangler.toml` adds cross-isolate SSE at ~$4/mo for the always-warm DO instance.
- PocketBase cron is driven by Workers Cron Triggers (per-minute `scheduled` events) rather than the in-process `time.Ticker`. Each trigger calls `pb.Cron().RunDue()`, so due-job selection remains PocketBase's scheduler.
- SMTP sockets have live Amazon SES STARTTLS proof only. Other providers can still vary by port, TLS mode, and auth behavior.
- PocketBase upstream backup creation, auto backups, and backup S3 settings are not the ongoing backup strategy. Use Cloudflare-native primitives (D1 Time Travel/export, R2 object copy) for production backups. PocketBase backup zips can be restored into empty Pocketflare targets for migration; restore is runtime-proven with the minimal fixture. See `docs/production-backups.md` for the full backup strategy, supported recovery paths, and limitations.

## References

- Production backup strategy: `docs/production-backups.md`
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers Assets binding: https://developers.cloudflare.com/workers/static-assets/binding/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Workers Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- R2 Wrangler commands: https://developers.cloudflare.com/r2/reference/wrangler-commands/
- R2 upload methods: https://developers.cloudflare.com/r2/objects/upload-objects/
