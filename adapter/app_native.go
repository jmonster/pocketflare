//go:build !js

// Package adapter bootstraps a PocketBase instance for local development.
package adapter

import (
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/ui"
)

// New creates a new PocketBase app for local development.
func New(config Config) (*pocketbase.PocketBase, *router.Router[*core.RequestEvent], error) {
	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDev:     true,
		DefaultDataDir: config.DataDir,
	})

	if err := pb.Bootstrap(); err != nil {
		return nil, nil, err
	}

	// Inject user-defined Go migrations before running all migrations.
	core.AppMigrations.Copy(config.AppMigrations)

	if err := pb.RunAllMigrations(); err != nil {
		return nil, nil, err
	}

	pbRouter, err := apis.NewRouter(pb)
	if err != nil {
		return nil, nil, err
	}

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
