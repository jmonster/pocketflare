# Pocketflare

Pocketflare packages PocketBase for Cloudflare Workers. It runs PocketBase as Go WASM, uses D1 for PocketBase databases, uses R2 for file storage/backups, and serves the PocketBase admin UI through Workers Assets.

## New Project

```sh
./scripts/scaffold-project.sh
```

The scaffold prompts for the target directory, Go module path, Worker name, app URL, D1 databases, R2 buckets, and whether to create Cloudflare resources through Wrangler. It does not write admin passwords to tracked files.

In the generated project:

```sh
./scripts/update-pb.sh
pnpm install
make deploy
```

`make deploy` builds first, then runs `pnpm exec wrangler deploy`.

## Admin Setup

For a fresh database, deploy and open `/_/`. PocketBase's first-access installer creates the first superuser.

Headless bootstrap is still supported by setting `POCKETFLARE_ADMIN_EMAIL` and `POCKETFLARE_ADMIN_PASSWORD` in the Worker environment, but it is not the normal path. Remove those values after the first successful boot.

New databases also default:
- app URL from `POCKETFLARE_APP_URL`
- trusted proxy header `CF-Connecting-IP`

Existing or migrated PocketBase settings are preserved.

## Email

Pocketflare replaces PocketBase's Go `net/smtp` transport in the Workers build. Mail delivery can use:

- HTTP provider APIs: `resend`, `postmark`, `sendgrid`, or `mailgun`
- a generic HTTPS webhook
- SMTP through Workers sockets, currently experimental and still needs live-provider proof

HTTP provider setup:

```sh
pnpm exec wrangler secret put POCKETFLARE_MAIL_API_KEY
```

Set non-secret provider defaults in `wrangler.toml`:

```toml
[vars]
POCKETFLARE_MAIL_PROVIDER = "resend"
```

Generic webhook setup:

```sh
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_URL
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_TOKEN
```

Provider selection priority is `POCKETFLARE_MAIL_PROVIDER`, then `POCKETFLARE_MAIL_WEBHOOK_URL`, then PocketBase admin SMTP settings. Use HTTP providers or the webhook for production until SMTP sockets are proven against your provider.

## Cloudflare Bindings

Required bindings in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "APP_DB"

[[d1_databases]]
binding = "LOGS_DB"

[[r2_buckets]]
binding = "STORAGE"

[[r2_buckets]]
binding = "BACKUPS"

[assets]
directory = "./admin-ui"
binding = "ASSETS"
```

`STORAGE` and `BACKUPS` are used by Pocketflare's R2 filesystem adapter. Do not enable PocketBase S3 just to make file fields work.

`ASSETS` is Cloudflare Workers Assets, not R2. It serves `admin-ui/_` so browser fan-out for admin static files does not boot the Go WASM runtime.

## File Storage

Do not enable PocketBase S3 for normal Pocketflare file fields. In the Workers build, Pocketflare injects an R2 filesystem adapter and ignores the upstream local/S3 filesystem path for file storage.

Standard PocketBase file uploads and downloads are still mediated by the PocketBase API. Direct browser-to-R2 uploads and signed R2 download redirects are possible future Pocketflare features, not effects of enabling PocketBase S3.

Terminology:

- Upload means a PocketBase client posts a file to the PocketBase API, then Pocketflare writes it to R2. The current writer is a chunked R2 multipart writer: it buffers up to one part in Go, uploads that part, and releases it. This is bounded-memory pseudo-streaming, not direct browser-to-R2 upload.
- Download means PocketBase serves `/api/files/...` through the Worker from R2. Signed R2 redirects and public-bucket delivery are not implemented.
- Copy means PocketBase's filesystem `Copy(src, dst)` method duplicated an existing object. Normal uploads, downloads, and migration imports do not use S3 `CopyObject`.

When optional R2 API credentials are configured, Copy can use server-side S3 `CopyObject` so object bytes do not pass through the Worker. Without those credentials, the intended fallback relays the source object body to a new R2 object through the Worker without holding the whole file in Go memory. Treat the fallback as needing runtime proof before relying on it for large objects.

## Migrate Existing PocketBase

1. Scaffold a Pocketflare project.

2. Move your hooks, routes, and migrations into the generated Go app. Register hooks before `router.BuildMux()`.

3. Export SQLite data:

```sh
mkdir -p .artifacts
./scripts/migrate-data.sh /path/to/pb_data/data.db > .artifacts/pocketbase-to-d1.sql
pnpm exec wrangler d1 execute APP_DB --remote --file .artifacts/pocketbase-to-d1.sql
```

4. Upload file storage:

```sh
WRANGLER_R2_BUCKET=<storage-bucket> ./scripts/migrate-files.sh /path/to/pb_data/storage --execute
```

For existing S3-backed PocketBase apps, copy the existing `storage/` prefix from the source bucket into the Pocketflare R2 `STORAGE` bucket. See `docs/storage-migration.md`.

5. Deploy:

```sh
make deploy
```

The data export includes `_params/settings`, so migrated app URL and trusted proxy settings are not replaced by Pocketflare defaults.

## Cloudflare Limits That Matter

Current Worker limits that shape Pocketflare:

- Memory is 128 MB per isolate, including JavaScript heap and WASM allocations. A single isolate can handle many concurrent requests, so admin static assets must stay on Workers Assets and not boot Go WASM.
- Worker size is 3 MB gzip on Free and 10 MB gzip on Paid, with a 64 MB uncompressed limit.
- Startup time is 1 second for global-scope parse and execution.
- Request body size is a Cloudflare account-plan limit, not a Workers-plan limit: 100 MB on Free/Pro, 200 MB on Business, and 500 MB by default on Enterprise. Standard PocketBase uploads still pass through the Worker, so this applies until direct R2 upload exists.
- Static Asset files can be up to 25 MiB each.

## Current Limits

- D1 cannot provide SQLite-equivalent multi-statement rollback through `database/sql`; each statement commits independently.
- Uploads and downloads still pass through the Worker; direct browser-to-R2 upload and signed R2 download redirects are not implemented.
- R2 filesystem Copy has two paths: server-side `CopyObject` with optional R2 API credentials, or the Worker relay fallback. The fallback and scaffolded bucket-name configuration need runtime proof before large-copy claims.
- Realtime/SSE requires the optional Durable Object binding. Without it, realtime is not supported on Workers.
- Cron requires the Workers Cron Trigger in `wrangler.toml`; it is not driven by PocketBase's in-process ticker.
- HTTP mail providers and webhook delivery are the production paths. SMTP sockets exist but need provider-level proof, especially STARTTLS on port 587.
- Backup restore still needs a cleanup pass to remove the last dependency on PocketBase backup S3 settings.

## References

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2 upload methods: https://developers.cloudflare.com/r2/objects/upload-objects/
