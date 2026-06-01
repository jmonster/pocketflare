//go:build js && wasm

package wasmdb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
	"syscall/js"
)

func init() {
	sql.Register("dopocketflare", &doDriver{})
}

// DO SQLite driver backed by ctx.storage.sql.
//
// ctx.storage.sql.exec() is synchronous (no Promises). It returns a
// SqlStorageCursor that provides .columnNames, .toArray(), .raw(),
// .rowsWritten, etc. This is fundamentally different from D1 where
// every operation returns a Promise.
//
// Transaction support: ctx.storage.transactionSync() runs a synchronous
// callback. All sql.exec() calls inside the callback are part of the same
// transaction. If the callback throws, the transaction rolls back.
//
// The driver does NOT emit BEGIN, COMMIT, ROLLBACK, or SAVEPOINT through
// sql.exec() — Cloudflare disallows transaction control statements.
// Instead, PocketBase's RunInTransactionHook wraps the entire Go callback
// in transactionSync(), and the driver's Tx is a no-op flag.

// ── driver.Driver ──────────────────────────────────────────────────────────

type doDriver struct{}

func (d *doDriver) Open(name string) (driver.Conn, error) {
	return &doConn{}, nil
}

// ── driver.Conn / driver.ConnBeginTx / driver.ConnPrepareContext ──────────

type doConn struct {
	mu sync.Mutex
	tx *doTx
}

func (c *doConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

func (c *doConn) PrepareContext(_ context.Context, query string) (driver.Stmt, error) {
	return &doStmt{conn: c, query: query}, nil
}

func (c *doConn) Close() error { return nil }

func (c *doConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *doConn) BeginTx(_ context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if opts.ReadOnly {
		return nil, errors.New("dopocketflare: read-only transactions are not supported")
	}
	if opts.Isolation != driver.IsolationLevel(0) {
		return nil, errors.New("dopocketflare: non-default isolation level is not supported")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.tx != nil {
		return nil, errors.New("dopocketflare: transaction already in progress on this connection")
	}

	tx := &doTx{conn: c}
	c.tx = tx
	return tx, nil
}

// ── driver.Stmt / driver.StmtExecContext / driver.StmtQueryContext ────────

type doStmt struct {
	conn  *doConn
	query string
}

func (s *doStmt) NumInput() int { return -1 }
func (s *doStmt) Close() error  { return nil }

func (s *doStmt) Exec([]driver.Value) (driver.Result, error) {
	return nil, errors.New("dopocketflare: Exec is deprecated; use ExecContext")
}

func (s *doStmt) Query([]driver.Value) (driver.Rows, error) {
	return nil, errors.New("dopocketflare: Query is deprecated; use QueryContext")
}

// ExecContext calls sql.exec() synchronously. No Promise involved.
func (s *doStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	s.conn.mu.Lock()
	tx := s.conn.tx
	done := tx != nil && tx.done
	s.conn.mu.Unlock()

	if done {
		return nil, errors.New("dopocketflare: transaction already completed")
	}

	jsArgs, err := namedValuesToJS(args)
	if err != nil {
		return nil, err
	}

	execArgs := append([]any{s.query}, jsArgs...)
	cursor := storageAPI().Get("sql").Call("exec", execArgs...)
	return &doResult{
		rowsWritten: cursor.Get("rowsWritten").Int(),
	}, nil
}

// QueryContext calls sql.exec() synchronously.
// Read-your-writes works inside a transactionSync() callback because
// all sql.exec() calls run in the same transaction synchronously.
func (s *doStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	s.conn.mu.Lock()
	tx := s.conn.tx
	done := tx != nil && tx.done
	s.conn.mu.Unlock()

	if done {
		return nil, errors.New("dopocketflare: transaction already completed")
	}

	jsArgs, err := namedValuesToJS(args)
	if err != nil {
		return nil, err
	}

	execArgs := append([]any{s.query}, jsArgs...)
	cursor := storageAPI().Get("sql").Call("exec", execArgs...)

	colsArray := cursor.Get("columnNames")
	if colsArray.Get("toArray").Type() == js.TypeFunction {
		colsArray = colsArray.Call("toArray")
	}
	colsLen := colsArray.Length()
	cols := make([]string, colsLen)
	for i := 0; i < colsLen; i++ {
		cols[i] = colsArray.Index(i).String()
	}

	rowsArray := cursor.Call("raw").Call("toArray")

	return &doRows{_columns: cols, rowsArray: rowsArray}, nil
}

// ── driver.Tx ──────────────────────────────────────────────────────────────

type doTx struct {
	mu   sync.Mutex
	conn *doConn
	done bool
}

func (tx *doTx) Commit() error {
	tx.mu.Lock()
	if tx.done {
		tx.mu.Unlock()
		return errors.New("dopocketflare: transaction already completed")
	}
	tx.done = true
	tx.mu.Unlock()
	tx.clearConnTx()
	return nil
}

func (tx *doTx) Rollback() error {
	tx.mu.Lock()
	if tx.done {
		tx.mu.Unlock()
		return errors.New("dopocketflare: transaction already completed")
	}
	tx.done = true
	tx.mu.Unlock()
	tx.clearConnTx()
	return nil
}

func (tx *doTx) clearConnTx() {
	tx.conn.mu.Lock()
	tx.conn.tx = nil
	tx.conn.mu.Unlock()
}

// ── driver.Result ──────────────────────────────────────────────────────────

type doResult struct {
	rowsWritten int
}

func (r *doResult) RowsAffected() (int64, error) { return int64(r.rowsWritten), nil }
func (r *doResult) LastInsertId() (int64, error) {
	return 0, errors.New("dopocketflare: last insert id not available from sql.exec(); use RETURNING")
}

// ── driver.Rows ────────────────────────────────────────────────────────────

type doRows struct {
	rowsArray  js.Value
	currentRow int
	_columns   []string
	mu         sync.Mutex
}

func (r *doRows) Columns() []string { return r._columns }

func (r *doRows) Close() error { return nil }

func (r *doRows) Next(dest []driver.Value) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.rowsArray.IsUndefined() || r.rowsArray.IsNull() || r.currentRow >= r.rowsArray.Length() {
		return io.EOF
	}

	rowArray := r.rowsArray.Index(r.currentRow)
	if rowArray.IsUndefined() || rowArray.IsNull() {
		return io.EOF
	}
	rowLen := rowArray.Length()
	for i := 0; i < rowLen; i++ {
		v, err := jsValueToGo(rowArray.Index(i))
		if err != nil {
			return err
		}
		dest[i] = v
	}
	r.currentRow++
	return nil
}

// ── storage API access ────────────────────────────────────────────────────

func storageAPI() js.Value {
	ctx := js.Global().Get("context").Get("ctx")
	if ctx.IsUndefined() || ctx.IsNull() {
		panic("dopocketflare: DO context not available — ensure POCKETFLARE_DB_MODE=do_sqlite")
	}
	storage := ctx.Get("storage")
	if storage.IsUndefined() || storage.IsNull() {
		panic("dopocketflare: ctx.storage not available — ensure POCKETFLARE_DB_MODE=do_sqlite")
	}
	return storage
}

// ── transactionSync bridge ─────────────────────────────────────────────────

// RunInTransactionSync executes fn inside ctx.storage.transactionSync().
// Because transactionSync runs synchronously, this function blocks the
// calling goroutine until the callback completes.
//
// If fn returns an error, the Go callback returns that message to the JS
// bridge, which throws inside transactionSync so Cloudflare rolls back writes.
//
// If fn returns nil, transactionSync commits the transaction.
func RunInTransactionSync(fn func() error) (err error) {
	storage := storageAPI()
	bridge := js.Global().Get("__pocketflareDoTransactionSync")
	if bridge.IsUndefined() || bridge.IsNull() {
		return errors.New("dopocketflare: transaction bridge is not registered")
	}

	jsCallback := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		err = fn()
		if err != nil {
			return err.Error()
		}
		return js.Undefined()
	})
	defer jsCallback.Release()

	result := bridge.Invoke(storage, jsCallback)
	if result.Get("ok").Bool() {
		return nil
	}
	if err != nil {
		return err
	}
	msg := result.Get("error").String()
	if msg == "" {
		msg = "dopocketflare: transactionSync failed"
	}
	return errors.New(msg)
}

// ── Interface assertions ──────────────────────────────────────────────────

var (
	_ driver.Driver             = (*doDriver)(nil)
	_ driver.Conn               = (*doConn)(nil)
	_ driver.ConnBeginTx        = (*doConn)(nil)
	_ driver.ConnPrepareContext = (*doConn)(nil)
	_ driver.Stmt               = (*doStmt)(nil)
	_ driver.StmtExecContext    = (*doStmt)(nil)
	_ driver.StmtQueryContext   = (*doStmt)(nil)
	_ driver.Tx                 = (*doTx)(nil)
	_ driver.Result             = (*doResult)(nil)
	_ driver.Rows               = (*doRows)(nil)
)
