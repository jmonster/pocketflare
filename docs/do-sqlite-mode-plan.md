# Durable Object SQLite Mode Plan

## Goal

Keep D1 as Pocketflare's default database backend for cheap, highly available apps, and add an opt-in Durable Object SQLite mode for apps that need upstream PocketBase transaction semantics.

This is a compatibility mode, not a replacement for D1 mode.

## Why This Exists

D1 supports atomic fixed write groups through `D1Database.batch()`, but it does not provide interactive SQLite transactions through Go `database/sql`. Pocketflare's D1 driver handles batchable writes and fails safely on query-after-write.

SQLite-backed Durable Objects provide a private SQLite database per object, synchronous SQL execution, and callback-based transaction APIs that roll back when the callback fails. That is the Cloudflare primitive that most closely matches PocketBase's upstream SQLite assumptions.

Important constraint: Durable Object `sql.exec()` cannot run transaction statements like `BEGIN TRANSACTION` or `SAVEPOINT`. Transaction support must use `ctx.storage.transactionSync()` / `ctx.storage.transaction()`, not raw SQL transaction statements.

## Product Shape

Offer two database modes:

| Mode | Default | Best For | Tradeoff |
|---|---:|---|---|
| D1 | Yes | lowest cost, simple operations, globally reachable data APIs | no interactive SQLite transactions |
| Durable Object SQLite | No | maximum PocketBase compatibility, hooks/imports/features that need read-your-writes | app database is owned by one Durable Object instance with different latency, cost, storage limits, and scaling profile |

Users choose the mode at scaffold time. Existing D1 apps are not automatically migrated.

## Proposed Architecture

Dynamic requests route through the Worker as they do today:

```text
request
  -> worker.mjs
  -> if DB_MODE=d1: singleton Go WASM runtime in the Worker isolate
  -> if DB_MODE=do_sqlite: app Durable Object stub
       -> singleton Go WASM runtime inside the Durable Object
       -> PocketBase database/sql driver backed by ctx.storage.sql
```

The Durable Object must own the PocketBase runtime for that app database. A thin Worker-to-DO SQL RPC layer is not enough because PocketBase transaction callbacks run application logic between SQL statements, and Durable Object SQLite transactions are callback-scoped rather than `BEGIN`/`COMMIT`-scoped.

R2 file storage stays unchanged. Admin assets stay on Workers Assets. Realtime can either keep the existing `RealtimeDO` or be folded later after the database mode is proven.

## Implementation Slices

1. Add scaffold/config mode
   - Add `POCKETFLARE_DB_MODE=d1|do_sqlite`.
   - Keep `d1` as the default.
   - Scaffold a SQLite-backed Durable Object class and binding only when selected.
   - Document that D1 and DO SQLite are separate storage backends.

2. Add DO request host
   - Add a Durable Object class that receives all dynamic requests for one app instance.
   - Instantiate the Go WASM runtime inside the Durable Object, not the outer Worker.
   - Keep static admin assets served by Workers Assets before any runtime boot.

3. Prove transaction callback bridging
   - Build a small spike that runs a Go callback from inside `ctx.storage.transactionSync()`.
   - Inside that callback, execute multiple `ctx.storage.sql.exec()` calls through Go and prove read-your-writes.
   - Return an error from the Go callback and prove all writes roll back.
   - This proof is mandatory before implementing the full mode.

4. Add SQLite storage driver and transaction runner
   - Implement a Go SQL execution layer for `ctx.storage.sql`.
   - Do not rely on SQL `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT`; Cloudflare disallows transaction statements through `sql.exec()`.
   - Patch PocketBase transaction entry points as narrowly as possible so `RunInTransaction` can execute its Go callback inside `transactionSync()` when `DB_MODE=do_sqlite`.
   - Preserve interactive query-after-write behavior inside that callback.
   - Convert values and rows with the same care as the D1 driver.

5. Wire adapter selection
   - In `adapter/wasmdb`, select D1 driver or DO SQLite driver from `POCKETFLARE_DB_MODE`.
   - Keep the PocketBase app wiring unchanged above the driver boundary.
   - Keep R2 filesystem constructors unchanged.

6. Migration support
   - Add explicit docs/scripts for SQLite PocketBase -> DO SQLite import.
   - Do not auto-migrate D1 -> DO SQLite in the first version.
   - Require users to choose a fresh target and verify before switching traffic.

7. Proof lanes
   - Run the existing e2e suite against D1 mode unchanged.
   - Add the same e2e suite against DO SQLite mode.
   - Add targeted proofs for currently limited D1 paths: collection import with views, field type conversions, recursive cascade deletes, and custom transaction read-your-writes.

## Non-Goals

- Do not make DO SQLite the default.
- Do not replace D1 migrations or D1 docs.
- Do not build a generic local filesystem.
- Do not implement native Pocketflare backups. Users should back up D1 and R2, or DO SQLite exports when Cloudflare exposes the needed operational path.
- Do not add direct browser-to-R2 upload as part of this work.

## Open Questions

- How should one app instance map to a Durable Object name? Default should be one object per deployed app.
- What is the cleanest way to expose DO SQLite import/export with Wrangler or Cloudflare APIs?
- Should realtime stay in `RealtimeDO` initially, or can the app DO own realtime once database mode is stable?
- What storage-limit warning should scaffold show for DO SQLite mode? Current Cloudflare limits list 10 GB per SQLite-backed Durable Object on Workers Paid and 1 GB on Workers Free.

## References

- Cloudflare SQLite-backed Durable Object Storage: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Durable Object limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Durable Object state and concurrency: https://developers.cloudflare.com/durable-objects/api/state/
