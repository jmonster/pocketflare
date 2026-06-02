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
| PocketBase migrations | Run statement-by-statement without an outer D1 transaction so legacy migrations can read their own writes |

### Supported with safe failure

| Feature | Behavior |
|---|---|
| Batch read-after-write | POST then PATCH in same batch: deterministic 400 with `batch_request_failed`. Zero records persisted. |
| Query-after-write in any tx | `d1pocketflare: cannot query after queued writes in a D1 batch transaction` |

### Patched (D1-compatible via patches)

**patch 010 (`010-d1-transaction-compat.patch`)**

| Feature | Fix |
|---|---|
| Collection delete with view resave | `checkViewDependencies` scans view queries outside tx (substring heuristic); `resaveViewsWithChangedFields` runs before DROP TABLE within tx |
| View collection save/update | Precompute fields and normalized query before entering write tx |
| Collection metadata updates | Precompute old table existence before saving `_collections`, avoiding schema checks after queued writes |
| Cascade deletes (single-level) | Cascade before main delete; collect all related records across all fields before writes |
| Raw SQL route (`/api/sql`) | Split multi-statement SQL by `;`, reject mixed read/write |

**patch 014 (`014-d1-parity-fixes.patch`)**

| Feature | Fix |
|---|---|
| Collection import with view validation | Stores merged collection map in `app.Store()` so `FindCollectionByNameOrId` and `findCollectionsByIdentifiers` resolve from memory; view field creation and validation route reads through parent app to avoid D1 batch |
| Field type conversions (single↔multiple) | View definitions pre-fetched outside the write transaction and passed to `normalizeSingleVsMultipleFieldChanges`; no more `sqlite_master` query after ALTER TABLE |
| Recursive/multi-level cascade deletes | BFS traversal of entire cascade graph collects all records across all depths before any writes; `skipCascadeDelete` flag prevents re-entrant cascade |
| SQL statement splitter hardening | Rune-based state machine respects string literals, blob literals, line comments, and block comments — semicolons inside those constructs are no longer treated as statement boundaries |
| Restore resume / start-over | UI handles active restore session detection, resume from interrupted phase, and cancel with clear guardrails |

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

PocketBase migrations are the exception in D1 mode. Pocketflare disables the migration runner's outer transaction for D1 because older upstream migrations interleave writes and reads. Those migrations still use the same D1 driver for individual statements.

## Hard Limitations

D1 imposes constraints that cannot be patched around at the application layer:

- **No arbitrary read-after-write in interactive transactions.** D1 `batch()` is statement-group atomic, not session-scoped. All statements must be known upfront. You cannot write, read the result, then decide the next write.
- **Reads before writes are not isolated.** Queries issued before any write in a tx callback run directly against D1 without snapshot isolation. Concurrent writers may change data between the read and the batch commit.
- **Migrations are statement-by-statement in D1 mode.** Pocketflare strips the outer transaction from the migration runner because legacy PocketBase migrations interleave reads and writes. Individual DDL statements still execute through the D1 driver.

## Diagnostics

When a query-after-write is blocked, the driver emits a structured log line:

```json
{"family":"pocketflare-driver","event":"query-after-write-blocked","queuedWrites":2,"query":"SELECT id FROM _collections WHERE ..."}
```

This appears in `wrangler tail` output. Use it to identify which PocketBase paths need patching.

## Proof Matrix

| Feature | Proof | Mode | Remaining Risk |
|---|---|---|---|
| D1 bootstrap (no QAW) | `scripts/proof-d1-bootstrap.sh` | D1 local (wrangler dev) | Cold-start timing varies per deployment |
| Field flip multi↔single | `scripts/proof-d1-bootstrap.sh` §5, `scripts/e2e-test.sh` §9 | D1 local + remote | View-heavy schemas not covered |
| Restore happy path | `scripts/proof-restore-cli.sh` §1-5 | D1 + DO SQLite local | Large backup zip timing |
| Restore resume | `scripts/proof-restore-cli.sh` §6 | D1 + DO SQLite local | Network interruption mid-DB-import |
| Full CRUD + auth + files | `scripts/e2e-test.sh` §1-7 | D1 + DO SQLite remote | None known |
| Batch atomicity | `scripts/e2e-test.sh` §8 | D1 + DO SQLite remote | None known |
| Sequential health stability | `scripts/e2e-test.sh` §10 | D1 + DO SQLite remote | Cold-start after deploy not covered |
| Cascade deletes (single-level) | `scripts/e2e-test.sh` §9 (implicit via collection delete) | D1 + DO SQLite remote | None known |
| Cascade deletes (multi-level) | No dedicated proof | — | Depth > 2 not proven; add a fixture with 3+ cascade levels |
| Collection import with views | No dedicated proof | — | Large import with many interdependent views not proven |
| Raw SQL route | No dedicated proof | — | Statement splitter tested only via unit-level review of 014 state machine |

### Next Proofs To Add

- Multi-level cascade delete fixture with at least three cascade depths.
- Collection import fixture with interdependent views.
- Raw SQL route behavioral proof for statement splitting across strings, blob literals, line comments, and block comments.

## DO SQLite: Full-Compatibility Path

For upstream SQLite semantics without rewriting apps, use the optional SQLite-backed Durable Object mode:

- Provides callback-scoped SQLite transactions with read-your-writes semantics
- Reduces the need for D1-specific transaction patches
- Tradeoff: app database moves from D1 to a Durable Object with different latency, cost, storage limit, and scaling characteristics
- D1 remains the default (cheap, high-availability, HTTP-accessible)
- DO SQLite is a configuration mode, not a replacement

Enable it with `POCKETFLARE_DB_MODE=do_sqlite` and an `APP_DO` binding using `new_sqlite_classes = ["AppDO"]`. See `docs/do-sqlite-migration.md`.
