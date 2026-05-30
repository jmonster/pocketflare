package adapter

import "github.com/pocketbase/pocketbase/core"

// Config defines the configuration for creating a PocketBase app.
type Config struct {
	AdminEmail          string
	AdminPassword       string
	AppURL              string
	DataDir             string // usually "/tmp/pb_data"; NOT persisted on Workers (ephemeral)
	MailWebhookURL      string
	MailWebhookToken    string
	TrustedProxyHeaders []string
	AppMigrations       core.MigrationsList
}
