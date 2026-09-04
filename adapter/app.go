// Package adapter bootstraps a PocketBase instance for the Workers runtime
// using D1 for database storage.
package adapter

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/pocketflare/pocketflare/adapter/d1"
	"github.com/pocketflare/pocketflare/adapter/internal/workerhttp"
	"github.com/pocketflare/pocketflare/adapter/mail"
	"github.com/pocketflare/pocketflare/adapter/proof"
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
// dist/admin-ui/_ before WASM boot.
func New(config Config) (*pocketbase.PocketBase, *router.Router[*core.RequestEvent], error) {
	dbMode := strings.ToLower(strings.TrimSpace(config.DBMode))
	if dbMode == "" {
		dbMode = "d1"
	}

	restoreMarker, err := readRestoreMarker()
	if err != nil {
		return nil, nil, fmt.Errorf("restore marker: %w", err)
	}
	restoreOnly := restoreMarker != nil

	dbConnect := wasmdb.Connect()
	switch dbMode {
	case "d1":
	case "do_sqlite":
		dbConnect = wasmdb.ConnectDO()
	default:
		return nil, nil, fmt.Errorf("unsupported database mode %q", config.DBMode)
	}

	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDev:     false,
		DefaultDataDir: config.DataDir,
		DBConnect:      dbConnect,
	})
	pb.SetSkipSystemMigrations(restoreOnly)

	// Wire R2-backed filesystem drivers before Bootstrap.
	storageBucket := config.StorageBucketName
	if storageBucket == "" {
		storageBucket = "pocketflare-storage"
	}
	backupsBucket := config.BackupsBucketName
	if backupsBucket == "" {
		backupsBucket = "pocketflare-backups"
	}
	core.NewWasmFilesystem = func() (*filesystem.System, error) {
		return filesystem.NewBlob(r2blob.New("STORAGE", storageBucket)), nil
	}
	core.NewWasmBackupsFilesystem = func() (*filesystem.System, error) {
		return filesystem.NewBlob(r2blob.New("BACKUPS", backupsBucket)), nil
	}

	applyNewInstallDefaults(pb, config)

	// Configure transaction behavior before Bootstrap because system migrations
	// run during Bootstrap.
	core.RunInTransactionHook = nil
	core.D1BatchMode = dbMode == "d1"
	core.RecordDeleteHook = nil
	apis.PrepareSQLQuery = nil
	if dbMode == "d1" {
		core.RecordDeleteHook = d1.DeleteRecord
		apis.PrepareSQLQuery = d1.PrepareSQLQuery
	} else if dbMode == "do_sqlite" {
		setupDoSqliteMode()
	}

	if err := pb.Bootstrap(); err != nil {
		return nil, nil, fmt.Errorf("bootstrap: %w", err)
	}

	registerMailer(pb, config)

	if !restoreOnly {
		// Normal boot runs migrations and provisions the configured headless
		// superuser. Restore resumes skip both so the restore session can finish.
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
	}
	registerInstallerBinding(pb)

	pbRouter, err := apis.NewRouter(pb)
	if err != nil {
		return nil, nil, err
	}
	pbRouter.Bind(&hook.Handler[*core.RequestEvent]{
		Id:       "pocketflareNormalizeRemoteAddr",
		Priority: apis.DefaultWWWRedirectMiddlewarePriority - 1,
		Func: func(e *core.RequestEvent) error {
			// syumai/workers sets RemoteAddr to bare CF-Connecting-IP; PocketBase
			// expects Go's host:port form when deriving log remoteIP.
			workerhttp.NormalizeRemoteAddr(e.Request)
			return e.Next()
		},
	})

	// Wire Pocketflare-specific routes.
	registerDoctorRoute(pb, pbRouter.Group("/api/pocketflare"), dbMode)
	registerPocketflareRestoreRoutes(pb, pbRouter.Group("/api"), dbMode)
	proof.Register(pb, pbRouter.Group("/api/pocketflare"))

	// Wire the Durable Object realtime bridge so SSE works across isolates.
	initRealtimeDO(pb)

	// Cloudflare storage backends do not support PocketBase's WAL checkpoint
	// path. Replace the optimize cron with a Worker-safe no-op.
	pb.Cron().Remove("__pbDBOptimize__")
	pb.Cron().MustAdd("__pbDBOptimize__", "0 0 * * *", func() {
		pb.Logger().Debug("Pocketflare optimize skipped (Cloudflare storage handles maintenance)")
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

// setupDoSqliteMode replaces PocketBase's standard BEGIN/COMMIT/ROLLBACK
// transaction path with ctx.storage.transactionSync(). The app callback
// runs inside the transactionSync callback, so all SQL operations during
// the transaction execute synchronously and atomically through
// ctx.storage.sql.exec(). OnComplete hooks run after transactionSync returns,
// matching PocketBase's normal post-commit/post-rollback behavior.
func setupDoSqliteMode() {
	core.RunInTransactionHook = func(app *core.BaseApp, db *dbx.DB, fn func(core.App) error, isForAuxDB bool) error {
		var txApp *core.BaseApp
		txErr := wasmdb.RunInTransactionSync(func() error {
			tx, err := db.Begin()
			if err != nil {
				return err
			}

			txApp = app.CreateTxApp(tx, isForAuxDB)
			if err := fn(txApp); err != nil {
				_ = tx.Rollback()
				return err
			}

			if err := tx.Commit(); err != nil {
				return err
			}

			return nil
		})
		if txApp == nil || txApp.TxInfo() == nil {
			return txErr
		}
		afterFuncErr := txApp.TxInfo().RunAfterFuncs(txErr)
		return errors.Join(txErr, afterFuncErr)
	}
}
