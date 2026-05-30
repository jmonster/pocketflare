//go:build js && wasm

package main

import (
	"log"
	"os"
	"strings"

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
	workers.Ready()
	select {}
}

func trimmedEnv(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}
