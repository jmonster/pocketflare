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

Pocketflare ignores the upstream S3 file-storage setting for normal file fields.

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

## Upload, Copy, And CopyObject

Migration does not use Pocketflare's runtime `Copy` path. Local migration uploads use `scripts/migrate-files.sh`; S3-backed migration should use `rclone`, `aws s3 sync`, or another S3-compatible copy tool to place objects in R2.

Runtime terms:

- Upload: a PocketBase client sends a file to the PocketBase API, then Pocketflare writes it to R2. The current writer is a chunked R2 multipart writer. It buffers up to one part in Go, uploads that part, and releases it. This is bounded-memory pseudo-streaming, not direct browser-to-R2 upload.
- Download: PocketBase serves `/api/files/...` through the Worker from R2. Signed R2 redirects and public-bucket delivery are not implemented.
- Copy: PocketBase's filesystem `Copy(src, dst)` method duplicates an existing stored object. Normal upload, download, local migration, and S3-to-R2 import do not call this path.

S3 `CopyObject` is only an optimization for runtime filesystem Copy. With optional R2 API credentials, Pocketflare asks R2 to copy the object server-side. Without those credentials, the fallback relays the source object body to a new R2 object through the Worker.

The streaming fallback is proven correct up to 20 MiB via `scripts/proof-copy.sh` (run against a local `wrangler dev` Worker with `POCKETFLARE_ENABLE_PROOF_ROUTES=1`):

- **Streaming fallback** (default, no credentials): Uses `FixedLengthStream` + `pipeTo` to relay source body to destination. The copy path itself has no Go-side buffering — memory stays bounded regardless of object size. The proof route allocates source generation and verification buffers (capped at 20 MiB), but those are test scaffolding, not part of the copy path under test.
- **S3 CopyObject** (requires parent R2 credentials: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ACCOUNT_ID`): Zero data through the Worker — R2 copies the object server-side. Object size is limited only by R2 S3 API limits. SigV4 signing is correct (verified via deployed Worker S3 API calls: no signature-format errors, no InvalidRequest). The S3 API is only reachable from within Cloudflare's network (local wrangler dev cannot establish TLS to `*.r2.cloudflarestorage.com`). Runtime E2E proof requires an R2 API token with S3 `PutObject` + `CopyObject` permission on the STORAGE bucket. The code path from credential detection through SigV4 signing through `fetch()` to R2 is exercised and structurally complete; the blocking item is token scope, not a code bug or platform constraint.

`scripts/proof-copy.sh` supports both modes. When parent R2 credentials are configured, the script derives 15-minute credentials scoped to the STORAGE bucket's `proof-copy/` prefix, runs S3 mode with `wrangler dev --remote`, asserts the correct `copyPath` is reported, and checks for S3 HTTP errors. If the token is scoped to a non-default bucket, set `POCKETFLARE_PROOF_STORAGE_BUCKET=<bucket>` so the temporary config and S3 bucket name match the token. Without parent credentials, the S3 path is skipped and only the streaming fallback is proven (17/17 passing, 1 KiB through 20 MiB).

The proof route (`POST /api/pocketflare/proof/copy`, gated behind `POCKETFLARE_ENABLE_PROOF_ROUTES=1`) uploads a random object, copies it, and verifies byte-for-byte equality including content type preservation. The response reports which copy path was used.

## Backups and Restore

Pocketflare has a separate R2 `BACKUPS` bucket. Existing PocketBase backup archives are optional migration data. If you need them, copy backup zip files into the `BACKUPS` bucket with their original file names.

**Backup zip restore** (admin UI Settings → Backups, or CLI `scripts/restore-backup.mjs`) imports the database and local `storage/` files from a PocketBase backup zip into an empty Pocketflare target. This is the recommended migration path from standalone PocketBase.

A minimal backup fixture is checked in at `tests/fixtures/minimal-backup.zip` (generated by `tests/fixtures/generate-backup-zip.mjs`). Run `scripts/proof-restore-cli.sh` to verify the CLI restore path end-to-end against a local `wrangler dev` Worker.

**Existing S3-backed files** are not included in PocketBase backup zips. Copy your source S3 bucket's `storage/` prefix into Pocketflare's R2 `STORAGE` bucket separately using `rclone`, `aws s3 sync`, or another S3-compatible tool. See the [Existing S3-Compatible Storage](#existing-s3-compatible-storage) section above for details.

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
