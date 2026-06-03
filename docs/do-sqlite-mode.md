# DO SQLite Architecture

Pocketflare supports two database modes:

| Mode | Default | Database | Best for |
|---|---:|---|---|
| `d1` | Yes | D1 `APP_DB` + `LOGS_DB` | cheapest baseline, globally reachable data APIs, fixed write transactions |
| `do_sqlite` | No | SQLite-backed Durable Object `APP_DO` | upstream-style SQLite transactions and read-your-writes behavior |

## Shape

`d1` mode keeps the existing runtime path:

```text
request -> worker.mjs -> Go/WASM -> D1
```

`do_sqlite` mode routes dynamic requests through one named Durable Object:

```text
request -> worker.mjs -> AppDO -> Go/WASM -> ctx.storage.sql
```

Static admin assets still come from Workers Assets before Go/WASM boots. R2 file storage is unchanged.

## Implementation Notes

- `POCKETFLARE_DB_MODE=do_sqlite` enables DO SQLite mode.
- `APP_DO` must be bound with a Wrangler migration using `new_sqlite_classes = ["AppDO"]`.
- `adapter/wasmdb/do_driver.go` maps `database/sql` statements to `ctx.storage.sql.exec()`.
- `patches/011-do-sqlite-transaction-hook.patch` exposes a narrow PocketBase transaction hook.
- `adapter/app.go` installs that hook before bootstrap so PocketBase transaction callbacks run inside `ctx.storage.transactionSync()`.
- The driver must not emit raw `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT`; Cloudflare Durable Object SQL rejects transaction control statements.

## Migration

D1 and DO SQLite are separate backends. There is no automatic D1-to-DO migration. Use `docs/do-sqlite-migration.md` for supported migration guidance.

## Validation

Local build and dry-run checks prove packaging. Transaction behavior requires a real Workers/DO runtime because `ctx.storage.sql` and `transactionSync()` are Cloudflare runtime APIs.
