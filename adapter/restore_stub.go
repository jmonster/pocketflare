//go:build !js || !wasm

package adapter

import "github.com/pocketbase/pocketbase/core"

func writeRestoreMarker(marker *RestoreMarker) error {
	return nil
}

func readRestoreMarker() (*RestoreMarker, error) {
	return nil, nil
}

func deleteRestoreMarker() error {
	return nil
}

func writeRestoreMarkerOnlyIfNew(marker *RestoreMarker) error {
	return nil
}

func hasStorageObjects(app core.App) bool {
	return false
}
