//go:build !js || !wasm

package adapter

import "github.com/pocketbase/pocketbase/core"

func registerInstallerBinding(app core.App) {}
