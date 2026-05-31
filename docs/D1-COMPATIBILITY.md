# D1 Compatibility Matrix

Pocketflare maps `database/sql` transactions to `D1Database.batch()` for atomic fixed write groups. Reads before writes run directly against D1 but are not transactionally isolated with the later batch. Reads after queued writes fail deterministically.

## Feature Status

### Supported

| Feature | Notes |
|---|---|
| Single-statement CRUD | Direct D1 execution; no transaction needed |
| Collection create | Table DDL + _collections insert |
| Simple /api/batch | Fixed write groups with no interleaved reads |
| Auth register/login/refresh | Reads precede writes within tx callback |
| File upload/download | R2-backed; no D1 transaction involvement |
| Collection rename (name-only) | ALTER TABLE RENAME + UPDATE _collections |

### Supported with safe failure

| Feature | Behavior |
|---|---|
| Batch read-after-write | POST then PATCH in same batch: deterministic 400 with `batch_request_failed`. Zero records persisted. |
| Query-after-write in any tx | `d1pocketflare: cannot query after queued writes in a D1 batch transaction` |

### Patched (D1-compatible via `patches/010-d1-transaction-compat.patch`)

| Feature | Fix |
|---|---|
| Collection delete with view resave | `checkViewDependencies` scans view queries outside tx (substring heuristic); `resaveViewsWithChangedFields` runs before DROP TABLE within tx |
| View collection save/update | Precompute fields and normalized query before entering write tx |
| Cascade deletes (single-level) | Cascade before main delete; collect all related records across all fields before writes |
| Raw SQL route (`/api/sql`) | Split multi-statement SQL by `;`, reject mixed read/write |

### Targeted patch needed

| Feature | Issue | Fix strategy |
|---|---|---|
| Collection import with view validation | View validation interleaved with writes | Prevalidate views, batch fixed writes |
| Field type conversions (single↔multiple) | `normalizeSingleVsMultipleFieldChanges` queries `sqlite_master` after ALTER TABLE | Precompute conversion plan before tx |
| Recursive/multi-level cascade deletes | `deleteRefRecords` calls `app.Delete()` which can trigger nested `cascadeRecordDelete` — inner cascade queries after outer writes are queued | Flatten cascade tree before any writes |

### Confirmed D1-compatible (no patch needed)

| Feature | Reason |
|---|---|
| OAuth2 auth flow | Write-only after initial validation; no interleaved reads |
| Simple collection rename | ALTER TABLE RENAME + UPDATE _collections only |
| Auth register/login | Reads precede writes within tx callback |

### Not D1-compatible

| Feature | Reason |
|---|---|
| Custom app transactions with read-your-writes | D1 `batch()` requires all statements upfront; cannot read intermediate results of queued writes |
| Interactive SQLite-style `BEGIN`/`COMMIT` with interleaved logic | `database/sql` tx model assumes connection-oriented transactions, not batch-or-nothing |

## Architecture

```
PocketBase RunInTransaction(fn)
  → d1Conn.BeginTx()       // creates tx state on connection
  → fn(txApp)
    → ExecContext (write)   // queued in tx.statements
    → QueryContext (read)   // before writes: direct D1 (non-isolated)
                            // after writes: fails with diagnostic log
  → d1Tx.Commit()           // D1Database.batch([...queued statements])
  → d1Tx.Rollback()         // drops queue, no persistence
```

## Diagnostics

When a query-after-write is blocked, the driver emits a structured log line:

```json
{"family":"pocketflare-driver","event":"query-after-write-blocked","queuedWrites":2,"query":"SELECT id FROM _collections WHERE ..."}
```

This appears in `wrangler tail` output. Use it to identify which PocketBase paths need patching.

## DO SQLite: Full-Compatibility Path

For upstream SQLite semantics without rewriting apps, an optional SQLite-backed Durable Object storage mode (`DurableObjectSqliteStorage`) is the full-compatibility option:

- Provides real interactive SQLite transactions (read-your-writes, nested tx, savepoints)
- Enables all upstream PocketBase features without patches
- Tradeoff: app database moves from D1 to a Durable Object with different latency, cost, storage limit, and scaling characteristics
- D1 remains the default (cheap, high-availability, HTTP-accessible)
- DO SQLite would be a configuration mode, not a replacement

This is not part of the current D1 batch implementation.
