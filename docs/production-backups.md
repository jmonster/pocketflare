# Production Backup Strategy

Pocketflare stores data across three Cloudflare resources. A complete production backup covers all three. This document defines the supported backup and recovery paths for each.

PocketBase backup zips are migration artifacts, not complete Pocketflare production backups. They contain schema and data but not R2 objects. Restoring a PocketBase backup zip into an empty Pocketflare target (admin UI or `scripts/restore-backup.mjs`) is a migration path from standalone PocketBase, not the production backup strategy.

## Resources to Back Up

| Resource | Binding | Content |
|---|---|---|
| `pocketflare-app` | `APP_DB` | Application data (collections, records, auth, settings) |
| `pocketflare-logs` | `LOGS_DB` | Auxiliary/log data (request logs, email logs) |
| `pocketflare-storage` | `STORAGE` | User file attachments under `storage/<collectionId>/<recordId>/<filename>` |
| `pocketflare-backups` | `BACKUPS` | PocketBase backup zip artifacts only (not a complete Pocketflare backup) |

## D1 Mode

### Backup: Time Travel (Primary)

D1 provides point-in-time recovery (PITR) automatically. No action needed to enable it.

| Plan | Retention |
|---|---|
| Workers Free | 30 days |
| Workers Paid | 30 days |
| Business | 90 days |
| Enterprise | 90 days |

Restore a database to any point within the retention window:

```sh
# Restore APP_DB to a specific timestamp (UTC)
pnpm exec wrangler d1 time-travel restore pocketflare-app \
  --remote \
  --timestamp "2026-06-02T10:30:00Z"

# Restore LOGS_DB to the same point
pnpm exec wrangler d1 time-travel restore pocketflare-logs \
  --remote \
  --timestamp "2026-06-02T10:30:00Z"
```

**Important:** Time Travel restore replaces the entire database. The existing database state is lost. Restore APP_DB and LOGS_DB to the same timestamp for consistency.

List available restore points:

```sh
pnpm exec wrangler d1 time-travel info pocketflare-app --remote
pnpm exec wrangler d1 time-travel info pocketflare-logs --remote
```

### Backup: SQL Export (Supplemental)

Export a full SQL dump for off-platform storage or cross-account portability:

```sh
# Export APP_DB
pnpm exec wrangler d1 export pocketflare-app \
  --remote \
  --output .artifacts/backups/pocketflare-app-$(date -u +%Y%m%dT%H%M%SZ).sql

# Export LOGS_DB
pnpm exec wrangler d1 export pocketflare-logs \
  --remote \
  --output .artifacts/backups/pocketflare-logs-$(date -u +%Y%m%dT%H%M%SZ).sql
```

**Always use `--remote`.** Without it, wrangler exports local dev data, not production.

For automated exports, wrap in a cron script or scheduled Worker. Cloudflare does not provide a managed scheduled-export feature for D1.

### Restore from SQL Export

```sh
pnpm exec wrangler d1 execute pocketflare-app \
  --remote \
  --file .artifacts/backups/pocketflare-app-20260602T103000Z.sql

pnpm exec wrangler d1 execute pocketflare-logs \
  --remote \
  --file .artifacts/backups/pocketflare-logs-20260602T103000Z.sql
```

**Limitations:**
- The export is a logical dump, not a physical snapshot. Large databases may take time to export and import.
- Restoring from SQL dump replaces data but does not roll back schema changes made after the export.
- D1 replication lag means the Worker may serve stale state for 30–60 seconds after import.

### Recommended Backup Cadence

| Method | Frequency | Recovery Point Objective |
|---|---|---|
| Time Travel (built-in) | Continuous | Within 30 days (any timestamp) |
| SQL export | Daily or weekly | Last export |
| R2 STORAGE sync (see below) | Daily | Last sync |

Time Travel is the primary recovery path. SQL exports are a safety net for cross-account portability and for surviving the Time Travel retention window.

## DO SQLite Mode

When `POCKETFLARE_DB_MODE=do_sqlite`, the app database lives inside a Durable Object's SQLite storage.

### Backup Options

**Durable Object SQLite does not provide managed point-in-time recovery equivalent to D1 Time Travel.** The SQLite database is a file inside the DO's persistent storage. Cloudflare does not offer a dashboard or CLI command to snapshot or restore DO SQLite storage.

Available approaches:

1. **DO Alarm-based export to R2 (manual implementation required).** Write a DO alarm handler that exports the SQLite database to an R2 bucket on a schedule. This is application code you must write and maintain. Pocketflare does not include this handler — it is a project-specific addition.

2. **PocketBase backup zip via admin API.** In DO SQLite mode, PocketBase's built-in backup creation (`POST /api/backups`) archives the SQLite database and local storage files into a zip stored in the `BACKUPS` R2 bucket. This works because DO SQLite mode runs PocketBase as it would on a single server. However:
   - The backup includes only `storage/` files PocketBase knows about (those tracked in `_files` table records), not arbitrary R2 objects.
   - Backup creation is synchronous and may hit Worker CPU time limits for large databases.
   - Auto-backups (`POCKETBASE_AUTO_BACKUPS`) are not tested at scale on Workers.

3. **Periodic SQLite dump via `wrangler` (not supported).** There is no `wrangler d1 export` equivalent for DO SQLite. The database is not externally queryable.

### Recovery Path

Recovery from DO SQLite mode depends on what backup artifacts exist:

- **From PocketBase backup zip:** Restore via admin UI or `scripts/restore-backup.mjs` into an empty Pocketflare target. This is a clean-slate restore, not an in-place recovery.
- **From custom DO Alarm export:** Restore is project-specific. Implement a DO handler that reads the exported SQLite dump from R2 and replaces the active database.
- **No backup:** Data is lost. DO SQLite has no automatic PITR.

### Recommendation

For production deployments that need managed backup and PITR, use D1 mode. DO SQLite mode is suited for development, low-stakes deployments, or apps where PocketBase backup zips are an acceptable recovery path.

## R2 STORAGE Bucket

R2 does not provide managed snapshot/backup or point-in-time recovery. Object backups require explicit copies.

### Backup: Cross-Bucket or Cross-Region Copy

**Option A: `rclone sync` (recommended)**

```sh
# One-time configuration (stores credentials in rclone config, not in repo)
rclone config create r2-source s3 \
  provider Cloudflare \
  access_key_id <R2_ACCESS_KEY_ID> \
  secret_access_key <R2_SECRET_ACCESS_KEY> \
  endpoint https://<account-id>.r2.cloudflarestorage.com

rclone config create r2-backup-target s3 \
  provider Cloudflare \
  access_key_id <BACKUP_ACCESS_KEY_ID> \
  secret_access_key <BACKUP_SECRET_ACCESS_KEY> \
  endpoint https://<account-id>.r2.cloudflarestorage.com

# Sync STORAGE bucket to a backup bucket
rclone sync r2-source:pocketflare-storage r2-backup-target:pocketflare-storage-backup \
  --progress --checksum
```

**Option B: `aws s3 sync`**

```sh
aws s3 sync s3://pocketflare-storage s3://pocketflare-storage-backup \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --source-region auto --region auto
```

**Option C: `wrangler r2` (small-scale, manual)**

`wrangler r2` does not have a bulk copy command. For individual objects or small sets:

```sh
pnpm exec wrangler r2 object get pocketflare-storage/storage/col/rec/file.txt \
  --remote --file /tmp/obj.bin
pnpm exec wrangler r2 object put backup-bucket/storage/col/rec/file.txt \
  --remote --file /tmp/obj.bin
```

### Verify R2 Backup Integrity

After syncing, spot-check object counts and checksums:

```sh
# Count objects in source
aws s3 ls s3://pocketflare-storage --recursive --endpoint-url https://<account-id>.r2.cloudflarestorage.com --summarize | tail -5

# Count objects in backup
aws s3 ls s3://pocketflare-storage-backup --recursive --endpoint-url https://<account-id>.r2.cloudflarestorage.com --summarize | tail -5
```

Verify specific file keys resolve:

```sh
# Check a known file key exists in backup
aws s3api head-object --bucket pocketflare-storage-backup \
  --key "storage/<collectionId>/<recordId>/<filename>" \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

### Key Layout

All user file attachments are under:

```text
storage/<collectionId>/<recordId>/<filename>
storage/<collectionId>/<recordId>/thumbs_<filename>/<thumbSize>_<filename>
```

The restore marker used during migrations lives at `pocketflare-restore/active.json`. It is ephemeral and does not need to be backed up.

## BACKUPS Bucket

The `BACKUPS` R2 bucket stores PocketBase backup zip artifacts created by PocketBase's built-in backup feature (admin UI Settings → Backups, or `POST /api/backups`). These zips package the database and `storage/` files into a portable format.

**The BACKUPS bucket is not a complete Pocketflare production backup.** It contains only PocketBase backup zips — point-in-time exports of the database schema/data and managed file attachments. It does not include:

- R2 objects not tracked by PocketBase's `_files` table
- D1-specific metadata or replication state
- DO SQLite storage outside what PocketBase exports
- Worker configuration, env vars, or bindings

If you use PocketBase backup zips for disaster recovery, store a copy outside the `BACKUPS` bucket as well. A bucket-level failure could take out both primary data and backup artifacts if they share an account or region.

## Backup Verification

Run the verification script to confirm backup-related bindings exist and are accessible:

```sh
node scripts/backup-verify.mjs <worker-url> --token <superuser-token>
```

This performs non-destructive checks against the live Worker:

1. **Doctor endpoint** — confirms DB mode, APP_DB connectivity, LOGS_DB connectivity, STORAGE binding, BACKUPS binding.
2. **Backup binding names** — verifies the bindings match the expected names (`APP_DB`, `LOGS_DB`, `STORAGE`, `BACKUPS`).
3. **R2 key shape** — confirms the storage prefix convention is documented (does not require live objects).

For full restore-path verification, use `scripts/proof-restore-cli.sh` which exercises the end-to-end backup-zip restore flow against a `wrangler dev` Worker.

## Support Matrix

| Resource | Backup Method | Recovery Method | Status |
|---|---|---|---|
| **D1 APP_DB** | Time Travel (PITR) | `wrangler d1 time-travel restore` | **Supported** — built into D1 |
| **D1 APP_DB** | SQL export | `wrangler d1 export` / `wrangler d1 execute` | **Supported** — manual, scriptable |
| **D1 LOGS_DB** | Time Travel (PITR) | `wrangler d1 time-travel restore` | **Supported** — built into D1 |
| **D1 LOGS_DB** | SQL export | `wrangler d1 export` / `wrangler d1 execute` | **Supported** — manual, scriptable |
| **DO SQLite** | PocketBase backup zip | `scripts/restore-backup.mjs` | **Manual** — admin UI or CLI restore into empty target |
| **DO SQLite** | Custom DO Alarm export | Project-specific | **Unsupported** — not implemented in Pocketflare |
| **DO SQLite** | Managed PITR | — | **Unsupported** — DO SQLite has no PITR |
| **R2 STORAGE** | `rclone sync` / `aws s3 sync` | Reverse sync or `aws s3 cp` | **Manual** — use S3-compatible tools |
| **R2 STORAGE** | Managed backup | — | **Unsupported** — R2 has no backup feature |
| **BACKUPS bucket** | PocketBase backup zips | `scripts/restore-backup.mjs` | **Manual** — migration artifact, not complete backup |
| **Worker config** | `wrangler.toml` + env vars | `wrangler deploy` | **Manual** — Git-tracked config, secrets in Keychain |

## References

- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/best-practices/sqlite/)
- [R2 Object operations](https://developers.cloudflare.com/r2/objects/)
- [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
