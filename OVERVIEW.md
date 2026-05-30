# Pocketflare Overview

Pocketflare runs PocketBase on Cloudflare Workers by compiling PocketBase to Go WASM, adapting SQLite access to D1, and adapting file storage to R2.

## Runtime

```
Browser
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

`worker.mjs` keeps one Go runtime per isolate. This is intentional: browser admin pages load many files in parallel, and creating one Go WASM runtime per request can exceed the Worker memory limit.

Admin UI files are checked in under `admin-ui/_` and served by Workers Assets, not by PocketBase. The explicit `env.ASSETS.fetch(req)` branch in `worker.mjs` keeps `/_` and `/_/*` off the Go runtime even when routing falls through to the Worker script.

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
| `wrangler.toml` | Worker name, app URL var, D1/R2 bindings, Durable Object bindings, Workers Cron Triggers, and Assets binding. |

## Cloudflare Resources

Required bindings:
- `APP_DB`: D1 database for PocketBase application data.
- `LOGS_DB`: D1 database for PocketBase auxiliary/log data.
- `STORAGE`: R2 bucket for PocketBase file fields.
- `BACKUPS`: R2 bucket for PocketBase backups.
- `ASSETS`: Workers Assets binding for `admin-ui/`.
- `REALTIME_DO`: Durable Object for SSE connections (class `RealtimeDO`).

A per-minute Workers Cron Trigger (`[triggers] crons = ["* * * * *"]`) drives PocketBase's cron scheduler.

`STORAGE` and `BACKUPS` are used directly by the patched WASM filesystem path. Users do not need to enable PocketBase's S3 file-storage feature for normal file fields. One backup-restore branch still consults PocketBase's backup S3 setting; backup restore needs follow-up before claiming full S3 independence.

`ASSETS` is not an R2 bucket. It is a Workers Assets binding. Matching static assets can be served by Cloudflare without invoking Worker code.

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

The generated `wrangler.toml` sets `POCKETFLARE_APP_URL` to the chosen Worker URL. On a fresh database, Pocketflare saves that as PocketBase's app URL. It also trusts `CF-Connecting-IP` by default. Existing settings rows are not overwritten.

Admin setup uses PocketBase's first-access installer at `/_/` by default. Headless bootstrap is available through `POCKETFLARE_ADMIN_EMAIL` and `POCKETFLARE_ADMIN_PASSWORD`, but it should be treated as an escape hatch and removed after the first successful boot.

## Email

Upstream PocketBase SMTP does not work as-is in Pocketflare. PocketBase uses Go `net/smtp`; Cloudflare Workers expose outbound TCP through the JavaScript `cloudflare:sockets` API. Ports 465 and 587 can be usable from Workers sockets, but the current Go WASM runtime does not bridge `net/smtp` to that API.

Supported now:
- `POCKETFLARE_MAIL_WEBHOOK_URL`: HTTPS endpoint that receives PocketBase mail JSON.
- `POCKETFLARE_MAIL_WEBHOOK_TOKEN`: optional bearer token sent to the webhook.

The webhook payload includes `from`, `to`, `cc`, `bcc`, `subject`, `html`, `text`, headers, and base64 attachments up to 10 MiB each. See `docs/email-implementation.md` for the SMTP sockets handoff.

## File Storage Behavior

Pocketflare's WASM build ignores PocketBase's upstream local/S3 filesystem selection for normal file fields. The adapter injects an R2-backed filesystem directly, so users should not enable PocketBase S3 just to make file storage work.

The standard PocketBase file API still proxies uploads and downloads through PocketBase. Upstream S3 mode does not make normal file-field uploads direct-to-S3. Direct browser-to-R2 uploads, signed R2 download redirects, or a public R2 custom domain would require explicit Pocketflare routes that preserve PocketBase access rules.

Writes use R2 multipart uploads (bounded ~10 MB Go memory per upload). Copies use server-side S3 CopyObject when R2 API credentials are configured (see `wrangler.toml`), with a FixedLengthStream fallback that also avoids Go-side buffering.

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

   The export keeps `_params/settings`, so migrated app URL, mail, auth, and trusted-proxy settings are preserved. `_migrations` is excluded; `_logs` is excluded unless `--include-logs` is passed.

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

- D1 has no multi-statement transaction boundary for separate `database/sql` calls. Rollback is a no-op; partial writes can remain after multi-step failures.
- R2 writes use multipart upload (bounded ~10 MB Go memory). Copies use server-side S3 CopyObject (opt-in; see `wrangler.toml`) or a streaming fallback.
- Realtime/SSE is implemented via a Durable Object (`RealtimeDO`) that holds SSE connections open. PocketBase handles auth and subscription matching in Go; the DO handles transport. `GET /api/realtime` is intercepted by `worker.mjs` and routed to the DO; `POST /api/realtime` (subscriptions) still goes through Go.
- PocketBase cron is driven by Workers Cron Triggers (per-minute `scheduled` events) rather than the in-process `time.Ticker`. Each trigger calls `pb.Cron().RunDue()` to execute due jobs.
- PocketBase SMTP email does not work as-is; the current code uses Go `net/smtp` and has no Worker sockets bridge. Use an HTTP mail provider hook until a Workers-compatible mailer exists.
- Backup restore is not fully decoupled from PocketBase backup S3 settings.

## References

- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workers Assets binding: https://developers.cloudflare.com/workers/static-assets/binding/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Workers Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- R2 Wrangler commands: https://developers.cloudflare.com/r2/reference/wrangler-commands/
