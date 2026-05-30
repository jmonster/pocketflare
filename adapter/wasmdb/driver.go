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

// txWrapperDriver wraps the syumai D1 connector to provide no-op transactions.
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

// txWrapperConn wraps a D1 connection to provide no-op transactions.
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

func (c *txWrapperConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	return &noopTx{}, nil
}

// noopTx implements driver.Tx with no-op Commit and Rollback.
// Each statement executes immediately through the underlying connection.
// D1 serializes all writes through a single SQLite primary.
type noopTx struct{}

func (tx *noopTx) Commit() error   { return nil }
func (tx *noopTx) Rollback() error { return nil }

var (
	_ driver.Driver      = (*txWrapperDriver)(nil)
	_ driver.Conn        = (*txWrapperConn)(nil)
	_ driver.ConnBeginTx = (*txWrapperConn)(nil)
	_ driver.Tx          = (*noopTx)(nil)
)
