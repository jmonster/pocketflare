# Migrating to DO SQLite Mode

## New Apps

Set `POCKETFLARE_DB_MODE = "do_sqlite"` at scaffold time and deploy.

Scaffold produces:
- Durable Object binding (`APP_DO`) in `wrangler.toml`
- Durable Object class (`AppDO`) wired in `worker.mjs`
- `dopocketflare` database driver active

The app database is a fresh SQLite database inside the Durable Object. No data migration needed.

## Existing Apps

### D1 mode → DO SQLite mode

D1 and DO SQLite are separate storage backends with no automatic migration. D1 uses Cloudflare's distributed query engine; DO SQLite is a single-instance SQLite database owned by a Durable Object.

**In-place mode switching is not supported.** Do not flip an existing D1 app to DO SQLite by changing `POCKETFLARE_DB_MODE`. Deploy a new app with the target mode and migrate data with a backup zip restore or a tested app-specific export/import path. D1 and DO SQLite both use SQLite-shaped schema, but their storage engines, transaction behavior, and deployment topology differ.

### Standalone PocketBase (SQLite) → DO SQLite mode

PocketBase's SQLite `.db` file is compatible with DO SQLite's SQL engine.

**Backup zip restore (recommended)**

1. Create a PocketBase backup:
   ```sh
   pocketbase backup create
   ```

2. Deploy a new Pocketflare app with `POCKETFLARE_DB_MODE = "do_sqlite"`.

3. Restore the backup zip from the admin UI (Settings → Backups) or CLI:
   ```sh
   node scripts/restore-backup.mjs https://<worker-domain> backup.zip --token <superuser-token>
   ```

This imports schema, data, settings, superusers, and local `storage/` files in a single flow.

Manual collection import through `PUT /api/collections/import` also works in DO SQLite mode, including chained views. It imports collection definitions only; migrate records and R2 files separately and verify the result before switching traffic.

### Verification Checklist

- [ ] All collections present with correct schema
- [ ] All records imported (spot-check record counts)
- [ ] Auth records (superusers, users) can log in
- [ ] File attachments resolve correctly (R2 URLs)
- [ ] Cron jobs fire on schedule
- [ ] Realtime subscriptions work (if enabled)
- [ ] Mail delivery works (SMTP or HTTP provider)
- [ ] Admin UI loads and collections are editable

Automated checks: `scripts/doctor.mjs` verifies health, DB connectivity, admin assets, and bundle size against a deployed Worker. `scripts/proof-restore-cli.sh` exercises the full backup-zip restore path end-to-end against a local `wrangler dev` Worker.

## Storage Limits

DO SQLite mode stores the app database inside a Durable Object. Current Cloudflare limits:

| Plan | SQLite Storage |
|------|---------------|
| Workers Free | 1 GB |
| Workers Paid | 10 GB |

D1 has higher storage limits and is recommended for large datasets (<https://developers.cloudflare.com/d1/platform/limits/>). DO SQLite mode is designed for apps that need PocketBase transaction fidelity, not large-scale data storage.
