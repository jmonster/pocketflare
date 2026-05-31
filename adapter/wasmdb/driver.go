//go:build js && wasm

package wasmdb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"sync"
	"syscall/js"

	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

func init() {
	sql.Register("d1pocketflare", &d1Driver{})
}

// D1 batch transaction driver.
//
// D1Database.batch() executes prepared statements sequentially as a SQL
// transaction and rolls back the entire sequence on failure. This driver
// queues writes during the transaction callback and commits them atomically
// via batch(). Rollback drops the queue without any persistence.
//
// Reads before queued writes run directly against D1 and are NOT
// transactionally isolated with the later batch. Reads after queued writes
// fail before persistence rather than seeing stale state.
//
// Pending sql.Result values cannot report RowsAffected or LastInsertId
// until after commit.

// ── driver.Driver ──

type d1Driver struct{}

func (d *d1Driver) Open(name string) (driver.Conn, error) {
	env := js.Global().Get("context").Get("env")
	v := env.Get(name)
	if v.IsUndefined() {
		return nil, errors.New("d1pocketflare: D1 binding not found: " + name)
	}
	return &d1Conn{dbObj: v}, nil
}

// ── driver.Conn / driver.ConnBeginTx / driver.ConnPrepareContext ──

type d1Conn struct {
	dbObj js.Value
	mu    sync.Mutex
	tx    *d1Tx
}

func (c *d1Conn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

func (c *d1Conn) PrepareContext(_ context.Context, query string) (driver.Stmt, error) {
	return &d1Stmt{conn: c, query: query}, nil
}

func (c *d1Conn) Close() error {
	return nil
}

func (c *d1Conn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

var (
	errReadOnlyTx  = errors.New("d1pocketflare: read-only transactions are not supported")
	errIsolationTx = errors.New("d1pocketflare: non-default isolation level is not supported")
	errNestedTx    = errors.New("d1pocketflare: transaction already in progress on this connection")
)

func (c *d1Conn) BeginTx(_ context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if opts.ReadOnly {
		return nil, errReadOnlyTx
	}
	if opts.Isolation != driver.IsolationLevel(0) {
		return nil, errIsolationTx
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.tx != nil {
		return nil, errNestedTx
	}

	tx := &d1Tx{conn: c}
	c.tx = tx
	return tx, nil
}

// ── driver.Stmt / driver.StmtExecContext / driver.StmtQueryContext ──

type d1Stmt struct {
	conn  *d1Conn
	query string
}

func (s *d1Stmt) NumInput() int { return -1 }

func (s *d1Stmt) Close() error { return nil }

func (s *d1Stmt) Exec([]driver.Value) (driver.Result, error) {
	return nil, errors.New("d1pocketflare: Exec is deprecated; use ExecContext")
}

func (s *d1Stmt) Query([]driver.Value) (driver.Rows, error) {
	return nil, errors.New("d1pocketflare: Query is deprecated; use QueryContext")
}

// ExecContext either queues the statement (if in a tx) or executes directly.
func (s *d1Stmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	s.conn.mu.Lock()
	tx := s.conn.tx
	s.conn.mu.Unlock()

	if tx == nil {
		return s.execDirect(ctx, args)
	}

	tx.mu.Lock()
	defer tx.mu.Unlock()

	if tx.done {
		return nil, errors.New("d1pocketflare: transaction already completed")
	}

	// Deep-copy args so we don't hold caller-owned slices.
	copied := copyNamedValues(args)

	r := &pendingResult{}
	tx.statements = append(tx.statements, queuedStatement{query: s.query, args: copied})
	tx.results = append(tx.results, r)

	return r, nil
}

// QueryContext reads directly against D1 before queued writes. Once writes
// are queued, reads fail instead of observing stale committed state.
func (s *d1Stmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	s.conn.mu.Lock()
	tx := s.conn.tx
	s.conn.mu.Unlock()

	if tx != nil {
		tx.mu.Lock()
		done := tx.done
		queuedWrites := len(tx.statements)
		tx.mu.Unlock()
		if done {
			return nil, errors.New("d1pocketflare: transaction already completed")
		}
		if queuedWrites > 0 {
			fmt.Fprintf(os.Stderr,
				`{"family":"pocketflare-driver","event":"query-after-write-blocked","queuedWrites":%d,"query":%q}`+"\n",
				queuedWrites, truncateForLog(s.query))
			return nil, errors.New("d1pocketflare: cannot query after queued writes in a D1 batch transaction")
		}
	}

	return s.queryDirect(ctx, args)
}

// execDirect runs a single statement against D1 non-transactionally.
func (s *d1Stmt) execDirect(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	jsArgs, err := namedValuesToJS(args)
	if err != nil {
		return nil, err
	}
	resultPromise := s.conn.dbObj.Call("prepare", s.query).Call("bind", jsArgs...).Call("run")
	resultObj, err := jsutil.AwaitPromise(ctx, resultPromise)
	if err != nil {
		return nil, err
	}
	m := readResultMeta(resultObj)
	return &directResult{meta: m}, nil
}

// queryDirect runs a single query against D1 non-transactionally.
func (s *d1Stmt) queryDirect(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	jsArgs, err := namedValuesToJS(args)
	if err != nil {
		return nil, err
	}
	resultPromise := s.conn.dbObj.Call("prepare", s.query).Call("bind", jsArgs...).Call("raw", map[string]any{"columnNames": true})
	rowsArray, err := jsutil.AwaitPromise(ctx, resultPromise)
	if err != nil {
		return nil, err
	}

	if rowsArray.Length() == 0 {
		return &d1Rows{rowsArray: rowsArray}, nil
	}

	colsArray := rowsArray.Call("shift")
	colsLen := colsArray.Length()
	cols := make([]string, colsLen)
	for i := 0; i < colsLen; i++ {
		cols[i] = colsArray.Index(i).String()
	}
	return &d1Rows{_columns: cols, rowsArray: rowsArray}, nil
}

// ── driver.Tx ──

type d1Tx struct {
	mu         sync.Mutex
	conn       *d1Conn
	statements []queuedStatement
	results    []*pendingResult
	done       bool
}

type queuedStatement struct {
	query string
	args  []driver.NamedValue
}

var errRolledBack = errors.New("d1pocketflare: transaction rolled back")

// Commit sends all queued statements to D1Database.batch().
func (tx *d1Tx) Commit() error {
	tx.mu.Lock()
	if tx.done {
		tx.mu.Unlock()
		return errors.New("d1pocketflare: transaction already completed")
	}
	tx.done = true

	if len(tx.statements) == 0 {
		tx.mu.Unlock()
		tx.clearConnTx()
		return nil
	}

	stmts := tx.statements
	results := tx.results
	dbObj := tx.conn.dbObj
	tx.mu.Unlock()

	// Build JS array of prepared statements.
	arr := js.Global().Get("Array").New(len(stmts))
	for i, q := range stmts {
		jsArgs, err := namedValuesToJS(q.args)
		if err != nil {
			tx.failResults(results, err)
			tx.clearConnTx()
			return err
		}
		stmt := dbObj.Call("prepare", q.query).Call("bind", jsArgs...)
		arr.SetIndex(i, stmt)
	}

	batchPromise := dbObj.Call("batch", arr)
	batchResults, err := jsutil.AwaitPromise(context.Background(), batchPromise)
	if err != nil {
		tx.failResults(results, err)
		tx.clearConnTx()
		return err
	}

	// Hydrate each pending result from batch results.
	for i, r := range results {
		meta := readResultMeta(batchResults.Index(i))
		r.mu.Lock()
		r.meta = &meta
		r.mu.Unlock()
	}

	tx.clearConnTx()
	return nil
}

func (tx *d1Tx) Rollback() error {
	tx.mu.Lock()
	if tx.done {
		tx.mu.Unlock()
		return errors.New("d1pocketflare: transaction already completed")
	}
	tx.done = true

	for _, r := range tx.results {
		r.mu.Lock()
		r.err = errRolledBack
		r.mu.Unlock()
	}

	tx.statements = nil
	tx.results = nil
	tx.mu.Unlock()

	tx.clearConnTx()
	return nil
}

func (tx *d1Tx) failResults(results []*pendingResult, err error) {
	for _, r := range results {
		r.mu.Lock()
		r.err = err
		r.mu.Unlock()
	}
}

func (tx *d1Tx) clearConnTx() {
	tx.conn.mu.Lock()
	tx.conn.tx = nil
	tx.conn.mu.Unlock()
}

// ── driver.Result (pending + direct) ──

type pendingResult struct {
	mu   sync.Mutex
	meta *resultMeta
	err  error
}

func (r *pendingResult) RowsAffected() (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return 0, r.err
	}
	if r.meta == nil {
		return 0, errors.New("d1pocketflare: result pending commit")
	}
	if !r.meta.hasChanges {
		return 0, errors.New("d1pocketflare: D1 result missing meta.changes")
	}
	return r.meta.changes, nil
}

func (r *pendingResult) LastInsertId() (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return 0, r.err
	}
	if r.meta == nil {
		return 0, errors.New("d1pocketflare: result pending commit")
	}
	if !r.meta.hasLastRowID {
		return 0, errors.New("d1pocketflare: D1 result missing meta.last_row_id")
	}
	return r.meta.lastRowID, nil
}

// directResult is returned by non-transactional ExecContext.
type directResult struct {
	meta resultMeta
}

func (r *directResult) RowsAffected() (int64, error) {
	if !r.meta.hasChanges {
		return 0, errors.New("d1pocketflare: D1 result missing meta.changes")
	}
	return r.meta.changes, nil
}

func (r *directResult) LastInsertId() (int64, error) {
	if !r.meta.hasLastRowID {
		return 0, errors.New("d1pocketflare: D1 result missing meta.last_row_id")
	}
	return r.meta.lastRowID, nil
}

// ── resultMeta ──

type resultMeta struct {
	changes       int64
	lastRowID     int64
	hasChanges    bool
	hasLastRowID  bool
}

func readResultMeta(obj js.Value) resultMeta {
	var m resultMeta
	meta := obj.Get("meta")
	if c := meta.Get("changes"); !c.IsNull() && !c.IsUndefined() {
		m.changes = int64(c.Int())
		m.hasChanges = true
	}
	if l := meta.Get("last_row_id"); !l.IsNull() && !l.IsUndefined() {
		m.lastRowID = int64(l.Int())
		m.hasLastRowID = true
	}
	return m
}

// ── driver.Rows ──

type d1Rows struct {
	rowsArray  js.Value
	currentRow int
	_columns   []string
	mu         sync.Mutex
}

func (r *d1Rows) Columns() []string { return r._columns }

func (r *d1Rows) Close() error { return nil }

func (r *d1Rows) Next(dest []driver.Value) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.currentRow >= r.rowsArray.Length() {
		return io.EOF
	}

	rowArray := r.rowsArray.Index(r.currentRow)
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

// ── Value conversion ──

func namedValuesToJS(args []driver.NamedValue) ([]any, error) {
	out := make([]any, len(args))
	for i, arg := range args {
		v, err := goValueToJS(arg.Value)
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}

func goValueToJS(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	if b, ok := v.([]byte); ok {
		dst := js.Global().Get("Uint8Array").New(len(b))
		if n := js.CopyBytesToJS(dst, b); n != len(b) {
			return nil, errors.New("d1pocketflare: incomplete copy to Uint8Array")
		}
		return dst, nil
	}
	return v, nil
}

func jsValueToGo(v js.Value) (driver.Value, error) {
	switch v.Type() {
	case js.TypeNull:
		return nil, nil
	case js.TypeNumber:
		f := v.Float()
		if isIntegral(f) {
			return int64(f), nil
		}
		return f, nil
	case js.TypeString:
		return v.String(), nil
	case js.TypeObject:
		// ArrayBuffer / blob
		src := js.Global().Get("Uint8Array").New(v)
		dst := make([]byte, src.Length())
		if n := js.CopyBytesToGo(dst, src); n != len(dst) {
			return nil, errors.New("d1pocketflare: incomplete copy from Uint8Array")
		}
		return dst, nil
	default:
		return nil, errors.New("d1pocketflare: unexpected JS value type in row")
	}
}

func isIntegral(f float64) bool {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return false
	}
	return f == math.Trunc(f)
}

// truncateForLog returns a compact representation of a SQL query for diagnostics.
func truncateForLog(query string) string {
	if len(query) > 80 {
		return query[:77] + "..."
	}
	return query
}

func copyNamedValues(args []driver.NamedValue) []driver.NamedValue {
	out := make([]driver.NamedValue, len(args))
	for i, a := range args {
		out[i].Name = a.Name
		out[i].Ordinal = a.Ordinal
		if b, ok := a.Value.([]byte); ok {
			c := make([]byte, len(b))
			copy(c, b)
			out[i].Value = c
		} else {
			out[i].Value = a.Value
		}
	}
	return out
}

// ── Interface assertions ──

var (
	_ driver.Driver             = (*d1Driver)(nil)
	_ driver.Conn               = (*d1Conn)(nil)
	_ driver.ConnBeginTx        = (*d1Conn)(nil)
	_ driver.ConnPrepareContext = (*d1Conn)(nil)
	_ driver.Stmt               = (*d1Stmt)(nil)
	_ driver.StmtExecContext    = (*d1Stmt)(nil)
	_ driver.StmtQueryContext   = (*d1Stmt)(nil)
	_ driver.Tx                 = (*d1Tx)(nil)
	_ driver.Result             = (*pendingResult)(nil)
	_ driver.Result             = (*directResult)(nil)
	_ driver.Rows               = (*d1Rows)(nil)
)
