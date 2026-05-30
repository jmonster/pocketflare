# Pocketflare Agent Notes

## Commands

```sh
./scripts/update-pb.sh       # materialize internal/pocketbase and apply patches
make build                   # compile Go WASM and copy JS runtime files into dist/
make deploy                  # build, then pnpm exec wrangler deploy
make dev                     # pnpm exec wrangler dev
./scripts/scaffold-project.sh
```

`internal/pocketbase/`, `dist/`, `.wrangler/`, `node_modules/`, `.artifacts/`, `pb_data/`, SQLite files, env files, and local dev vars are intentionally ignored. A fresh clone is not build-ready until `./scripts/update-pb.sh` has run.

## Runtime Shape

`worker.mjs` is the Worker entry point. It serves `/_` and `/_/*` through the Cloudflare Workers Assets binding before WASM boots. Dynamic API traffic uses a lazy singleton Go/PocketBase runtime per Worker isolate. This avoids concurrent browser asset fan-out creating multiple large Go WASM heaps in one isolate.

Go entrypoint: `cmd/pocketflare/main.go`

Adapter: `adapter.New(config)` wires:
- D1 `APP_DB` for PocketBase data.
- D1 `LOGS_DB` for PocketBase auxiliary/log data.
- R2 `STORAGE` for PocketBase file storage.
- R2 `BACKUPS` for PocketBase backups.
- Workers Assets `ASSETS` for the checked-in admin UI at `admin-ui/_`.

Do not route admin static assets through Go/WASM. Static admin requests should stay on Workers Assets.

## Configuration

Runtime env vars:
- `POCKETFLARE_APP_URL`: optional default app URL for new databases only.
- `POCKETFLARE_ADMIN_EMAIL`: optional headless initial superuser email.
- `POCKETFLARE_ADMIN_PASSWORD`: optional headless initial superuser password.
- `POCKETFLARE_MAIL_PROVIDER`: optional mail transport (resend|postmark|sendgrid|mailgun|smtp|webhook).
- `POCKETFLARE_MAIL_API_KEY`: optional API key for HTTP mail providers.
- `POCKETFLARE_MAIL_DOMAIN`: optional Mailgun sending domain.
- `POCKETFLARE_MAIL_WEBHOOK_URL`: optional HTTPS mail webhook (legacy).
- `POCKETFLARE_MAIL_WEBHOOK_TOKEN`: optional bearer token for the mail webhook.
- `R2_ACCESS_KEY_ID`: optional R2 API token access key for server-side CopyObject.
- `R2_SECRET_ACCESS_KEY`: optional R2 API token secret for server-side CopyObject.
- `R2_ACCOUNT_ID`: optional Cloudflare account ID for server-side CopyObject.

`adapter.New` applies `POCKETFLARE_APP_URL` and trusted proxy header defaults before `Bootstrap()`. PocketBase persists those only when no `_params/settings` row exists, so migrated and already-deployed projects keep their stored settings. New databases default `TrustedProxy.Headers` to `["CF-Connecting-IP"]`.

Normal new-project admin setup should use PocketBase's first-access installer at `/_/`. The `POCKETFLARE_ADMIN_*` env path exists only for headless bootstrap and should be removed after the first successful boot. Do not commit credentials. `wrangler.toml` may contain non-secret resource names/IDs.

## Cloudflare Bindings

`STORAGE` and `BACKUPS` are live R2 bindings. They are not dead and do not require enabling PocketBase S3 settings for normal file storage. The WASM PocketBase filesystem path is patched to call the injected R2 filesystem constructors instead of the upstream local/S3 path.

Known caveat: backup restore still has one upstream branch that checks `Settings().Backups.S3.Enabled`. Backup create/list/upload use R2; restore is not fully decoupled from S3 settings yet.

Standard PocketBase file uploads/downloads still go through the PocketBase API. Enabling upstream S3 settings is not a direct-upload feature. Direct R2 uploads or signed download redirects need explicit Pocketflare routes that preserve access rules.

`adapter/r2blob` upload writes use a chunked R2 multipart writer: buffer up to one part in Go, upload it, release it. This is bounded-memory pseudo-streaming, not direct browser-to-R2 upload. Filesystem Copy is separate: it only runs when PocketBase calls `Copy(src, dst)` to duplicate an existing object. With `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ACCOUNT_ID`, Copy can use server-side S3 `CopyObject`; otherwise the intended Worker relay fallback must be runtime-proven before claiming large-copy safety.

Migration docs for local and existing S3-backed PocketBase storage live in `docs/storage-migration.md`. Pocketflare expects R2 object keys under `storage/<collectionId>/<recordId>/<filename>`.

`ASSETS` is the Workers Assets binding declared in `wrangler.toml`:

```toml
[assets]
directory = "./admin-ui"
binding = "ASSETS"
```

Cloudflare's default static-asset routing can serve matching files without Worker code. `worker.mjs` also explicitly calls `env.ASSETS.fetch(req)` for `/_` and `/_/*` as a no-rewrite fallback.

## PocketBase Patch Set

Managed by `scripts/update-pb.sh` against PocketBase v0.36.9:

| Patch | Purpose |
|---|---|
| `001-bootstrap-wasm.patch` | Split OS data-dir and fsnotify behavior into build-tagged files; WASM no-ops unsupported filesystem setup. |
| `002-filesystem-wasm.patch` | Add injectable WASM filesystem constructors used by the adapter for R2. |
| `003-nil-body-fix.patch` | Guard nil request bodies from Workers GET requests. |
| `004-filesystem-newblob.patch` | Add `filesystem.NewBlob(blob.Driver)` for R2-backed storage. |

Keep durable source edits in this checkout. Do not edit generated `internal/pocketbase/` as the lasting fix; edit patches and rerun `scripts/update-pb.sh`.

## D1 Transaction Constraint

Cloudflare D1 does not provide multi-statement transactions across separate `database/sql` calls. `adapter/wasmdb/driver.go` wraps `Begin`/`BeginTx` with no-op transactions so PocketBase code can run, but each statement commits independently. Rollback cannot undo earlier statements in the callback.

Consequences:
- Normal single-statement CRUD is fine.
- Migrations are statement-by-statement.
- Batch/import/custom hooks that expect cross-statement rollback can leave partial writes.

## Validation

Use the narrowest proof that exercises the touched surface:
- Go/runtime changes: `make build`.
- Worker packaging/config: `pnpm exec wrangler deploy --dry-run --outdir .artifacts/deploy-dry-run`.
- Script syntax: `bash -n scripts/<name>.sh`.
- Admin asset regression: concurrent requests to `/_/...` should return from Workers Assets and not boot WASM.

Do not run broad suites unless requested. Do not rerun failures without diagnosing the mechanism.

## Email

PocketBase's built-in SMTP client uses Go `net/smtp`, which is non-functional in Go WASM on Cloudflare Workers. Pocketflare replaces it with `adapter/mail`, which provides three transport modes:

1. **HTTP provider** (`POCKETFLARE_MAIL_PROVIDER`): resend, postmark, sendgrid, mailgun — talks directly to each provider's HTTP API.
2. **Generic webhook** (`POCKETFLARE_MAIL_WEBHOOK_URL`): legacy path — posts JSON payloads to any HTTPS endpoint.
3. **SMTP via Workers sockets**: when neither of the above is set, reads PocketBase admin SMTP settings at send time and delivers through `cloudflare:sockets` (JS module `smtp-transport.mjs`).

Provider selection priority is: `MAIL_PROVIDER` > `MAIL_WEBHOOK_URL` > PocketBase SMTP settings. HTTP providers and webhook are the production paths. SMTP sockets compile but need live-provider proof, especially STARTTLS on port 587. Port 25 is blocked.

Env vars: `POCKETFLARE_MAIL_PROVIDER`, `POCKETFLARE_MAIL_API_KEY`, `POCKETFLARE_MAIL_DOMAIN` (Mailgun only), plus legacy `POCKETFLARE_MAIL_WEBHOOK_URL` / `POCKETFLARE_MAIL_WEBHOOK_TOKEN`.
