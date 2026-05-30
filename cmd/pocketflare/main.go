//go:build js && wasm

package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/pocketflare/pocketflare/adapter"
	"github.com/syumai/workers"
	"github.com/syumai/workers/cloudflare/cron"
)

func main() {
	pb, router, err := adapter.New(adapter.Config{
		DataDir:           "/tmp/pb_data",
		AppURL:            trimmedEnv("POCKETFLARE_APP_URL"),
		AdminEmail:        trimmedEnv("POCKETFLARE_ADMIN_EMAIL"),
		AdminPassword:     os.Getenv("POCKETFLARE_ADMIN_PASSWORD"),
		MailProvider:      trimmedEnv("POCKETFLARE_MAIL_PROVIDER"),
		MailAPIKey:        os.Getenv("POCKETFLARE_MAIL_API_KEY"),
		MailDomain:        trimmedEnv("POCKETFLARE_MAIL_DOMAIN"),
		MailWebhookURL:    trimmedEnv("POCKETFLARE_MAIL_WEBHOOK_URL"),
		MailWebhookToken:  os.Getenv("POCKETFLARE_MAIL_WEBHOOK_TOKEN"),
		StorageBucketName:  trimmedEnv("POCKETFLARE_STORAGE_BUCKET_NAME"),
		BackupsBucketName:  trimmedEnv("POCKETFLARE_BACKUPS_BUCKET_NAME"),
	})
	if err != nil {
		log.Fatalf("failed to initialize PocketBase: %v", err)
	}
	defer func() {
		if err := pb.ResetBootstrapState(); err != nil {
			log.Printf("cleanup error: %v", err)
		}
	}()

	handler, err := router.BuildMux()
	if err != nil {
		log.Fatalf("failed to build router: %v", err)
	}

	workers.ServeNonBlock(handler)

	// Wire PocketBase cron to Workers Cron Triggers.
	// The wrangler.toml [triggers] section fires a scheduled event every
	// minute; this handler runs any due PocketBase cron jobs.
	cron.ScheduleTaskNonBlock(func(ctx context.Context) error {
		ev, err := cron.NewEvent(ctx)
		if err != nil {
			return err
		}
		pb.Cron().RunDue(ev.ScheduledTime)
		return nil
	})

	workers.Ready()
	select {}
}

func trimmedEnv(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}
