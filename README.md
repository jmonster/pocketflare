# Pocketflare

Pocketflare packages PocketBase for Cloudflare Workers. It runs PocketBase as Go WASM, uses D1 for PocketBase databases, uses R2 for file storage/backups, and serves the PocketBase admin UI through Workers Assets.

## New Project

```sh
./scripts/scaffold-project.sh
```

The scaffold prompts for the target directory, Go module path, Worker name, app URL, D1 databases, R2 buckets, and optional admin setup. If you approve it, the script runs Wrangler commands to create the D1 and R2 resources. It does not write admin passwords to tracked files.

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

PocketBase SMTP settings do not work as-is in Pocketflare because upstream PocketBase uses Go `net/smtp`, while Cloudflare outbound sockets are exposed to JavaScript through `cloudflare:sockets`.

Pocketflare supports an HTTPS mail webhook:

```sh
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_URL
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_TOKEN
```

When `POCKETFLARE_MAIL_WEBHOOK_URL` is set, Pocketflare posts PocketBase mail messages as JSON to that URL. The token is optional and is sent as `Authorization: Bearer <token>`. The webhook must deliver the message through your mail provider.

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

R2 writes use multipart uploads (bounded ~10 MB Go memory per upload). Copies use server-side S3 CopyObject when R2 API credentials are configured, or stream through the Worker with bounded memory when they are not. See the commented `R2_ACCOUNT_ID` and secrets in `wrangler.toml` to enable server-side copies.

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

## Current Limits

- D1 cannot provide SQLite-equivalent multi-statement rollback through `database/sql`; each statement commits independently.
- R2 writes stream via multipart upload; copies use server-side CopyObject (opt-in) or streaming fallback.
- Realtime/SSE and PocketBase cron are not implemented.
- PocketBase SMTP email does not work as-is in Pocketflare; use an HTTP mail provider hook until a Worker sockets mailer exists.
- Backup restore still needs a cleanup pass to remove the last dependency on PocketBase backup S3 settings.
