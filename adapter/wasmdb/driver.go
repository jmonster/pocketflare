//go:build js && wasm

package wasmdb

import (
	"context"
	"database/sql"
	"database/sql/driver"

	d1driver "github.com/syumai/workers/cloudflare/d1"
)

func init() {
	sql.Register("d1pocketflare", &txWrapperDriver{})
}

// txWrapperDriver provides no-op transactions for D1's database/sql interface.
//
// WHY NOOP TRANSACTIONS ARE THE ONLY OPTION
//
// D1 does not support multi-statement SQL transactions. There is no way to
// BEGIN TRANSACTION, execute N statements, then COMMIT or ROLLBACK across
// them with D1. This is a platform constraint, not a missing feature.
//
// What D1 actually provides:
//   - Each db.prepare(sql).run() call is its own transaction at the storage
//     layer. Every statement is individually atomic.
//   - db.batch([]prepared) executes an array of prepared statements in a
//     single HTTP round-trip, atomically. This IS a genuine multi-statement
//     transaction, but it's a single-call primitive — you submit everything
//     at once and get results back at once. The database/sql model requires
//     interleaving reads and writes across separate method calls.
//   - db.withSession() returns a D1DatabaseSession that provides sequential
//     consistency (you read your writes within the session). It does NOT
//     provide BEGIN/COMMIT/ROLLBACK boundaries across separate prepare().run()
//     calls. The Session API is for read-replication consistency, not for
//     user-managed multi-statement atomicity.
//
// Why batch() doesn't help here:
//   - database/sql's transaction model is connection-oriented: you Begin(),
//     execute statements one at a time (possibly reading intermediate results),
//     then Commit() or Rollback(). This maps to SQLite's native transactional
//     model but not to D1's batch-or-nothing model.
//   - D1 batch() requires all statements upfront and returns all results at
//     once. You cannot interleave application logic, read results, then issue
//     more writes — which is what PocketBase's RunInTransaction callers do
//     (e.g., save a record, run a callback that queries the saved data, then
//     commit or roll back based on the result).
//   - There is no adapter layer that can buffer and replay statements, because
//     application logic and side effects (hooks, callbacks) run between them.
//
// Why withSession() doesn't help here:
//   - D1DatabaseSession only exposes prepare() and batch(). Running "BEGIN
//     TRANSACTION" through session.prepare().run() is not documented or
//     guaranteed to create a transactional boundary — each .run() call still
//     operates independently at the storage layer.
//   - Even if BEGIN/COMMIT SQL were accepted on a session object, the
//     database/sql model guarantees nothing about how the driver's internal
//     connection handles them across separate Prepare() calls.
//
// DO NOT ATTEMPT TO "FIX" THIS
//
// If you are reading this and thinking "surely we can make transactions work
// with D1 somehow," read the above sections again. The D1 platform has been
// architected from the ground up as a stateless HTTP-accessible database.
// Multi-statement transactions spanning independent driver.Prepare() calls
// are fundamentally incompatible with that architecture. This has been
// investigated thoroughly; there is no trick, workaround, or upcoming D1
// feature that will bridge this gap.
//
// PRACTICAL IMPACT
//
// At the individual-statement level, D1 is fully atomic. Every INSERT,
// UPDATE, DELETE, or SELECT executes atomically on its own. The only place
// this limitation surfaces is in PocketBase code paths that use
// RunInTransaction (or the underlying dbx.Transactional) to group multiple
// statements:
//
//   - DrySubmit (deprecated in earlier PocketBase releases): used for pre-submit validation.
//     The temp save will persist even on "rollback." This is acceptable
//     because DrySubmit is only called opportunistically and the actual
//     Submit() path does not depend on it — the real create/update call
//     happens outside a transaction.
//   - Collection import: multiple collection operations within a single
//     RunInTransaction. If the import fails partway, some collections will
//     have been created. Manual cleanup may be needed.
//   - Batch API: multiple record operations in one request. Partial failures
//     may leave some operations applied. The batch endpoint is typically
//     used by admin clients; data integrity should be verified after failure.
//   - Auto-migration: schema changes executed during app bootstrap. Each
//     migration function runs inside RunInTransaction. If a migration step
//     fails, earlier schema changes in that step persist. However, PocketBase's
//     migration version tracker means failed migrations will be retried from
//     scratch on next bootstrap, and most schema DDL is idempotent.
//
// These are the same tradeoffs you get with any D1-backed application. They
// are not unique to Pocketflare — they are inherent to D1's design.
type txWrapperDriver struct{}

func (d *txWrapperDriver) Open(name string) (driver.Conn, error) {
	connector, err := d1driver.OpenConnector(name)
	if err != nil {
		return nil, err
	}
	conn, err := connector.Connect(context.Background())
	if err != nil {
		return nil, err
	}
	return &txWrapperConn{conn: conn}, nil
}

// txWrapperConn wraps a D1 connection and provides no-op transactions.
//
// All non-transaction operations (Prepare, Close) delegate directly to the
// underlying d1.Conn. Begin and BeginTx return a noopTx — the transaction
// itself is a no-op because D1 cannot support multi-statement transactions
// across separate database/sql calls (see txWrapperDriver for the full
// explanation).
type txWrapperConn struct {
	conn driver.Conn
}

func (c *txWrapperConn) Prepare(query string) (driver.Stmt, error) {
	return c.conn.Prepare(query)
}

func (c *txWrapperConn) Close() error {
	return c.conn.Close()
}

func (c *txWrapperConn) Begin() (driver.Tx, error) {
	return &noopTx{}, nil
}

func (c *txWrapperConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	return &noopTx{}, nil
}

// noopTx implements driver.Tx where Commit and Rollback are both no-ops.
//
// D1 does not support multi-statement transactions across separate
// driver.Prepare() calls (documented in txWrapperDriver above). Every
// "transaction" created by database/sql through this driver commits each
// statement immediately — there is no pending state to commit or roll back.
//
// PocketBase callers that use RunInTransaction (DrySubmit, collection import,
// batch API, auto-migration) will see every write take effect immediately.
// On "rollback", earlier writes are not undone. This is a documented D1
// platform constraint, not a driver bug.
type noopTx struct{}

func (tx *noopTx) Commit() error   { return nil }
func (tx *noopTx) Rollback() error { return nil }

var (
	_ driver.Driver      = (*txWrapperDriver)(nil)
	_ driver.Conn        = (*txWrapperConn)(nil)
	_ driver.ConnBeginTx = (*txWrapperConn)(nil)
	_ driver.Tx          = (*noopTx)(nil)
)
