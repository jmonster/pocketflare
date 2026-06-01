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

**Migration is not supported in the first version.** If you need PocketBase transaction semantics, deploy a new app with `POCKETFLARE_DB_MODE = "do_sqlite"` and migrate data manually:

1. Export collections from the D1 app (PocketBase JSON export or D1 SQL dump)
2. Import into the new DO SQLite app (PocketBase collection import API)

D1 and DO SQLite schemas are compatible — both use SQLite DDL. Timestamp and JSON column behavior may differ; test before switching traffic.

### Standalone PocketBase (SQLite) → DO SQLite mode

PocketBase's SQLite `.db` file is compatible with DO SQLite's SQL engine. Migration path:

1. Export the PocketBase database:
   ```sh
   pocketbase backup create
   # or: sqlite3 pb_data/data.db .dump > export.sql
   ```

2. Deploy a new Pocketflare app with `POCKETFLARE_DB_MODE = "do_sqlite"`.

3. Import via PocketBase's collection import API:
   ```sh
   curl -X POST https://your-app.workers.dev/api/collections/import \
     -H "Authorization: <admin-token>" \
     -F "data=@export.json"
   ```

4. Re-upload file attachments to R2 (files stored in PocketBase's local filesystem
   must be uploaded separately; Pocketflare uses R2, not local disk).

5. Verify all collections, auth records, and file references before switching DNS.

### Verification Checklist

- [ ] All collections present with correct schema
- [ ] All records imported (spot-check record counts)
- [ ] Auth records (superusers, users) can log in
- [ ] File attachments resolve correctly (R2 URLs)
- [ ] Cron jobs fire on schedule
- [ ] Realtime subscriptions work (if enabled)
- [ ] Mail delivery works (SMTP or HTTP provider)
- [ ] Admin UI loads and collections are editable

## Storage Limits

DO SQLite mode stores the app database inside a Durable Object. Current Cloudflare limits:

| Plan | SQLite Storage |
|------|---------------|
| Workers Free | 1 GB |
| Workers Paid | 10 GB |

D1 has higher storage limits and is recommended for large datasets (<https://developers.cloudflare.com/d1/platform/limits/>). DO SQLite mode is designed for apps that need PocketBase transaction fidelity, not large-scale data storage.
