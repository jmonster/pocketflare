package main

import (
	"log"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketflare/pocketflare/adapter"
	"github.com/syumai/workers"
)

func main() {
	pb, router, err := adapter.New(adapter.Config{
		DataDir:          "/tmp/pb_data",
		AppURL:           trimmedEnv("POCKETFLARE_APP_URL"),
		AdminEmail:       trimmedEnv("POCKETFLARE_ADMIN_EMAIL"),
		AdminPassword:    os.Getenv("POCKETFLARE_ADMIN_PASSWORD"),
		MailWebhookURL:   trimmedEnv("POCKETFLARE_MAIL_WEBHOOK_URL"),
		MailWebhookToken: os.Getenv("POCKETFLARE_MAIL_WEBHOOK_TOKEN"),
		AppMigrations:    customMigrations(),
	})
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	defer pb.ResetBootstrapState()

	// Custom hook: auto-capitalize task titles
	pb.OnRecordCreate("tasks").BindFunc(func(e *core.RecordEvent) error {
		if title := e.Record.GetString("title"); title != "" {
			e.Record.Set("title", strings.ToUpper(title))
		}
		return e.Next()
	})

	handler, err := router.BuildMux()
	if err != nil {
		log.Fatalf("router: %v", err)
	}

	workers.ServeNonBlock(handler)
	workers.Ready()
	select {}
}

func trimmedEnv(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

// customMigrations creates a 'tasks' collection programmatically.
func customMigrations() core.MigrationsList {
	var migrations core.MigrationsList
	migrations.Register(
		func(app core.App) error {
			collection := core.NewBaseCollection("tasks")
			collection.Fields.Add(&core.TextField{
				Name:     "title",
				Required: true,
			})
			collection.Fields.Add(&core.BoolField{
				Name: "done",
			})
			return app.Save(collection)
		},
		nil, // no down migration
		"create_tasks_collection",
	)
	return migrations
}
