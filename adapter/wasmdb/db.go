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
