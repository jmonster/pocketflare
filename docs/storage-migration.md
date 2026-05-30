# Storage Migration Guide

Pocketflare stores PocketBase files in the R2 `STORAGE` bucket under this key shape:

```text
storage/<collectionId>/<recordId>/<filename>
storage/<collectionId>/<recordId>/thumbs_<filename>/<thumbSize>_<filename>
```

That matches PocketBase's local `pb_data/storage` layout with an added `storage/` object-key prefix. Collection IDs, record IDs, and file names come from the migrated D1 data; object keys must match those values exactly.

## Database First

Always migrate the SQLite database before file storage:

```sh
mkdir -p .artifacts
./scripts/migrate-data.sh /path/to/pb_data/data.db > .artifacts/pocketbase-to-d1.sql
pnpm exec wrangler d1 execute APP_DB --remote --file .artifacts/pocketbase-to-d1.sql
```

The export keeps `_params/settings`. Existing app URL, auth, mail, trusted proxy, and S3 settings are preserved in D1, but Pocketflare ignores the upstream S3 file-storage setting for normal file fields.

## Local PocketBase Storage

Source layout:

```text
pb_data/storage/<collectionId>/<recordId>/<filename>
```

Upload:

```sh
WRANGLER_R2_BUCKET=<storage-bucket> \
  ./scripts/migrate-files.sh /path/to/pb_data/storage --execute
```

Dry-run first by omitting `--execute`.

By default the script uploads local path `collection/record/file` to R2 key `storage/collection/record/file`.

## Existing S3-Compatible Storage

If the existing PocketBase app uses S3, migrate the objects into the Pocketflare R2 `STORAGE` bucket with the same relative keys PocketBase used.

Most PocketBase S3 objects are already under a `storage/` prefix. Verify before copying:

```sh
aws s3 ls s3://<source-bucket>/storage/ --recursive --endpoint-url <source-endpoint>
```

Copy with an S3-compatible tool:

```sh
rclone sync <source-remote>:<source-bucket>/storage \
  <r2-remote>:<storage-bucket>/storage
```

or:

```sh
aws s3 sync s3://<source-bucket>/storage \
  s3://<storage-bucket>/storage \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

Use Cloudflare R2 credentials for the destination. Source credentials should remain outside the repo.

If your export tool writes files locally with paths that already include `storage/`, upload with:

```sh
WRANGLER_R2_BUCKET=<storage-bucket> \
  ./scripts/migrate-files.sh /path/to/export-root --no-storage-prefix --execute
```

## Backups

Pocketflare has a separate R2 `BACKUPS` bucket. Existing PocketBase backup archives are optional migration data. If you need them, copy backup zip files into the `BACKUPS` bucket with their original file names.

Backup create/list/upload use R2. Backup restore still needs follow-up work because one upstream restore branch consults PocketBase backup S3 settings.

## Verification

After database and files are migrated:

1. Open `/_/`.
2. Pick one record with a file field.
3. Confirm the API record contains the expected file name.
4. Fetch:

   ```sh
   curl -I "https://<worker-domain>/api/files/<collectionId>/<recordId>/<filename>"
   ```

5. If the file is missing, compare the expected key:

   ```text
   storage/<collectionId>/<recordId>/<filename>
   ```

   against the object key in R2.

## Current Gaps

- No automated S3-to-R2 migration wrapper is checked in yet.
- No direct browser-to-R2 upload flow exists yet.
- No signed R2 download redirect exists yet.
- Large uploads/copies should avoid the current Go memory-buffered adapter path until R2 multipart/server-side copy work lands.
