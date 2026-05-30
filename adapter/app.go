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

	"github.com/pocketflare/pocketflare/adapter/mail"
	"github.com/pocketflare/pocketflare/adapter/r2blob"
	"github.com/pocketflare/pocketflare/adapter/wasmdb"
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
		return filesystem.NewBlob(r2blob.New("STORAGE", "pocketflare-storage")), nil
	}
	core.NewWasmBackupsFilesystem = func() (*filesystem.System, error) {
		return filesystem.NewBlob(r2blob.New("BACKUPS", "pocketflare-backups")), nil
	}

	applyNewInstallDefaults(pb, config)

	if err := pb.Bootstrap(); err != nil {
		return nil, nil, fmt.Errorf("bootstrap: %w", err)
	}

	registerMailer(pb, config)

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

	// Wire the Durable Object realtime bridge so SSE works across isolates.
	initRealtimeDO(pb)

	// D1 doesn't support SQLite PRAGMA statements. Replace the
	// __pbDBOptimize__ cron job with a D1-safe no-op.
	pb.Cron().Remove("__pbDBOptimize__")
	pb.Cron().MustAdd("__pbDBOptimize__", "0 0 * * *", func() {
		pb.Logger().Debug("D1 optimize skipped (D1 handles optimization automatically)")
	})

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

func registerMailer(app *pocketbase.PocketBase, config Config) {
	// Priority 1: explicit POCKETFLARE_MAIL_PROVIDER env var.
	if config.MailProvider != "" {
		ml, err := mail.NewHTTPMailer(config.MailProvider, config.MailAPIKey, config.MailDomain, config.MailWebhookURL, config.MailWebhookToken)
		if err != nil {
			app.Logger().Warn("mail: invalid provider config, mail will not be sent", "provider", config.MailProvider, "error", err)
			return
		}
		app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
			e.Mailer = ml
			return e.Next()
		})
		return
	}

	// Priority 2: legacy POCKETFLARE_MAIL_WEBHOOK_URL env var.
	if config.MailWebhookURL != "" {
		ml, _ := mail.NewHTTPMailer("webhook", "", "", config.MailWebhookURL, config.MailWebhookToken)
		app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
			e.Mailer = ml
			return e.Next()
		})
		return
	}

	// Priority 3: SMTP via PocketBase admin SMTP settings (on-demand).
	app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
		s := app.Settings().SMTP
		if !s.Enabled {
			return e.Next() // no mailer configured; PB will log a warning
		}
		e.Mailer = &mail.SMTPClient{
			Host:       s.Host,
			Port:       s.Port,
			Username:   s.Username,
			Password:   s.Password,
			TLS:        s.TLS,
			AuthMethod: s.AuthMethod,
			LocalName:  s.LocalName,
		}
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
