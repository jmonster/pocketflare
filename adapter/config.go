package adapter

import "github.com/pocketbase/pocketbase/core"

// Config defines the configuration for creating a PocketBase app.
type Config struct {
	AdminEmail          string
	AdminPassword       string
	AppURL              string
	DataDir             string // usually "/tmp/pb_data"; NOT persisted on Workers (ephemeral)

	// MailProvider selects the mail transport:
	//   "resend"|"postmark"|"sendgrid"|"mailgun"|"smtp"|"webhook"|""
	MailProvider string

	// MailAPIKey is the API key for HTTP mail providers.
	// Set via Worker secrets, not wrangler.toml.
	MailAPIKey string

	// MailDomain is the sending domain for Mailgun.
	MailDomain string

	// Legacy webhook settings — used when MailProvider is empty
	// but MailWebhookURL is set (backward compat).
	MailWebhookURL   string
	MailWebhookToken string

	TrustedProxyHeaders []string
	AppMigrations       core.MigrationsList

	// StorageBucketName sets the R2 bucket name for app storage files.
	// Defaults to "pocketflare-storage" if left empty.
	StorageBucketName string

	// BackupsBucketName sets the R2 bucket name for backup files.
	// Defaults to "pocketflare-backups" if left empty.
	BackupsBucketName string
}
