//go:build js && wasm

// Package wasmdb provides a D1-backed DBConnect function for PocketBase.
package wasmdb

import (
	"path/filepath"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	dbx.BuilderFuncMap["d1pocketflare"] = dbx.NewSqliteBuilder
	dbx.BuilderFuncMap["dopocketflare"] = dbx.NewSqliteBuilder
}

// Connect returns a core.DBConnectFunc that routes PocketBase db paths
// to the appropriate D1 Workers binding.
//
//   - "auxiliary.db" (used for the logs database) maps to the "LOGS_DB" binding.
//   - Everything else (the main "data.db") maps to the "APP_DB" binding.
func Connect() core.DBConnectFunc {
	return func(dbPath string) (*dbx.DB, error) {
		binding := "APP_DB"
		if strings.Contains(filepath.Base(dbPath), "auxiliary") {
			binding = "LOGS_DB"
		}
		return dbx.Open("d1pocketflare", binding)
	}
}

// ConnectDO returns a core.DBConnectFunc for DO SQLite mode.
// All database paths open through the "dopocketflare" driver backed
// by ctx.storage.sql. The DO owns a single SQLite database per object,
// so binding-based routing is not needed — all paths resolve to the
// same SQLite instance via ctx.storage.
func ConnectDO() core.DBConnectFunc {
	return func(dbPath string) (*dbx.DB, error) {
		_ = dbPath
		return dbx.Open("dopocketflare", "do-sqlite")
	}
}
