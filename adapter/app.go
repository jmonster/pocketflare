// Package adapter bootstraps a PocketBase instance for the Workers runtime
// using D1 for database storage.
package adapter

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/pocketflare/pocketflare/adapter/r2blob"
	"github.com/pocketflare/pocketflare/adapter/wasmdb"
	"github.com/pocketflare/pocketflare/adapter/webmailer"
)

// New creates a new PocketBase app pre-configured for the Workers runtime.
//
// It bootstraps the app, runs all migrations, builds the API router with
// CORS, and returns the app instance along with the http.Handler ready for
// use in a Workers fetch handler.
//
// Admin UI static assets are served via Cloudflare Workers Assets from
// admin-ui/_ before WASM boot.
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

	applyNewInstallDefaults(pb, config)

	if err := pb.Bootstrap(); err != nil {
		return nil, nil, fmt.Errorf("bootstrap: %w", err)
	}

	if config.MailWebhookURL != "" {
		registerWebMailer(pb, config)
	}

	// Inject user-defined Go migrations before running all migrations.
	core.AppMigrations.Copy(config.AppMigrations)

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

	return pb, pbRouter, nil
}

func applyNewInstallDefaults(app *pocketbase.PocketBase, config Config) {
	settings := app.Settings()

	// Bootstrap persists these values only when the D1 database has no existing
	// _params/settings row. Migrated and already-deployed projects keep theirs.
	if appURL := strings.TrimRight(strings.TrimSpace(config.AppURL), "/"); appURL != "" {
		settings.Meta.AppURL = appURL
	}

	headers := config.TrustedProxyHeaders
	if headers == nil {
		headers = []string{"CF-Connecting-IP"}
	}
	settings.TrustedProxy.Headers = append([]string(nil), headers...)
}

func registerWebMailer(app *pocketbase.PocketBase, config Config) {
	client := &webmailer.Client{
		URL:   config.MailWebhookURL,
		Token: config.MailWebhookToken,
	}

	app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
		e.Mailer = client
		return e.Next()
	})
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
