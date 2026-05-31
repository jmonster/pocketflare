# Pocketflare Agent Notes

## Commands

```sh
./scripts/update-pb.sh       # materialize internal/pocketbase and apply patches
node scripts/check-pb-version.mjs
make build                   # compile Go WASM and copy JS runtime files into dist/
make deploy                  # build, then pnpm exec wrangler deploy
make dev                     # pnpm exec wrangler dev
./scripts/scaffold-project.sh
```

## Wrangler `--remote` is ALWAYS required

Wrangler v4 `d1 execute` and `r2 object put` default to **local**. The Worker reads from **remote** D1/R2. Every command that touches production resources must include `--remote`. Local is a dev-only mirror with no connection to the deployed Worker.

```sh
# WRONG — data goes to local, Worker never sees it
pnpm exec wrangler d1 execute my-app --command="SELECT ..."
pnpm exec wrangler r2 object put "bucket/key" --file ./local-file

# RIGHT
pnpm exec wrangler d1 execute my-app --remote --command="SELECT ..."
pnpm exec wrangler r2 object put "bucket/key" --file ./local-file --remote
```

**`migrate-files.sh` does NOT add `--remote` automatically.** If you use it for a real migration, either pass `--remote` in the script or upload through the PocketBase API directly (which uses the Worker's R2 binding and always hits remote).

`internal/pocketbase/`, `dist/`, `.wrangler/`, `node_modules/`, `.artifacts/`, `pb_data/`, SQLite files, env files, and local dev vars are intentionally ignored. A fresh clone is not build-ready until `./scripts/update-pb.sh` has run.

## Runtime Shape

`worker.mjs` is the Worker entry point. `/_pf` is the first-run setup route; it boots the runtime only to redirect an empty database to PocketBase's tokenized first-superuser installer. `/_` and nested `/_/*` admin static assets stay on Cloudflare Workers Assets before WASM boots. Dynamic API traffic uses a lazy singleton Go/PocketBase runtime per Worker isolate. This avoids concurrent browser asset fan-out creating multiple large Go WASM heaps in one isolate.

Go entrypoint: `cmd/pocketflare/main.go`

Adapter: `adapter.New(config)` wires:
- D1 `APP_DB` for PocketBase data.
- D1 `LOGS_DB` for PocketBase auxiliary/log data.
- R2 `STORAGE` for PocketBase file storage.
- R2 `BACKUPS` for upstream PocketBase backup zip artifacts, not complete Pocketflare data backups.
- Workers Assets `ASSETS` for the checked-in admin UI at `admin-ui/_`.

Do not route admin static assets through Go/WASM. `/_pf` owns installer discovery; `/_` and nested static admin requests should stay on Workers Assets.

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

Normal new-project admin setup should use Pocketflare's `/_pf` route, which redirects to PocketBase's first-access installer when no superuser exists. The `POCKETFLARE_ADMIN_*` env path exists only for headless bootstrap and should be removed after the first successful boot. Do not commit credentials. `wrangler.toml` may contain non-secret resource names/IDs.

## Cloudflare Bindings

`STORAGE` and `BACKUPS` are live R2 bindings. The WASM PocketBase filesystem path is patched to call the injected R2 filesystem constructors instead of the upstream local/S3 path.

That adapter covers PocketBase-managed file fields and PocketBase filesystem calls. It is not a general writable POSIX filesystem for custom Go code. Direct `os.*`, fsnotify, subprocess, and raw socket assumptions need Worker-compatible replacements.

PocketBase backups are not complete Pocketflare backups. Upstream backup creation archives the local `pb_data` directory, but Pocketflare stores app data in D1 and file fields in R2. If backup creation or auto backups are enabled, the zip artifact is stored in `BACKUPS`, but it should not be treated as restorable production data. Use D1 Time Travel/export for database backup and copy/snapshot the `STORAGE` R2 bucket separately for uploaded files. Backup restore is unsupported on Workers.

Standard PocketBase file uploads/downloads still go through the PocketBase API. Enabling upstream S3 settings is not a direct-upload feature. Direct R2 uploads or signed download redirects need explicit Pocketflare routes that preserve access rules.

`adapter/r2blob` upload writes use a chunked R2 multipart writer: buffer up to one part in Go, upload it, release it. This is bounded-memory pseudo-streaming, not direct browser-to-R2 upload. Filesystem Copy is separate: it only runs when PocketBase calls `Copy(src, dst)` to duplicate an existing object. With `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ACCOUNT_ID`, Copy can use server-side S3 `CopyObject`; otherwise the intended Worker relay fallback must be runtime-proven before claiming large-copy safety.

Migration docs for local and existing S3-backed PocketBase storage live in `docs/storage-migration.md`. Pocketflare expects R2 object keys under `storage/<collectionId>/<recordId>/<filename>`.

`ASSETS` is the Workers Assets binding declared in `wrangler.toml`:

```toml
[assets]
directory = "./admin-ui"
binding = "ASSETS"
```

Cloudflare's default static-asset routing can serve matching files without Worker code. `worker.mjs` explicitly calls `env.ASSETS.fetch(req)` for admin paths as a no-rewrite fallback; installer discovery is isolated to `/_pf`.

## PocketBase Patch Set

Managed by `scripts/update-pb.sh` against PocketBase v0.39.0:

| Patch | Purpose |
|---|---|
| `001-bootstrap-wasm.patch` | Split OS data-dir and fsnotify behavior into build-tagged files; WASM no-ops unsupported filesystem setup. |
| `002-filesystem-wasm.patch` | Add injectable WASM filesystem constructors used by the adapter for R2. |
| `003-nil-body-fix.patch` | Guard nil request bodies from Workers GET requests. |
| `004-filesystem-newblob.patch` | Add `filesystem.NewBlob(blob.Driver)` for R2-backed storage. |
| `005-cron-rundue.patch` | Expose cron due-run behavior needed by the Worker scheduled handler. |
| `006-realtime-wasm.patch` | Allow the Worker WebSocket/Durable Object bridge to provide realtime clients. |
| `007-defaultclient-setid.patch` | Let the realtime bridge preserve PocketBase subscription client ids. |
| `008-pocketflare-admin-ui.patch` | Apply Pocketflare admin UI branding and replace upstream S3 settings with R2/D1 guidance. |

Keep durable source edits in this checkout. Do not edit generated `internal/pocketbase/` as the lasting fix; edit patches and rerun `scripts/update-pb.sh`.

## Updating PocketBase

Before bumping PocketBase, run `node scripts/check-pb-version.mjs` and update the default version in `scripts/update-pb.sh`.

Use a fresh upstream clone under `.artifacts/` to replay every patch against the new tag before touching the durable generated tree. A good proof lane is:

```sh
rm -rf .artifacts/pb-apply
git clone --depth 1 --branch vX.Y.Z https://github.com/pocketbase/pocketbase.git .artifacts/pb-apply
cd .artifacts/pb-apply
for patch in ../../patches/*.patch; do git apply "$patch"; done
```

Only after the patch stack applies cleanly should `internal/pocketbase/` be replaced or regenerated. Preserve the previous generated tree under `.artifacts/` if it helps compare behavior; do not edit it as durable source.

Patch notes from the v0.39.0 bump:
- Upstream added `core/notify_watcher.go`; the WASM patch must build-tag that file out and provide `notify_watcher_wasm.go`, not duplicate `registerNotifyWatcherHooks` in `base_wasm.go`.
- The admin UI is JS modules in `ui/src`, not the older Svelte layout. Patch `ui/src/...`, run `pnpm install` and `pnpm run build` from `internal/pocketbase/ui`, then sync `ui/dist/` into `admin-ui/_`.
- If `008-pocketflare-admin-ui.patch` adds binary assets such as `ui/public/images/logo.png`, regenerate it with `git diff --binary` and verify the patch applies from a fresh clone. Do not run blanket whitespace cleanup over binary patch hunks; it can corrupt the `GIT binary patch` terminator.
- Regenerate admin UI patches from `internal/pocketbase` with `git -C internal/pocketbase diff --binary -- <paths>`. Untracked new files need an explicit binary add hunk.
- Treat `git diff --check` failures inside `.patch` fixtures carefully. It is acceptable to run `git diff --check -- ':!patches/*.patch'` if the patch fixture itself must preserve upstream or binary-patch formatting.

After replaying patches and rebuilding generated assets, run the narrow proofs:
- `make build`
- `node scripts/check-pb-version.mjs`
- fresh patch replay from `.artifacts/`
- `pnpm exec wrangler deploy --dry-run --outdir .artifacts/deploy-dry-run`

## D1 Transaction Constraint

Cloudflare D1 supports atomic multi-statement transactions through `D1Database.batch()`, which executes prepared statements sequentially as a SQL transaction and rolls back the entire sequence on failure. `adapter/wasmdb/driver.go` maps `database/sql` transactions to D1 batch: writes are queued during the transaction callback and committed atomically at `Commit()`. Rollback drops the queue without any persistence.

Constraints:
- **Query-after-write fails.** After any queued write inside a transaction, subsequent `QueryContext` calls return a deterministic error. This prevents partial commits and makes unsupported interactive transaction shapes loud.
- **Reads before writes are not isolated.** A `QueryContext` before any queued write executes directly against D1 but is not transactionally isolated with the later batch.
- **Pending results are opaque.** `RowsAffected` and `LastInsertId` error until after commit; code that inspects these inside the transaction callback is incompatible with deferred batch commit.
- Some upstream PocketBase paths interleave reads and writes inside `RunInTransaction` and need targeted patches (see `docs/D1-COMPATIBILITY.md` for the full matrix).
- When a query-after-write is blocked, the driver emits a structured log line to stderr: `{"family":"pocketflare-driver","event":"query-after-write-blocked","queuedWrites":N,"query":"..."}`. Use `wrangler tail` to identify which paths need patching.
- For full upstream PocketBase compatibility without application rewrites, add an optional SQLite-backed Durable Object storage mode. D1 remains the default for cost and availability.
- See `docs/do-sqlite-mode-plan.md` for the opt-in full-compatibility storage plan.

## D1 Data Import (migrating from SQLite PocketBase)

When importing an existing PocketBase database into D1:

**Always use `--remote`.** Wrangler v4 `d1 execute` defaults to local. Imports, schema changes, and queries against the Worker's database must use `--remote`. The Worker reads from remote D1; local is a dev-only mirror.

**D1 replication delay.** After DDL changes (DROP TABLE, CREATE TABLE), wait 30–60 seconds before letting the Worker boot against the new schema. D1 replicas lag behind the primary and the Worker will see stale state.

**Bootstrap strategy.** The safest migration path is:
1. Start with empty D1 databases
2. Let Pocketflare bootstrap PocketBase (creates system tables with the current version's schema)
3. Import only app/user data on top — NOT system tables (`_params`, `_collections`, `_migrations`, `_superusers`, `_authOrigins`, `_externalAuths`, `_mfas`, `_otps`)
4. Import app-specific `_collections` entries (skip the system ones PocketBase already created)
5. Recreate SQL VIEWs — PocketBase public views are views, not tables
6. Patch `_params/settings` with target environment values
7. Import `_logs` to LOGS_DB

The `_migrations` table from an older PocketBase version has entries that the current version's migration runner may not match exactly. Importing it causes the runner to re-apply migrations against existing tables, which fails on D1 because the init migration uses `CREATE TABLE` without `IF NOT EXISTS`. Bootstrapping clean avoids this entirely.

**Password hashes are portable.** PocketBase uses standard `$2a$10$` bcrypt. Hashes from any PocketBase version work in any other. The auth token signing key is generated fresh during bootstrap — existing JWT tokens are invalidated, but users can log in again with their same password. Superusers should be created fresh via `POCKETFLARE_ADMIN_EMAIL`/`POCKETFLARE_ADMIN_PASSWORD` env vars or the `/_pf` installer flow.

**Schema drift from JS migrations.** If the old PocketBase had custom `pb_migrations/*.js` that added columns (e.g. `users.disclaimer_agreed`), those columns must be added via ALTER TABLE before importing user data. PocketBase v0.39 creates tables with its own schema, which won't include columns added by old JS migrations.

**Views, not tables.** PocketBase creates public sharing collections (e.g. `pool_share_public`) as SQL VIEWs. If a migration script creates them as tables, drop and recreate as views from the source schema dump.

**`migrate-data.sh` includes `_migrations` by default.** Pass `--exclude-migrations` for clean imports where you want PocketBase to run migrations fresh.

## Validation

Use the narrowest proof that exercises the touched surface:
- Go/runtime changes: `make build`.
- Worker packaging/config: `pnpm exec wrangler deploy --dry-run --outdir .artifacts/deploy-dry-run`.
- Script syntax: `bash -n scripts/<name>.sh`.
- Admin asset regression: concurrent requests to nested `/_/...` static assets should return from Workers Assets and not boot WASM.

Do not run broad suites unless requested. Do not rerun failures without diagnosing the mechanism.

## Email

PocketBase's built-in SMTP client uses Go `net/smtp`, which is non-functional in Go WASM on Cloudflare Workers. Pocketflare replaces it with `adapter/mail`, which provides three transport modes:

1. **HTTP provider** (`POCKETFLARE_MAIL_PROVIDER`): resend, postmark, sendgrid, mailgun — talks directly to each provider's HTTP API.
2. **Generic webhook** (`POCKETFLARE_MAIL_WEBHOOK_URL`): legacy path — posts JSON payloads to any HTTPS endpoint.
3. **SMTP via Workers sockets**: when neither of the above is set, reads PocketBase admin SMTP settings at send time and delivers through `cloudflare:sockets` (JS module `smtp-transport.mjs`).

Provider selection priority is: `MAIL_PROVIDER` > `MAIL_WEBHOOK_URL` > PocketBase SMTP settings. SMTP sockets have live Amazon SES STARTTLS proof. Other providers can still vary by port, TLS mode, and auth behavior. Port 25 is blocked.

Env vars: `POCKETFLARE_MAIL_PROVIDER`, `POCKETFLARE_MAIL_API_KEY`, `POCKETFLARE_MAIL_DOMAIN` (Mailgun only), plus legacy `POCKETFLARE_MAIL_WEBHOOK_URL` / `POCKETFLARE_MAIL_WEBHOOK_TOKEN`.
