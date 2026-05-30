// Package adapter bootstraps a PocketBase instance for the Workers runtime
// using D1 for database storage.
package adapter

import (
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/ui"

	"github.com/pocketflare/pocketflare/adapter/r2blob"
	"github.com/pocketflare/pocketflare/adapter/wasmdb"
)

// Config defines the configuration for creating a PocketBase Workers app.
type Config struct {
	AppName       string
	AppURL        string
	AdminEmail    string
	AdminPassword string
	DataDir       string // usually "/tmp/pb_data" -- NOT persisted on Workers
}

// New creates a new PocketBase app pre-configured for the Workers runtime.
//
// It bootstraps the app, runs all migrations, builds the API router with
// CORS and the admin dashboard route (with gzip), and returns the app
// instance along with the http.Handler ready for use in a Workers fetch handler.
func New(config Config) (*pocketbase.PocketBase, *router.Router[*core.RequestEvent], error) {
	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDev:     false,
		DefaultDataDir: config.DataDir,
		DBConnect:      wasmdb.Connect(),
	})

	// Wire R2-backed filesystem drivers before Bootstrap.
	core.NewWasmFilesystem = func() (*filesystem.System, error) {
		return filesystem.NewBlob(r2blob.New("STORAGE")), nil
	}
	core.NewWasmBackupsFilesystem = func() (*filesystem.System, error) {
		return filesystem.NewBlob(r2blob.New("BACKUPS")), nil
	}

	if err := pb.Bootstrap(); err != nil {
		return nil, nil, fmt.Errorf("bootstrap: %w", err)
	}

	if err := pb.RunAllMigrations(); err != nil {
		return nil, nil, fmt.Errorf("migrations: %w", err)
	}

	// Create initial superuser if configured.
	if config.AdminEmail != "" && config.AdminPassword != "" {
		if err := ensureSuperuser(pb, config.AdminEmail, config.AdminPassword); err != nil {
			return nil, nil, fmt.Errorf("superuser: %w", err)
		}
	}

	pbRouter, err := apis.NewRouter(pb)
	if err != nil {
		return nil, nil, err
	}

	// Register global CORS middleware (same defaults as apis.Serve).
	pbRouter.Bind(apis.CORS(apis.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{
			http.MethodGet,
			http.MethodHead,
			http.MethodPut,
			http.MethodPatch,
			http.MethodPost,
			http.MethodDelete,
		},
	}))

	// Admin dashboard route (same pattern as apis.Serve).
	pbRouter.GET("/_/{path...}", apis.Static(ui.DistDirFS, false)).
		BindFunc(func(e *core.RequestEvent) error {
			if e.Request.PathValue(apis.StaticWildcardParam) != "" {
				e.Response.Header().Set("Cache-Control", "max-age=1209600, stale-while-revalidate=86400")
			}
			return e.Next()
		}).
		Bind(apis.Gzip())

	return pb, pbRouter, nil
}

// ensureSuperuser creates an initial superuser if one with the given email
// does not already exist.
func ensureSuperuser(app *pocketbase.PocketBase, email, password string) error {
	col, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return fmt.Errorf("find superusers collection: %w", err)
	}

	_, err = app.FindAuthRecordByEmail(col, email)
	if err == nil {
		return nil // already exists
	}

	record := core.NewRecord(col)
	record.SetEmail(email)
	record.SetPassword(password)

	if err := app.Save(record); err != nil {
		return fmt.Errorf("save superuser: %w", err)
	}

	return nil
}
