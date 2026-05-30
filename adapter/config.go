package adapter

import "github.com/pocketbase/pocketbase/core"

// Config defines the configuration for creating a PocketBase app.
type Config struct {
	AppName       string
	AppURL        string
	AdminEmail    string
	AdminPassword string
	DataDir       string // usually "/tmp/pb_data"; NOT persisted on Workers (ephemeral)
	AppMigrations core.MigrationsList
}
